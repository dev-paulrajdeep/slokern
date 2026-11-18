#!/usr/bin/env python3
"""
scripts/setup.py — Cross-Platform SLOKern Bootstrap & Installation Orchestrator.

Purpose:
    Turnkey bootstrap orchestrator that automates system prerequisites checking,
    virtual environment management, backend Python installation, frontend Node/npm
    installation and build, safe .env generation, hardware/runtime mode detection,
    and structured audit logging.

Authority:
    Aligned with AGENTS.md Section 1, 2, 8, 9, 10, 13, and USER_REQUEST Criteria 1-18.
Owner:
    Rajdeep
"""

from __future__ import annotations

import argparse
import ctypes
from dataclasses import dataclass, field
import json
import logging
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
from typing import Dict, List, Optional, Tuple
import urllib.request


# =============================================================================
# ANSI Formatting & Colored Logging Helper
# =============================================================================

class TermColor:
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"


def supports_color() -> bool:
    if os.environ.get("NO_COLOR") or os.environ.get("TERM") == "dumb":
        return False
    return sys.stdout.isatty()


def color_text(text: str, color_code: str) -> str:
    if not supports_color():
        return text
    return f"{color_code}{text}{TermColor.RESET}"


# =============================================================================
# Audit Data Contracts
# =============================================================================

@dataclass
class SystemAudit:
    os_name: str
    os_release: str
    os_version: str
    architecture: str
    total_ram_gb: float
    available_ram_gb: float
    disk_total_gb: float
    disk_free_gb: float
    python_version: str
    python_path: str
    is_python_supported: bool
    is_ram_adequate: bool
    is_disk_adequate: bool
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


@dataclass
class ToolAudit:
    git_path: Optional[str]
    git_version: Optional[str]
    node_path: Optional[str]
    node_version: Optional[str]
    npm_path: Optional[str]
    npm_version: Optional[str]
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


@dataclass
class HardwareAudit:
    has_nvidia_gpu: bool
    gpu_name: Optional[str] = None
    gpu_vram_mb: Optional[int] = None
    driver_version: Optional[str] = None
    cuda_version: Optional[str] = None
    vllm_service_active: bool = False
    ollama_service_active: bool = False
    ollama_models: List[str] = field(default_factory=list)
    nebius_configured: bool = False
    recommended_adapter: str = "fake"
    recommended_mode_description: str = "Zero-GPU CPU Demo Mode"


@dataclass
class SetupConfig:
    repo_root: Path
    check_only: bool = False
    non_interactive: bool = False
    dev: bool = False
    recreate_venv: bool = False
    skip_backend: bool = False
    skip_frontend: bool = False
    skip_build: bool = False
    preferred_adapter: Optional[str] = None
    verbose: bool = False


# =============================================================================
# Logging Infrastructure
# =============================================================================

def setup_logger(repo_root: Path, verbose: bool = False) -> logging.Logger:
    """Configures dual console and file logging to logs/setup.log."""
    logs_dir = repo_root / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_file = logs_dir / "setup.log"

    logger = logging.getLogger("slokern.setup")
    logger.setLevel(logging.DEBUG)
    close_logger(logger)

    # File handler: uncolored, detailed timestamps
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter(
        "[%(asctime)s] [%(levelname)-7s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    file_handler.setFormatter(file_formatter)
    logger.addHandler(file_handler)

    # Console handler: clean user presentation
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG if verbose else logging.INFO)
    console_formatter = logging.Formatter("%(message)s")
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)

    return logger


def close_logger(logger: logging.Logger) -> None:
    """Closes and detaches all handlers from the logger to cleanly release file handles."""
    for handler in list(logger.handlers):
        try:
            handler.close()
        except Exception:
            pass
        logger.removeHandler(handler)


# =============================================================================
# System Audit & Hardware Detection
# =============================================================================

