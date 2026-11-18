"""
tests/unit/installer/test_doctor.py — Unit tests for scripts/doctor.py diagnostic tool.

Authority: Aligned with AGENTS.md Section 1, 6, 10, 13 and USER_REQUEST Criteria 12 & 13.
Owner: Rajdeep
"""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import platform
import socket
import sys
from unittest.mock import MagicMock, mock_open, patch
import urllib.error

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import doctor
from doctor import (
    DiagnosticCheck,
    DiagnosticStatus,
    DoctorReport,
    SlokernDoctor,
    format_report_text,
    http_probe_json,
    is_port_in_use,
    main,
)


# =============================================================================
# 1. Port & HTTP Probe Utility Tests
# =============================================================================

def test_is_port_in_use_true():
    """Verifies is_port_in_use returns True when socket connects successfully."""
    with patch("socket.socket") as mock_sock_cls:
        mock_sock = MagicMock()
        mock_sock.connect_ex.return_value = 0
        mock_sock_cls.return_value = mock_sock

        assert is_port_in_use("127.0.0.1", 8001) is True
        mock_sock.connect_ex.assert_called_once_with(("127.0.0.1", 8001))
        mock_sock.close.assert_called_once()


def test_is_port_in_use_false_connection_refused():
    """Verifies is_port_in_use returns False when connection is refused."""
    with patch("socket.socket") as mock_sock_cls:
        mock_sock = MagicMock()
        mock_sock.connect_ex.return_value = 10061
        mock_sock_cls.return_value = mock_sock

        assert is_port_in_use("127.0.0.1", 8001) is False
        mock_sock.close.assert_called_once()


def test_is_port_in_use_false_on_socket_exception():
    """Verifies is_port_in_use returns False on any socket exception."""
    with patch("socket.socket") as mock_sock_cls:
        mock_sock = MagicMock()
        mock_sock.connect_ex.side_effect = socket.error("Network unreachable")
        mock_sock_cls.return_value = mock_sock

        assert is_port_in_use("127.0.0.1", 8001) is False


def test_http_probe_json_success():
    """Verifies http_probe_json parses valid JSON response on HTTP 200."""
    with patch("urllib.request.build_opener") as mock_opener_cls:
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = b'{"status": "ok", "version": "0.1.0"}'

        mock_opener = MagicMock()
        mock_opener.open.return_value.__enter__.return_value = mock_resp
        mock_opener_cls.return_value = mock_opener

        ok, code, data, err = http_probe_json("http://127.0.0.1:8001/api/health")

        assert ok is True
        assert code == 200
        assert data == {"status": "ok", "version": "0.1.0"}
        assert err is None


def test_http_probe_json_non_json_response():
    """Verifies http_probe_json handles non-JSON body gracefully."""
    with patch("urllib.request.build_opener") as mock_opener_cls:
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = b'<html><body>Not Found</body></html>'

        mock_opener = MagicMock()
        mock_opener.open.return_value.__enter__.return_value = mock_resp
        mock_opener_cls.return_value = mock_opener

        ok, code, data, err = http_probe_json("http://127.0.0.1:8001/api/health")

        assert ok is True
        assert code == 200
        assert data is None
        assert "Non-JSON response" in err


def test_http_probe_json_http_error():
    """Verifies http_probe_json handles HTTPError exceptions."""
    with patch("urllib.request.build_opener") as mock_opener_cls:
        mock_err = urllib.error.HTTPError(
            url="http://127.0.0.1:8001/api/health",
            code=503,
            msg="Service Unavailable",
            hdrs={},
            fp=io.BytesIO(b'{"detail": "degraded"}'),
        )
        mock_opener = MagicMock()
        mock_opener.open.side_effect = mock_err
        mock_opener_cls.return_value = mock_opener

        ok, code, data, err = http_probe_json("http://127.0.0.1:8001/api/health")

        assert ok is False
        assert code == 503
        assert data == {"detail": "degraded"}
        assert "503" in str(err)


def test_http_probe_json_connection_failure():
    """Verifies http_probe_json handles connection timeout or refused."""
    with patch("urllib.request.build_opener") as mock_opener_cls:
        mock_opener = MagicMock()
        mock_opener.open.side_effect = urllib.error.URLError("Connection refused")
        mock_opener_cls.return_value = mock_opener

        ok, code, data, err = http_probe_json("http://127.0.0.1:8001/api/health")

        assert ok is False
        assert code is None
        assert data is None
        assert "Connection refused" in err


# =============================================================================
# 2. SlokernDoctor Inspection Categories
# =============================================================================

