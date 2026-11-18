"""
Purpose: Unit tests validating files in fixtures/workloads/ and workload loader functions.
Owner: Rajdeep (Historical design: Adriraj)
Authority: Aligned with AGENTS.md Section 4, 10, 13 and docs/experiment-methodology.md
"""

from pathlib import Path

import pytest
from pydantic import ValidationError

from slokern.contracts.enums import ArrivalMode
from slokern.contracts.spec import WorkloadSpec
from slokern.engine.workload.fixtures import (
    get_fixtures_workload_dir,
    list_workload_fixtures,
    load_workload_spec_from_file,
)


def test_workload_fixtures_dir_exists():
    fixtures_dir = get_fixtures_workload_dir()
    assert fixtures_dir.exists()
    assert fixtures_dir.is_dir()


def test_list_workload_fixtures_finds_files():
    fixtures = list_workload_fixtures()
    assert len(fixtures) > 0
    names = [f.name for f in fixtures]
    assert "local_qwen3_chat.json" in names


def test_local_qwen3_chat_fixture_schema():
    fixtures_dir = get_fixtures_workload_dir()
    fixture_path = fixtures_dir / "local_qwen3_chat.json"
    assert fixture_path.is_file()

    spec = load_workload_spec_from_file(fixture_path)
    assert isinstance(spec, WorkloadSpec)
    assert spec.schema_version == "1.0.0"
    assert spec.workload_name == "local-qwen3-chat-workload"
    assert spec.fixture_id == "fix-qwen3-chat-01"
    assert spec.arrival_mode == ArrivalMode.CONSTANT
    assert spec.target_offered_rate == 1.5
    assert spec.concurrency_limit == 2
    assert spec.warmup_duration_s == 8
    assert spec.measurement_duration_s == 15
    assert spec.max_input_tokens == 128
    assert spec.max_output_tokens == 32


def test_all_json_workload_fixtures_valid():
    fixtures = list_workload_fixtures()
    assert len(fixtures) > 0
    for fixture_path in fixtures:
        spec = load_workload_spec_from_file(fixture_path)
        assert isinstance(spec, WorkloadSpec)
        assert spec.target_offered_rate > 0
        assert spec.concurrency_limit >= 1
        assert spec.warmup_duration_s >= 0
        assert spec.measurement_duration_s > 0
        assert spec.max_input_tokens > 0
        assert spec.max_output_tokens > 0


def test_load_workload_spec_missing_file(tmp_path: Path):
    non_existent = tmp_path / "missing_workload.json"
    with pytest.raises(FileNotFoundError, match="does not exist"):
        load_workload_spec_from_file(non_existent)


def test_workload_fixture_rejects_extra_fields(tmp_path: Path):
    bad_fixture = tmp_path / "bad_workload.json"
    bad_fixture.write_text(
        """{
            "schema_version": "1.0.0",
            "workload_name": "invalid-extra",
            "fixture_id": "fix-bad-01",
            "arrival_mode": "constant",
            "target_offered_rate": 1.0,
            "concurrency_limit": 1,
            "warmup_duration_s": 1,
            "measurement_duration_s": 5,
            "max_input_tokens": 64,
            "max_output_tokens": 16,
            "unauthorized_extra_field": "forbidden"
        }""",
        encoding="utf-8",
    )
    with pytest.raises(ValidationError, match="extra_forbidden"):
        load_workload_spec_from_file(bad_fixture)
