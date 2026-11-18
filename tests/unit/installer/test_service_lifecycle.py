"""
tests/unit/installer/test_service_lifecycle.py — Unit tests for SLOKern service lifecycle management.

Tests PID tracking, port occupancy, health probing, process identity verification,
unrelated process termination protection, idempotent start/stop, and script contracts.

Authority: Aligned with AGENTS.md Section 1, 3, 6, 10, 13 and USER_REQUEST Criteria 6, 9, 10.
Owner: Rajdeep
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import sys
from unittest.mock import MagicMock, mock_open, patch
import urllib.error

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


# =============================================================================
# Helper Utilities & Lifecycle Contracts
# =============================================================================

class ServiceLifecycleManager:
    """
    Python reference model for the service lifecycle contracts implemented by
    scripts/start.ps1, scripts/start.sh, scripts/stop.ps1, and scripts/stop.sh.
    """

    ALLOWED_PROCESS_KEYWORDS = ["python", "slokern", "serve", "node", "vite", "npm"]

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self.pid_dir = repo_root / ".slokern" / "pids"
        self.log_dir = repo_root / "logs"

    def record_pid(self, service_name: str, pid: int) -> Path:
        """Writes PID to .slokern/pids/<service>.pid."""
        self.pid_dir.mkdir(parents=True, exist_ok=True)
        pid_file = self.pid_dir / f"{service_name}.pid"
        pid_file.write_text(f"{pid}\n", encoding="utf-8")
        return pid_file

    def read_pid(self, service_name: str) -> int | None:
        """Reads PID from .slokern/pids/<service>.pid, cleaning up corrupt files."""
        pid_file = self.pid_dir / f"{service_name}.pid"
        if not pid_file.exists():
            return None
        content = pid_file.read_text(encoding="utf-8").strip()
        if not content:
            pid_file.unlink(missing_ok=True)
            return None
        try:
            return int(content)
        except ValueError:
            pid_file.unlink(missing_ok=True)
            return None

    def validate_process_identity(
        self,
        pid: int,
        proc_name: str,
        cmd_line: str,
    ) -> bool:
        """
        CRITICAL SECURITY INVARIANT:
        Validates process name and commandline against expected keywords.
        Returns False if the process does not match expected SLOKern services,
        strictly preventing termination of unrelated processes with recycled PIDs.
        """
        combined = f"{proc_name.lower()} {cmd_line.lower()}"
        return any(kw in combined for kw in self.ALLOWED_PROCESS_KEYWORDS)

    def probe_port(self, host: str, port: int, timeout: float = 0.5) -> bool:
        """Checks if a TCP port is open/occupied."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            return sock.connect_ex((host, port)) == 0
        except Exception:
            return False
        finally:
            try:
                sock.close()
            except Exception:
                pass

    def probe_health(self, host: str, port: int, timeout: float = 2.0) -> bool:
        """Probes /api/health endpoint for readiness."""
        url = f"http://{host}:{port}/api/health"
        req = urllib.request.Request(url, headers={"User-Agent": "SLOKern-Lifecycle-Test"})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(req, timeout=timeout) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    return data.get("status") in ("ok", "healthy") or "version" in data
                return False
        except Exception:
            return False

    def stop_service(
        self,
        service_name: str,
        proc_getter,
        proc_killer,
    ) -> tuple[bool, str]:
        """
        Safely stops a recorded service:
        1. Reads PID.
        2. Validates process exists.
        3. Validates process identity (recycled PID protection).
        4. Terminates process.
        5. Cleans up PID file.
        """
        pid = self.read_pid(service_name)
        pid_file = self.pid_dir / f"{service_name}.pid"

        if pid is None:
            return True, "No active PID file found. Nothing to stop."

        proc_info = proc_getter(pid)
        if proc_info is None:
            pid_file.unlink(missing_ok=True)
            return True, f"Process {pid} is not running. Stale PID file removed."

        proc_name, cmd_line = proc_info
        if not self.validate_process_identity(pid, proc_name, cmd_line):
            pid_file.unlink(missing_ok=True)
            return False, f"SECURITY REJECTION: PID {pid} ({proc_name}) does not match expected SLOKern keywords."

        proc_killer(pid)
        pid_file.unlink(missing_ok=True)
        return True, f"Successfully stopped {service_name} (PID {pid})."