def test_inspect_python_environment_pass(tmp_path):
    """Verifies Python >= 3.10 and active virtualenv produces PASS."""
    doc = SlokernDoctor(repo_root=tmp_path)

    with patch("platform.python_version", return_value="3.11.9"), \
         patch("sys.version_info", MagicMock(major=3, minor=11)), \
         patch.dict("os.environ", {"VIRTUAL_ENV": "/path/to/.venv"}):

        checks = doc.inspect_python_environment()
        statuses = {c.name: c.status for c in checks}

        assert statuses["python_version"] == DiagnosticStatus.PASS
        assert statuses["virtualenv_active"] == DiagnosticStatus.PASS


def test_inspect_python_environment_fail_version(tmp_path):
    """Verifies Python < 3.10 produces FAIL with actionable remediation."""
    doc = SlokernDoctor(repo_root=tmp_path)

    with patch("platform.python_version", return_value="3.9.7"), \
         patch("sys.version_info", MagicMock(major=3, minor=9)):

        checks = doc.inspect_python_environment()
        version_check = next(c for c in checks if c.name == "python_version")

        assert version_check.status == DiagnosticStatus.FAIL
        assert "unsupported" in version_check.message
        assert version_check.remediation is not None


def test_inspect_python_environment_warn_outside_venv_with_local_venv(tmp_path):
    """Verifies warning with remediation when running outside venv but .venv exists."""
    (tmp_path / ".venv").mkdir()
    doc = SlokernDoctor(repo_root=tmp_path)

    with patch("platform.python_version", return_value="3.11.9"), \
         patch("sys.version_info", MagicMock(major=3, minor=11)), \
         patch.object(sys, "prefix", "/usr"), \
         patch.object(sys, "base_prefix", "/usr"), \
         patch.dict("os.environ", {}, clear=True):

        checks = doc.inspect_python_environment()
        venv_check = next(c for c in checks if c.name == "virtualenv_active")

        assert venv_check.status == DiagnosticStatus.WARN
        assert "repository .venv exists" in venv_check.message


def test_inspect_cli_and_packages_pass(tmp_path):
    """Verifies CLI registration and key packages produce PASS."""
    doc = SlokernDoctor(repo_root=tmp_path)
    checks = doc.inspect_cli_and_packages()

    statuses = {c.name: c.status for c in checks}
    assert statuses.get("cli_entrypoint") == DiagnosticStatus.PASS
    assert statuses.get("dep_pydantic") == DiagnosticStatus.PASS
    assert statuses.get("dep_pytest") == DiagnosticStatus.PASS


def test_inspect_cli_and_packages_missing_subcommand(tmp_path):
    """Verifies missing CLI subcommands produces FAIL."""
    doc = SlokernDoctor(repo_root=tmp_path)

    mock_parser = MagicMock()
    mock_action = MagicMock(spec=argparse._SubParsersAction)
    # choices missing "smoke-test"
    mock_action.choices = {"optimize": None, "verify": None, "report": None, "validate": None, "serve": None, "credentials": None}
    mock_parser._actions = [mock_action]

    with patch("slokern.cli.main.build_parser", return_value=mock_parser):
        checks = doc.inspect_cli_and_packages()
        cli_check = next(c for c in checks if c.name == "cli_entrypoint")

        assert cli_check.status == DiagnosticStatus.FAIL
        assert "missing expected subcommands" in cli_check.message


def test_inspect_node_and_frontend_all_pass(tmp_path):
    """Verifies node, npm, package.json, node_modules, and dist production bundle PASS."""
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir(parents=True)
    (frontend_dir / "package.json").write_text("{}", encoding="utf-8")
    (frontend_dir / "node_modules" / "vite").mkdir(parents=True)
    dist_dir = frontend_dir / "dist"
    (dist_dir / "assets").mkdir(parents=True)
    (dist_dir / "index.html").write_text("<html></html>", encoding="utf-8")

    doc = SlokernDoctor(repo_root=tmp_path)

    with patch("shutil.which", return_value="/usr/bin/tool"), \
         patch("subprocess.run") as mock_run:

        mock_run.return_value = MagicMock(stdout="v20.10.0\n")
        checks = doc.inspect_node_and_frontend()
        statuses = {c.name: c.status for c in checks}

        assert statuses["node_version"] == DiagnosticStatus.PASS
        assert statuses["npm_version"] == DiagnosticStatus.PASS
        assert statuses["frontend_package_json"] == DiagnosticStatus.PASS
        assert statuses["frontend_dependencies"] == DiagnosticStatus.PASS
        assert statuses["frontend_dist"] == DiagnosticStatus.PASS


