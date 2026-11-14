"""
Purpose: Unit tests for SSEEventQueue (api/sse) and SSE handler lifecycle in app.py.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 10 and DEC-0014
"""

import io
import queue
import threading
import time
from typing import List, Optional
from unittest.mock import MagicMock, patch

import pytest

from slokern.api.sse import SSEEventQueue


# ---------------------------------------------------------------------------
# SSEEventQueue unit tests
# ---------------------------------------------------------------------------


def test_sse_queue_emit_and_get() -> None:
    """Events emitted appear in the main queue."""
    q = SSEEventQueue()
    q.emit("progress", {"run_id": "r1", "value": 42})
    item = q.get(timeout=0.1)
    assert item is not None
    assert '"type": "progress"' in item
    assert '"value": 42' in item


def test_sse_queue_get_returns_none_on_timeout() -> None:
    """get() returns None instead of raising queue.Empty on timeout."""
    q = SSEEventQueue()
    result = q.get(timeout=0.05)
    assert result is None


def test_sse_queue_close_sends_sentinel() -> None:
    """close() places a None sentinel in the main queue."""
    q = SSEEventQueue()
    q.close()
    item = q.get(timeout=0.1)
    assert item is None
    assert q.is_closed is True


def test_sse_queue_close_idempotent() -> None:
    """Calling close() twice does not raise."""
    q = SSEEventQueue()
    q.close()
    q.close()  # Should be a no-op


def test_sse_queue_subscribe_gets_history() -> None:
    """subscribe() pre-populates with historical events."""
    q = SSEEventQueue()
    q.emit("started", {"run_id": "r2"})
    q.emit("progress", {"run_id": "r2", "step": 1})

    sub = q.subscribe()
    item1 = sub.get(timeout=0.1)
    item2 = sub.get(timeout=0.1)

    assert item1 is not None and '"type": "started"' in item1
    assert item2 is not None and '"type": "progress"' in item2


def test_sse_queue_subscribe_gets_sentinel_when_closed() -> None:
    """subscribe() after close() gets history then a None sentinel."""
    q = SSEEventQueue()
    q.emit("done", {"run_id": "r3"})
    q.close()

    sub = q.subscribe()
    item1 = sub.get(timeout=0.1)
    item2 = sub.get(timeout=0.1)

    assert item1 is not None and '"type": "done"' in item1
    assert item2 is None  # sentinel signals closure


def test_sse_queue_unsubscribe_removes_subscriber() -> None:
    """unsubscribe() prevents future events from reaching removed subscriber."""
    q = SSEEventQueue()
    sub = q.subscribe()
    q.unsubscribe(sub)

    q.emit("event", {"key": "value"})
    # sub should not receive the event
    with pytest.raises(queue.Empty):
        sub.get(timeout=0.05)


def test_sse_queue_multiple_subscribers_independent_delivery() -> None:
    """Each subscriber receives its own independent copy of every event."""
    q = SSEEventQueue()
    sub1 = q.subscribe()
    sub2 = q.subscribe()

    q.emit("test", {"n": 1})
    q.emit("test", {"n": 2})

    items1 = [sub1.get(timeout=0.1), sub1.get(timeout=0.1)]
    items2 = [sub2.get(timeout=0.1), sub2.get(timeout=0.1)]

    assert all(x is not None for x in items1)
    assert all(x is not None for x in items2)
    assert items1 == items2


def test_sse_queue_emit_after_close_is_dropped() -> None:
    """Events emitted after close() are silently dropped."""
    q = SSEEventQueue()
    q.close()
    q.emit("late", {"data": "should be dropped"})
    # Only the sentinel should be in the queue
    q.get(timeout=0.05)  # consume sentinel
    assert q.get(timeout=0.05) is None


def test_sse_queue_unsubscribe_nonexistent_is_silent() -> None:
    """unsubscribe() for a queue that is not registered does not raise."""
    q = SSEEventQueue()
    ghost: queue.Queue[Optional[str]] = queue.Queue()
    q.unsubscribe(ghost)  # should not raise


# ---------------------------------------------------------------------------
# SSE handler behaviour tests (via mock wfile)
# ---------------------------------------------------------------------------


