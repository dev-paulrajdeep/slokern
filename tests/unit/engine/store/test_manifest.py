"""
Purpose: Unit tests for engine/store/manifest.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 4, 14 and DEC-0014
"""

import hashlib
import time
from pathlib import Path

import pytest

from slokern.engine.store.manifest import (
    build_campaign_manifest,
    compute_file_sha256,
)


def test_compute_file_sha256_success(tmp_path: Path):
    test_file = tmp_path / "test_data.txt"
    content = b"hello slokern experiment artifact"
    test_file.write_bytes(content)

    expected_sha = hashlib.sha256(content).hexdigest()
    actual_sha = compute_file_sha256(test_file)
    assert actual_sha == expected_sha


def test_compute_file_sha256_large_file(tmp_path: Path):
    test_file = tmp_path / "large_data.bin"
    # Content larger than the 65536 chunk size to test chunk loop
    content = b"x" * 100000
    test_file.write_bytes(content)

    expected_sha = hashlib.sha256(content).hexdigest()
    actual_sha = compute_file_sha256(test_file)
    assert actual_sha == expected_sha


def test_compute_file_sha256_not_found(tmp_path: Path):
    missing_file = tmp_path / "does_not_exist.json"
    with pytest.raises(FileNotFoundError, match="does not exist"):
        compute_file_sha256(missing_file)


def test_build_campaign_manifest_defaults():
    camp_id = "camp-default-01"
    workload = {"workload_name": "test-workload", "arrival_mode": "constant"}
    slo = {"slo_id": "slo-01", "constraints": []}
    candidates = []

    before_ts = time.time()
    manifest = build_campaign_manifest(
        campaign_id=camp_id,
        workload_spec=workload,
        slo_spec=slo,
        candidate_history=candidates,
    )
    after_ts = time.time()

    assert manifest["manifest_version"] == "1.0"
    assert manifest["campaign_id"] == camp_id
    assert before_ts <= manifest["created_at"] <= after_ts
    assert manifest["workload_spec"] == workload
    assert manifest["slo_spec"] == slo
    assert manifest["search_summary"] == {
        "total_candidates_evaluated": 0,
        "winning_candidate_id": None,
        "has_feasible_winner": False,
    }
    assert manifest["candidate_history"] == []
    assert manifest["winning_candidate"] is None
    assert manifest["verification_record"] is None
    assert manifest["artifact_hashes"] == {}
    assert manifest["metadata"] == {}


def test_build_campaign_manifest_with_winner_and_verification():
    camp_id = "camp-win-01"
    workload = {"workload_name": "qwen3-chat", "target_offered_rate": 2.0}
    slo = {"slo_id": "slo-qwen3", "min_sample_count": 10}
    cand_1 = {"candidate_id": "c1", "verdict": "FEASIBLE", "throughput": 50.0}
    cand_2 = {"candidate_id": "c2", "verdict": "INFEASIBLE", "throughput": 60.0}
    candidates = [cand_1, cand_2]
    winner = cand_1
    verification = {
        "verification_run_id": "verif-01",
        "verdict": "VERIFIED",
        "drift_passed": True,
    }
    artifact_files = {
        "run_c1.jsonl": "hash_c1",
        "verification_verif-01.jsonl": "hash_v1",
    }
    extra_metadata = {"env": "local_rtx5060", "vllm_version": "0.34.0"}

    manifest = build_campaign_manifest(
        campaign_id=camp_id,
        workload_spec=workload,
        slo_spec=slo,
        candidate_history=candidates,
        winning_candidate=winner,
        verification_record=verification,
        artifact_files=artifact_files,
        extra_metadata=extra_metadata,
    )

    assert manifest["campaign_id"] == camp_id
    assert manifest["search_summary"] == {
        "total_candidates_evaluated": 2,
        "winning_candidate_id": "c1",
        "has_feasible_winner": True,
    }
    assert manifest["candidate_history"] == candidates
    assert manifest["winning_candidate"] == winner
    assert manifest["verification_record"] == verification
    assert manifest["artifact_hashes"] == artifact_files
    assert manifest["metadata"] == extra_metadata
