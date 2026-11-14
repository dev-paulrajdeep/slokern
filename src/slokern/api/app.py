"""
Purpose: API application assembly and multi-threaded HTTP server.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 1, 3, 9, 12 and DEC-0014
"""

import json
import queue
import re
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Tuple, Union

from slokern.api.routes.health import (
    get_health,
    get_latest_smoke_test,
    get_runtime_profile,
    run_smoke_probe,
)
from slokern.api.routes.campaigns import (
    dispatch_campaign_run,
    get_campaign_queue,
    get_campaign_status,
    list_campaigns,
)
from slokern.api.routes.experiments import (
    list_experiments,
    get_experiment_detail,
    get_experiment_candidates,
    get_experiment_verification,
    list_all_reports,
)
from slokern.api.routes.reports import get_report_data
from slokern.api.routes.runs import (
    dispatch_single_run,
    get_run_queue,
    get_run_status,
    list_recent_runs,
)
from slokern.api.routes.verification import dispatch_verification_run
from slokern.api.settings import (
    DEFAULT_API_HOST,
    DEFAULT_API_PORT,
)
from slokern.engine.store.redact import sanitize_secret_message


def handle_api_request(
    method: str,
    path: str,
    body: Union[Dict[str, Any], str, bytes, None] = None,
    artifacts_root: str = "artifacts",
) -> Tuple[int, Dict[str, str], bytes]:
    """
    In-process request dispatcher allowing deterministic unit testing without TCP sockets.
    Returns (status_code, headers_dict, response_bytes).
    """
    parsed = urllib.parse.urlsplit(path)
    clean_path = parsed.path.rstrip("/")
    query = urllib.parse.parse_qs(parsed.query)

    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }

    parsed_body: Dict[str, Any] = {}
    if isinstance(body, (str, bytes)):
        try:
            val = json.loads(body)
            if isinstance(val, dict):
                parsed_body = val
        except Exception:
            pass
    elif isinstance(body, dict):
        parsed_body = body

    if method == "OPTIONS":
        return 200, headers, b""

    try:
        # GET /api/health
        if method == "GET" and clean_path == "/api/health":
            adapter = query.get("adapter", [None])[0]
            res = get_health(adapter_name=adapter)
            return 200, headers, json.dumps(res).encode("utf-8")

        # POST /api/smoke-test
        if method == "POST" and clean_path == "/api/smoke-test":
            payload = parsed_body
            adapter = payload.get("adapter")
            prompt = payload.get("prompt", "SLOKern preflight smoke test probe.")
            res = run_smoke_probe(adapter_name=adapter, prompt=prompt)
            status = 200 if res.get("status") == "success" else 503
            return status, headers, json.dumps(res).encode("utf-8")

        # POST /api/runs/single
        if method == "POST" and clean_path == "/api/runs/single":
            payload = parsed_body
            res = dispatch_single_run(payload, artifacts_root=artifacts_root)
            return 200, headers, json.dumps(res).encode("utf-8")

        # GET /api/runs
        if method == "GET" and clean_path == "/api/runs":
            runs_list = list_recent_runs(artifacts_root=artifacts_root)
            return 200, headers, json.dumps(runs_list).encode("utf-8")

        # GET /api/runs/<run_id>/trace
        match_trace = re.match(r"^/api/runs/(.+)/trace$", clean_path)
        if method == "GET" and match_trace:
            run_id = match_trace.group(1)
            # Security: Strict alphanumeric validation to prevent directory traversal
            if not re.match(r"^[a-zA-Z0-9_\-]+$", run_id):
                err = {"error": f"Invalid run_id format: {run_id}"}
                return 400, headers, json.dumps(err).encode("utf-8")

            resolved_path = None
            candidate_paths = [
                Path(artifacts_root) / "runs" / run_id / "raw_measurements.jsonl",
                Path(artifacts_root) / "runs" / run_id / "measurements.jsonl",
            ]
            for p in candidate_paths:
                if p.exists() and p.stat().st_size > 0:
                    resolved_path = p
                    break

            if resolved_path is None:
                for pat in (
                    f"**/runs/{run_id}/raw_measurements.jsonl",
                    f"**/runs/{run_id}/measurements.jsonl",
                ):
                    matches = list(Path(artifacts_root).glob(pat))
                    if matches and matches[0].exists() and matches[0].stat().st_size > 0:
                        resolved_path = matches[0]
                        break

            if resolved_path is None or not resolved_path.exists():
                err = {"error": f"Raw trace artifact not found for run {run_id}"}
                return 404, headers, json.dumps(err).encode("utf-8")

            trace_headers = dict(headers)
            trace_headers["Content-Type"] = "application/x-ndjson; charset=utf-8"
            trace_headers["Content-Disposition"] = f'attachment; filename="raw_measurements_{run_id}.jsonl"'
            return 200, trace_headers, resolved_path.read_bytes()

        # GET /api/runs/<run_id>
        match_run = re.match(r"^/api/runs/(.+)$", clean_path)
        if method == "GET" and match_run:
            run_id = match_run.group(1)
            if not re.match(r"^[a-zA-Z0-9_\-]+$", run_id):
                err = {"error": f"Invalid run_id format: {run_id}"}
                return 400, headers, json.dumps(err).encode("utf-8")
            res = get_run_status(run_id, artifacts_root=artifacts_root)
            status = 404 if res.get("error") == "Run not found" else 200
            return status, headers, json.dumps(res).encode("utf-8")

        # POST /api/runs/verify
        if method == "POST" and clean_path == "/api/runs/verify":
            payload = parsed_body
            res = dispatch_verification_run(payload, artifacts_root=artifacts_root)
            return 200, headers, json.dumps(res).encode("utf-8")

        # POST /api/campaigns/run
        if method == "POST" and clean_path == "/api/campaigns/run":
            status_code, res = dispatch_campaign_run(parsed_body, artifacts_root=artifacts_root)
            return status_code, headers, json.dumps(res).encode("utf-8")

        # GET /api/campaigns
        if method == "GET" and clean_path == "/api/campaigns":
            res = list_campaigns(artifacts_root=artifacts_root)
            return 200, headers, json.dumps(res).encode("utf-8")

        # GET /api/campaigns/<campaign_id>
        match_camp = re.match(r"^/api/campaigns/(.+)$", clean_path)
        if method == "GET" and match_camp:
            campaign_id = match_camp.group(1)
            if not re.match(r"^[a-zA-Z0-9_\-]+$", campaign_id):
                return 400, headers, json.dumps({"error": f"Invalid campaign_id format: {campaign_id}"}).encode("utf-8")
            res = get_campaign_status(campaign_id, artifacts_root=artifacts_root)
            status = 404 if res.get("error") == "Campaign not found" else 200
            return status, headers, json.dumps(res).encode("utf-8")

        # GET /api/runtime
        if method == "GET" and clean_path == "/api/runtime":
            res = get_runtime_profile(artifacts_root=artifacts_root)
            return 200, headers, json.dumps(res).encode("utf-8")

        # GET /api/smoke-test/latest
        if method == "GET" and clean_path == "/api/smoke-test/latest":
            res = get_latest_smoke_test(artifacts_root=artifacts_root)
            status = 200 if res.get("status") != "FAILED" else 500
            return status, headers, json.dumps(res).encode("utf-8")

        # GET /api/experiments
        if method == "GET" and clean_path == "/api/experiments":
            res = list_experiments(artifacts_root=artifacts_root)
            return 200, headers, json.dumps(res).encode("utf-8")

        # GET /api/experiments/<experiment_id>/candidates
        match_cands = re.match(r"^/api/experiments/(.+)/candidates$", clean_path)
        if method == "GET" and match_cands:
            exp_id = match_cands.group(1)
            if not re.match(r"^[a-zA-Z0-9_\-]+$", exp_id):
                return 400, headers, json.dumps({"error": f"Invalid experiment_id: {exp_id}"}).encode("utf-8")
            res = get_experiment_candidates(exp_id, artifacts_root=artifacts_root)
            return 200, headers, json.dumps(res).encode("utf-8")

        # GET /api/experiments/<experiment_id>/verification
        match_exp_verif = re.match(r"^/api/experiments/(.+)/verification$", clean_path)
        if method == "GET" and match_exp_verif:
            exp_id = match_exp_verif.group(1)
            if not re.match(r"^[a-zA-Z0-9_\-]+$", exp_id):
                return 400, headers, json.dumps({"error": f"Invalid experiment_id: {exp_id}"}).encode("utf-8")
            res = get_experiment_verification(exp_id, artifacts_root=artifacts_root)
            return 200, headers, json.dumps(res).encode("utf-8")

        # GET /api/experiments/<experiment_id>
        match_exp = re.match(r"^/api/experiments/(.+)$", clean_path)
        if method == "GET" and match_exp:
            exp_id = match_exp.group(1)
            if not re.match(r"^[a-zA-Z0-9_\-]+$", exp_id):
                return 400, headers, json.dumps({"error": f"Invalid experiment_id: {exp_id}"}).encode("utf-8")
            res = get_experiment_detail(exp_id, artifacts_root=artifacts_root)
            status = 404 if "error" in res else 200
            return status, headers, json.dumps(res).encode("utf-8")

        # GET /api/reports
        if method == "GET" and clean_path == "/api/reports":
            res = list_all_reports(artifacts_root=artifacts_root)
            return 200, headers, json.dumps(res).encode("utf-8")

        # GET /api/reports/<experiment_id>
        match_rep = re.match(r"^/api/reports/(.+)$", clean_path)
        if method == "GET" and match_rep:
            exp_id = match_rep.group(1)
            if not re.match(r"^[a-zA-Z0-9_\-]+$", exp_id):
                err = {"error": f"Invalid experiment_id format: {exp_id}"}
                return 400, headers, json.dumps(err).encode("utf-8")
            res = get_report_data(exp_id, artifacts_root=artifacts_root)
            return 200, headers, json.dumps(res).encode("utf-8")

        # 404 Not Found
        err = {"error": f"Endpoint not found: {method} {clean_path}"}
        return 404, headers, json.dumps(err).encode("utf-8")

    except Exception as exc:
        sanitized = sanitize_secret_message(str(exc))
        err = {"error": sanitized, "status": "server_error"}
        return 500, headers, json.dumps(err).encode("utf-8")


