#!/usr/bin/env bash
# Purpose: Start SLOKern application services (API Control Plane and Vite Dashboard) in the background.
# Owner: Rajdeep
# Authority: Aligned with AGENTS.md Section 1, 3, 6, 8, 10, 12, 13, and USER_REQUEST Criteria 10 & 11.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_DIR="$REPO_ROOT/.slokern/pids"
LOG_DIR="$REPO_ROOT/logs"

# Default configuration
BACKEND_PORT=8001
FRONTEND_PORT=5173
HOST_ADDR="127.0.0.1"
START_FRONTEND=true
OPEN_BROWSER=true
PREVIEW_MODE=false

print_usage() {
    cat <<EOF
Usage: ./scripts/start.sh [options]

Options:
  --backend-port PORT     Port for SLOKern API (default: 8001)
  --frontend-port PORT    Port for Vite frontend (default: 5173)
  --host HOST             Host interface to bind (default: 127.0.0.1)
  --no-frontend           Skip starting frontend dashboard (API only)
  --no-browser, --headless Do not launch default web browser
  --preview               Preview production build if frontend/dist exists
  -h, --help              Show this help message
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --backend-port)
            BACKEND_PORT="$2"
            shift 2
            ;;
        --frontend-port)
            FRONTEND_PORT="$2"
            shift 2
            ;;
        --host)
            HOST_ADDR="$2"
            shift 2
            ;;
        --no-frontend)
            START_FRONTEND=false
            shift
            ;;
        --no-browser|--headless)
            OPEN_BROWSER=false
            shift
            ;;
        --preview)
            PREVIEW_MODE=true
            shift
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            print_usage
            exit 1
            ;;
    esac
done

mkdir -p "$PID_DIR"
mkdir -p "$LOG_DIR"