def _make_mock_wfile() -> io.BytesIO:
    """Return a BytesIO acting as wfile (writable bytes buffer)."""
    buf = io.BytesIO()
    # BytesIO.flush() is a no-op; that's fine for testing
    return buf


def _run_sse_handler(
    sse_queue: SSEEventQueue,
    timeout_cycles: int = 0,
) -> bytes:
    """
    Drive the same logic as the app.py SSE handler directly against
    a real SSEEventQueue, without starting an HTTP server.

    Returns everything that would have been written to the SSE response body.
    """
    import queue as _queue_module
    _queue_Empty = _queue_module.Empty

    buf = io.BytesIO()

    sub_queue = sse_queue.subscribe() if hasattr(sse_queue, "subscribe") else sse_queue
    try:
        while True:
            try:
                event = sub_queue.get(timeout=0.05)
            except _queue_Empty:
                buf.write(b": keep-alive\n\n")
                continue
            if event is None:
                break
            buf.write(event.encode("utf-8"))
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
        pass
    finally:
        if hasattr(sse_queue, "unsubscribe") and sub_queue is not sse_queue:
            sse_queue.unsubscribe(sub_queue)

    return buf.getvalue()


def test_handler_idle_queue_sends_keepalive() -> None:
    """
    An idle SSE connection does not raise; it emits keep-alive comments
    and terminates cleanly when the queue is closed.
    """
    q = SSEEventQueue()

    # Close the queue after two idle cycles (100ms) to let the handler send
    # at least one heartbeat before shutting down
    def _close_after_delay() -> None:
        time.sleep(0.12)
        q.close()

    t = threading.Thread(target=_close_after_delay, daemon=True)
    t.start()

    output = _run_sse_handler(q)
    t.join(timeout=2.0)

    # At least one keep-alive must appear
    assert b": keep-alive\n\n" in output


def test_handler_delivers_events() -> None:
    """Events emitted before close are delivered to the SSE stream."""
    q = SSEEventQueue()
    q.emit("progress", {"run_id": "r1", "step": 1})
    q.emit("completed", {"run_id": "r1"})
    q.close()

    output = _run_sse_handler(q)

    assert b'"type": "progress"' in output
    assert b'"type": "completed"' in output


def test_handler_no_keepalive_when_events_arrive_fast() -> None:
    """When events arrive immediately, there should be no keep-alive in output."""
    q = SSEEventQueue()
    # Emit directly into subscriber before handler starts
    q.emit("fast", {"n": 1})
    q.emit("fast", {"n": 2})
    q.close()

    output = _run_sse_handler(q)

    # Events must be present
    assert b'"type": "fast"' in output
    # Keep-alive is not expected (all events arrived before any timeout)
    assert b": keep-alive" not in output


def test_handler_queue_close_terminates_stream() -> None:
    """When the queue is closed, the stream loop exits cleanly."""
    q = SSEEventQueue()
    q.close()

    output = _run_sse_handler(q)

    # None sentinel causes loop exit — no infinite hang
    assert isinstance(output, bytes)


def test_handler_subscription_cleaned_up_after_error() -> None:
    """
    Even when the handler loop terminates abnormally (simulated BrokenPipeError),
    the subscription is removed from the queue.
    """
    import queue as _queue_module
    _queue_Empty = _queue_module.Empty

    q = SSEEventQueue()

    class _BrokenPipeWfile:
        def write(self, data: bytes) -> None:
            raise BrokenPipeError("client gone")

        def flush(self) -> None:
            pass

    # Emit an event so the handler gets past the get() call before hitting write()
    q.emit("event", {"v": 1})

    sub_queue: Optional[queue.Queue[Optional[str]]] = None

    # Simulate the handler pattern
    captured_sub: List[queue.Queue[Optional[str]]] = []
    sub = q.subscribe()
    captured_sub.append(sub)

    try:
        while True:
            try:
                event = sub.get(timeout=0.1)
            except _queue_Empty:
                break
            if event is None:
                break
            # Simulate write failure
            raise BrokenPipeError("client gone")
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
        pass
    finally:
        if hasattr(q, "unsubscribe") and sub is not q:
            q.unsubscribe(sub)

    # After cleanup, subscriber should not be in the subscribers list
    with q._lock:
        assert sub not in q._subscribers


