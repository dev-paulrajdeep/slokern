"""
Purpose: Unit tests for VLLMServingAdapter, loopback security, streaming TTFT, and Prometheus cross-check.
Owner: Rajdeep (Architecture & Implementation)
Authority: Aligned with AGENTS.md Section 1, 3, 9, 12, 13 and DEC-0014
"""

import json
import urllib.error
import urllib.request
from unittest.mock import MagicMock, patch

import pytest

from slokern.contracts.config import CandidateConfig
from slokern.contracts.enums import ParameterStatus
from slokern.engine.serving.base import ConfigurationError, ServingRequest
from slokern.engine.serving.vllm import (
    VLLMServingAdapter,
    classify_qwen3_text,
)


def test_vllm_default_endpoint_and_model():
    """Verifies default endpoint is http://localhost:8000 and model is slokern-qwen3-1.7b."""
    adapter = VLLMServingAdapter()
    assert adapter.base_url == "http://localhost:8000"
    assert adapter.model_name == "slokern-qwen3-1.7b"
    assert adapter.runtime_name == "vllm"

    fp = adapter.get_environment_fingerprint()
    assert fp["provider"] == "vllm"
    assert fp["endpoint_host"] == "localhost:8000"
    assert fp["is_simulated"] is False
    assert fp["security_boundary"] == "strict_loopback"
    assert fp["execution_mode"] == "enforce_eager"


def test_vllm_rejects_non_loopback():
    """Non-loopback host raises ConfigurationError unless allow_remote is declared."""
    with pytest.raises(ConfigurationError) as exc_info:
        VLLMServingAdapter(base_url="http://192.168.1.100:8000")
    assert "not a permitted loopback address" in str(exc_info.value)

    with pytest.raises(ConfigurationError) as exc_info:
        VLLMServingAdapter(base_url="http://remote-vllm.example.com:8000")
    assert "not a permitted loopback address" in str(exc_info.value)

    # When allow_remote is True, it succeeds
    adapter = VLLMServingAdapter(base_url="http://remote-vllm.example.com:8000", allow_remote=True)
    assert adapter.base_url == "http://remote-vllm.example.com:8000"


def test_vllm_rejects_url_credentials():
    """Userinfo in URL credentials raises ConfigurationError."""
    with pytest.raises(ConfigurationError) as exc_info:
        VLLMServingAdapter(base_url="http://admin:secret@localhost:8000")
    assert "URL credentials (userinfo) are prohibited" in str(exc_info.value)


def test_classify_qwen3_text():
    """Verifies classification of Qwen3 reasoning and content text."""
    text_with_think = "<think>\nThinking step 1.\nThinking step 2.\n</think>\nHere is the answer."
    res = classify_qwen3_text(text_with_think)
    assert res["has_reasoning"] is True
    assert res["reasoning_tokens"] > 0
    assert res["content_tokens"] > 0
    assert res["unclassified_flag"] is None

    text_plain = "Simple direct answer without reasoning."
    res_plain = classify_qwen3_text(text_plain)
    assert res_plain["has_reasoning"] is False
    assert res_plain["reasoning_tokens"] == 0
    assert res_plain["content_tokens"] > 0


def test_vllm_check_readiness_success():
    """Verifies readiness check succeeds when health returns 200 and model is present."""
    adapter = VLLMServingAdapter()

    health_resp = MagicMock()
    health_resp.status = 200
    health_resp.__enter__.return_value = health_resp
    health_resp.__exit__.return_value = None

    models_data = {"data": [{"id": "slokern-qwen3-1.7b", "object": "model"}]}
    models_resp = MagicMock()
    models_resp.status = 200
    models_resp.read.return_value = json.dumps(models_data).encode("utf-8")
    models_resp.__enter__.return_value = models_resp
    models_resp.__exit__.return_value = None

    def mock_open(req, timeout=None):
        if req.full_url.endswith("/health"):
            return health_resp
        elif req.full_url.endswith("/v1/models"):
            return models_resp
        raise ValueError(f"Unexpected url {req.full_url}")

    with patch.object(adapter._opener, "open", side_effect=mock_open):
        readiness = adapter.check_readiness()
        assert readiness["ready"] is True
        assert readiness["model_available"] is True
        assert readiness["daemon_reachable"] is True
        assert adapter.health_check() is True


