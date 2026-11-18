#!/usr/bin/env python3
"""
Purpose: Standalone, read-only diagnostic tool for SLOKern environment, dependencies, ports, and serving runtimes.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 1, 3, 6, 8, 10, 12, 13, and USER_REQUEST Criteria 12 & 13.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, field
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import sys
from typing import Any, Dict, List, Optional, Tuple
import urllib.error
import urllib.request

# Ensure repo root and src/ are importable
REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


class DiagnosticStatus:
    PASS = "PASS"
    WARN = "WARN"
    FAIL = "FAIL"
    INFO = "INFO"


@dataclass
class DiagnosticCheck:
    category: str
    name: str
    status: str
    message: str
    details: Dict[str, Any] = field(default_factory=dict)
    remediation: Optional[str] = None


@dataclass
class DoctorReport:
    timestamp: str
    platform: Dict[str, Any]
    checks: List[DiagnosticCheck] = field(default_factory=list)
    overall_status: str = DiagnosticStatus.PASS
    summary: Dict[str, int] = field(default_factory=dict)
    recommendations: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "platform": self.platform,
            "overall_status": self.overall_status,
            "summary": self.summary,
            "recommendations": self.recommendations,
            "checks": [asdict(c) for c in self.checks],
        }


def is_port_in_use(host: str, port: int, timeout: float = 0.8) -> bool:
    """Read-only TCP connect check to determine if a port is listening."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        res = sock.connect_ex((host, port))
        return res == 0
    except Exception:
        return False
    finally:
        try:
            sock.close()
        except Exception:
            pass


def http_probe_json(url: str, timeout: float = 1.5) -> Tuple[bool, Optional[int], Optional[Dict[str, Any]], Optional[str]]:
    """Read-only HTTP probe returning (is_ok, status_code, parsed_json, error_msg). Direct loopback without proxy."""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "SLOKern-Doctor/1.0", "Accept": "application/json"},
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as resp:
            code = resp.status
            body = resp.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(body)
                return True, code, data, None
            except Exception:
                return True, code, None, f"Non-JSON response: {body[:100]}"
    except urllib.error.HTTPError as exc:
        try:
            err_body = exc.read().decode("utf-8", errors="replace")
            err_json = json.loads(err_body)
        except Exception:
            err_json = None
        return False, exc.code, err_json, str(exc)
    except Exception as exc:
        return False, None, None, str(exc)


