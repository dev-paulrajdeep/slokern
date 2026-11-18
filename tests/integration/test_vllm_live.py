"""
Purpose: Live integration tests validating VLLMServingAdapter against running local vLLM instance.
Owner: Rajdeep (Architecture & Implementation)
Authority: Aligned with AGENTS.md Section 1, 10, 12, 13 and docs/local-benchmark-protocol.md
"""

import pytest

from slokern.engine.serving.base import ServingRequest
from slokern.engine.serving.vllm import VLLMServingAdapter


@pytest.fixture(scope="module")
def live_adapter():
    """Initializes VLLMServingAdapter targeting live local vLLM server."""
    adapter = VLLMServingAdapter(
        base_url="http://localhost:8000",
        model_name="slokern-qwen3-1.7b",
        timeout_s=30.0,
    )
    # Strict requirement: endpoint must be active
    readiness = adapter.check_readiness()
    if not readiness["ready"]:
        pytest.fail(
            f"STRICT REQUIREMENT FAILED: Live vLLM endpoint at http://localhost:8000 is unreachable or model missing. "
            f"Details: {readiness}"
        )
    return adapter


def test_stage0_live_preflight_and_discovery(live_adapter):
    """Stage 0: Asserts live server health, model discovery, and environment fingerprint."""
    readiness = live_adapter.check_readiness()
    assert readiness["ready"] is True
    assert readiness["daemon_reachable"] is True
    assert readiness["model_available"] is True
    assert "slokern-qwen3-1.7b" in readiness["discovered_models"]

    fp = live_adapter.get_environment_fingerprint()
    assert fp["provider"] == "vllm"
    assert fp["endpoint_host"] == "localhost:8000"
    assert fp["model_name"] == "slokern-qwen3-1.7b"
    assert fp["is_simulated"] is False


def test_stage1_live_non_streaming_inference(live_adapter):
    """Stage 1A: Executes live non-streaming inference on RTX 5060 GPU."""
    req = ServingRequest(
        prompt="Explain KV cache in 15 words or less.",
        max_tokens=32,
        temperature=0.0,
        request_id="req-live-stage1-01",
    )
    res = live_adapter.generate(req)
    assert res.status_code == 200
    assert res.error is None
    assert len(res.text) > 0
    assert res.input_tokens > 0
    assert res.output_tokens > 0
    assert res.total_latency_ms > 0.0


def test_stage1_live_streaming_inference(live_adapter):
    """Stage 1B: Executes live streaming SSE inference and verifies chunk timings."""
    req = ServingRequest(
        prompt="Count from 1 to 5 clearly.",
        max_tokens=32,
        temperature=0.0,
        stream=True,
        request_id="req-live-stage1-02",
    )
    chunks = list(live_adapter.stream_generate(req))
    assert len(chunks) >= 2

    # Verify first content chunk timing (TTFT)
    first_chunk = chunks[0]
    assert first_chunk.timestamp_ms > 0.0
    assert first_chunk.latency_ms > 0.0

    # Verify final chunk terminates cleanly
    last_chunk = chunks[-1]
    assert last_chunk.is_last is True


def test_stage2_live_prometheus_cross_check(live_adapter):
    """Stage 2: Scrapes Prometheus before/after live requests and reconciles TTFT."""
    snap_before = live_adapter.scrape_prometheus_metrics()
    assert snap_before["success"] is True
    assert "vllm:time_to_first_token_seconds" in snap_before["histograms"]

    # Execute 3 sequential streaming requests
    ttft_observations = []
    for i in range(3):
        req = ServingRequest(
            prompt=f"Provide item number {i+1} in a benchmark.",
            max_tokens=16,
            temperature=0.0,
            stream=True,
            request_id=f"req-live-stage2-0{i}",
        )
        chunks = list(live_adapter.stream_generate(req))
        assert len(chunks) > 0
        ttft_observations.append(chunks[0].latency_ms)

    mean_client_ttft = sum(ttft_observations) / len(ttft_observations)
    assert mean_client_ttft > 0.0

    snap_after = live_adapter.scrape_prometheus_metrics()
    assert snap_after["success"] is True

    cross_check = VLLMServingAdapter.calculate_prometheus_cross_check(
        snap_before, snap_after, client_ttft_mean_ms=mean_client_ttft
    )
    assert cross_check["reconciled"] is True
    assert cross_check["count_delta"] >= 3.0
    assert cross_check["server_ttft_mean_ms"] is not None