def test_inspect_node_and_frontend_missing_node_and_npm(tmp_path):
    """Verifies missing node and npm binaries generates warnings."""
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir(parents=True)
    (frontend_dir / "package.json").write_text("{}", encoding="utf-8")

    doc = SlokernDoctor(repo_root=tmp_path)

    with patch("shutil.which", return_value=None):
        checks = doc.inspect_node_and_frontend()
        statuses = {c.name: c.status for c in checks}

        assert statuses["node_version"] == DiagnosticStatus.WARN
        assert statuses["npm_version"] == DiagnosticStatus.WARN


def test_inspect_node_and_frontend_missing_dist_bundle(tmp_path):
    """Verifies missing frontend/dist generates WARN with build remediation."""
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir(parents=True)
    (frontend_dir / "package.json").write_text("{}", encoding="utf-8")
    (frontend_dir / "node_modules" / "vite").mkdir(parents=True)

    doc = SlokernDoctor(repo_root=tmp_path)

    with patch("shutil.which", return_value="/usr/bin/tool"), \
         patch("subprocess.run", return_value=MagicMock(stdout="v20.0.0\n")):

        checks = doc.inspect_node_and_frontend()
        dist_check = next(c for c in checks if c.name == "frontend_dist")

        assert dist_check.status == DiagnosticStatus.WARN
        assert "run build" in dist_check.remediation


def test_inspect_environment_and_secrets(tmp_path):
    """Verifies detection of .env.example, .env, and runtime secret status."""
    (tmp_path / ".env.example").write_text("EXAMPLE=1\n", encoding="utf-8")
    (tmp_path / ".env").write_text("SLOKERN_ADAPTER=fake\n", encoding="utf-8")

    doc = SlokernDoctor(repo_root=tmp_path)

    checks = doc.inspect_environment_and_secrets()
    statuses = {c.name: c.status for c in checks}

    assert statuses["env_example"] == DiagnosticStatus.PASS
    assert statuses["env_file"] == DiagnosticStatus.PASS


def test_inspect_environment_posix_permissions_warning(tmp_path):
    """Verifies warning when .env has overly permissive permissions on POSIX."""
    env_file = tmp_path / ".env"
    env_file.write_text("SECRET=1\n", encoding="utf-8")

    doc = SlokernDoctor(repo_root=tmp_path)

    # Mock POSIX mode 0o644 (other-readable)
    mock_stat = MagicMock()
    mock_stat.st_mode = 0o100644

    with patch("os.name", "posix"), \
         patch.object(Path, "stat", return_value=mock_stat):

        checks = doc.inspect_environment_and_secrets()
        perm_check = next((c for c in checks if c.name == "env_permissions"), None)

        assert perm_check is not None
        assert perm_check.status == DiagnosticStatus.WARN
        assert "chmod 600" in perm_check.remediation


def test_inspect_ports_and_services_idle(tmp_path):
    """Verifies port inspection when all services are free/offline."""
    doc = SlokernDoctor(repo_root=tmp_path)

    with patch("doctor.is_port_in_use", return_value=False):
        checks = doc.inspect_ports_and_services()
        statuses = {c.name: c.status for c in checks}

        assert statuses["port_slokern_api"] == DiagnosticStatus.INFO
        assert statuses["port_frontend"] == DiagnosticStatus.INFO
        assert statuses["port_vllm"] == DiagnosticStatus.INFO
        assert statuses["port_ollama"] == DiagnosticStatus.INFO


def test_inspect_ports_and_services_api_healthy(tmp_path):
    """Verifies port 8001 returns PASS when responding to /api/health."""
    doc = SlokernDoctor(repo_root=tmp_path)

    with patch("doctor.is_port_in_use", side_effect=lambda h, p: p == 8001), \
         patch("doctor.http_probe_json", return_value=(True, 200, {"status": "ok"}, None)):

        checks = doc.inspect_ports_and_services()
        api_check = next(c for c in checks if c.name == "port_slokern_api")

        assert api_check.status == DiagnosticStatus.PASS
        assert "ACTIVE" in api_check.message


def test_inspect_ports_and_services_api_occupied_unrecognized(tmp_path):
    """Verifies port 8001 returns WARN when occupied by an unrecognized/failing service."""
    doc = SlokernDoctor(repo_root=tmp_path)

    with patch("doctor.is_port_in_use", side_effect=lambda h, p: p == 8001), \
         patch("doctor.http_probe_json", return_value=(False, 404, None, "Not Found")):

        checks = doc.inspect_ports_and_services()
        api_check = next(c for c in checks if c.name == "port_slokern_api")

        assert api_check.status == DiagnosticStatus.WARN
        assert "OCCUPIED" in api_check.message
        assert "stop.ps1" in api_check.remediation


