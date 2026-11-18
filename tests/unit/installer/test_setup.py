"""
tests/unit/installer/test_setup.py — Unit tests for scripts/setup.py bootstrap orchestrator.

Authority: Aligned with AGENTS.md Section 1, 6, 10, 13 and USER_REQUEST Criteria 1-18.
Owner: Rajdeep
"""

from __future__ import annotations

import argparse
from collections import namedtuple
import logging
import os
from pathlib import Path
import platform
import subprocess
import sys
from unittest.mock import MagicMock, mock_open, patch

import pytest

VersionInfo = namedtuple("VersionInfo", ["major", "minor", "micro", "releaselevel", "serial"])

# Ensure scripts directory is on sys.path for direct import
REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import setup
from setup import (
    HardwareAudit,
    SetupConfig,
    SystemAudit,
    ToolAudit,
    audit_hardware_and_runtime,
    audit_tools,
    color_text,
    detect_system_info,
    ensure_virtualenv,
    get_venv_python_path,
    install_backend,
    install_frontend,
    parse_args,
    run_setup,
    setup_environment_file,
    setup_logger,
    supports_color,
)


# =============================================================================
# 1. System Audit & OS/Arch Detection
# =============================================================================

class MockDiskUsage:
    def __init__(self, total_gb: float, free_gb: float):
        self.total = int(total_gb * (1024**3))
        self.free = int(free_gb * (1024**3))


def test_detect_system_info_windows_success(tmp_path):
    """Verifies Windows OS, architecture, RAM, and disk detection with adequate resources."""
    with patch("platform.system", return_value="Windows"), \
         patch("platform.release", return_value="11"), \
         patch("platform.version", return_value="10.0.26100"), \
         patch("platform.machine", return_value="AMD64"), \
         patch("sys.version_info", VersionInfo(3, 11, 9, "final", 0)), \
         patch("shutil.disk_usage", return_value=MockDiskUsage(total_gb=500.0, free_gb=120.0)):

        # Mock GlobalMemoryStatusEx via ctypes
        def mock_global_memory(byref_stat):
            stat = byref_stat._obj
            stat.ullTotalPhys = int(16.0 * (1024**3))
            stat.ullAvailPhys = int(10.0 * (1024**3))
            return 1

        with patch("ctypes.windll.kernel32.GlobalMemoryStatusEx", side_effect=mock_global_memory, create=True):
            audit = detect_system_info(tmp_path)

            assert audit.os_name == "Windows"
            assert audit.os_release == "11"
            assert audit.architecture == "AMD64"
            assert audit.total_ram_gb == 16.0
            assert audit.available_ram_gb == 10.0
            assert audit.disk_free_gb == 120.0
            assert audit.is_python_supported is True
            assert audit.is_ram_adequate is True
            assert audit.is_disk_adequate is True
            assert len(audit.errors) == 0


def test_detect_system_info_linux_meminfo(tmp_path):
    """Verifies Linux /proc/meminfo parsing for system RAM."""
    fake_meminfo = (
        "MemTotal:       16384000 kB\n"
        "MemFree:         4194304 kB\n"
        "MemAvailable:    8192000 kB\n"
        "Buffers:          524288 kB\n"
    )
    with patch("platform.system", return_value="Linux"), \
         patch("platform.release", return_value="6.5.0-generic"), \
         patch("platform.machine", return_value="x86_64"), \
         patch("sys.version_info", VersionInfo(3, 11, 5, "final", 0)), \
         patch("shutil.disk_usage", return_value=MockDiskUsage(total_gb=250.0, free_gb=50.0)), \
         patch("pathlib.Path.read_text", return_value=fake_meminfo):

        audit = detect_system_info(tmp_path)

        assert audit.os_name == "Linux"
        assert audit.total_ram_gb == 15.62  # 16384000 / 1024^2
        assert audit.available_ram_gb == 7.81
        assert audit.is_ram_adequate is True
        assert len(audit.errors) == 0