def test_handler_unexpected_exception_still_cleans_up() -> None:
    """
    If an unexpected exception occurs (not connection-related), the finally
    block still unsubscribes. We simulate this by raising ValueError.
    """
    import queue as _queue_module
    _queue_Empty = _queue_module.Empty

    q = SSEEventQueue()
    q.emit("event", {"v": 2})

    sub = q.subscribe()

    try:
        while True:
            try:
                event = sub.get(timeout=0.1)
            except _queue_Empty:
                break
            if event is None:
                break
            raise RuntimeError("unexpected crash in handler")
    except RuntimeError:
        pass  # re-raise in real code, but absorbed here for test
    finally:
        if hasattr(q, "unsubscribe") and sub is not q:
            q.unsubscribe(sub)

    with q._lock:
        assert sub not in q._subscribers


def test_handler_multiple_subscribers_independent() -> None:
    """
    Two concurrent SSE handlers on the same queue each receive all events
    independently.
    """
    q = SSEEventQueue()
    results: List[bytes] = [b"", b""]

    def _handler(idx: int) -> None:
        results[idx] = _run_sse_handler(q)

    t1 = threading.Thread(target=_handler, args=(0,), daemon=True)
    t2 = threading.Thread(target=_handler, args=(1,), daemon=True)
    t1.start()
    t2.start()

    # Let threads subscribe, then emit events
    time.sleep(0.02)
    q.emit("data", {"n": 1})
    q.emit("data", {"n": 2})
    q.close()

    t1.join(timeout=3.0)
    t2.join(timeout=3.0)

    assert b'"type": "data"' in results[0]
    assert b'"type": "data"' in results[1]
    # Each handler should have received both events
    assert results[0].count(b'"type": "data"') == 2
    assert results[1].count(b'"type": "data"') == 2


def test_handler_idle_stream_stays_open_across_multiple_timeouts() -> None:
    """
    The SSE handler MUST NOT terminate on queue timeout; the stream must
    remain open across several successive idle periods.
    This is the core regression test for the original bug.
    """
    q = SSEEventQueue()

    keepalive_count: List[int] = [0]

    import queue as _queue_module
    _queue_Empty = _queue_module.Empty

    buf = io.BytesIO()
    sub = q.subscribe()

    # Drive the loop for ~3+ idle cycles (each 50ms timeout => ≥3 cycles in 250ms)
    # then emit an event and close
    def _emit_and_close() -> None:
        time.sleep(0.25)  # allow at least 3 × 50 ms timeouts with slack
        q.emit("final", {"done": True})
        q.close()

    t = threading.Thread(target=_emit_and_close, daemon=True)
    t.start()

    try:
        while True:
            try:
                event = sub.get(timeout=0.05)
            except _queue_Empty:
                buf.write(b": keep-alive\n\n")
                keepalive_count[0] += 1
                continue
            if event is None:
                break
            buf.write(event.encode("utf-8"))
    finally:
        q.unsubscribe(sub)

    t.join(timeout=3.0)

    output = buf.getvalue()

    # Must have survived multiple timeouts without crashing
    assert keepalive_count[0] >= 3, f"expected ≥3 keep-alives, got {keepalive_count[0]}"
    # Must also have received the final event
    assert b'"type": "final"' in output


# ---------------------------------------------------------------------------
# Direct SlokernHTTPRequestHandler Tests (End-to-End Handlers)
# ---------------------------------------------------------------------------

from slokern.api.app import SlokernHTTPRequestHandler


class _MockServer:
    def __init__(self) -> None:
        self.is_shutting_down = False
        self.daemon_threads = True


class _MockHandler(SlokernHTTPRequestHandler):
    def __init__(self, path: str, server: Optional[_MockServer] = None) -> None:
        self.path = path
        self.server = server or _MockServer()
        self.wfile = io.BytesIO()
        self.headers_sent: List[tuple[str, str]] = []
        self.status_sent: Optional[int] = None

    def send_response(self, code: int, message: Optional[str] = None) -> None:
        self.status_sent = code

    def send_header(self, keyword: str, value: str) -> None:
        self.headers_sent.append((keyword, value))

    def end_headers(self) -> None:
        pass