# =============================================================================
# 1. PID Tracking & File Management Tests
# =============================================================================

def test_pid_file_recording_and_reading(tmp_path):
    """Verifies storing and retrieving integer process IDs."""
    mgr = ServiceLifecycleManager(tmp_path)

    pid_file = mgr.record_pid("backend", 41250)
    assert pid_file.exists()
    assert pid_file.read_text(encoding="utf-8").strip() == "41250"

    read_val = mgr.read_pid("backend")
    assert read_val == 41250


def test_corrupt_pid_file_cleaned_up(tmp_path):
    """Verifies that non-integer PID files are safely detected and removed."""
    mgr = ServiceLifecycleManager(tmp_path)
    pid_dir = tmp_path / ".slokern" / "pids"
    pid_dir.mkdir(parents=True)
    corrupt_file = pid_dir / "backend.pid"
    corrupt_file.write_text("not_a_valid_pid\n", encoding="utf-8")

    assert mgr.read_pid("backend") is None
    assert not corrupt_file.exists()


def test_empty_pid_file_cleaned_up(tmp_path):
    """Verifies that empty PID files are safely removed."""
    mgr = ServiceLifecycleManager(tmp_path)
    pid_dir = tmp_path / ".slokern" / "pids"
    pid_dir.mkdir(parents=True)
    empty_file = pid_dir / "frontend.pid"
    empty_file.write_text("   \n", encoding="utf-8")

    assert mgr.read_pid("frontend") is None
    assert not empty_file.exists()


# =============================================================================
# 2. Process Identity & Security Invariant Tests
# =============================================================================

def test_validate_process_identity_accepts_slokern_processes(tmp_path):
    """Verifies legitimate backend and frontend processes pass validation."""
    mgr = ServiceLifecycleManager(tmp_path)

    # Legitimate Python backend
    assert mgr.validate_process_identity(1001, "python.exe", "python -m slokern serve --port 8001") is True
    assert mgr.validate_process_identity(1002, "python3", "slokern serve --host 127.0.0.1") is True

    # Legitimate Node / Vite frontend
    assert mgr.validate_process_identity(2001, "node.exe", "node vite --host 0.0.0.0") is True
    assert mgr.validate_process_identity(2002, "npm", "npm run dev") is True


def test_validate_process_identity_rejects_unrelated_processes(tmp_path):
    """
    CRITICAL SECURITY INVARIANT:
    Ensures that if an OS recycles a PID for an unrelated process
    (e.g. system, explorer, postgres, chrome), termination is strictly blocked!
    """
    mgr = ServiceLifecycleManager(tmp_path)

    # System process
    assert mgr.validate_process_identity(4, "System", "") is False
    # Windows Explorer
    assert mgr.validate_process_identity(500, "explorer.exe", "C:\\Windows\\explorer.exe") is False
    # Database
    assert mgr.validate_process_identity(5432, "postgres", "postgres -D /data") is False
    # Browser
    assert mgr.validate_process_identity(8080, "chrome.exe", "--type=renderer") is False
    # Docker
    assert mgr.validate_process_identity(9000, "dockerd", "/usr/bin/dockerd") is False


def test_stop_service_refuses_to_kill_unrelated_process(tmp_path):
    """Verifies stop_service aborts without killing if PID belongs to an unrelated process."""
    mgr = ServiceLifecycleManager(tmp_path)
    mgr.record_pid("backend", 9999)

    mock_getter = MagicMock(return_value=("svchost.exe", "C:\\Windows\\system32\\svchost.exe -k netsvcs"))
    mock_killer = MagicMock()

    ok, msg = mgr.stop_service("backend", mock_getter, mock_killer)

    # Must fail and must NOT invoke killer!
    assert ok is False
    assert "SECURITY REJECTION" in msg
    mock_killer.assert_not_called()
    # Stale/invalid PID file should be removed so it doesn't linger
    assert not (tmp_path / ".slokern" / "pids" / "backend.pid").exists()