def test_detect_system_info_darwin_macos(tmp_path):
    """Verifies macOS / Darwin RAM detection via sysctl."""
    # 16 GB in bytes = 17179869184
    mock_res = MagicMock()
    mock_res.stdout = "17179869184\n"

    with patch("platform.system", return_value="Darwin"), \
         patch("platform.release", return_value="23.4.0"), \
         patch("platform.machine", return_value="arm64"), \
         patch("sys.version_info", VersionInfo(3, 12, 1, "final", 0)), \
         patch("shutil.disk_usage", return_value=MockDiskUsage(total_gb=500.0, free_gb=80.0)), \
         patch("subprocess.run", return_value=mock_res):

        audit = detect_system_info(tmp_path)

        assert audit.os_name == "Darwin"
        assert audit.architecture == "arm64"
        assert audit.total_ram_gb == 16.0
        assert audit.is_ram_adequate is True


def test_detect_system_info_unsupported_python_version(tmp_path):
    """Verifies detection of unsupported Python version (< 3.10) producing blocking error."""
    with patch("platform.system", return_value="Linux"), \
         patch("sys.version_info", VersionInfo(3, 9, 7, "final", 0)), \
         patch("shutil.disk_usage", return_value=MockDiskUsage(total_gb=100.0, free_gb=20.0)):

        audit = detect_system_info(tmp_path)

        assert audit.is_python_supported is False
        assert any("Python version 3.9.7 is unsupported" in err for err in audit.errors)


def test_detect_system_info_python_310_warning(tmp_path):
    """Verifies Python 3.10 is permitted but generates a recommended 3.11+ warning."""
    with patch("platform.system", return_value="Linux"), \
         patch("sys.version_info", VersionInfo(3, 10, 12, "final", 0)), \
         patch("shutil.disk_usage", return_value=MockDiskUsage(total_gb=100.0, free_gb=20.0)):

        audit = detect_system_info(tmp_path)

        assert audit.is_python_supported is True
        assert len(audit.errors) == 0
        assert any("Python 3.11+ is recommended" in w for w in audit.warnings)


def test_detect_system_info_low_ram_warning(tmp_path):
    """Verifies that RAM < 8 GB triggers an informational warning."""
    with patch("platform.system", return_value="Linux"), \
         patch("sys.version_info", VersionInfo(3, 11, 0, "final", 0)), \
         patch("pathlib.Path.read_text", return_value="MemTotal: 4194304 kB\nMemAvailable: 2097152 kB\n"), \
         patch("shutil.disk_usage", return_value=MockDiskUsage(total_gb=100.0, free_gb=20.0)):

        audit = detect_system_info(tmp_path)

        assert audit.total_ram_gb == 4.0
        assert audit.is_ram_adequate is False
        assert any("below 8 GB recommended minimum" in w for w in audit.warnings)


def test_detect_system_info_critically_low_disk_space(tmp_path):
    """Verifies free disk < 2.0 GB produces a blocking error."""
    with patch("platform.system", return_value="Linux"), \
         patch("sys.version_info", VersionInfo(3, 11, 0, "final", 0)), \
         patch("shutil.disk_usage", return_value=MockDiskUsage(total_gb=100.0, free_gb=1.2)):

        audit = detect_system_info(tmp_path)

        assert audit.is_disk_adequate is False
        assert any("Critically low disk space" in err for err in audit.errors)


def test_detect_system_info_low_disk_space_warning(tmp_path):
    """Verifies free disk between 2.0 and 5.0 GB produces a warning."""
    with patch("platform.system", return_value="Linux"), \
         patch("sys.version_info", VersionInfo(3, 11, 0, "final", 0)), \
         patch("shutil.disk_usage", return_value=MockDiskUsage(total_gb=100.0, free_gb=3.5)):

        audit = detect_system_info(tmp_path)

        assert audit.is_disk_adequate is False
        assert len(audit.errors) == 0
        assert any("Low free disk space" in w for w in audit.warnings)


# =============================================================================
# 2. Tooling Prerequisites Audit
# =============================================================================