def test_inspect_hardware_and_acceleration_nvidia_smi_detected(tmp_path):
    """Verifies independent GPU detection via nvidia-smi."""
    doc = SlokernDoctor(repo_root=tmp_path)

    mock_run = MagicMock()
    mock_run.returncode = 0
    mock_run.stdout = "NVIDIA GeForce RTX 5060 Laptop GPU, 8151 MiB, 570.86.16\n"

    with patch("shutil.which", return_value="/usr/bin/nvidia-smi"), \
         patch("subprocess.run", return_value=mock_run):

        checks = doc.inspect_hardware_and_acceleration()
        smi_check = next((c for c in checks if c.name == "nvidia_smi"), None)

        assert smi_check is not None
        assert smi_check.status == DiagnosticStatus.PASS
        assert "RTX 5060" in smi_check.message


def test_inspect_hardware_and_acceleration_cpu_only_mode(tmp_path):
    """Verifies CPU-only mode status when no GPU hardware is detected."""
    doc = SlokernDoctor(repo_root=tmp_path)

    with patch("shutil.which", return_value=None):
        checks = doc.inspect_hardware_and_acceleration()
        mode_check = next(c for c in checks if c.name == "compute_mode")

        assert mode_check.status == DiagnosticStatus.INFO
        assert "CPU-only" in mode_check.message


def test_inspect_serving_adapters(tmp_path):
    """Verifies inspection of fake and vLLM serving adapters."""
    doc = SlokernDoctor(repo_root=tmp_path)

    with patch("slokern.engine.serving.vllm.VLLMServingAdapter.health_check", return_value=False):
        checks = doc.inspect_serving_adapters()
        statuses = {c.name: c.status for c in checks}

        assert statuses.get("adapter_fake") == DiagnosticStatus.PASS


def test_inspect_artifacts_storage_exists_and_writeable(tmp_path):
    """Verifies artifacts directory storage check passes when writeable."""
    art_dir = tmp_path / "artifacts"
    art_dir.mkdir()

    doc = SlokernDoctor(repo_root=tmp_path, artifacts_dir="artifacts")

    with patch("os.access", return_value=True):
        checks = doc.inspect_artifacts_storage()
        art_check = checks[0]

        assert art_check.status == DiagnosticStatus.PASS
        assert "writeable" in art_check.message


def test_inspect_artifacts_storage_not_writeable(tmp_path):
    """Verifies artifacts directory failure when write access is denied."""
    art_dir = tmp_path / "artifacts"
    art_dir.mkdir()

    doc = SlokernDoctor(repo_root=tmp_path, artifacts_dir="artifacts")

    with patch("os.access", return_value=False):
        checks = doc.inspect_artifacts_storage()
        art_check = checks[0]

        assert art_check.status == DiagnosticStatus.FAIL
        assert "not writeable" in art_check.message


# =============================================================================
# 3. Report Aggregation, Formatting & Read-Only Invariance
# =============================================================================

def test_run_all_checks_aggregation(tmp_path):
    """Verifies run_all_checks aggregates counts and calculates overall_status correctly."""
    doc = SlokernDoctor(repo_root=tmp_path)

    # Mock individual inspectors
    c_pass = DiagnosticCheck("Cat", "check1", DiagnosticStatus.PASS, "ok")
    c_warn = DiagnosticCheck("Cat", "check2", DiagnosticStatus.WARN, "warning", remediation="Fix warning")
    c_info = DiagnosticCheck("Cat", "check3", DiagnosticStatus.INFO, "info")

    with patch.object(doc, "inspect_python_environment", return_value=[c_pass]), \
         patch.object(doc, "inspect_cli_and_packages", return_value=[c_pass]), \
         patch.object(doc, "inspect_node_and_frontend", return_value=[c_warn]), \
         patch.object(doc, "inspect_environment_and_secrets", return_value=[c_pass]), \
         patch.object(doc, "inspect_ports_and_services", return_value=[c_info]), \
         patch.object(doc, "inspect_hardware_and_acceleration", return_value=[c_info]), \
         patch.object(doc, "inspect_serving_adapters", return_value=[c_pass]), \
         patch.object(doc, "inspect_artifacts_storage", return_value=[c_pass]):

        report = doc.run_all_checks()

        assert report.overall_status == DiagnosticStatus.WARN
        assert report.summary[DiagnosticStatus.PASS] == 5
        assert report.summary[DiagnosticStatus.WARN] == 1
        assert report.summary[DiagnosticStatus.FAIL] == 0
        assert report.summary[DiagnosticStatus.INFO] == 2
        assert len(report.recommendations) == 1
        assert "[check2] Fix warning" in report.recommendations[0]

        # Verify to_dict serializability
        d = report.to_dict()
        assert d["overall_status"] == DiagnosticStatus.WARN
        assert len(d["checks"]) == 8


