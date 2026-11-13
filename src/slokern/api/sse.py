"""
Purpose: Server-sent event stream queue of experiment progress.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 3, 9 and docs/architecture.md
"""

import json
import queue
import threading
import time
from typing import Any, Dict, List, Optional


class SSEEventQueue:
    """
    Thread-safe event queue buffering SSE data payloads for streaming HTTP clients.
    Supports event history replay for reconnecting or late-arriving subscribers and multi-client fanout.
    """

    def __init__(self, maxsize: int = 10000) -> None:
        self.maxsize = maxsize
        self._lock = threading.Lock()
        self._queue: queue.Queue[Optional[str]] = queue.Queue(maxsize=maxsize)
        self._history: List[str] = []
        self._subscribers: List[queue.Queue[Optional[str]]] = []
        self.is_closed: bool = False

    def emit(self, event_type: str, data: Dict[str, Any]) -> None:
        with self._lock:
            if self.is_closed:
                return
            payload = {"type": event_type, "timestamp": time.time(), **data}
            event_str = f"data: {json.dumps(payload)}\n\n"
            self._history.append(event_str)
            try:
                self._queue.put_nowait(event_str)
            except queue.Full:
                pass
            for sub in list(self._subscribers):
                try:
                    sub.put_nowait(event_str)
                except queue.Full:
                    pass

    def close(self) -> None:
        with self._lock:
            if self.is_closed:
                return
            self.is_closed = True
            try:
                self._queue.put_nowait(None)
            except queue.Full:
                pass
            for sub in list(self._subscribers):
                try:
                    sub.put_nowait(None)
                except queue.Full:
                    pass

    def get(self, timeout: Optional[float] = 1.0) -> Optional[str]:
        try:
            item = self._queue.get(timeout=timeout)
            return item if isinstance(item, str) else None
        except queue.Empty:
            return None

    def subscribe(self) -> queue.Queue[Optional[str]]:
        """
        Creates a subscriber queue pre-populated with all events emitted so far.
        If already closed, includes a terminal None so subscriber gracefully drains and closes.
        """
        sub: queue.Queue[Optional[str]] = queue.Queue(maxsize=self.maxsize)
        with self._lock:
            for item in self._history:
                try:
                    sub.put_nowait(item)
                except queue.Full:
                    break
            if self.is_closed:
                try:
                    sub.put_nowait(None)
                except queue.Full:
                    pass
            else:
                self._subscribers.append(sub)
        return sub

    def unsubscribe(self, sub: queue.Queue[Optional[str]]) -> None:
        with self._lock:
            if sub in self._subscribers:
                self._subscribers.remove(sub)
