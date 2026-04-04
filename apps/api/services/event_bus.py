"""
In-memory SSE event bus.

Each active run gets an asyncio.Queue.  The orchestrator emits events via
`emit()` while the SSE route handler drains the queue and streams
`data: {...}\n\n` lines to connected clients.
"""
import asyncio

_queues: dict[str, asyncio.Queue] = {}


def create_queue(run_id: str) -> asyncio.Queue:
    """Create (or replace) the queue for *run_id* and return it."""
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    _queues[run_id] = q
    return q


def get_queue(run_id: str) -> "asyncio.Queue | None":
    return _queues.get(run_id)


async def emit(run_id: str, event_type: str, data: dict) -> None:
    """Push an event onto the run's queue.  No-op if no queue exists."""
    q = _queues.get(run_id)
    if q is None:
        return
    try:
        q.put_nowait({"type": event_type, "data": data})
    except asyncio.QueueFull:
        pass  # drop silently — client is too slow or disconnected


def close_queue(run_id: str) -> None:
    """Send the sentinel (None) and remove the queue.  Idempotent."""
    q = _queues.pop(run_id, None)
    if q is not None:
        try:
            q.put_nowait(None)
        except asyncio.QueueFull:
            pass