def test_vllm_check_readiness_connection_error():
    """Verifies connection error is cleanly captured without unhandled exceptions."""
    adapter = VLLMServingAdapter()

    with patch.object(adapter._opener, "open", side_effect=urllib.error.URLError("Connection refused")):
        readiness = adapter.check_readiness()
        assert readiness["ready"] is False
        assert readiness["daemon_reachable"] is False
        assert "Cannot connect to vLLM daemon" in readiness["error"]
        assert adapter.health_check() is False


def test_vllm_apply_config_evaluation():
    """Verifies dynamic parameters are applied and unsupported flags categorized."""
    adapter = VLLMServingAdapter()
    candidate = CandidateConfig(
        candidate_id="cand-vllm-01",
        model_name="slokern-qwen3-1.7b",
        runtime_name="vllm",
        requested_settings={
            "concurrency_limit": 2,
            "max_tokens": 128,
            "temperature": 0.0,
            "max_num_batched_tokens": 4096,  # Unsupported startup flag
        },
        effective_settings={},
        parameter_status={},
        environment_fingerprint={},
    )

    # In non-strict mode, unsupported parameters are marked UNSUPPORTED without exception
    updated = adapter.apply_config(candidate, strict=False)
    assert updated.parameter_status["concurrency_limit"] == ParameterStatus.APPLIED
    assert updated.parameter_status["max_tokens"] == ParameterStatus.APPLIED
    assert updated.parameter_status["max_num_batched_tokens"] == ParameterStatus.UNSUPPORTED
    assert updated.effective_settings["concurrency_limit"] == 2
    assert updated.effective_settings["max_tokens"] == 128

    # In strict mode, unsupported parameter raises ConfigurationError
    with pytest.raises(ConfigurationError) as exc_info:
        adapter.apply_config(candidate, strict=True)
    assert "Configuration rejected by runtime 'vllm'" in str(exc_info.value)


def test_vllm_generate_non_streaming():
    """Verifies non-streaming generation parsing and token classification."""
    adapter = VLLMServingAdapter()
    sample_response = {
        "id": "chatcmpl-test-01",
        "object": "chat.completion",
        "created": 1731900000,
        "model": "slokern-qwen3-1.7b",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "<think>\nEvaluate constraints.\n</think>\nFeasible.",
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 15,
            "completion_tokens": 10,
            "total_tokens": 25,
        },
    }

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = json.dumps(sample_response).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = None

    with patch.object(adapter._opener, "open", return_value=mock_resp):
        res = adapter.generate("Test prompt")
        assert res.status_code == 200
        assert res.input_tokens == 15
        assert res.output_tokens == 10
        assert "Feasible." in res.text
        assert res.metadata["reasoning_tokens"] > 0
        assert res.metadata["has_reasoning"] is True


def test_vllm_stream_generate():
    """Verifies streaming token parsing, TTFT extraction on first content chunk, and ITL deltas."""
    adapter = VLLMServingAdapter()

    sse_lines = [
        b'data: {"choices": [{"delta": {"role": "assistant"}}]}\n\n',
        b'data: {"choices": [{"delta": {"content": "<think>"}}]}\n\n',
        b'data: {"choices": [{"delta": {"content": "Reasoning"}}]}\n\n',
        b'data: {"choices": [{"delta": {"content": "</think>"}}]}\n\n',
        b'data: {"choices": [{"delta": {"content": "Result."}}]}\n\n',
        b'data: [DONE]\n\n',
    ]

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.__iter__.return_value = iter(sse_lines)
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = None

    with patch.object(adapter._opener, "open", return_value=mock_resp):
        chunks = list(adapter.stream_generate(ServingRequest(prompt="Test streaming")))

        assert len(chunks) == 5  # 4 content chunks + 1 final done chunk
        assert chunks[0].token == "<think>"
        assert chunks[0].metadata["token_category"] == "reasoning"
        assert chunks[3].token == "Result."
        assert chunks[3].metadata["token_category"] == "content"
        assert chunks[4].is_last is True
        assert chunks[4].metadata["done"] is True