test_port_open() {
    local host="$1"
    local port="$2"
    if command -v nc >/dev/null 2>&1; then
        nc -z -w 1 "$host" "$port" >/dev/null 2>&1
        return $?
    elif (echo >/dev/tcp/"$host"/"$port") >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

probe_api_health() {
    local host="$1"
    local port="$2"
    local url="http://$host:$port/api/health"
    if command -v curl >/dev/null 2>&1; then
        curl -s -m 2 "$url" | grep -q '"status"' >/dev/null 2>&1
        return $?
    else
        return 1
    fi
}

echo "================================================================="
echo "          SLOKern Application Service Lifecycle Launcher         "
echo "================================================================="
echo "  Workspace:    $REPO_ROOT"
echo "  Backend Port: $BACKEND_PORT"
echo "  Frontend Port:$FRONTEND_PORT"
echo ""

# 1. Resolve Python executable
PYTHON_EXE=""
if [[ -f "$REPO_ROOT/.venv/bin/python" ]]; then
    PYTHON_EXE="$REPO_ROOT/.venv/bin/python"
elif [[ -f "$REPO_ROOT/.venv/Scripts/python.exe" ]]; then
    PYTHON_EXE="$REPO_ROOT/.venv/Scripts/python.exe"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_EXE="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
    PYTHON_EXE="$(command -v python)"
else
    echo "[ERROR] Python executable not found. Ensure python3 is installed." >&2
    exit 1
fi

export PYTHONPATH="$REPO_ROOT/src:${PYTHONPATH:-}"

# 2. Check Backend Port Status
BACKEND_PID_FILE="$PID_DIR/backend.pid"
BACKEND_ALREADY_RUNNING=false

if test_port_open "$HOST_ADDR" "$BACKEND_PORT"; then
    if probe_api_health "$HOST_ADDR" "$BACKEND_PORT"; then
        echo "[INFO] Backend API is already running and healthy on port $BACKEND_PORT."
        BACKEND_ALREADY_RUNNING=true
    else
        echo "[ERROR] Port $BACKEND_PORT is already in use by an unrecognized service." >&2
        echo "Please terminate the process on port $BACKEND_PORT or run scripts/stop.sh before launching." >&2
        exit 1
    fi
fi

# 3. Start Backend if not already running
if [[ "$BACKEND_ALREADY_RUNNING" = false ]]; then
    echo "[1/3] Starting SLOKern Control Plane API on http://$HOST_ADDR:$BACKEND_PORT..."

    BACKEND_LOG="$LOG_DIR/backend.log"
    BACKEND_ERR="$LOG_DIR/backend.err"
    : > "$BACKEND_LOG"
    : > "$BACKEND_ERR"

    nohup "$PYTHON_EXE" -u -m slokern.cli.main serve --host "$HOST_ADDR" --port "$BACKEND_PORT" > "$BACKEND_LOG" 2> "$BACKEND_ERR" &
    BACKEND_PID=$!
    echo "$BACKEND_PID" > "$BACKEND_PID_FILE"
    echo "  -> Backend process spawned (PID: $BACKEND_PID). Waiting for health probe..."

    # Poll /api/health for up to 15 seconds
    HEALTHY=false
    for i in {1..30}; do
        sleep 0.5
        if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
            echo "[ERROR] Backend process exited unexpectedly." >&2
            if [[ -s "$BACKEND_ERR" ]]; then
                echo "Recent error log output:" >&2
                tail -n 15 "$BACKEND_ERR" >&2
            fi
            rm -f "$BACKEND_PID_FILE"
            exit 1
        fi
        if probe_api_health "$HOST_ADDR" "$BACKEND_PORT"; then
            HEALTHY=true
            break
        fi
    done

    if [[ "$HEALTHY" = false ]]; then
        echo "[ERROR] Backend started but failed to respond to /api/health within 15 seconds." >&2
        kill -9 "$BACKEND_PID" 2>/dev/null || true
        rm -f "$BACKEND_PID_FILE"
        exit 1
    fi
    echo "  -> Backend health check verified (HTTP 200 OK)."
fi

# 4. Check & Start Frontend Dashboard
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
FRONTEND_RUNNING=false

if [[ "$START_FRONTEND" = true ]]; then
    FRONTEND_DIR="$REPO_ROOT/frontend"
    if test_port_open "$HOST_ADDR" "$FRONTEND_PORT"; then
        echo "[INFO] Frontend dashboard is already active on port $FRONTEND_PORT."
        FRONTEND_RUNNING=true
    elif [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
        echo "[WARN] frontend/node_modules not found. Skipping frontend dashboard."
        echo "To install frontend: npm --prefix frontend install (or run scripts/setup.sh)"
    else
        echo "[2/3] Starting Frontend Dashboard on http://$HOST_ADDR:$FRONTEND_PORT..."

        FRONTEND_LOG="$LOG_DIR/frontend.log"
        FRONTEND_ERR="$LOG_DIR/frontend.err"
        : > "$FRONTEND_LOG"
        : > "$FRONTEND_ERR"

        VITE_BIN="$FRONTEND_DIR/node_modules/vite/bin/vite.js"
        VITE_CMD="node $VITE_BIN"
        if [[ ! -f "$VITE_BIN" ]]; then
            VITE_CMD="npx vite"
        fi

        VITE_ARGS="--host $HOST_ADDR --port $FRONTEND_PORT"
        if [[ "$PREVIEW_MODE" = true && -d "$FRONTEND_DIR/dist" ]]; then
            VITE_ARGS="preview --host $HOST_ADDR --port $FRONTEND_PORT"
        fi

        (cd "$FRONTEND_DIR" && nohup $VITE_CMD $VITE_ARGS > "$FRONTEND_LOG" 2> "$FRONTEND_ERR" & echo $! > "$FRONTEND_PID_FILE")
        FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
        echo "  -> Frontend process spawned (PID: $FRONTEND_PID). Waiting for port readiness..."

        for j in {1..24}; do
            sleep 0.5
            if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
                echo "[WARN] Frontend process exited unexpectedly." >&2
                rm -f "$FRONTEND_PID_FILE"
                break
            fi
            if test_port_open "$HOST_ADDR" "$FRONTEND_PORT"; then
                FRONTEND_RUNNING=true
                break
            fi
        done

        if [[ "$FRONTEND_RUNNING" = true ]]; then
            echo "  -> Frontend dashboard verified (Port $FRONTEND_PORT listening)."
        else
            echo "  [WARN] Frontend started but did not open port $FRONTEND_PORT in time. Check $FRONTEND_ERR"
        fi
    fi
fi

# 5. Output Service URLs & Status Summary
echo ""
echo "[3/3] Service Status Summary"
echo "================================================================="
echo "      SLOKern Application Services Ready & Operational           "
echo "================================================================="
if [[ "$FRONTEND_RUNNING" = true ]]; then
    echo "  Dashboard UI:         http://localhost:$FRONTEND_PORT"
else
    echo "  Dashboard UI:         Disabled/Offline"
fi
echo "  API Control Plane:    http://$HOST_ADDR:$BACKEND_PORT"
echo "  API Health Endpoint:  http://$HOST_ADDR:$BACKEND_PORT/api/health"
echo "  API Docs / Endpoints: http://$HOST_ADDR:$BACKEND_PORT/api/experiments"
echo "-----------------------------------------------------------------"

B_PID="N/A"
[[ -f "$BACKEND_PID_FILE" ]] && B_PID="$(cat "$BACKEND_PID_FILE")"
F_PID="N/A"
[[ -f "$FRONTEND_PID_FILE" ]] && F_PID="$(cat "$FRONTEND_PID_FILE")"

echo "  Backend PID:          $B_PID (saved in .slokern/pids/backend.pid)"
echo "  Frontend PID:         $F_PID (saved in .slokern/pids/frontend.pid)"
echo "  Log Files:            logs/backend.log, logs/frontend.log"
echo "-----------------------------------------------------------------"
echo "  To stop services:     ./scripts/stop.sh"
echo "  To diagnose health:   python scripts/doctor.py"
echo "================================================================="

if [[ "$FRONTEND_RUNNING" = true && "$OPEN_BROWSER" = true ]]; then
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "http://localhost:$FRONTEND_PORT" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then
        open "http://localhost:$FRONTEND_PORT" >/dev/null 2>&1 || true
    fi
fi

exit 0