def detect_system_info(repo_root: Path) -> SystemAudit:
    """Audits operating system, architecture, RAM, disk space, and Python version."""
    os_name = platform.system()
    os_release = platform.release()
    os_version = platform.version()
    architecture = platform.machine()
    python_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    python_path = sys.executable

    # RAM detection
    total_ram_gb = 0.0
    available_ram_gb = 0.0

    if os_name == "Windows":
        try:
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            total_ram_gb = round(stat.ullTotalPhys / (1024 ** 3), 2)
            available_ram_gb = round(stat.ullAvailPhys / (1024 ** 3), 2)
        except Exception:
            pass
    elif os_name == "Linux":
        try:
            meminfo = Path("/proc/meminfo").read_text(encoding="utf-8")
            mem_dict: Dict[str, float] = {}
            for line in meminfo.splitlines():
                if ":" in line:
                    parts = line.split(":", 1)
                    key = parts[0].strip()
                    val_str = parts[1].strip().split()[0]
                    mem_dict[key] = float(val_str)
            if "MemTotal" in mem_dict:
                total_ram_gb = round(mem_dict["MemTotal"] / (1024 ** 2), 2)
            if "MemAvailable" in mem_dict:
                available_ram_gb = round(mem_dict["MemAvailable"] / (1024 ** 2), 2)
        except Exception:
            pass
    elif os_name == "Darwin":
        try:
            res = subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, check=True)
            bytes_val = float(res.stdout.strip())
            total_ram_gb = round(bytes_val / (1024 ** 3), 2)
            available_ram_gb = total_ram_gb * 0.5  # Approximate if unmeasured
        except Exception:
            pass

    # Disk usage
    try:
        du = shutil.disk_usage(repo_root)
        disk_total_gb = round(du.total / (1024 ** 3), 2)
        disk_free_gb = round(du.free / (1024 ** 3), 2)
    except Exception:
        disk_total_gb = 0.0
        disk_free_gb = 0.0

    warnings: List[str] = []
    errors: List[str] = []

    # Python version compatibility
    # pyproject.toml requires >= 3.11, while 3.10 is minimum acceptable for bootstrap runner
    is_python_supported = sys.version_info >= (3, 10)
    if not is_python_supported:
        errors.append(f"Python version {python_version} is unsupported. Python 3.10+ (recommended 3.11+) is required.")
    elif sys.version_info < (3, 11):
        warnings.append(f"Running on Python {python_version}. Python 3.11+ is recommended for optimal performance.")

    # RAM adequacy check (8 GB minimum recommended for local dev/demo; 16 GB for full local LLM serving)
    is_ram_adequate = total_ram_gb >= 7.5 or total_ram_gb == 0.0
    if total_ram_gb > 0 and total_ram_gb < 7.5:
        warnings.append(f"System RAM ({total_ram_gb} GB) is below 8 GB recommended minimum.")

    # Disk adequacy check (5 GB recommended for dependencies, venv, and artifacts)
    is_disk_adequate = disk_free_gb >= 5.0 or disk_free_gb == 0.0
    if disk_free_gb > 0 and disk_free_gb < 2.0:
        errors.append(f"Critically low disk space ({disk_free_gb} GB free). At least 2 GB required.")
    elif disk_free_gb > 0 and disk_free_gb < 5.0:
        warnings.append(f"Low free disk space ({disk_free_gb} GB free). 5 GB recommended.")

    return SystemAudit(
        os_name=os_name,
        os_release=os_release,
        os_version=os_version,
        architecture=architecture,
        total_ram_gb=total_ram_gb,
        available_ram_gb=available_ram_gb,
        disk_total_gb=disk_total_gb,
        disk_free_gb=disk_free_gb,
        python_version=python_version,
        python_path=python_path,
        is_python_supported=is_python_supported,
        is_ram_adequate=is_ram_adequate,
        is_disk_adequate=is_disk_adequate,
        warnings=warnings,
        errors=errors,
    )


