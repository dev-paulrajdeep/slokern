"""
Purpose: Unit tests for campaign execution API routes, parameter validation, and SSE event ordering.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 1, 3, 5, 10 and DEC-0014
"""

import json
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from slokern.api.app import handle_api_request
from slokern.api.routes.campaigns import (
    dispatch_campaign_run,
    get_campaign_queue,
    get_campaign_status,
    list_campaigns,
)
from slokern.contracts.enums import ExecutionStatus, FeasibilityVerdict, VerificationState
from slokern.contracts.metrics import MetricSet
from slokern.contracts.verdict import FeasibilityResult
from slokern.engine.runner.run_executor import SingleRunResult


def test_campaign_creation_202_accepted(tmp_path: Path):
    payload = {
        "adapter": "fake",
        "workload": {
            "workload_name": "unit-test-campaign",
            "target_offered_rate": 2.0,
            "measurement_duration_s": 1,
            "concurrency_limit": 1,
        },
        "slo": {
            "p95_ttft_threshold": 500.0,
            "max_error_rate": 0.05,
        },
    }

    status, headers, body = handle_api_request(
        "POST",
        "/api/campaigns/run",
        body=payload,
        artifacts_root=str(tmp_path),
    )

    assert status == 202
    assert headers["Content-Type"] == "application/json"
    data = json.loads(body.decode("utf-8"))
    assert "campaign_id" in data
    assert data["campaign_id"].startswith("cmp-")
    assert data["status"] == "ACCEPTED"
    assert data["stream_url"] == f"/api/campaigns/{data['campaign_id']}/stream"


def test_campaign_parameter_validation_invalid_adapter(tmp_path: Path):
    payload = {
        "adapter": "invalid_engine_adapter",
        "target_offered_rate": 5.0,
    }
    status, headers, body = handle_api_request(
        "POST",
        "/api/campaigns/run",
        body=payload,
        artifacts_root=str(tmp_path),
    )
    assert status == 400
    data = json.loads(body.decode("utf-8"))
    assert "error" in data
    assert "invalid adapter" in data["error"].lower()


def test_campaign_parameter_validation_invalid_model(tmp_path: Path):
    payload = {
        "adapter": "fake",
        "model_name": 12345,  # Non-string
    }
    status, headers, body = handle_api_request(
        "POST",
        "/api/campaigns/run",
        body=payload,
        artifacts_root=str(tmp_path),
    )
    assert status == 400
    data = json.loads(body.decode("utf-8"))
    assert "error" in data
    assert "model_name" in data["error"]


def test_campaign_parameter_validation_negative_rates(tmp_path: Path):
    # Negative offered rate
    payload1 = {
        "adapter": "fake",
        "workload": {
            "target_offered_rate": -5.0,
            "measurement_duration_s": 2,
        },
    }
    status1, _, body1 = handle_api_request(
        "POST",
        "/api/campaigns/run",
        body=payload1,
        artifacts_root=str(tmp_path),
    )
    assert status1 == 400
    assert "target_offered_rate must be positive" in json.loads(body1.decode("utf-8"))["error"]

    # Zero duration
    payload2 = {
        "adapter": "fake",
        "workload": {
            "target_offered_rate": 2.0,
            "measurement_duration_s": 0,
        },
    }
    status2, _, body2 = handle_api_request(
        "POST",
        "/api/campaigns/run",
        body=payload2,
        artifacts_root=str(tmp_path),
    )
    assert status2 == 400
    assert "measurement_duration_s must be positive" in json.loads(body2.decode("utf-8"))["error"]


def test_campaign_parameter_validation_invalid_slo(tmp_path: Path):
    payload = {
        "adapter": "fake",
        "p95_ttft_threshold": -100.0,
    }
    status, _, body = handle_api_request(
        "POST",
        "/api/campaigns/run",
        body=payload,
        artifacts_root=str(tmp_path),
    )
    assert status == 400
    data = json.loads(body.decode("utf-8"))
    assert "p95_ttft_threshold must be positive" in data["error"]


