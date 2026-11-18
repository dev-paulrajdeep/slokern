"""
Purpose: Unit tests for engine/workload/fixtures.
Owner: Rajdeep (Historical design: Adriraj)
"""

from slokern.engine.workload.fixtures import (
    get_fixtures_workload_dir,
    list_workload_fixtures,
    load_workload_spec_from_file,
)


def test_workload_fixtures_resolver():
    path = get_fixtures_workload_dir()
    assert path.is_dir()
    assert (path / "local_qwen3_chat.json").exists()


def test_list_workload_fixtures_not_empty():
    fixtures = list_workload_fixtures()
    assert len(fixtures) >= 1
    assert any(f.name == "local_qwen3_chat.json" for f in fixtures)


def test_load_qwen3_chat_fixture():
    path = get_fixtures_workload_dir() / "local_qwen3_chat.json"
    spec = load_workload_spec_from_file(path)
    assert spec.workload_name == "local-qwen3-chat-workload"