class SlokernDoctor:
    """
    Independent, read-only diagnostic inspector for SLOKern application environment.
    Never modifies files, starts services, stops processes, or alters system state.
    """

    def __init__(
        self,
        repo_root: Path = REPO_ROOT,
        api_host: str = "127.0.0.1",
        api_port: int = 8001,
        frontend_port: int = 5173,
        vllm_port: int = 8000,
        ollama_port: int = 11434,
        artifacts_dir: str = "artifacts",
    ) -> None:
        self.repo_root = repo_root
        self.api_host = api_host
        self.api_port = api_port
        self.frontend_port = frontend_port
        self.vllm_port = vllm_port
        self.ollama_port = ollama_port
        self.artifacts_dir = repo_root / artifacts_dir

    def inspect_python_environment(self) -> List[DiagnosticCheck]:
        checks: List[DiagnosticCheck] = []
        py_version = platform.python_version()
        py_major = sys.version_info.major
        py_minor = sys.version_info.minor

        # Python version check (>= 3.10)
        if py_major == 3 and py_minor >= 10:
            checks.append(
                DiagnosticCheck(
                    category="Python Environment",
                    name="python_version",
                    status=DiagnosticStatus.PASS,
                    message=f"Python {py_version} satisfies requirement (>= 3.10)",
                    details={"version": py_version, "executable": sys.executable},
                )
            )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Python Environment",
                    name="python_version",
                    status=DiagnosticStatus.FAIL,
                    message=f"Python {py_version} is unsupported (requires Python >= 3.10)",
                    details={"version": py_version, "executable": sys.executable},
                    remediation="Install Python 3.10 or higher and create a virtual environment.",
                )
            )

        # Virtualenv detection
        in_venv = (
            hasattr(sys, "real_prefix")
            or (hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix)
            or os.environ.get("VIRTUAL_ENV") is not None
        )
        local_venv_dir = self.repo_root / ".venv"

        if in_venv:
            checks.append(
                DiagnosticCheck(
                    category="Python Environment",
                    name="virtualenv_active",
                    status=DiagnosticStatus.PASS,
                    message=f"Active virtual environment detected ({sys.prefix})",
                    details={"prefix": sys.prefix, "base_prefix": getattr(sys, "base_prefix", None)},
                )
            )
        elif local_venv_dir.exists():
            checks.append(
                DiagnosticCheck(
                    category="Python Environment",
                    name="virtualenv_active",
                    status=DiagnosticStatus.WARN,
                    message=f"Running outside virtualenv, but repository .venv exists at {local_venv_dir}",
                    details={"local_venv": str(local_venv_dir)},
                    remediation="Activate .venv or execute via .venv/bin/python (or .venv\\Scripts\\python.exe).",
                )
            )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Python Environment",
                    name="virtualenv_active",
                    status=DiagnosticStatus.WARN,
                    message="No virtual environment active or found in repository root",
                    remediation="Create a virtual environment: python -m venv .venv",
                )
            )

        return checks

    def inspect_cli_and_packages(self) -> List[DiagnosticCheck]:
        checks: List[DiagnosticCheck] = []

        # Check slokern package importability
        try:
            from slokern.cli.main import build_parser

            parser = build_parser()
            subparsers_actions = [
                action for action in parser._actions if isinstance(action, argparse._SubParsersAction)
            ]
            registered_cmds = list(subparsers_actions[0].choices.keys()) if subparsers_actions else []
            expected_cmds = {"smoke-test", "optimize", "verify", "report", "validate", "serve", "credentials"}
            missing_cmds = expected_cmds - set(registered_cmds)

            if not missing_cmds:
                checks.append(
                    DiagnosticCheck(
                        category="SLOKern CLI",
                        name="cli_entrypoint",
                        status=DiagnosticStatus.PASS,
                        message=f"SLOKern CLI operational with all core commands registered: {', '.join(sorted(registered_cmds))}",
                        details={"commands": registered_cmds},
                    )
                )
            else:
                checks.append(
                    DiagnosticCheck(
                        category="SLOKern CLI",
                        name="cli_entrypoint",
                        status=DiagnosticStatus.FAIL,
                        message=f"SLOKern CLI missing expected subcommands: {sorted(missing_cmds)}",
                        details={"registered": registered_cmds, "missing": sorted(missing_cmds)},
                        remediation="Check src/slokern/cli/main.py for command registration errors.",
                    )
                )
        except Exception as exc:
            checks.append(
                DiagnosticCheck(
                    category="SLOKern CLI",
                    name="cli_entrypoint",
                    status=DiagnosticStatus.FAIL,
                    message=f"Failed to import SLOKern CLI: {exc}",
                    details={"error": str(exc)},
                    remediation="Ensure dependencies are installed: pip install -e . or pip install -r requirements.txt",
                )
            )

        # Check key dependencies
        for pkg in ["pydantic", "pytest"]:
            try:
                mod = __import__(pkg)
                checks.append(
                    DiagnosticCheck(
                        category="SLOKern CLI",
                        name=f"dep_{pkg}",
                        status=DiagnosticStatus.PASS,
                        message=f"Required package '{pkg}' available ({getattr(mod, '__version__', 'unknown')})",
                        details={"package": pkg, "version": getattr(mod, "__version__", None)},
                    )
                )
            except ImportError:
                checks.append(
                    DiagnosticCheck(
                        category="SLOKern CLI",
                        name=f"dep_{pkg}",
                        status=DiagnosticStatus.FAIL,
                        message=f"Required package '{pkg}' is missing",
                        remediation=f"Install missing package: pip install {pkg}",
                    )
                )

        return checks

    def inspect_node_and_frontend(self) -> List[DiagnosticCheck]:
        checks: List[DiagnosticCheck] = []

        # Check node binary
        node_bin = shutil.which("node")
        if node_bin:
            try:
                proc = subprocess.run([node_bin, "--version"], capture_output=True, text=True, timeout=5)
                node_ver = proc.stdout.strip()
                checks.append(
                    DiagnosticCheck(
                        category="Node & Frontend",
                        name="node_version",
                        status=DiagnosticStatus.PASS,
                        message=f"Node.js found: {node_ver} ({node_bin})",
                        details={"binary": node_bin, "version": node_ver},
                    )
                )
            except Exception as exc:
                checks.append(
                    DiagnosticCheck(
                        category="Node & Frontend",
                        name="node_version",
                        status=DiagnosticStatus.WARN,
                        message=f"Node.js found at {node_bin} but failed version probe: {exc}",
                    )
                )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Node & Frontend",
                    name="node_version",
                    status=DiagnosticStatus.WARN,
                    message="Node.js is not found in PATH (required for dashboard UI development)",
                    remediation="Install Node.js (v18+) from https://nodejs.org or via package manager.",
                )
            )

        # Check npm binary
        npm_bin = shutil.which("npm") or shutil.which("npm.cmd")
        if npm_bin:
            try:
                proc = subprocess.run([npm_bin, "--version"], capture_output=True, text=True, timeout=5)
                npm_ver = proc.stdout.strip()
                checks.append(
                    DiagnosticCheck(
                        category="Node & Frontend",
                        name="npm_version",
                        status=DiagnosticStatus.PASS,
                        message=f"npm found: v{npm_ver} ({npm_bin})",
                        details={"binary": npm_bin, "version": npm_ver},
                    )
                )
            except Exception as exc:
                checks.append(
                    DiagnosticCheck(
                        category="Node & Frontend",
                        name="npm_version",
                        status=DiagnosticStatus.WARN,
                        message=f"npm found at {npm_bin} but failed version probe: {exc}",
                    )
                )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Node & Frontend",
                    name="npm_version",
                    status=DiagnosticStatus.WARN,
                    message="npm is not found in PATH",
                    remediation="Install npm (bundled with Node.js).",
                )
            )

        # Frontend directory & node_modules
        frontend_dir = self.repo_root / "frontend"
        if not frontend_dir.exists():
            checks.append(
                DiagnosticCheck(
                    category="Node & Frontend",
                    name="frontend_directory",
                    status=DiagnosticStatus.FAIL,
                    message="frontend/ directory does not exist",
                )
            )
            return checks

        pkg_json = frontend_dir / "package.json"
        if pkg_json.exists():
            checks.append(
                DiagnosticCheck(
                    category="Node & Frontend",
                    name="frontend_package_json",
                    status=DiagnosticStatus.PASS,
                    message="frontend/package.json verified",
                )
            )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Node & Frontend",
                    name="frontend_package_json",
                    status=DiagnosticStatus.FAIL,
                    message="frontend/package.json missing",
                )
            )

        node_modules = frontend_dir / "node_modules"
        if node_modules.exists() and (node_modules / "vite").exists():
            checks.append(
                DiagnosticCheck(
                    category="Node & Frontend",
                    name="frontend_dependencies",
                    status=DiagnosticStatus.PASS,
                    message="frontend/node_modules present with Vite installed",
                )
            )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Node & Frontend",
                    name="frontend_dependencies",
                    status=DiagnosticStatus.WARN,
                    message="frontend/node_modules missing or incomplete",
                    remediation="Install frontend dependencies: npm --prefix frontend ci (or npm --prefix frontend install)",
                )
            )

        # Frontend production build dist/
        dist_dir = frontend_dir / "dist"
        dist_html = dist_dir / "index.html"
        dist_assets = dist_dir / "assets"
        if dist_html.exists() and dist_assets.exists():
            html_size = dist_html.stat().st_size
            checks.append(
                DiagnosticCheck(
                    category="Node & Frontend",
                    name="frontend_dist",
                    status=DiagnosticStatus.PASS,
                    message=f"Production bundle verified in frontend/dist (index.html: {html_size} bytes)",
                    details={"index_html_size": html_size},
                )
            )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Node & Frontend",
                    name="frontend_dist",
                    status=DiagnosticStatus.WARN,
                    message="frontend/dist production bundle not found (development mode only)",
                    remediation="Build frontend production bundle: npm --prefix frontend run build",
                )
            )

        return checks

    def inspect_environment_and_secrets(self) -> List[DiagnosticCheck]:
        checks: List[DiagnosticCheck] = []

        # .env.example
        env_example = self.repo_root / ".env.example"
        if env_example.exists():
            checks.append(
                DiagnosticCheck(
                    category="Configuration & Secrets",
                    name="env_example",
                    status=DiagnosticStatus.PASS,
                    message=".env.example template present",
                )
            )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Configuration & Secrets",
                    name="env_example",
                    status=DiagnosticStatus.WARN,
                    message=".env.example template missing from repository root",
                )
            )

        # .env presence
        env_file = self.repo_root / ".env"
        if env_file.exists():
            checks.append(
                DiagnosticCheck(
                    category="Configuration & Secrets",
                    name="env_file",
                    status=DiagnosticStatus.PASS,
                    message=".env configuration file present",
                    details={"path": str(env_file)},
                )
            )
            # Security permission check on POSIX
            if os.name == "posix":
                mode = env_file.stat().st_mode
                if mode & 0o077:
                    checks.append(
                        DiagnosticCheck(
                            category="Configuration & Secrets",
                            name="env_permissions",
                            status=DiagnosticStatus.WARN,
                            message=f".env file has overly permissive mode ({oct(mode & 0o777)})",
                            remediation="Restrict .env permissions: chmod 600 .env",
                        )
                    )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Configuration & Secrets",
                    name="env_file",
                    status=DiagnosticStatus.INFO,
                    message=".env not present (default local/CPU settings will apply)",
                    remediation="Copy .env.example to .env if custom API keys or ports are desired: cp .env.example .env",
                )
            )

        # Check configured runtime secrets via slokern secrets facility
        try:
            from slokern.config.secrets import get_secret_status, is_placeholder_secret

            nebius_status = get_secret_status("NEBIUS_API_KEY")
            if nebius_status.is_available:
                checks.append(
                    DiagnosticCheck(
                        category="Configuration & Secrets",
                        name="secret_nebius_api_key",
                        status=DiagnosticStatus.PASS,
                        message=f"NEBIUS_API_KEY configured via {nebius_status.source_description} (masked for security)",
                        details={"status": nebius_status.status.value},
                    )
                )
            else:
                checks.append(
                    DiagnosticCheck(
                        category="Configuration & Secrets",
                        name="secret_nebius_api_key",
                        status=DiagnosticStatus.INFO,
                        message="NEBIUS_API_KEY not configured (cloud Nebius adapter will not be available; local/vLLM/fake active)",
                        details={"status": nebius_status.status.value},
                    )
                )
        except Exception as exc:
            checks.append(
                DiagnosticCheck(
                    category="Configuration & Secrets",
                    name="secrets_subsystem",
                    status=DiagnosticStatus.WARN,
                    message=f"Could not audit runtime secret configuration: {exc}",
                )
            )

        return checks

    def inspect_ports_and_services(self) -> List[DiagnosticCheck]:
        checks: List[DiagnosticCheck] = []

        # 1. SLOKern Control Plane API (Port 8001)
        api_busy = is_port_in_use(self.api_host, self.api_port)
        if api_busy:
            # Check if it responds to /api/health
            health_url = f"http://{self.api_host}:{self.api_port}/api/health"
            ok, code, data, err = http_probe_json(health_url)
            if ok and isinstance(data, dict) and ("status" in data or "runtime" in data or "version" in data):
                adapter_stat = data.get("status", "ok")
                checks.append(
                    DiagnosticCheck(
                        category="Ports & Services",
                        name="port_slokern_api",
                        status=DiagnosticStatus.PASS,
                        message=f"Port {self.api_port} is ACTIVE: SLOKern API is running (status: {adapter_stat})",
                        details={"endpoint": health_url, "response": data},
                    )
                )
            else:
                checks.append(
                    DiagnosticCheck(
                        category="Ports & Services",
                        name="port_slokern_api",
                        status=DiagnosticStatus.WARN,
                        message=f"Port {self.api_port} is OCCUPIED by an unrecognized service or unhealthy API (HTTP {code})",
                        details={"endpoint": health_url, "error": err},
                        remediation=f"Inspect port {self.api_port} or run scripts/stop.ps1 (or scripts/stop.sh) before starting.",
                    )
                )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Ports & Services",
                    name="port_slokern_api",
                    status=DiagnosticStatus.INFO,
                    message=f"Port {self.api_port} is FREE (SLOKern API is idle, ready to start)",
                    details={"host": self.api_host, "port": self.api_port},
                )
            )

        # 2. Frontend Dashboard (Port 5173)
        frontend_busy = is_port_in_use(self.api_host, self.frontend_port)
        if frontend_busy:
            checks.append(
                DiagnosticCheck(
                    category="Ports & Services",
                    name="port_frontend",
                    status=DiagnosticStatus.PASS,
                    message=f"Port {self.frontend_port} is ACTIVE: Dashboard server is listening",
                    details={"host": self.api_host, "port": self.frontend_port},
                )
            )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Ports & Services",
                    name="port_frontend",
                    status=DiagnosticStatus.INFO,
                    message=f"Port {self.frontend_port} is FREE (Frontend server is idle, ready to start)",
                    details={"host": self.api_host, "port": self.frontend_port},
                )
            )

        # 3. Serving Runtime: vLLM (Port 8000)
        vllm_busy = is_port_in_use(self.api_host, self.vllm_port)
        if vllm_busy:
            vllm_health = f"http://{self.api_host}:{self.vllm_port}/health"
            ok, code, data, err = http_probe_json(vllm_health)
            if ok:
                checks.append(
                    DiagnosticCheck(
                        category="Ports & Services",
                        name="port_vllm",
                        status=DiagnosticStatus.PASS,
                        message=f"Port {self.vllm_port} is ACTIVE: vLLM serving runtime is responding",
                        details={"endpoint": vllm_health},
                    )
                )
            else:
                checks.append(
                    DiagnosticCheck(
                        category="Ports & Services",
                        name="port_vllm",
                        status=DiagnosticStatus.INFO,
                        message=f"Port {self.vllm_port} is listening (HTTP probe returned status {code})",
                    )
                )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Ports & Services",
                    name="port_vllm",
                    status=DiagnosticStatus.INFO,
                    message=f"Port {self.vllm_port} is FREE / OFFLINE (vLLM is not currently running)",
                )
            )

        # 4. Serving Runtime: Ollama (Port 11434)
        ollama_busy = is_port_in_use(self.api_host, self.ollama_port)
        if ollama_busy:
            checks.append(
                DiagnosticCheck(
                    category="Ports & Services",
                    name="port_ollama",
                    status=DiagnosticStatus.PASS,
                    message=f"Port {self.ollama_port} is ACTIVE: Ollama daemon is listening",
                )
            )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Ports & Services",
                    name="port_ollama",
                    status=DiagnosticStatus.INFO,
                    message=f"Port {self.ollama_port} is OFFLINE (Ollama daemon not running)",
                )
            )

        return checks

    def inspect_hardware_and_acceleration(self) -> List[DiagnosticCheck]:
        checks: List[DiagnosticCheck] = []
        gpu_detected = False

        # 1. PyTorch CUDA inspection (if torch installed)
        try:
            import torch  # type: ignore

            if torch.cuda.is_available():
                gpu_count = torch.cuda.device_count()
                device_name = torch.cuda.get_device_name(0)
                props = torch.cuda.get_device_properties(0)
                total_mem_mb = int(props.total_memory / (1024 * 1024))
                gpu_detected = True
                checks.append(
                    DiagnosticCheck(
                        category="Hardware & Acceleration",
                        name="pytorch_cuda",
                        status=DiagnosticStatus.PASS,
                        message=f"PyTorch CUDA active: {device_name} ({total_mem_mb} MB VRAM, {gpu_count} device(s))",
                        details={
                            "device_name": device_name,
                            "total_memory_mb": total_mem_mb,
                            "device_count": gpu_count,
                            "cuda_version": getattr(torch.version, "cuda", None),
                        },
                    )
                )
            else:
                checks.append(
                    DiagnosticCheck(
                        category="Hardware & Acceleration",
                        name="pytorch_cuda",
                        status=DiagnosticStatus.INFO,
                        message="PyTorch installed in CPU-only mode (CUDA not available)",
                    )
                )
        except ImportError:
            # torch not installed; this is completely normal for CPU-only / lightweight SLOKern installs!
            pass

        # 2. NVIDIA SMI inspection (independent hardware probe)
        nvidia_smi = shutil.which("nvidia-smi")
        if nvidia_smi:
            try:
                proc = subprocess.run(
                    [nvidia_smi, "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    lines = [line.strip() for line in proc.stdout.strip().splitlines() if line.strip()]
                    first_gpu = lines[0]
                    gpu_detected = True
                    checks.append(
                        DiagnosticCheck(
                            category="Hardware & Acceleration",
                            name="nvidia_smi",
                            status=DiagnosticStatus.PASS,
                            message=f"NVIDIA hardware detected: {first_gpu}",
                            details={"gpus": lines},
                        )
                    )
            except Exception:
                pass

        if not gpu_detected:
            checks.append(
                DiagnosticCheck(
                    category="Hardware & Acceleration",
                    name="compute_mode",
                    status=DiagnosticStatus.INFO,
                    message="No NVIDIA GPU detected; operating in CPU-only / Remote Inference mode (AGENTS.md Criteria 4 & 5)",
                    details={"mode": "cpu_or_remote"},
                )
            )

        return checks

    def inspect_serving_adapters(self) -> List[DiagnosticCheck]:
        checks: List[DiagnosticCheck] = []
        configured_adapter = os.environ.get("SLOKERN_ADAPTER", "vllm").strip().lower()

        checks.append(
            DiagnosticCheck(
                category="Serving Adapters",
                name="configured_adapter",
                status=DiagnosticStatus.INFO,
                message=f"Default/configured serving adapter: '{configured_adapter}'",
                details={"adapter": configured_adapter},
            )
        )

        try:
            from slokern.engine.serving.factory import create_serving_adapter

            # Test fake adapter (always available)
            fake_adapter = create_serving_adapter("fake")
            fp_fake = fake_adapter.get_environment_fingerprint()
            checks.append(
                DiagnosticCheck(
                    category="Serving Adapters",
                    name="adapter_fake",
                    status=DiagnosticStatus.PASS,
                    message="Simulated demo adapter ('fake') ready for zero-hardware benchmarking",
                    details=fp_fake,
                )
            )

            # Test vLLM adapter initialization & readiness
            try:
                vllm_adapter = create_serving_adapter("vllm")
                fp_vllm = vllm_adapter.get_environment_fingerprint()
                is_ready = vllm_adapter.health_check()
                status_vllm = DiagnosticStatus.PASS if is_ready else DiagnosticStatus.INFO
                msg_vllm = (
                    "vLLM adapter initialized and endpoint is responding"
                    if is_ready
                    else "vLLM adapter initialized; endpoint is currently offline (expected if vLLM not yet started)"
                )
                checks.append(
                    DiagnosticCheck(
                        category="Serving Adapters",
                        name="adapter_vllm",
                        status=status_vllm,
                        message=msg_vllm,
                        details=fp_vllm,
                    )
                )
            except Exception as exc:
                checks.append(
                    DiagnosticCheck(
                        category="Serving Adapters",
                        name="adapter_vllm",
                        status=DiagnosticStatus.INFO,
                        message=f"vLLM adapter check: {exc}",
                    )
                )

        except Exception as exc:
            checks.append(
                DiagnosticCheck(
                    category="Serving Adapters",
                    name="adapter_factory",
                    status=DiagnosticStatus.WARN,
                    message=f"Failed to inspect serving adapters: {exc}",
                )
            )

        return checks

    def inspect_artifacts_storage(self) -> List[DiagnosticCheck]:
        checks: List[DiagnosticCheck] = []
        art_path = self.artifacts_dir

        if art_path.exists():
            is_writeable = os.access(art_path, os.W_OK)
            status = DiagnosticStatus.PASS if is_writeable else DiagnosticStatus.FAIL
            msg = (
                f"Artifacts storage directory '{art_path.resolve()}' exists and is writeable"
                if is_writeable
                else f"Artifacts storage directory '{art_path.resolve()}' is not writeable"
            )
            checks.append(
                DiagnosticCheck(
                    category="Artifacts Storage",
                    name="artifacts_storage",
                    status=status,
                    message=msg,
                    details={"path": str(art_path.resolve())},
                )
            )
        else:
            checks.append(
                DiagnosticCheck(
                    category="Artifacts Storage",
                    name="artifacts_storage",
                    status=DiagnosticStatus.INFO,
                    message=f"Artifacts directory '{art_path}' will be created on first experiment execution",
                    details={"path": str(art_path.resolve())},
                )
            )

        return checks

    def run_all_checks(self) -> DoctorReport:
        """Runs all independent diagnostic inspections in read-only mode."""
        import datetime

        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        plat_info = {
            "os": platform.system(),
            "os_release": platform.release(),
            "architecture": platform.machine(),
            "python_version": platform.python_version(),
            "hostname": platform.node(),
            "working_directory": str(self.repo_root),
        }

        all_checks: List[DiagnosticCheck] = []
        all_checks.extend(self.inspect_python_environment())
        all_checks.extend(self.inspect_cli_and_packages())
        all_checks.extend(self.inspect_node_and_frontend())
        all_checks.extend(self.inspect_environment_and_secrets())
        all_checks.extend(self.inspect_ports_and_services())
        all_checks.extend(self.inspect_hardware_and_acceleration())
        all_checks.extend(self.inspect_serving_adapters())
        all_checks.extend(self.inspect_artifacts_storage())

        # Calculate summary counts
        counts = {
            DiagnosticStatus.PASS: sum(1 for c in all_checks if c.status == DiagnosticStatus.PASS),
            DiagnosticStatus.WARN: sum(1 for c in all_checks if c.status == DiagnosticStatus.WARN),
            DiagnosticStatus.FAIL: sum(1 for c in all_checks if c.status == DiagnosticStatus.FAIL),
            DiagnosticStatus.INFO: sum(1 for c in all_checks if c.status == DiagnosticStatus.INFO),
        }

        # Overall status
        if counts[DiagnosticStatus.FAIL] > 0:
            overall = DiagnosticStatus.FAIL
        elif counts[DiagnosticStatus.WARN] > 0:
            overall = DiagnosticStatus.WARN
        else:
            overall = DiagnosticStatus.PASS

        # Collect actionable recommendations
        recommendations: List[str] = []
        for c in all_checks:
            if c.remediation and c.status in (DiagnosticStatus.FAIL, DiagnosticStatus.WARN):
                recommendations.append(f"[{c.name}] {c.remediation}")

        return DoctorReport(
            timestamp=now,
            platform=plat_info,
            checks=all_checks,
            overall_status=overall,
            summary=counts,
            recommendations=recommendations,
        )


def format_report_text(report: DoctorReport, verbose: bool = False) -> str:
    """Formats the DoctorReport into a clean, human-readable terminal output."""
    lines: List[str] = []

    lines.append("======================================================================")
    lines.append("                SLOKern Diagnostic Doctor & Readiness Audit          ")
    lines.append("======================================================================")
    lines.append(f"  Platform:    {report.platform.get('os')} ({report.platform.get('architecture')})")
    lines.append(f"  Python:      {report.platform.get('python_version')}")
    lines.append(f"  Workspace:   {report.platform.get('working_directory')}")
    lines.append(f"  Inspection:  READ-ONLY (zero state or service modifications)")
    lines.append("----------------------------------------------------------------------")

    current_cat = None
    for c in report.checks:
        if c.category != current_cat:
            current_cat = c.category
            lines.append(f"\n[{current_cat}]")

        tag = f"[{c.status}]"
        # Align tag nicely
        lines.append(f"  {tag:<7} {c.name}: {c.message}")
        if verbose and c.details:
            for k, v in c.details.items():
                lines.append(f"          * {k}: {v}")

    lines.append("\n======================================================================")
    lines.append("Diagnostic Summary:")
    lines.append(
        f"  Total Checks: {len(report.checks)}  |  "
        f"Passed: {report.summary.get(DiagnosticStatus.PASS, 0)}  |  "
        f"Warnings: {report.summary.get(DiagnosticStatus.WARN, 0)}  |  "
        f"Failures: {report.summary.get(DiagnosticStatus.FAIL, 0)}  |  "
        f"Info: {report.summary.get(DiagnosticStatus.INFO, 0)}"
    )
    lines.append(f"  Overall Status: [{report.overall_status}]")

    if report.recommendations:
        lines.append("----------------------------------------------------------------------")
        lines.append("Actionable Remediation Guidance:")
        for idx, rec in enumerate(report.recommendations, 1):
            lines.append(f"  {idx}. {rec}")

    lines.append("======================================================================")
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="doctor.py",
        description="SLOKern Diagnostic Doctor: Read-only environment, dependency, and service readiness inspector.",
    )
    parser.add_argument("--json", action="store_true", help="Output diagnostic report as machine-readable JSON.")
    parser.add_argument("--verbose", "-v", action="store_true", help="Include verbose inspection details.")
    parser.add_argument("--api-host", default="127.0.0.1", help="SLOKern API host to probe (default: 127.0.0.1).")
    parser.add_argument("--api-port", type=int, default=8001, help="SLOKern API port to probe (default: 8001).")
    parser.add_argument("--frontend-port", type=int, default=5173, help="Frontend port to probe (default: 5173).")
    parser.add_argument("--vllm-port", type=int, default=8000, help="vLLM port to probe (default: 8000).")
    parser.add_argument("--artifacts-dir", default="artifacts", help="Artifacts directory (default: artifacts).")

    args = parser.parse_args(argv if argv is not None else sys.argv[1:])

    doctor = SlokernDoctor(
        repo_root=REPO_ROOT,
        api_host=args.api_host,
        api_port=args.api_port,
        frontend_port=args.frontend_port,
        vllm_port=args.vllm_port,
        artifacts_dir=args.artifacts_dir,
    )

    report = doctor.run_all_checks()

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        print(format_report_text(report, verbose=args.verbose))

    # Return 0 if PASS or WARN, 1 if blocking FAIL
    return 1 if report.overall_status == DiagnosticStatus.FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
