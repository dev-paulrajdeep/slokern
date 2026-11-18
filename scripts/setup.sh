#!/usr/bin/env bash
# ==============================================================================
# SLOKern Turnkey Installation Launcher (Linux / macOS)
#
# Thin, robust launcher that discovers Python 3, forwards all arguments,
# and delegates bootstrap logic to scripts/setup.py.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Discover Python 3 executable
PYTHON_BIN=""

if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
    PYTHON_BIN="$REPO_ROOT/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
    # Verify it is Python 3
    if python -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" >/dev/null 2>&1; then
        PYTHON_BIN="$(command -v python)"
    fi
fi

if [[ -z "$PYTHON_BIN" ]]; then
    echo "[ERROR] Python 3.10+ was not found on PATH." >&2
    echo "Please install Python 3.11 using your package manager (e.g. sudo apt install python3 python3-venv python3-pip)." >&2
    exit 1
fi

SETUP_SCRIPT="$SCRIPT_DIR/setup.py"
if [[ ! -f "$SETUP_SCRIPT" ]]; then
    echo "[ERROR] setup.py not found at $SETUP_SCRIPT" >&2
    exit 1
fi

exec "$PYTHON_BIN" "$SETUP_SCRIPT" "$@"