def audit_tools() -> ToolAudit:
    """Audits git, node, and npm prerequisites."""
    warnings: List[str] = []
    errors: List[str] = []

    # Git
    git_path = shutil.which("git")
    git_version: Optional[str] = None
    if git_path:
        try:
            res = subprocess.run([git_path, "--version"], capture_output=True, text=True, check=True)
            git_version = res.stdout.strip()
        except Exception as exc:
            warnings.append(f"Git discovered at {git_path} but failed to report version: {exc}")
    else:
        warnings.append("Git not found on PATH. Source repository operations and submodules may be limited.")

    # Node.js
    node_path = shutil.which("node")
    node_version: Optional[str] = None
    if node_path:
        try:
            res = subprocess.run([node_path, "-v"], capture_output=True, text=True, check=True)
            node_version = res.stdout.strip()
            # Check for Node version (recommended >= 18)
            v_digits = node_version.lstrip("v").split(".")
            if v_digits and v_digits[0].isdigit() and int(v_digits[0]) < 18:
                warnings.append(f"Node.js version {node_version} is older than recommended Node 18+.")
        except Exception as exc:
            warnings.append(f"Node.js discovered at {node_path} but failed to report version: {exc}")
    else:
        errors.append("Node.js is not found on PATH. Required to build and run the SLOKern Command Center frontend.")

    # npm
    npm_path = shutil.which("npm") or shutil.which("npm.cmd")
    npm_version: Optional[str] = None
    if npm_path:
        try:
            res = subprocess.run([npm_path, "-v"], capture_output=True, text=True, check=True)
            npm_version = res.stdout.strip()
        except Exception as exc:
            warnings.append(f"npm discovered at {npm_path} but failed to report version: {exc}")
    else:
        errors.append("npm package manager is not found on PATH.")

    return ToolAudit(
        git_path=git_path,
        git_version=git_version,
        node_path=node_path,
        node_version=node_version,
        npm_path=npm_path,
        npm_version=npm_version,
        warnings=warnings,
        errors=errors,
    )


