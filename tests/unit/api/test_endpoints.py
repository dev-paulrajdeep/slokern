"""
Purpose: Test comprehensive API discovery, runtime profiles, candidate extraction, and reports.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 1, 3, 4, 10 and DEC-0014
"""

import json
from slokern.api.app import handle_api_request


def test_api_runtime_endpoint():
    status, headers, body = handle_api_request("GET", "/api/runtime", artifacts_root="artifacts")
    assert status == 200
    assert headers["Content-Type"] == "application/json"
    data = json.loads(body.decode("utf-8"))
    assert data["status"] == "ok"
    assert data["provider"] in ("vllm", "nebius", "ollama", "fake", "N/A")
    assert data["adapter"] in ("vllm", "vllm-nebius", "ollama", "fake", "vllm-fake")


def test_api_smoke_test_latest():
    status, headers, body = handle_api_request("GET", "/api/smoke-test/latest", artifacts_root="artifacts")
    assert status == 200
    data = json.loads(body.decode("utf-8"))
    assert data["status"] == "PASSED"
    assert data["adapter"] in ("vllm", "vllm-nebius", "ollama", "fake", "vllm-fake")
    assert data["probe_request"]["ttft_ms"] > 0


def test_api_experiments_discovery():
    status, headers, body = handle_api_request("GET", "/api/experiments", artifacts_root="artifacts")
    assert status == 200
    data = json.loads(body.decode("utf-8"))
    assert isinstance(data, list)
    assert len(data) > 0
    exp_ids = [e["id"] for e in data]
    assert "exp-audit-offline-campaign" in exp_ids

    campaign = next(e for e in data if e["id"] == "exp-audit-offline-campaign")
    assert campaign["evidenceClassification"] == "DEMO DATA"
    assert campaign["runsCount"] == 5
    assert campaign["candidateId"] == "15594344d2bf"


def test_api_candidates_extraction():
    status, headers, body = handle_api_request(
        "GET", "/api/experiments/exp-audit-offline-campaign/candidates", artifacts_root="artifacts"
    )
    assert status == 200
    candidates = json.loads(body.decode("utf-8"))
    assert len(candidates) == 5
    winner = next(c for c in candidates if c["tag"] == "WINNER")
    assert winner["id"] == "15594344d2bf"
    assert winner["throughput"] == 160.0
    assert winner["feasible"] is True


def test_api_reports_discovery():
    status, headers, body = handle_api_request("GET", "/api/reports", artifacts_root="artifacts")
    assert status == 200
    reports = json.loads(body.decode("utf-8"))
    assert isinstance(reports, list)
    assert len(reports) > 0