def test_vllm_scrape_prometheus_metrics():
    """Verifies parsing of vLLM Prometheus metrics."""
    adapter = VLLMServingAdapter()

    sample_metrics = """
# HELP vllm:time_to_first_token_seconds Histogram of TTFT
# TYPE vllm:time_to_first_token_seconds histogram
vllm:time_to_first_token_seconds_bucket{le="0.1",model_name="slokern-qwen3-1.7b"} 5.0
vllm:time_to_first_token_seconds_bucket{le="0.5",model_name="slokern-qwen3-1.7b"} 10.0
vllm:time_to_first_token_seconds_bucket{le="+Inf",model_name="slokern-qwen3-1.7b"} 10.0
vllm:time_to_first_token_seconds_sum{model_name="slokern-qwen3-1.7b"} 1.77
vllm:time_to_first_token_seconds_count{model_name="slokern-qwen3-1.7b"} 10.0
# HELP vllm:prompt_tokens_total Total prompt tokens
vllm:prompt_tokens_total{model_name="slokern-qwen3-1.7b"} 230.0
# HELP vllm:num_requests_running Number of requests running
vllm:num_requests_running{model_name="slokern-qwen3-1.7b"} 0.0
"""

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = sample_metrics.encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = None

    with patch.object(adapter._opener, "open", return_value=mock_resp):
        parsed = adapter.scrape_prometheus_metrics()
        assert parsed["success"] is True
        assert "vllm:prompt_tokens_total" in parsed["counters"]
        assert parsed["counters"]["vllm:prompt_tokens_total"] == 230.0
        assert parsed["gauges"]["vllm:num_requests_running"] == 0.0
        assert "vllm:time_to_first_token_seconds" in parsed["histograms"]
        hist = parsed["histograms"]["vllm:time_to_first_token_seconds"]
        assert hist["count"] == 10.0
        assert hist["sum"] == 1.77


def test_vllm_calculate_prometheus_cross_check():
    """Verifies cross-checking client TTFT against Prometheus histogram deltas and warning thresholds."""
    before = {
        "success": True,
        "histograms": {
            "vllm:time_to_first_token_seconds": {"count": 10.0, "sum": 1.77}
        },
    }
    after = {
        "success": True,
        "histograms": {
            "vllm:time_to_first_token_seconds": {"count": 20.0, "sum": 3.77}
        },
    }

    # Delta: count = 10, sum = 2.0 -> mean server TTFT = 200.0 ms
    # Client TTFT = 210.0 ms -> skew = 10.0 ms <= 25.0 ms threshold (No warning)
    res_ok = VLLMServingAdapter.calculate_prometheus_cross_check(before, after, client_ttft_mean_ms=210.0)
    assert res_ok["reconciled"] is True
    assert res_ok["server_ttft_mean_ms"] == 200.0
    assert res_ok["skew_ms"] == 10.0
    assert res_ok["skew_warning"] is False

    # Client TTFT = 240.0 ms -> skew = 40.0 ms > 25.0 ms (Triggers warning)
    res_warn = VLLMServingAdapter.calculate_prometheus_cross_check(before, after, client_ttft_mean_ms=240.0)
    assert res_warn["skew_ms"] == 40.0
    assert res_warn["skew_warning"] is True
    assert "exceeds 25.0ms threshold" in res_warn["warning_message"]