def test_audit_tools_all_present():
    """Verifies tool audit when git, node (>=18), and npm are all present."""
    def fake_which(cmd):
        return f"/usr/bin/{cmd}"

    def fake_run(cmd, capture_output=True, text=True, check=True):
        res = MagicMock()
        if cmd[0].endswith("git"):
            res.stdout = "git version 2.43.0\n"
        elif cmd[0].endswith("node"):
            res.stdout = "v20.11.0\n"
        elif cmd[0].endswith("npm") or cmd[0].endswith("npm.cmd"):
            res.stdout = "10.2.4\n"
        return res

    with patch("shutil.which", side_effect=fake_which), \
         patch("subprocess.run", side_effect=fake_run):

        tool_audit = audit_tools()

        assert tool_audit.git_version == "git version 2.43.0"
        assert tool_audit.node_version == "v20.11.0"
        assert tool_audit.npm_version == "10.2.4"
        assert len(tool_audit.errors) == 0
        assert len(tool_audit.warnings) == 0


def test_audit_tools_missing_git_is_warning_only():
    """Verifies that missing git generates a warning but does not block installation."""
    def fake_which(cmd):
        if cmd == "git":
            return None
        return f"/usr/bin/{cmd}"

    def fake_run(cmd, capture_output=True, text=True, check=True):
        res = MagicMock()
        res.stdout = "v20.11.0\n" if "node" in cmd[0] else "10.2.4\n"
        return res

    with patch("shutil.which", side_effect=fake_which), \
         patch("subprocess.run", side_effect=fake_run):

        tool_audit = audit_tools()

        assert tool_audit.git_path is None
        assert any("Git not found on PATH" in w for w in tool_audit.warnings)
        assert len(tool_audit.errors) == 0


def test_audit_tools_missing_node_is_error():
    """Verifies that missing node.js generates a blocking error."""
    def fake_which(cmd):
        if cmd == "node":
            return None
        return f"/usr/bin/{cmd}"

    with patch("shutil.which", side_effect=fake_which), \
         patch("subprocess.run", return_value=MagicMock(stdout="10.0.0\n")):

        tool_audit = audit_tools()

        assert tool_audit.node_path is None
        assert any("Node.js is not found on PATH" in err for err in tool_audit.errors)


def test_audit_tools_missing_npm_is_error():
    """Verifies that missing npm generates a blocking error."""
    def fake_which(cmd):
        if "npm" in cmd:
            return None
        return f"/usr/bin/{cmd}"

    with patch("shutil.which", side_effect=fake_which), \
         patch("subprocess.run", return_value=MagicMock(stdout="v20.0.0\n")):

        tool_audit = audit_tools()

        assert tool_audit.npm_path is None
        assert any("npm package manager is not found on PATH" in err for err in tool_audit.errors)


def test_audit_tools_outdated_node_version_warning():
    """Verifies node < 18 produces a warning."""
    def fake_which(cmd):
        return f"/usr/bin/{cmd}"

    def fake_run(cmd, capture_output=True, text=True, check=True):
        res = MagicMock()
        res.stdout = "v16.14.2\n" if "node" in cmd[0] else "8.5.0\n"
        return res

    with patch("shutil.which", side_effect=fake_which), \
         patch("subprocess.run", side_effect=fake_run):

        tool_audit = audit_tools()

        assert any("older than recommended Node 18+" in w for w in tool_audit.warnings)


# =============================================================================
# 3. Hardware & Runtime Acceleration Audit
# =============================================================================

def test_audit_hardware_nvidia_gpu_detected(tmp_path):
    """Verifies NVIDIA GPU detection via nvidia-smi query output."""
    mock_smi_res = MagicMock()
    mock_smi_res.returncode = 0
    mock_smi_res.stdout = "NVIDIA GeForce RTX 5060 Laptop GPU, 8151, 570.86.16\n"

    with patch("shutil.which", return_value="/usr/bin/nvidia-smi"), \
         patch("subprocess.run", return_value=mock_smi_res), \
         patch.dict("os.environ", {}, clear=True), \
         patch("urllib.request.build_opener") as mock_opener_cls:

        mock_opener = MagicMock()
        mock_opener.open.side_effect = Exception("offline")
        mock_opener_cls.return_value = mock_opener

        hw_audit = audit_hardware_and_runtime(tmp_path)

        assert hw_audit.has_nvidia_gpu is True
        assert hw_audit.gpu_name == "NVIDIA GeForce RTX 5060 Laptop GPU"
        assert hw_audit.gpu_vram_mb == 8151
        assert hw_audit.driver_version == "570.86.16"
        assert hw_audit.recommended_adapter == "vllm"


