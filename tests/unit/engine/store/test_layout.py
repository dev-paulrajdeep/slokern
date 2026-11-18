"""
Purpose: Unit tests for engine/store/layout.
Owner: Rajdeep
"""

from slokern.engine.store.layout import (
    get_campaign_dir,
    get_manifest_path,
    get_report_path,
    get_run_trace_path,
    get_verification_trace_path,
)


def test_layout_paths(tmp_path):
    campaign_id = "camp-001"
    camp_dir = get_campaign_dir(tmp_path, campaign_id)
    assert camp_dir == tmp_path / "runs" / "camp-001"

    trace_path = get_run_trace_path(tmp_path, campaign_id, "run-01")
    assert trace_path == camp_dir / "run-01.jsonl"

    verif_path = get_verification_trace_path(tmp_path, campaign_id, "run-verif-01")
    assert verif_path == camp_dir / "verification_run-verif-01.jsonl"

    manifest_path = get_manifest_path(tmp_path, campaign_id)
    assert manifest_path == camp_dir / "manifest.json"

    report_path = get_report_path(tmp_path, campaign_id)
    assert report_path == camp_dir / "report.md"