class SlokernHTTPRequestHandler(BaseHTTPRequestHandler):
    """
    Standard HTTP Request Handler implementing the SLOKern Control Plane REST & SSE API.
    """

    artifacts_root: str = "artifacts"

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self) -> None:
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        clean_path = parsed.path.rstrip("/")

        # Server-Sent Events stream: /api/runs/<run_id>/events
        match_sse = re.match(r"^/api/runs/(.+)/events$", clean_path)
        if match_sse:
            run_id = match_sse.group(1)
            if not re.match(r"^[a-zA-Z0-9_\-]+$", run_id):
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Invalid run_id format: {run_id}"}).encode("utf-8"))
                return

            event_queue = get_run_queue(run_id)
            if not event_queue:
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Active run queue not found for {run_id}"}).encode("utf-8"))
                return

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self._send_cors_headers()
            self.end_headers()

            sub_queue = event_queue.subscribe() if hasattr(event_queue, "subscribe") else event_queue
            try:
                while True:
                    if getattr(self.server, "is_shutting_down", False):
                        break
                    try:
                        event = sub_queue.get(timeout=1.0)
                    except queue.Empty:
                        if getattr(self.server, "is_shutting_down", False):
                            break
                        # Idle timeout — send SSE keep-alive comment and continue streaming
                        self.wfile.write(b": keep-alive\n\n")
                        self.wfile.flush()
                        continue
                    if event is None:
                        # Sentinel: the upstream queue has closed the stream
                        break
                    self.wfile.write(event.encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
            finally:
                self.close_connection = True
                if hasattr(event_queue, "unsubscribe") and sub_queue is not event_queue:
                    event_queue.unsubscribe(sub_queue)
            return

        # Server-Sent Events stream: /api/campaigns/<campaign_id>/stream
        match_camp_sse = re.match(r"^/api/campaigns/(.+)/stream$", clean_path)
        if match_camp_sse:
            campaign_id = match_camp_sse.group(1)
            if not re.match(r"^[a-zA-Z0-9_\-]+$", campaign_id):
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Invalid campaign_id format: {campaign_id}"}).encode("utf-8"))
                return

            event_queue = get_campaign_queue(campaign_id)
            if not event_queue:
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Active campaign stream not found for {campaign_id}"}).encode("utf-8"))
                return

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self._send_cors_headers()
            self.end_headers()

            sub_queue = event_queue.subscribe() if hasattr(event_queue, "subscribe") else event_queue
            try:
                while True:
                    if getattr(self.server, "is_shutting_down", False):
                        break
                    try:
                        event = sub_queue.get(timeout=1.0)
                    except queue.Empty:
                        if getattr(self.server, "is_shutting_down", False):
                            break
                        # Idle timeout — send SSE keep-alive comment and continue streaming
                        self.wfile.write(b": keep-alive\n\n")
                        self.wfile.flush()
                        continue
                    if event is None:
                        # Sentinel: the upstream queue has closed the stream
                        break
                    self.wfile.write(event.encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
            finally:
                self.close_connection = True
                if hasattr(event_queue, "unsubscribe") and sub_queue is not event_queue:
                    event_queue.unsubscribe(sub_queue)
            return

        # Standard REST GET dispatch
        status_code, headers, body_bytes = handle_api_request(
            method="GET",
            path=self.path,
            artifacts_root=self.artifacts_root,
        )
        self.send_response(status_code)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body_bytes)

    def do_POST(self) -> None:
        content_length = int(self.headers.get("Content-Length", 0))
        body = {}
        if content_length > 0:
            raw_body = self.rfile.read(content_length).decode("utf-8")
            try:
                body = json.loads(raw_body)
            except Exception:
                body = {}

        status_code, headers, body_bytes = handle_api_request(
            method="POST",
            path=self.path,
            body=body,
            artifacts_root=self.artifacts_root,
        )
        self.send_response(status_code)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body_bytes)

    def log_message(self, format: str, *args: Any) -> None:
        # Suppress noisy logging in tests/headless runs unless SLOKERN_LOG_HTTP=1
        import os
        if os.environ.get("SLOKERN_LOG_HTTP", "") == "1":
            super().log_message(format, *args)