def test_audit_hardware_cpu_only_zero_gpu_mode(tmp_path):
    """Verifies CPU-only fallback when no GPU or remote keys are detected."""
    with patch("shutil.which", return_value=None), \
         patch("os.environ.get", return_value=None), \
         patch("urllib.request.build_opener") as mock_opener_cls:

        mock_opener = MagicMock()
        mock_opener.open.side_effect = Exception("offline")
        mock_opener_cls.return_value = mock_opener

        hw_audit = audit_hardware_and_runtime(tmp_path)

        assert hw_audit.has_nvidia_gpu is False
        assert hw_audit.gpu_name is None
        assert hw_audit.recommended_adapter == "fake"
        assert "Zero-GPU Demo Mode" in hw_audit.recommended_mode_description


def test_audit_hardware_local_vllm_service_active(tmp_path):
    """Verifies active local vLLM endpoint takes priority."""
    with patch("shutil.which", return_value=None), \
         patch("urllib.request.build_opener") as mock_opener_cls:

        mock_resp = MagicMock()
        mock_resp.getcode.return_value = 200

        mock_opener = MagicMock()
        mock_opener.open.return_value.__enter__.return_value = mock_resp
        mock_opener_cls.return_value = mock_opener

        hw_audit = audit_hardware_and_runtime(tmp_path)

        assert hw_audit.vllm_service_active is True
        assert hw_audit.recommended_adapter == "vllm"


def test_audit_hardware_local_ollama_service_active(tmp_path):
    """Verifies active local Ollama endpoint detection."""
    with patch("shutil.which", return_value=None), \
         patch("urllib.request.build_opener") as mock_opener_cls:

        mock_opener = MagicMock()

        def fake_open(url, timeout=1.5):
            if "11434" in url:
                m = MagicMock()
                m.getcode.return_value = 200
                m.read.return_value = b'{"models": [{"name": "qwen3:4b"}]}'
                m.__enter__.return_value = m
                return m
            raise ConnectionRefusedError()

        mock_opener.open.side_effect = fake_open
        mock_opener_cls.return_value = mock_opener

        hw_audit = audit_hardware_and_runtime(tmp_path)

        assert hw_audit.ollama_service_active is True
        assert "qwen3:4b" in hw_audit.ollama_models
        assert hw_audit.recommended_adapter == "local"


def test_audit_hardware_nebius_cloud_credentials(tmp_path):
    """Verifies Nebius credentials in environment sets adapter to nebius."""
    with patch("shutil.which", return_value=None), \
         patch.dict("os.environ", {"NEBIUS_API_KEY": "valid-api-key-test"}), \
         patch("urllib.request.build_opener") as mock_opener_cls:

        mock_opener = MagicMock()
        mock_opener.open.side_effect = Exception("offline")
        mock_opener_cls.return_value = mock_opener

        hw_audit = audit_hardware_and_runtime(tmp_path)

        assert hw_audit.nebius_configured is True
        assert hw_audit.recommended_adapter == "nebius"


# =============================================================================
# 4. Virtual Environment & Backend Installation
# =============================================================================

def test_get_venv_python_path():
    """Verifies platform-specific path resolution for Python in virtualenv."""
    venv_dir = Path("/mock/repo/.venv")
    with patch("platform.system", return_value="Windows"):
        p = get_venv_python_path(venv_dir)
        assert p.as_posix().endswith("Scripts/python.exe")

    with patch("platform.system", return_value="Linux"):
        p = get_venv_python_path(venv_dir)
        assert p.as_posix().endswith("bin/python")