def test_vllm_stream_reasoning_content_delta():
    """Verifies streaming chunks with reasoning_content in delta are classified as reasoning."""
    adapter = VLLMServingAdapter()

    sse_lines = [
        b'data: {"choices": [{"delta": {"reasoning_content": "Step 1: evaluate constraint"}}]}\n\n',
        b'data: {"choices": [{"delta": {"reasoning_content": "Step 2: compute margin"}}]}\n\n',
        b'data: {"choices": [{"delta": {"content": "Final Answer."}}]}\n\n',
        b'data: [DONE]\n\n',
    ]

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.__iter__.return_value = iter(sse_lines)
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = None

    with patch.object(adapter._opener, "open", return_value=mock_resp):
        chunks = list(adapter.stream_generate(ServingRequest(prompt="Test reasoning delta")))

        assert len(chunks) == 4
        assert chunks[0].token == "Step 1: evaluate constraint"
        assert chunks[0].metadata["token_category"] == "reasoning"
        assert chunks[1].token == "Step 2: compute margin"
        assert chunks[1].metadata["token_category"] == "reasoning"
        assert chunks[2].token == "Final Answer."
        assert chunks[2].metadata["token_category"] == "content"
        assert chunks[3].is_last is True


def test_vllm_stream_empty_and_truncated_chunks():
    """Verifies handling of empty SSE deltas and truncated think blocks."""
    adapter = VLLMServingAdapter()

    # Stream with empty delta followed by unclosed <think> tag
    sse_lines = [
        b'data: {"choices": [{"delta": {}}]}\n\n',
        b'data: {"choices": [{"delta": {"content": ""}}]}\n\n',
        b'data: {"choices": [{"delta": {"content": "<think>Drafting reasoning..."}}]}\n\n',
        b'data: [DONE]\n\n',
    ]

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.__iter__.return_value = iter(sse_lines)
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = None

    with patch.object(adapter._opener, "open", return_value=mock_resp):
        chunks = list(adapter.stream_generate(ServingRequest(prompt="Test empty & truncated")))

        assert len(chunks) == 2  # The 1 valid content chunk + [DONE]
        assert chunks[0].token == "<think>Drafting reasoning..."
        assert chunks[0].metadata["token_category"] == "reasoning"
        assert chunks[1].is_last is True

    # classify_qwen3_text handles truncated block
    classified = classify_qwen3_text("<think>Unclosed reasoning block")
    assert classified["unclassified_flag"] == "truncated_think_block"
    assert classified["reasoning_tokens"] > 0


def test_vllm_prometheus_cross_check_configurable_threshold():
    """Verifies skew_threshold_ms parameter alters warning triggering."""
    before = {
        "success": True,
        "histograms": {
            "vllm:time_to_first_token_seconds": {"count": 10.0, "sum": 1.0}
        },
    }
    after = {
        "success": True,
        "histograms": {
            "vllm:time_to_first_token_seconds": {"count": 20.0, "sum": 2.0}
        },
    }
    # Server mean TTFT: (2.0 - 1.0)/(20 - 10) = 0.1s = 100.0 ms
    # Client TTFT = 135.0 ms -> skew = 35.0 ms

    # With default threshold (25.0ms) -> warning
    res_default = VLLMServingAdapter.calculate_prometheus_cross_check(before, after, client_ttft_mean_ms=135.0)
    assert res_default["skew_warning"] is True
    assert res_default["skew_threshold_ms"] == 25.0

    # With relaxed threshold (50.0ms) -> no warning
    res_relaxed = VLLMServingAdapter.calculate_prometheus_cross_check(
        before, after, client_ttft_mean_ms=135.0, skew_threshold_ms=50.0
    )
    assert res_relaxed["skew_warning"] is False
    assert res_relaxed["skew_threshold_ms"] == 50.0
    assert res_relaxed["warning_message"] is None

    # With strict threshold (10.0ms) -> warning
    res_strict = VLLMServingAdapter.calculate_prometheus_cross_check(
        before, after, client_ttft_mean_ms=115.0, skew_threshold_ms=10.0
    )
    assert res_strict["skew_warning"] is True
    assert res_strict["skew_threshold_ms"] == 10.0

