"""
Purpose: Unit tests for engine/store/writer.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 4, 12, 14 and DEC-0014
"""

import json
from pathlib import Path

from slokern.engine.store.writer import (
    write_jsonl_trace,
    write_manifest,
    write_report,
)


def test_write_jsonl_trace_basic(tmp_path: Path):
    out_file = tmp_path / "traces" / "run_01.jsonl"
    records = [
        {"request_id": "r1", "latency_ms": 12.5, "status": 200},
        {"request_id": "r2", "latency_ms": 15.1, "status": 200},
    ]

    result_path = write_jsonl_trace(out_file, records)
    assert result_path == out_file
    assert out_file.exists()

    lines = out_file.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 2
    assert json.loads(lines[0]) == records[0]
    assert json.loads(lines[1]) == records[1]


def test_write_jsonl_trace_creates_nested_parents(tmp_path: Path):
    deep_path = tmp_path / "deep" / "nested" / "dir" / "trace.jsonl"
    records = [{"test": "ok"}]
    write_jsonl_trace(deep_path, records)
    assert deep_path.exists()


def test_write_jsonl_trace_redacts_secret(tmp_path: Path):
    out_file = tmp_path / "secret_trace.jsonl"
    secret = "secret-token-value-xyz"
    records = [
        {"request_id": "r1", "auth": f"Bearer {secret}", "info": f"api_key: {secret}"},
    ]

    write_jsonl_trace(out_file, records, secret_key=secret)
    content = out_file.read_text(encoding="utf-8")
    assert secret not in content
    assert "***REDACTED***" in content


def test_write_jsonl_trace_redacts_bearer_without_secret_key(tmp_path: Path):
    out_file = tmp_path / "auto_redact_trace.jsonl"
    raw_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    records = [
        {"request_id": "r1", "header": f"Bearer {raw_token}", "api_key": "secret_key_12345"},
    ]

    write_jsonl_trace(out_file, records)  # secret_key omitted
    content = out_file.read_text(encoding="utf-8")
    assert raw_token not in content
    assert "secret_key_12345" not in content
    assert "***REDACTED***" in content


def test_write_manifest(tmp_path: Path):
    manifest_file = tmp_path / "artifacts" / "campaign-1" / "manifest.json"
    manifest_data = {
        "manifest_version": "1.0",
        "campaign_id": "c-001",
        "summary": {"winner": "cand-02"},
    }

    result = write_manifest(manifest_file, manifest_data)
    assert result == manifest_file
    assert manifest_file.exists()

    content = manifest_file.read_text(encoding="utf-8")
    # Verify indentation
    assert "\n  " in content
    loaded = json.loads(content)
    assert loaded == manifest_data


def test_write_report(tmp_path: Path):
    report_file = tmp_path / "artifacts" / "campaign-1" / "report.md"
    markdown = "# SLOKern Campaign Audit Report\n\n- Verdict: **VERIFIED**\n"

    result = write_report(report_file, markdown)
    assert result == report_file
    assert report_file.exists()
    assert report_file.read_text(encoding="utf-8") == markdown