def test_ensure_virtualenv_reuse_existing(tmp_path):
    """Verifies that an existing .venv is detected and reused without recreation."""
    venv_dir = tmp_path / ".venv"
    if platform.system() == "Windows":
        py_bin = venv_dir / "Scripts" / "python.exe"
    else:
        py_bin = venv_dir / "bin" / "python"
    py_bin.parent.mkdir(parents=True, exist_ok=True)
    py_bin.write_text("#!/usr/bin/env python\n", encoding="utf-8")

    logger = logging.getLogger("test.setup")

    with patch("venv.EnvBuilder") as mock_builder:
        res = ensure_virtualenv(tmp_path, recreate=False, logger=logger)
        assert res == py_bin
        mock_builder.assert_not_called()


def test_ensure_virtualenv_recreate_flag(tmp_path):
    """Verifies that --recreate-venv removes existing venv and creates fresh."""
    venv_dir = tmp_path / ".venv"
    venv_dir.mkdir(parents=True, exist_ok=True)
    (venv_dir / "marker.txt").write_text("old", encoding="utf-8")

    logger = logging.getLogger("test.setup")

    with patch("venv.EnvBuilder") as mock_builder_cls, \
         patch("setup.get_venv_python_path", return_value=tmp_path / "mock_python"):

        mock_builder = MagicMock()
        mock_builder_cls.return_value = mock_builder

        # Mock mock_python existing
        with patch.object(Path, "exists", return_value=True):
            res = ensure_virtualenv(tmp_path, recreate=True, logger=logger)
            mock_builder_cls.assert_called_once_with(with_pip=True, clear=True)
            mock_builder.create.assert_called_once_with(venv_dir)


def test_install_backend_standard_success(tmp_path):
    """Verifies standard pip editable install success."""
    venv_py = tmp_path / "python"
    logger = logging.getLogger("test.setup")

    with patch("subprocess.run") as mock_run:
        mock_proc = MagicMock()
        mock_proc.returncode = 0
        mock_run.return_value = mock_proc

        ok = install_backend(tmp_path, venv_py, dev=False, verbose=False, logger=logger)

        assert ok is True
        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert "-m" in args
        assert "pip" in args
        assert "-e" in args
        assert "." in args


def test_install_backend_fallback_to_no_build_isolation(tmp_path):
    """Verifies fallback to --no-build-isolation when standard install fails."""
    venv_py = tmp_path / "python"
    logger = logging.getLogger("test.setup")

    def fake_run(cmd, *args, **kwargs):
        if "--no-build-isolation" in cmd:
            return MagicMock(returncode=0)
        raise subprocess.CalledProcessError(returncode=1, cmd=cmd)

    with patch("subprocess.run", side_effect=fake_run):
        ok = install_backend(tmp_path, venv_py, dev=False, verbose=False, logger=logger)
        assert ok is True


def test_install_backend_fallback_to_existing_import(tmp_path):
    """Verifies fallback when both pip calls fail but slokern is already importable."""
    venv_py = tmp_path / "python"
    logger = logging.getLogger("test.setup")

    def fake_run(cmd, *args, **kwargs):
        if "-c" in cmd and "import slokern" in cmd[2]:
            return MagicMock(stdout="/path/to/slokern\n")
        raise subprocess.CalledProcessError(returncode=1, cmd=cmd)

    with patch("subprocess.run", side_effect=fake_run):
        ok = install_backend(tmp_path, venv_py, dev=False, verbose=False, logger=logger)
        assert ok is True


def test_install_backend_all_strategies_fail(tmp_path):
    """Verifies install_backend returns False if all strategies fail."""
    venv_py = tmp_path / "python"
    logger = logging.getLogger("test.setup")

    with patch("subprocess.run", side_effect=subprocess.CalledProcessError(returncode=1, cmd="pip")):
        ok = install_backend(tmp_path, venv_py, dev=False, verbose=False, logger=logger)
        assert ok is False


# =============================================================================
# 5. Frontend Installation & Build
# =============================================================================