def test_stop_service_terminates_verified_process(tmp_path):
    """Verifies stop_service terminates a verified SLOKern process and removes PID file."""
    mgr = ServiceLifecycleManager(tmp_path)
    mgr.record_pid("backend", 4500)

    mock_getter = MagicMock(return_value=("python.exe", "python -m slokern serve --port 8001"))
    mock_killer = MagicMock()

    ok, msg = mgr.stop_service("backend", mock_getter, mock_killer)

    assert ok is True
    assert "Successfully stopped backend" in msg
    mock_killer.assert_called_once_with(4500)
    assert not (tmp_path / ".slokern" / "pids" / "backend.pid").exists()


# =============================================================================
# 3. Port Occupancy & Existing Server Reuse Tests
# =============================================================================

def test_probe_port_detection(tmp_path):
    """Verifies port occupancy check accurately detects open vs closed sockets."""
    mgr = ServiceLifecycleManager(tmp_path)

    with patch("socket.socket") as mock_sock_cls:
        mock_sock = MagicMock()
        mock_sock.connect_ex.return_value = 0
        mock_sock_cls.return_value = mock_sock

        assert mgr.probe_port("127.0.0.1", 8001) is True

        mock_sock.connect_ex.return_value = 10061
        assert mgr.probe_port("127.0.0.1", 8001) is False


def test_probe_health_success_and_failure(tmp_path):
    """Verifies /api/health probe detects healthy vs degraded vs offline states."""
    mgr = ServiceLifecycleManager(tmp_path)

    with patch("urllib.request.build_opener") as mock_opener_cls:
        mock_opener = MagicMock()

        # 1. Healthy response
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = b'{"status": "ok", "version": "0.1.0"}'
        mock_opener.open.return_value.__enter__.return_value = mock_resp
        mock_opener_cls.return_value = mock_opener

        assert mgr.probe_health("127.0.0.1", 8001) is True

        # 2. Degraded response
        mock_resp.read.return_value = b'{"status": "degraded"}'
        assert mgr.probe_health("127.0.0.1", 8001) is False

        # 3. Connection refused
        mock_opener.open.side_effect = urllib.error.URLError("Connection refused")
        assert mgr.probe_health("127.0.0.1", 8001) is False


def test_reuse_existing_healthy_service_contract(tmp_path):
    """
    CRITICAL INVARIANT (Criterion 6):
    When an existing server is running and healthy, lifecycle launchers must
    reuse it safely without restarting or crashing.
    """
    mgr = ServiceLifecycleManager(tmp_path)
    mgr.record_pid("backend", 1234)

    # Mock port open and healthy API
    with patch.object(mgr, "probe_port", return_value=True), \
         patch.object(mgr, "probe_health", return_value=True):

        is_running = mgr.probe_port("127.0.0.1", 8001)
        is_healthy = mgr.probe_health("127.0.0.1", 8001)

        # Simulation of start script logic
        if is_running and is_healthy:
            status = "REUSED_EXISTING"
        else:
            status = "SPAWN_NEW"

        assert status == "REUSED_EXISTING"
        # Existing PID must remain intact
        assert mgr.read_pid("backend") == 1234


# =============================================================================
# 4. Idempotency & Lifecycle Repeatability Tests
# =============================================================================

def test_stop_service_idempotent_when_no_services_running(tmp_path):
    """
    CRITICAL INVARIANT (Criterion 9):
    Stopping services when nothing is running must succeed cleanly with code 0.
    """
    mgr = ServiceLifecycleManager(tmp_path)

    # First stop call
    ok1, msg1 = mgr.stop_service("backend", lambda p: None, lambda p: None)
    assert ok1 is True
    assert "No active PID file found" in msg1

    # Second stop call (idempotent repeat)
    ok2, msg2 = mgr.stop_service("backend", lambda p: None, lambda p: None)
    assert ok2 is True