def test_request_handler_idle_run_sse_connection_no_exception() -> None:
    """Idle run SSE connection catches queue.Empty, sends keep-alive, does not crash."""
    from slokern.api.routes.runs import ACTIVE_QUEUES, RUNS_LOCK

    q = SSEEventQueue()
    run_id = "test-run-idle-01"
    with RUNS_LOCK:
        ACTIVE_QUEUES[run_id] = q

    # Simulate 1 timeout then stream close
    call_count = 0
    sub = q.subscribe()
    def mock_get(timeout=None):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise queue.Empty()
        return None

    sub.get = mock_get
    q.subscribe = lambda: sub

    handler = _MockHandler(f"/api/runs/{run_id}/events")
    handler.do_GET()

    assert handler.status_sent == 200
    assert any(k == "Content-Type" and v == "text/event-stream" for k, v in handler.headers_sent)
    output = handler.wfile.getvalue()
    assert b": keep-alive\n\n" in output
    assert len(q._subscribers) == 0  # unsubscribed in finally


def test_request_handler_idle_campaign_sse_connection_no_exception() -> None:
    """Idle campaign SSE connection catches queue.Empty, sends keep-alive, does not crash."""
    from slokern.api.routes.campaigns import ACTIVE_CAMPAIGN_QUEUES, CAMPAIGNS_LOCK

    q = SSEEventQueue()
    camp_id = "test-camp-idle-01"
    with CAMPAIGNS_LOCK:
        ACTIVE_CAMPAIGN_QUEUES[camp_id] = q

    call_count = 0
    sub = q.subscribe()
    def mock_get(timeout=None):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise queue.Empty()
        return None

    sub.get = mock_get
    q.subscribe = lambda: sub

    handler = _MockHandler(f"/api/campaigns/{camp_id}/stream")
    handler.do_GET()

    assert handler.status_sent == 200
    assert any(k == "Content-Type" and v == "text/event-stream" for k, v in handler.headers_sent)
    output = handler.wfile.getvalue()
    assert b": keep-alive\n\n" in output
    assert len(q._subscribers) == 0


def test_request_handler_run_event_arrives_and_delivered() -> None:
    """Emitted run events are correctly written to the response stream."""
    from slokern.api.routes.runs import ACTIVE_QUEUES, RUNS_LOCK

    q = SSEEventQueue()
    run_id = "test-run-event-01"
    with RUNS_LOCK:
        ACTIVE_QUEUES[run_id] = q

    handler = _MockHandler(f"/api/runs/{run_id}/events")

    def _emit_and_close() -> None:
        time.sleep(0.02)
        q.emit("progress", {"run_id": run_id, "step": 3})
        q.close()

    t = threading.Thread(target=_emit_and_close, daemon=True)
    t.start()
    handler.do_GET()
    t.join(timeout=2.0)

    output = handler.wfile.getvalue()
    assert b'"type": "progress"' in output
    assert b'"step": 3' in output


def test_request_handler_campaign_event_arrives_and_delivered() -> None:
    """Emitted campaign events are correctly written to the response stream."""
    from slokern.api.routes.campaigns import ACTIVE_CAMPAIGN_QUEUES, CAMPAIGNS_LOCK

    q = SSEEventQueue()
    camp_id = "test-camp-event-01"
    with CAMPAIGNS_LOCK:
        ACTIVE_CAMPAIGN_QUEUES[camp_id] = q

    handler = _MockHandler(f"/api/campaigns/{camp_id}/stream")

    def _emit_and_close() -> None:
        time.sleep(0.02)
        q.emit("candidate_completed", {"campaign_id": camp_id, "verdict": "FEASIBLE"})
        q.close()

    t = threading.Thread(target=_emit_and_close, daemon=True)
    t.start()
    handler.do_GET()
    t.join(timeout=2.0)

    output = handler.wfile.getvalue()
    assert b'"type": "candidate_completed"' in output
    assert b'"verdict": "FEASIBLE"' in output


