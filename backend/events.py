"""In-process event bus for /events SSE subscribers."""
from __future__ import annotations

import asyncio
from collections.abc import Callable

_subscribers: list[asyncio.Queue] = []
_loop_hook: Callable[[dict], None] | None = None


def subscribe() -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers.append(queue)
    return queue


def unsubscribe(queue: asyncio.Queue) -> None:
    if queue in _subscribers:
        _subscribers.remove(queue)


def publish(event: dict) -> None:
    """Push an event to all live SSE subscribers (safe from sync routes)."""
    for queue in list(_subscribers):
        try:
            queue.put_nowait(event)
        except Exception:
            continue
    if _loop_hook is not None:
        try:
            _loop_hook(event)
        except Exception:
            pass