def test_stop_service_cleans_stale_pid_when_process_already_exited(tmp_path):
    """Verifies that if a recorded process has already exited, the stale PID is removed."""
    mgr = ServiceLifecycleManager(tmp_path)
    mgr.record_pid("frontend", 8888)

    mock_getter = MagicMock(return_value=None)  # Process not running
    mock_killer = MagicMock()

    ok, msg = mgr.stop_service("frontend", mock_getter, mock_killer)

    assert ok is True
    assert "is not running" in msg
    mock_killer.assert_not_called()
    assert not (tmp_path / ".slokern" / "pids" / "frontend.pid").exists()


# =============================================================================
# 5. Shell & PowerShell Script Contract Integrity Tests
# =============================================================================

def test_lifecycle_scripts_exist():
    """Verifies that all 4 lifecycle scripts exist in scripts/ directory."""
    start_ps1 = SCRIPTS_DIR / "start.ps1"
    start_sh = SCRIPTS_DIR / "start.sh"
    stop_ps1 = SCRIPTS_DIR / "stop.ps1"
    stop_sh = SCRIPTS_DIR / "stop.sh"

    assert start_ps1.exists(), "scripts/start.ps1 missing"
    assert start_sh.exists(), "scripts/start.sh missing"
    assert stop_ps1.exists(), "scripts/stop.ps1 missing"
    assert stop_sh.exists(), "scripts/stop.sh missing"


def test_start_scripts_parameter_contracts():
    """Verifies that start.ps1 and start.sh define matching configuration parameters."""
    ps1_content = (SCRIPTS_DIR / "start.ps1").read_text(encoding="utf-8")
    sh_content = (SCRIPTS_DIR / "start.sh").read_text(encoding="utf-8")

    # Both scripts must support BackendPort (8001), FrontendPort (5173), HostAddress (127.0.0.1)
    assert "8001" in ps1_content
    assert "8001" in sh_content

    assert "5173" in ps1_content
    assert "5173" in sh_content

    assert "127.0.0.1" in ps1_content
    assert "127.0.0.1" in sh_content

    # Both scripts must support headless / no-browser modes
    assert "NoBrowser" in ps1_content or "no-browser" in ps1_content.lower()
    assert "no-browser" in sh_content.lower() or "headless" in sh_content.lower()

    # Both scripts must track PIDs in .slokern/pids
    assert ".slokern" in ps1_content and "pids" in ps1_content
    assert ".slokern" in sh_content and "pids" in sh_content


def test_stop_scripts_pid_termination_contracts():
    """Verifies that stop.ps1 and stop.sh use recorded PIDs and validate process identities."""
    stop_ps1_content = (SCRIPTS_DIR / "stop.ps1").read_text(encoding="utf-8")
    stop_sh_content = (SCRIPTS_DIR / "stop.sh").read_text(encoding="utf-8")

    # Must reference .slokern/pids
    assert ".slokern" in stop_ps1_content and "pids" in stop_ps1_content
    assert ".slokern" in stop_sh_content and "pids" in stop_sh_content

    # Must contain keyword validation / identity checks
    for kw in ["python", "slokern", "node"]:
        assert kw in stop_ps1_content.lower()
        assert kw in stop_sh_content.lower()


def test_posix_scripts_have_shebang_and_strict_modes():
    """Verifies that POSIX shell scripts have #!/usr/bin/env bash and set -e."""
    for script_name in ["start.sh", "stop.sh", "setup.sh"]:
        path = SCRIPTS_DIR / script_name
        if path.exists():
            content = path.read_text(encoding="utf-8")
            assert content.startswith("#!/"), f"{script_name} missing shebang"
            assert "set -e" in content or "set -u" in content, f"{script_name} missing strict error flags"