def test_install_frontend_skips_if_no_frontend_dir(tmp_path):
    """Verifies that missing frontend/ directory is skipped gracefully without error."""
    logger = logging.getLogger("test.setup")
    ok = install_frontend(tmp_path, skip_build=False, verbose=False, logger=logger)
    assert ok is True


def test_install_frontend_missing_npm_fails(tmp_path):
    """Verifies failure when npm binary is not found on PATH."""
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir(parents=True)
    (frontend_dir / "package.json").write_text("{}", encoding="utf-8")
    logger = logging.getLogger("test.setup")

    with patch("shutil.which", return_value=None):
        ok = install_frontend(tmp_path, skip_build=False, verbose=False, logger=logger)
        assert ok is False


def test_install_frontend_uses_npm_ci_with_lockfile(tmp_path):
    """Verifies npm ci is used when package-lock.json exists, followed by build."""
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir(parents=True)
    (frontend_dir / "package.json").write_text("{}", encoding="utf-8")
    (frontend_dir / "package-lock.json").write_text("{}", encoding="utf-8")
    dist_dir = frontend_dir / "dist"
    dist_dir.mkdir()
    (dist_dir / "index.html").write_text("<html></html>", encoding="utf-8")

    logger = logging.getLogger("test.setup")

    executed_cmds = []

    def fake_run(cmd, *args, **kwargs):
        executed_cmds.append(cmd)
        return MagicMock(returncode=0)

    with patch("shutil.which", return_value="/usr/bin/npm"), \
         patch("subprocess.run", side_effect=fake_run):

        ok = install_frontend(tmp_path, skip_build=False, verbose=False, logger=logger)

        assert ok is True
        assert len(executed_cmds) == 2
        assert executed_cmds[0] == ["/usr/bin/npm", "ci"]
        assert executed_cmds[1] == ["/usr/bin/npm", "run", "build"]


def test_install_frontend_respects_skip_build(tmp_path):
    """Verifies --skip-build skips compilation step."""
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir(parents=True)
    (frontend_dir / "package.json").write_text("{}", encoding="utf-8")
    logger = logging.getLogger("test.setup")

    executed_cmds = []

    def fake_run(cmd, *args, **kwargs):
        executed_cmds.append(cmd)
        return MagicMock(returncode=0)

    with patch("shutil.which", return_value="/usr/bin/npm"), \
         patch("subprocess.run", side_effect=fake_run):

        ok = install_frontend(tmp_path, skip_build=True, verbose=False, logger=logger)

        assert ok is True
        assert len(executed_cmds) == 1
        assert executed_cmds[0] == ["/usr/bin/npm", "install"]


def test_install_frontend_npm_ci_fallback_to_install(tmp_path):
    """Verifies that if npm ci fails, setup automatically falls back to npm install."""
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir(parents=True)
    (frontend_dir / "package.json").write_text("{}", encoding="utf-8")
    (frontend_dir / "package-lock.json").write_text("{}", encoding="utf-8")
    dist_dir = frontend_dir / "dist"
    dist_dir.mkdir()
    (dist_dir / "index.html").write_text("<html></html>", encoding="utf-8")

    logger = logging.getLogger("test.setup")

    call_count = {"ci": 0, "install": 0, "build": 0}

    def fake_run(cmd, *args, **kwargs):
        if "ci" in cmd:
            call_count["ci"] += 1
            raise subprocess.CalledProcessError(returncode=1, cmd=cmd)
        elif "install" in cmd:
            call_count["install"] += 1
            return MagicMock(returncode=0)
        elif "build" in cmd:
            call_count["build"] += 1
            return MagicMock(returncode=0)
        return MagicMock(returncode=0)

    with patch("shutil.which", return_value="/usr/bin/npm"), \
         patch("subprocess.run", side_effect=fake_run):

        ok = install_frontend(tmp_path, skip_build=False, verbose=False, logger=logger)

        assert ok is True
        assert call_count["ci"] == 1
        assert call_count["install"] == 1
        assert call_count["build"] == 1


# =============================================================================
# 6. Safe .env Configuration Non-Overwriting
# =============================================================================