def close_all_active_queues() -> None:
    """
    Closes all active run and campaign SSE queues to unblock streaming worker threads.
    """
    try:
        from slokern.api.routes.runs import ACTIVE_QUEUES, RUNS_LOCK
        with RUNS_LOCK:
            for q in list(ACTIVE_QUEUES.values()):
                if hasattr(q, "close"):
                    q.close()
    except Exception:
        pass
    try:
        from slokern.api.routes.campaigns import ACTIVE_CAMPAIGN_QUEUES, CAMPAIGNS_LOCK
        with CAMPAIGNS_LOCK:
            for q in list(ACTIVE_CAMPAIGN_QUEUES.values()):
                if hasattr(q, "close"):
                    q.close()
    except Exception:
        pass


def create_api_server(
    host: str = DEFAULT_API_HOST,
    port: int = DEFAULT_API_PORT,
    artifacts_root: str = "artifacts",
) -> ThreadingHTTPServer:
    """
    Instantiates multi-threaded HTTP server for SLOKern control plane.
    Sets daemon_threads = True so worker threads do not prevent clean exit on shutdown.
    """
    handler = SlokernHTTPRequestHandler
    handler.artifacts_root = artifacts_root
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    setattr(server, "is_shutting_down", False)
    return server


def run_server(
    host: str = DEFAULT_API_HOST,
    port: int = DEFAULT_API_PORT,
    artifacts_root: str = "artifacts",
) -> None:
    from slokern.config.secrets import load_runtime_secrets
    load_runtime_secrets()

    server = create_api_server(host=host, port=port, artifacts_root=artifacts_root)
    print(f"[SLOKern API Control Plane] Listening on http://{host}:{port}")
    print(f"  Artifacts directory: {artifacts_root}")
    print("  Available endpoints: GET /api/health, POST /api/smoke-test, POST /api/runs/single, GET /api/runs, GET /api/runs/<id>/trace, GET /api/reports/<id>")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down SLOKern API server.")
    finally:
        setattr(server, "is_shutting_down", True)
        close_all_active_queues()
        try:
            server.shutdown()
        except Exception:
            pass
        try:
            server.server_close()
        except Exception:
            pass


if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_API_HOST
    port = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_API_PORT
    run_server(host=host, port=port)