def test_request_handler_client_disconnect_cleans_up() -> None:
    """Client disconnect (BrokenPipeError on write) cleanly exits and unsubscribes."""
    from slokern.api.routes.runs import ACTIVE_QUEUES, RUNS_LOCK

    q = SSEEventQueue()
    run_id = "test-run-disconnect-01"
    with RUNS_LOCK:
        ACTIVE_QUEUES[run_id] = q

    class _DisconnectHandler(_MockHandler):
        @property
        def wfile(self):
            class _BrokenWriter:
                def write(s, data: bytes) -> None:
                    raise BrokenPipeError("client disconnected")
                def flush(s) -> None:
                    pass
            return _BrokenWriter()

        @wfile.setter
        def wfile(self, val):
            pass

    handler = _DisconnectHandler(f"/api/runs/{run_id}/events")
    # Pre-emit an event so the loop immediately calls write
    q.emit("progress", {"run_id": run_id})

    handler.do_GET()

    # Subscription must be cleaned up in finally block despite exception
    assert len(q._subscribers) == 0


def test_request_handler_server_shutdown_flag_exits_loop() -> None:
    """Setting server.is_shutting_down exits the streaming loop without waiting for close."""
    from slokern.api.routes.runs import ACTIVE_QUEUES, RUNS_LOCK

    q = SSEEventQueue()
    run_id = "test-run-shutdown-flag-01"
    with RUNS_LOCK:
        ACTIVE_QUEUES[run_id] = q

    server = _MockServer()
    server.is_shutting_down = False

    # Simulate sub_queue raising queue.Empty while is_shutting_down is True
    sub = q.subscribe()
    def mock_get(timeout=None):
        server.is_shutting_down = True
        raise queue.Empty()

    sub.get = mock_get
    q.subscribe = lambda: sub

    handler = _MockHandler(f"/api/runs/{run_id}/events", server=server)
    handler.do_GET()

    assert len(q._subscribers) == 0


def test_live_server_graceful_shutdown_no_hanging_threads() -> None:
    """Live ThreadingHTTPServer shuts down cleanly with zero hanging worker threads."""
    import urllib.request
    from slokern.api.app import create_api_server, close_all_active_queues
    from slokern.api.routes.runs import ACTIVE_QUEUES, RUNS_LOCK

    server = create_api_server("127.0.0.1", 0)
    port = server.server_port
    assert server.daemon_threads is True

    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    # Use direct opener with empty proxy handler to avoid local environment proxy interception
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    # 1. Verify REST endpoint works
    health_url = f"http://127.0.0.1:{port}/api/health?adapter=fake"
    with opener.open(health_url, timeout=3.0) as resp:
        assert resp.status == 200

    # 2. Open an SSE connection to an active queue
    q = SSEEventQueue()
    run_id = "test-live-shutdown-run"
    with RUNS_LOCK:
        ACTIVE_QUEUES[run_id] = q

    client_connected = threading.Event()
    client_done = threading.Event()

    def _sse_client() -> None:
        try:
            url = f"http://127.0.0.1:{port}/api/runs/{run_id}/events"
            with opener.open(url, timeout=5.0) as resp:
                client_connected.set()
                while True:
                    line = resp.readline()
                    if not line:
                        break
        except Exception:
            pass
        finally:
            client_done.set()

    client_thread = threading.Thread(target=_sse_client, daemon=True)
    client_thread.start()
    client_connected.wait(timeout=2.0)

    # 3. Shutdown server gracefully
    server.is_shutting_down = True
    close_all_active_queues()
    server.shutdown()
    server.server_close()

    server_thread.join(timeout=3.0)
    client_thread.join(timeout=3.0)

    assert not server_thread.is_alive(), "server_thread should terminate"
    assert not client_thread.is_alive(), "client_thread should terminate"


def test_cli_no_duplicate_import_warning() -> None:
    """Running python -W error -m slokern.cli.main executes without RuntimeWarning."""
    import subprocess
    import sys

    cmd = [sys.executable, "-W", "error", "-m", "slokern.cli.main", "--help"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10.0)
    assert result.returncode == 0
    assert "RuntimeWarning" not in result.stderr