def test_setup_environment_file_existing_not_overwritten(tmp_path):
    """
    CRITICAL INVARIANT (Criterion 8):
    Verifies that existing .env files and credentials are NEVER overwritten.
    """
    env_file = tmp_path / ".env"
    existing_content = "NEBIUS_API_KEY=my-super-secret-production-token\nSLOKERN_ADAPTER=nebius\n"
    env_file.write_text(existing_content, encoding="utf-8")

    logger = logging.getLogger("test.setup")

    result_path = setup_environment_file(tmp_path, recommended_adapter="fake", logger=logger)

    assert result_path == env_file
    # Content must remain 100% identical
    assert env_file.read_text(encoding="utf-8") == existing_content


def test_setup_environment_file_created_from_template(tmp_path):
    """Verifies that .env is copied from .env.example when .env does not exist."""
    env_example = tmp_path / ".env.example"
    example_content = "# Template\nSLOKERN_ADAPTER=fake\nSLOKERN_API_PORT=8001\n"
    env_example.write_text(example_content, encoding="utf-8")

    logger = logging.getLogger("test.setup")

    result_path = setup_environment_file(tmp_path, recommended_adapter="vllm", logger=logger)

    env_file = tmp_path / ".env"
    assert result_path == env_file
    assert env_file.exists()
    assert env_file.read_text(encoding="utf-8") == example_content


def test_setup_environment_file_minimal_fallback_if_no_example(tmp_path):
    """Verifies fallback minimal .env generation if .env.example is absent."""
    logger = logging.getLogger("test.setup")

    result_path = setup_environment_file(tmp_path, recommended_adapter="local", logger=logger)

    env_file = tmp_path / ".env"
    assert result_path == env_file
    assert env_file.exists()
    content = env_file.read_text(encoding="utf-8")
    assert "SLOKERN_ADAPTER=local" in content
    assert "SLOKERN_API_PORT=8001" in content


def test_setup_environment_file_posix_chmod(tmp_path):
    """Verifies chmod 0600 is applied on POSIX systems."""
    env_example = tmp_path / ".env.example"
    env_example.write_text("TEST=1\n", encoding="utf-8")
    logger = logging.getLogger("test.setup")

    with patch("platform.system", return_value="Linux"), \
         patch("os.chmod") as mock_chmod:

        setup_environment_file(tmp_path, recommended_adapter="fake", logger=logger)

        env_file = tmp_path / ".env"
        mock_chmod.assert_called_once_with(env_file, 0o600)


# =============================================================================
# 7. Orchestration, CLI Flags, Idempotency & Error Handling
# =============================================================================

def test_parse_args_all_flags():
    """Verifies parsing of all supported CLI flags."""
    argv = [
        "--check-only",
        "--non-interactive",
        "--dev",
        "--recreate-venv",
        "--skip-backend",
        "--skip-frontend",
        "--skip-build",
        "--adapter", "vllm",
        "--verbose",
    ]
    cfg = parse_args(argv)

    assert cfg.check_only is True
    assert cfg.non_interactive is True
    assert cfg.dev is True
    assert cfg.recreate_venv is True
    assert cfg.skip_backend is True
    assert cfg.skip_frontend is True
    assert cfg.skip_build is True
    assert cfg.preferred_adapter == "vllm"
    assert cfg.verbose is True


def test_run_setup_check_only_mode(tmp_path):
    """Verifies --check-only mode audits without installing or modifying files."""
    cfg = SetupConfig(repo_root=tmp_path, check_only=True)

    with patch("setup.detect_system_info") as mock_sys, \
         patch("setup.audit_tools") as mock_tools, \
         patch("setup.audit_hardware_and_runtime") as mock_hw, \
         patch("setup.setup_environment_file") as mock_env, \
         patch("setup.ensure_virtualenv") as mock_venv:

        mock_sys.return_value = SystemAudit(
            os_name="Windows", os_release="11", os_version="10.0", architecture="AMD64",
            total_ram_gb=16.0, available_ram_gb=10.0, disk_total_gb=500.0, disk_free_gb=100.0,
            python_version="3.11.9", python_path="python", is_python_supported=True,
            is_ram_adequate=True, is_disk_adequate=True,
        )
        mock_tools.return_value = ToolAudit(
            git_path="git", git_version="2.40", node_path="node", node_version="v20.0",
            npm_path="npm", npm_version="10.0",
        )
        mock_hw.return_value = HardwareAudit(
            has_nvidia_gpu=False, recommended_adapter="fake",
            recommended_mode_description="CPU-only",
        )

        ret = run_setup(cfg)

        assert ret == 0
        mock_env.assert_not_called()
        mock_venv.assert_not_called()