def audit_hardware_and_runtime(repo_root: Path) -> HardwareAudit:
    """
    Detects hardware acceleration and available inference serving runtimes:
      - NVIDIA GPU & VRAM via nvidia-smi
      - Local vLLM on port 8000
      - Local Ollama on port 11434
      - Nebius Cloud credentials from environment or .env
    """
    has_nvidia_gpu = False
    gpu_name: Optional[str] = None
    gpu_vram_mb: Optional[int] = None
    driver_version: Optional[str] = None
    cuda_version: Optional[str] = None

    # 1. NVIDIA GPU detection
    smi_path = shutil.which("nvidia-smi")
    if smi_path:
        try:
            res = subprocess.run(
                [
                    smi_path,
                    "--query-gpu=name,memory.total,driver_version",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if res.returncode == 0 and res.stdout.strip():
                line = res.stdout.strip().splitlines()[0]
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 3:
                    gpu_name = parts[0]
                    try:
                        gpu_vram_mb = int(parts[1])
                    except ValueError:
                        gpu_vram_mb = None
                    driver_version = parts[2]
                    has_nvidia_gpu = True
        except Exception:
            pass

    # 2. Local vLLM probe (with proxy bypass)
    vllm_service_active = False
    proxy_handler = urllib.request.ProxyHandler({})
    opener = urllib.request.build_opener(proxy_handler)
    try:
        with opener.open("http://127.0.0.1:8000/v1/models", timeout=1.5) as resp:
            if resp.getcode() == 200:
                vllm_service_active = True
    except Exception:
        vllm_service_active = False

    # 3. Local Ollama probe
    ollama_service_active = False
    ollama_models: List[str] = []
    try:
        with opener.open("http://127.0.0.1:11434/api/tags", timeout=1.5) as resp:
            if resp.getcode() == 200:
                data = json.loads(resp.read().decode("utf-8"))
                ollama_service_active = True
                ollama_models = [m.get("name", "") for m in data.get("models", []) if m.get("name")]
    except Exception:
        ollama_service_active = False

    # 4. Nebius Cloud credentials probe
    nebius_configured = bool(os.environ.get("NEBIUS_API_KEY"))
    if not nebius_configured:
        env_file = repo_root / ".env"
        if env_file.exists():
            try:
                for line in env_file.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line.startswith("NEBIUS_API_KEY=") and not line.endswith("="):
                        val = line.split("=", 1)[1].strip().strip("'\"")
                        if val and val != "your-nebius-api-key" and not val.startswith("<"):
                            nebius_configured = True
                            break
            except Exception:
                pass

    # 5. Classify recommended mode
    if vllm_service_active:
        recommended_adapter = "vllm"
        recommended_mode_description = f"Local vLLM Active ({gpu_name or 'GPU'}) on port 8000"
    elif ollama_service_active:
        recommended_adapter = "local"
        recommended_mode_description = f"Local Ollama Active ({len(ollama_models)} model(s) available)"
    elif nebius_configured:
        recommended_adapter = "nebius"
        recommended_mode_description = "Nebius Cloud Remote Serving Configured"
    elif has_nvidia_gpu:
        recommended_adapter = "vllm"
        recommended_mode_description = f"NVIDIA GPU Available ({gpu_name}, {round((gpu_vram_mb or 0)/1024, 1)} GB VRAM) — Ready for vLLM or Ollama"
    else:
        recommended_adapter = "fake"
        recommended_mode_description = "CPU-Only Mode (Zero-GPU Demo Mode / Simulated Serving)"

    return HardwareAudit(
        has_nvidia_gpu=has_nvidia_gpu,
        gpu_name=gpu_name,
        gpu_vram_mb=gpu_vram_mb,
        driver_version=driver_version,
        cuda_version=cuda_version,
        vllm_service_active=vllm_service_active,
        ollama_service_active=ollama_service_active,
        ollama_models=ollama_models,
        nebius_configured=nebius_configured,
        recommended_adapter=recommended_adapter,
        recommended_mode_description=recommended_mode_description,
    )


# =============================================================================
# Virtual Environment & Backend Installation
# =============================================================================

def get_venv_python_path(venv_dir: Path) -> Path:
    """Returns the platform-specific path to python inside the virtualenv."""
    if platform.system() == "Windows":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def ensure_virtualenv(repo_root: Path, recreate: bool, logger: logging.Logger) -> Path:
    """
    Creates or reuses the Python virtual environment (.venv).
    Returns the absolute path to the virtualenv Python executable.
    """
    venv_dir = repo_root / ".venv"
    venv_python = get_venv_python_path(venv_dir)

    if recreate and venv_dir.exists():
        logger.info(f"  -> Recreating virtual environment at {venv_dir}...")
        try:
            shutil.rmtree(venv_dir)
        except Exception as exc:
            logger.warning(f"  [WARN] Failed to completely remove {venv_dir}: {exc}")

    if venv_python.exists() and not recreate:
        logger.info(f"  -> Reusing existing virtual environment (.venv) at {venv_python}")
        return venv_python

    logger.info(f"  -> Creating virtual environment at {venv_dir}...")
    import venv
    try:
        venv.EnvBuilder(with_pip=True, clear=recreate).create(venv_dir)
    except Exception as exc:
        logger.error(f"  [ERROR] Failed to create virtual environment: {exc}")
        logger.error("  On Linux/Debian systems, install python3-venv: sudo apt install python3-venv python3-pip")
        raise RuntimeError(f"Virtualenv creation failed: {exc}") from exc

    if not venv_python.exists():
        raise RuntimeError(f"Virtualenv Python not found at expected path: {venv_python}")

    logger.info("  -> Virtual environment created successfully.")
    return venv_python


def install_backend(
    repo_root: Path,
    venv_python: Path,
    dev: bool,
    verbose: bool,
    logger: logging.Logger,
) -> bool:
    """Installs the slokern package in editable mode via pip inside .venv with resilient offline fallbacks."""
    logger.info("  -> Installing Python backend dependencies...")
    target_spec = ".[dev]" if dev else "."

    # Strategy 1: Standard pip install -e
    cmd = [str(venv_python), "-m", "pip", "install", "-e", target_spec]
    logger.debug(f"Running backend command: {' '.join(cmd)}")

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=True,
        )
        if verbose and proc.stdout:
            for line in proc.stdout.splitlines():
                logger.debug(f"    [pip] {line}")
        logger.info("  -> Backend package installed in editable mode.")
        return True
    except subprocess.CalledProcessError as exc:
        logger.debug(f"Standard pip install exited with {exc.returncode}; attempting fallback strategies...")

    # Strategy 2: pip install --no-build-isolation -e
    cmd_no_iso = [str(venv_python), "-m", "pip", "install", "--no-build-isolation", "-e", target_spec]
    logger.debug(f"Running backend fallback command: {' '.join(cmd_no_iso)}")
    try:
        proc = subprocess.run(
            cmd_no_iso,
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=True,
        )
        if verbose and proc.stdout:
            for line in proc.stdout.splitlines():
                logger.debug(f"    [pip] {line}")
        logger.info("  -> Backend package installed in editable mode (no build isolation).")
        return True
    except subprocess.CalledProcessError:
        logger.debug("pip install --no-build-isolation failed; checking if slokern is already installed...")

    # Strategy 3: Check if slokern is already importable and working in venv
    probe_cmd = [str(venv_python), "-c", "import slokern; print(slokern.__file__)"]
    try:
        probe_res = subprocess.run(probe_cmd, cwd=str(repo_root), capture_output=True, text=True, check=True)
        installed_loc = probe_res.stdout.strip()
        logger.info(f"  -> Reusing existing editable installation ({installed_loc}).")
        return True
    except subprocess.CalledProcessError as probe_exc:
        logger.error("  [ERROR] pip install failed and package 'slokern' is not importable.")
        logger.error(f"  Diagnostics: {probe_exc.stderr or probe_exc}")
        return False


# =============================================================================
# Frontend Installation & Build
# =============================================================================

def install_frontend(
    repo_root: Path,
    skip_build: bool,
    verbose: bool,
    logger: logging.Logger,
) -> bool:
    """Installs frontend dependencies using frozen lockfile and builds the Vite bundle."""
    frontend_dir = repo_root / "frontend"
    if not frontend_dir.exists() or not (frontend_dir / "package.json").exists():
        logger.warning("  [WARN] Frontend directory not found; skipping frontend installation.")
        return True

    npm_bin = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm_bin:
        logger.error("  [ERROR] npm executable not found on PATH. Frontend installation aborted.")
        return False

    lockfile = frontend_dir / "package-lock.json"
    npm_cmd_install = [npm_bin, "ci"] if lockfile.exists() else [npm_bin, "install"]

    logger.info(f"  -> Installing frontend dependencies using {'npm ci' if lockfile.exists() else 'npm install'}...")
    logger.debug(f"Running command: {' '.join(npm_cmd_install)} in {frontend_dir}")

    try:
        proc = subprocess.run(
            npm_cmd_install,
            cwd=str(frontend_dir),
            capture_output=True,
            text=True,
            check=True,
        )
        if verbose and proc.stdout:
            for line in proc.stdout.splitlines()[-10:]:
                logger.debug(f"    [npm] {line}")
        logger.info("  -> Frontend dependencies installed successfully.")
    except subprocess.CalledProcessError as exc:
        logger.warning(f"  [WARN] 'npm ci' failed (exit code {exc.returncode}); falling back to 'npm install'...")
        try:
            subprocess.run(
                [npm_bin, "install"],
                cwd=str(frontend_dir),
                capture_output=True,
                text=True,
                check=True,
            )
            logger.info("  -> Frontend dependencies installed successfully via 'npm install'.")
        except subprocess.CalledProcessError as exc2:
            logger.error(f"  [ERROR] Frontend installation failed: {exc2.stderr or exc2}")
            return False

    if not skip_build:
        logger.info("  -> Compiling frontend distribution bundle (npm run build)...")
        try:
            build_proc = subprocess.run(
                [npm_bin, "run", "build"],
                cwd=str(frontend_dir),
                capture_output=True,
                text=True,
                check=True,
            )
            dist_index = frontend_dir / "dist" / "index.html"
            if dist_index.exists():
                logger.info(f"  -> Frontend production bundle built cleanly ({dist_index}).")
            else:
                logger.warning("  [WARN] Build succeeded but dist/index.html was not generated.")
        except subprocess.CalledProcessError as exc:
            logger.error(f"  [ERROR] Frontend build failed with exit code {exc.returncode}")
            if exc.stderr:
                for line in exc.stderr.splitlines():
                    logger.error(f"    {line}")
            return False

    return True


# =============================================================================
# Environment Configuration (.env) Setup
# =============================================================================

def setup_environment_file(
    repo_root: Path,
    recommended_adapter: str,
    logger: logging.Logger,
) -> Path:
    """
    Safely creates .env from .env.example only if .env does not already exist.
    Never overwrites existing user configurations or API keys.
    """
    env_file = repo_root / ".env"
    env_example = repo_root / ".env.example"

    if env_file.exists():
        logger.info(f"  -> Existing .env found ({env_file}); preserving without overwriting.")
        return env_file

    if not env_example.exists():
        logger.warning("  [WARN] .env.example not found; creating minimal fallback .env.")
        minimal_content = (
            f"# SLOKern Environment Configuration\n"
            f"SLOKERN_ADAPTER={recommended_adapter}\n"
            f"SLOKERN_API_HOST=127.0.0.1\n"
            f"SLOKERN_API_PORT=8001\n"
        )
        env_file.write_text(minimal_content, encoding="utf-8")
    else:
        logger.info("  -> Generating .env from .env.example template...")
        shutil.copyfile(env_example, env_file)

    # Restrict permissions on POSIX systems (chmod 600)
    if platform.system() != "Windows":
        try:
            os.chmod(env_file, 0o600)
            logger.debug(f"Restricted .env file permissions to 0600 on {env_file}")
        except Exception as exc:
            logger.warning(f"Could not set restrictive permissions on .env: {exc}")

    logger.info(f"  -> Initialized {env_file} with default adapter '{recommended_adapter}'.")
    return env_file


# =============================================================================
# Orchestrator & CLI Entry Point
# =============================================================================

def print_banner() -> None:
    banner = f"""
{TermColor.CYAN}======================================================================
       SLOKern — Inference Optimization & Verification System
                     Turnkey Installation Bootstrap
======================================================================{TermColor.RESET}"""
    print(banner)


def run_setup(config: SetupConfig) -> int:
    """Executes the full installation lifecycle according to the provided configuration."""
    logger = setup_logger(config.repo_root, verbose=config.verbose)
    try:
        print_banner()

        logger.info(f"Repository Root:      {config.repo_root.resolve()}")
        logger.info(f"Execution Mode:       {'Check-Only Audit' if config.check_only else 'Full Installation'}")
        logger.info(f"Log Destination:      {config.repo_root / 'logs' / 'setup.log'}\n")

        # 1. System Audit
        logger.info(color_text("[1/5] System & Environment Audit", TermColor.BOLD))
        sys_audit = detect_system_info(config.repo_root)
        logger.info(f"  Operating System:   {sys_audit.os_name} {sys_audit.os_release} ({sys_audit.architecture})")
        logger.info(f"  System RAM:         {sys_audit.total_ram_gb} GB total ({sys_audit.available_ram_gb} GB available)")
        logger.info(f"  Disk Space:         {sys_audit.disk_free_gb} GB free / {sys_audit.disk_total_gb} GB total")
        logger.info(f"  Python Runtime:     {sys_audit.python_version} ({sys_audit.python_path})")

        for warn in sys_audit.warnings:
            logger.warning(color_text(f"  [WARN] {warn}", TermColor.YELLOW))
        for err in sys_audit.errors:
            logger.error(color_text(f"  [FAIL] {err}", TermColor.RED))

        if sys_audit.errors:
            logger.error("\nSystem prerequisite checks failed. Resolve errors above to proceed.")
            return 1

        # 2. Tooling Audit
        logger.info(color_text("\n[2/5] Tooling & Dependency Prerequisites", TermColor.BOLD))
        tool_audit = audit_tools()
        logger.info(f"  Git Version:        {tool_audit.git_version or 'Not found'}")
        logger.info(f"  Node.js Version:    {tool_audit.node_version or 'Not found'}")
        logger.info(f"  npm Version:        {tool_audit.npm_version or 'Not found'}")

        for warn in tool_audit.warnings:
            logger.warning(color_text(f"  [WARN] {warn}", TermColor.YELLOW))
        for err in tool_audit.errors:
            logger.error(color_text(f"  [FAIL] {err}", TermColor.RED))

        if tool_audit.errors and not config.skip_frontend:
            logger.error("\nMissing required tools. Install Node.js 18+ and npm before installing frontend.")
            return 1

        # 3. Hardware & Runtime Acceleration Audit
        logger.info(color_text("\n[3/5] Hardware & Inference Runtime Detection", TermColor.BOLD))
        hw_audit = audit_hardware_and_runtime(config.repo_root)
        if hw_audit.has_nvidia_gpu:
            vram_str = f", {round((hw_audit.gpu_vram_mb or 0)/1024, 1)} GB VRAM" if hw_audit.gpu_vram_mb else ""
            logger.info(f"  NVIDIA GPU:         {hw_audit.gpu_name}{vram_str} (Driver: {hw_audit.driver_version or 'N/A'})")
        else:
            logger.info("  NVIDIA GPU:         No NVIDIA GPU detected (CPU mode active)")

        logger.info(f"  Local vLLM Service: {'Running on port 8000' if hw_audit.vllm_service_active else 'Not responding on port 8000'}")
        logger.info(f"  Local Ollama Daemon:{'Running on port 11434' if hw_audit.ollama_service_active else 'Not responding on port 11434'}")
        logger.info(f"  Remote Credentials: {'Nebius API key configured' if hw_audit.nebius_configured else 'No remote API keys set'}")

        target_adapter = config.preferred_adapter or hw_audit.recommended_adapter
        logger.info(f"  Classified Mode:    {color_text(hw_audit.recommended_mode_description, TermColor.GREEN)}")
        logger.info(f"  Target Adapter:     {color_text(target_adapter, TermColor.CYAN)}")

        if config.check_only:
            logger.info(color_text("\n[SUCCESS] Check-only audit complete. No files were modified.", TermColor.GREEN))
            return 0

        # 4. Configuration & Virtual Environment Setup
        logger.info(color_text("\n[4/5] Environment & Backend Bootstrap", TermColor.BOLD))
        _ = setup_environment_file(config.repo_root, target_adapter, logger)

        if not config.skip_backend:
            venv_python = ensure_virtualenv(config.repo_root, config.recreate_venv, logger)
            backend_ok = install_backend(config.repo_root, venv_python, config.dev, config.verbose, logger)
            if not backend_ok:
                logger.error("\nBackend dependency installation failed. Review logs/setup.log for details.")
                return 1
        else:
            logger.info("  -> Backend installation skipped via --skip-backend.")

        # 5. Frontend Bootstrap & Build
        logger.info(color_text("\n[5/5] Frontend Installation & Build", TermColor.BOLD))
        if not config.skip_frontend:
            frontend_ok = install_frontend(config.repo_root, config.skip_build, config.verbose, logger)
            if not frontend_ok:
                logger.error("\nFrontend installation failed. Review logs/setup.log for details.")
                return 1
        else:
            logger.info("  -> Frontend installation skipped via --skip-frontend.")

        # Summary and next steps
        logger.info(f"\n{TermColor.GREEN}======================================================================{TermColor.RESET}")
        logger.info(f"{TermColor.GREEN}    ✓ SLOKern Installation & Bootstrap Completed Successfully!{TermColor.RESET}")
        logger.info(f"{TermColor.GREEN}======================================================================{TermColor.RESET}")
        logger.info("Next steps:")
        if platform.system() == "Windows":
            logger.info("  1. Run diagnostic audit:      .\\.venv\\Scripts\\python.exe scripts\\doctor.py")
            logger.info("  2. Start SLOKern services:    .\\scripts\\start.ps1")
            logger.info("  3. Run local demo benchmark:  .\\scripts\\run_local_demo.ps1")
        else:
            logger.info("  1. Run diagnostic audit:      ./.venv/bin/python scripts/doctor.py")
            logger.info("  2. Start SLOKern services:    ./scripts/start.sh")
            logger.info("  3. Open UI Command Center:    http://127.0.0.1:5173")

        return 0
    finally:
        close_logger(logger)


def parse_args(argv: Optional[List[str]] = None) -> SetupConfig:
    parser = argparse.ArgumentParser(
        description="SLOKern Installation Bootstrap & Cross-Platform Orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Perform system, prerequisite, and hardware audit without installing packages or modifying files.",
    )
    parser.add_argument(
        "--non-interactive",
        "-y",
        "--yes",
        action="store_true",
        help="Run without interactive confirmation prompts.",
    )
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Install developer and testing dependencies (pytest, ruff, mypy).",
    )
    parser.add_argument(
        "--recreate-venv",
        action="store_true",
        help="Recreate the Python virtual environment (.venv) from scratch.",
    )
    parser.add_argument(
        "--skip-backend",
        action="store_true",
        help="Skip Python virtual environment creation and pip installation.",
    )
    parser.add_argument(
        "--skip-frontend",
        action="store_true",
        help="Skip Node.js dependencies installation and Vite frontend build.",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Install npm packages but skip frontend production compilation.",
    )
    parser.add_argument(
        "--adapter",
        choices=["vllm", "local", "nebius", "fake"],
        default=None,
        help="Preferred serving adapter to configure in .env (defaults to capability detection).",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose output to stdout.",
    )

    args = parser.parse_args(argv)
    repo_root = Path(__file__).resolve().parent.parent

    return SetupConfig(
        repo_root=repo_root,
        check_only=args.check_only,
        non_interactive=args.non_interactive,
        dev=args.dev,
        recreate_venv=args.recreate_venv,
        skip_backend=args.skip_backend,
        skip_frontend=args.skip_frontend,
        skip_build=args.skip_build,
        preferred_adapter=args.adapter,
        verbose=args.verbose,
    )


def main(argv: Optional[List[str]] = None) -> int:
    config = parse_args(argv)
    return run_setup(config)


if __name__ == "__main__":
    sys.exit(main())
