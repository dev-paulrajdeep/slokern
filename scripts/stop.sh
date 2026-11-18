#!/usr/bin/env bash
# Purpose: Stop SLOKern application services using recorded PIDs.
# Owner: Rajdeep
# Authority: Aligned with AGENTS.md Section 1, 3, 6, 8, 10, 12, 13, and USER_REQUEST Criteria 10 & 11.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_DIR="$REPO_ROOT/.slokern/pids"

echo "================================================================="
echo "           SLOKern Application Service Terminator                "
echo "================================================================="

if [[ ! -d "$PID_DIR" ]]; then
    echo "[INFO] No .slokern/pids directory found. No services to stop."
    exit 0
fi

PID_FILES=("$PID_DIR"/*.pid)
if [[ ! -e "${PID_FILES[0]}" ]]; then
    echo "[INFO] No active SLOKern PID files found in $PID_DIR. No services to stop."
    exit 0
fi

stop_slokern_process() {
    local pid_file="$1"
    local service_name="$2"
    shift 2
    local expected_keywords=("$@")

    if [[ ! -f "$pid_file" ]]; then
        return
    fi

    local target_pid
    target_pid="$(cat "$pid_file" | tr -d '[:space:]')"
    if [[ -z "$target_pid" || ! "$target_pid" =~ ^[0-9]+$ ]]; then
        echo "  [WARN] Invalid PID in $pid_file. Removing stale file."
        rm -f "$pid_file"
        return
    fi

    # Check if process is running
    if ! kill -0 "$target_pid" 2>/dev/null; then
        echo "  [INFO] $service_name (PID $target_pid) is not running. Cleaned up stale PID file."
        rm -f "$pid_file"
        return
    fi

    # Process identity verification
    local cmdline=""
    if [[ -f "/proc/$target_pid/cmdline" ]]; then
        cmdline="$(tr '\0' ' ' < "/proc/$target_pid/cmdline" 2>/dev/null || true)"
    elif command -v ps >/dev/null 2>&1; then
        cmdline="$(ps -p "$target_pid" -o args= 2>/dev/null || true)"
    fi

    local is_expected=false
    for kw in "${expected_keywords[@]}"; do
        if [[ "$cmdline" =~ $kw ]]; then
            is_expected=true
            break
        fi
    done

    if [[ "$is_expected" = false && -n "$cmdline" ]]; then
        echo "  [SECURITY WARNING] Process with PID $target_pid does not match expected $service_name keywords." >&2
        echo "  Command line: $cmdline" >&2
        echo "  Skipping termination to avoid killing unrelated process." >&2
        rm -f "$pid_file"
        return
    fi

    echo "  Stopping $service_name (PID $target_pid)..."

    # Terminate child processes
    pkill -P "$target_pid" 2>/dev/null || true

    # Terminate parent process gracefully
    kill -15 "$target_pid" 2>/dev/null || true

    # Wait up to 5 seconds
    local stopped=false
    for i in {1..10}; do
        sleep 0.5
        if ! kill -0 "$target_pid" 2>/dev/null; then
            stopped=true
            break
        fi
    done

    if [[ "$stopped" = false ]]; then
        echo "  [WARN] Process $target_pid did not exit cleanly; forcing SIGKILL..."
        kill -9 "$target_pid" 2>/dev/null || true
    fi

    echo "  [PASS] Successfully stopped $service_name (PID $target_pid)."
    rm -f "$pid_file"
}

# Stop Backend
stop_slokern_process "$PID_DIR/backend.pid" "Backend API" "python" "slokern" "serve"

# Stop Frontend
stop_slokern_process "$PID_DIR/frontend.pid" "Frontend Dashboard" "node" "vite" "npm"

REMAINING=("$PID_DIR"/*.pid)
if [[ ! -e "${REMAINING[0]}" ]]; then
    echo ""
    echo "All SLOKern application services stopped cleanly."
else
    echo ""
    echo "Remaining PID files in $PID_DIR: ${#REMAINING[@]}"
fi
echo "================================================================="
exit 0