def test_run_setup_idempotent_execution(tmp_path):
    """
    CRITICAL INVARIANT (Criterion 9):
    Verifies that running setup multiple times succeeds idempotently.
    """
    cfg = SetupConfig(repo_root=tmp_path)

    with patch("setup.detect_system_info") as mock_sys, \
         patch("setup.audit_tools") as mock_tools, \
         patch("setup.audit_hardware_and_runtime") as mock_hw, \
         patch("setup.setup_environment_file", return_value=tmp_path / ".env"), \
         patch("setup.ensure_virtualenv", return_value=tmp_path / "python"), \
         patch("setup.install_backend", return_value=True), \
         patch("setup.install_frontend", return_value=True):

        mock_sys.return_value = SystemAudit(
            os_name="Linux", os_release="6.5", os_version="Ubuntu", architecture="x86_64",
            total_ram_gb=16.0, available_ram_gb=12.0, disk_total_gb=500.0, disk_free_gb=100.0,
            python_version="3.11.5", python_path="python", is_python_supported=True,
            is_ram_adequate=True, is_disk_adequate=True,
        )
        mock_tools.return_value = ToolAudit(
            git_path="git", git_version="2.40", node_path="node", node_version="v20.0",
            npm_path="npm", npm_version="10.0",
        )
        mock_hw.return_value = HardwareAudit(
            has_nvidia_gpu=False, recommended_adapter="fake",
            recommended_mode_description="CPU-only",
        )

        # Run 1
        ret1 = run_setup(cfg)
        assert ret1 == 0

        # Run 2 (idempotent repeated run)
        ret2 = run_setup(cfg)
        assert ret2 == 0


def test_run_setup_system_error_stops_gracefully(tmp_path):
    """Verifies that system audit errors abort setup with nonzero exit code."""
    cfg = SetupConfig(repo_root=tmp_path)

    with patch("setup.detect_system_info") as mock_sys:
        mock_sys.return_value = SystemAudit(
            os_name="Linux", os_release="6.5", os_version="Ubuntu", architecture="x86_64",
            total_ram_gb=2.0, available_ram_gb=1.0, disk_total_gb=50.0, disk_free_gb=0.5,
            python_version="3.8.0", python_path="python", is_python_supported=False,
            is_ram_adequate=False, is_disk_adequate=False,
            errors=["Unsupported Python 3.8", "Critically low disk space"],
        )

        ret = run_setup(cfg)
        assert ret == 1


def test_run_setup_tool_error_stops_gracefully(tmp_path):
    """Verifies that missing node/npm prerequisites abort setup with code 1."""
    cfg = SetupConfig(repo_root=tmp_path)

    with patch("setup.detect_system_info") as mock_sys, \
         patch("setup.audit_tools") as mock_tools:

        mock_sys.return_value = SystemAudit(
            os_name="Windows", os_release="11", os_version="10.0", architecture="AMD64",
            total_ram_gb=16.0, available_ram_gb=10.0, disk_total_gb=500.0, disk_free_gb=100.0,
            python_version="3.11.9", python_path="python", is_python_supported=True,
            is_ram_adequate=True, is_disk_adequate=True,
        )
        mock_tools.return_value = ToolAudit(
            git_path=None, git_version=None, node_path=None, node_version=None,
            npm_path=None, npm_version=None,
            errors=["Node.js not found", "npm not found"],
        )

        ret = run_setup(cfg)
        assert ret == 1