def test_doctor_read_only_invariance(tmp_path):
    """
    CRITICAL INVARIANT (Criterion 13):
    Verifies that running the doctor diagnostic tool NEVER creates, deletes,
    or modifies any file in the workspace (strictly read-only).
    """
    # Create baseline snapshot of files in tmp_path
    (tmp_path / ".env.example").write_text("FOO=BAR\n", encoding="utf-8")
    (tmp_path / "pyproject.toml").write_text("[project]\n", encoding="utf-8")

    def get_dir_state(p: Path):
        return {f: f.stat().st_mtime_ns for f in p.rglob("*")}

    state_before = get_dir_state(tmp_path)

    with patch("doctor.is_port_in_use", return_value=False), \
         patch("doctor.http_probe_json", return_value=(False, None, None, "offline")), \
         patch("slokern.engine.serving.vllm.VLLMServingAdapter.health_check", return_value=False):
        doc = SlokernDoctor(repo_root=tmp_path)
        _ = doc.run_all_checks()

    state_after = get_dir_state(tmp_path)

    assert state_before.keys() == state_after.keys()
    for f in state_before:
        assert state_before[f] == state_after[f]


def test_format_report_text():
    """Verifies clean terminal output generation for human viewing."""
    rep = DoctorReport(
        timestamp="2026-11-19T00:00:00Z",
        platform={"os": "Windows", "architecture": "AMD64", "python_version": "3.11.9", "working_directory": "/slokern"},
        checks=[
            DiagnosticCheck("System", "test_chk", DiagnosticStatus.PASS, "Check passed"),
            DiagnosticCheck("System", "warn_chk", DiagnosticStatus.WARN, "Needs attention", remediation="Upgrade tool"),
        ],
        overall_status=DiagnosticStatus.WARN,
        summary={DiagnosticStatus.PASS: 1, DiagnosticStatus.WARN: 1, DiagnosticStatus.FAIL: 0, DiagnosticStatus.INFO: 0},
        recommendations=["[warn_chk] Upgrade tool"],
    )

    text = format_report_text(rep, verbose=True)

    assert "SLOKern Diagnostic Doctor" in text
    assert "[System]" in text
    assert "[PASS]" in text
    assert "[WARN]" in text
    assert "Overall Status: [WARN]" in text
    assert "Actionable Remediation Guidance:" in text
    assert "1. [warn_chk] Upgrade tool" in text


# =============================================================================
# 4. CLI Entry Point Tests
# =============================================================================

def test_main_cli_json_output(capsys):
    """Verifies doctor.py --json outputs valid JSON string to stdout."""
    with patch("doctor.is_port_in_use", return_value=False), \
         patch("doctor.http_probe_json", return_value=(False, None, None, "offline")), \
         patch("slokern.engine.serving.vllm.VLLMServingAdapter.health_check", return_value=False):
        ret = main(["--json"])

        out = capsys.readouterr().out
        data = json.loads(out)

        assert "platform" in data
        assert "checks" in data
        assert "overall_status" in data
        assert ret in (0, 1)


def test_main_cli_exit_code_zero_on_pass_or_warn(tmp_path):
    """Verifies main exits with 0 on PASS or WARN status."""
    with patch("doctor.SlokernDoctor.run_all_checks") as mock_run:
        mock_run.return_value = DoctorReport(
            timestamp="", platform={}, checks=[], overall_status=DiagnosticStatus.PASS,
            summary={}, recommendations=[],
        )
        assert main([]) == 0

        mock_run.return_value.overall_status = DiagnosticStatus.WARN
        assert main([]) == 0


def test_main_cli_exit_code_one_on_fail(tmp_path):
    """Verifies main exits with 1 on FAIL status."""
    with patch("doctor.SlokernDoctor.run_all_checks") as mock_run:
        mock_run.return_value = DoctorReport(
            timestamp="", platform={}, checks=[], overall_status=DiagnosticStatus.FAIL,
            summary={}, recommendations=[],
        )
        assert main([]) == 1
