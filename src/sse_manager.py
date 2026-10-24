"""
FraudGuard Server-Sent Events (SSE) Manager
Maintains active HTTP subscriber connections, dispatches real-time transaction events,
and emits periodic ping heartbeats for AWS ALB / proxy keep-alive.
"""

import json
import time
import queue
import threading
from typing import Any, Dict, List, Optional


class SSEManager:
    _instance: Optional["SSEManager"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self.clients: List[queue.Queue] = []
        self._clients_lock = threading.Lock()
        self._running = True
        self._heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self._heartbeat_thread.start()

    @classmethod
    def get_instance(cls) -> "SSEManager":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=100)
        with self._clients_lock:
            self.clients.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._clients_lock:
            if q in self.clients:
                self.clients.remove(q)

    def broadcast(self, event_type: str, data: Any) -> None:
        payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        dead_clients = []
        with self._clients_lock:
            for q in self.clients:
                try:
                    q.put_nowait(payload)
                except queue.Full:
                    dead_clients.append(q)
            for dead in dead_clients:
                if dead in self.clients:
                    self.clients.remove(dead)

    def _heartbeat_loop(self) -> None:
        while self._running:
            time.sleep(15)
            self.broadcast("ping", {"timestamp": int(time.time())})

    def shutdown(self) -> None:
        self._running = False