def test_campaign_sse_event_ordering_and_artifact_persistence(tmp_path: Path):
    """
    Verifies full 6-run campaign SSE event sequence:
    campaign_started -> candidate_completed x5 -> winner_selected -> verification_completed -> campaign_completed
    and verifies that search_result.json, verification_record.json, and report.md are written to disk.
    """
    campaign_id = "cmp-test-sse-01"
    payload = {
        "campaign_id": campaign_id,
        "adapter": "fake",
        "workload": {
            "workload_name": "sse-test-workload",
            "target_offered_rate": 10.0,
            "measurement_duration_s": 1,
            "warmup_duration_s": 0,
            "concurrency_limit": 1,
        },
        "slo": {
            "p95_ttft_threshold": 500.0,
            "max_error_rate": 0.05,
        },
    }

    # Execute dispatch
    status_code, res = dispatch_campaign_run(payload, artifacts_root=str(tmp_path))
    assert status_code == 202
    assert res["campaign_id"] == campaign_id

    queue = get_campaign_queue(campaign_id)
    assert queue is not None

    # Collect events from queue with timeout
    events = []
    deadline = time.time() + 15.0
    while time.time() < deadline:
        event_str = queue.get(timeout=0.5)
        if event_str is None:
            if queue.is_closed:
                break
            continue
        # Parse SSE data line
        assert event_str.startswith("data: ")
        raw_json = event_str[len("data: "):].strip()
        data = json.loads(raw_json)
        events.append(data)
        if data.get("type") == "campaign_completed":
            break

    event_types = [e["type"] for e in events]

    # Verify event ordering
    assert "campaign_started" in event_types
    assert event_types[0] == "campaign_started"
    assert events[0]["total_runs"] == 6

    # Verify request_progress events exist
    progress_events = [e for e in events if e["type"] == "request_progress"]
    assert len(progress_events) > 0
    assert "completed" in progress_events[0]
    assert "total" in progress_events[0]

    # Verify candidate_completed emitted exactly 5 times (baseline + 4 grid candidates)
    cand_completed = [e for e in events if e["type"] == "candidate_completed"]
    assert len(cand_completed) == 5, f"Expected 5 candidate_completed events, got {len(cand_completed)}"

    # Verify run indices
    run_indices = [c["run_index"] for c in cand_completed]
    assert run_indices == [0, 1, 2, 3, 4]

    # Verify winner_selected occurs after candidate_completed
    assert "winner_selected" in event_types
    winner_idx = event_types.index("winner_selected")
    last_cand_idx = max(i for i, t in enumerate(event_types) if t == "candidate_completed")
    assert winner_idx > last_cand_idx

    # Verify verification events
    assert "verification_started" in event_types
    assert "verification_completed" in event_types
    verif_comp_idx = event_types.index("verification_completed")
    assert verif_comp_idx > winner_idx

    # Verify campaign_completed is final event
    assert "campaign_completed" in event_types
    assert event_types[-1] == "campaign_completed"
    comp_event = events[-1]
    assert comp_event["winner_id"] is not None
    assert comp_event["is_verified"] is True

    # Verify artifacts persisted to disk
    camp_dir = tmp_path / "experiments" / campaign_id
    assert (camp_dir / "search_result.json").exists()
    assert (camp_dir / "verification_record.json").exists()
    assert (camp_dir / "report.md").exists()
    assert (camp_dir / "report.json").exists()

    # Verify content of search_result.json
    search_data = json.loads((camp_dir / "search_result.json").read_text(encoding="utf-8"))
    assert search_data["experiment_id"] == campaign_id
    assert len(search_data["tested_candidates"]) == 5
    assert search_data["selected_candidate_id"] == comp_event["winner_id"]

    # Verify content of verification_record.json
    verif_data = json.loads((camp_dir / "verification_record.json").read_text(encoding="utf-8"))
    assert verif_data["verification_verdict"] == "VERIFIED"


def test_campaign_status_and_listing(tmp_path: Path):
    # Test 404 on nonexistent campaign
    status, _, body = handle_api_request("GET", "/api/campaigns/cmp-nonexistent", artifacts_root=str(tmp_path))
    assert status == 404

    # Test listing
    status, _, body = handle_api_request("GET", "/api/campaigns", artifacts_root=str(tmp_path))
    assert status == 200
    campaigns = json.loads(body.decode("utf-8"))
    assert isinstance(campaigns, list)
