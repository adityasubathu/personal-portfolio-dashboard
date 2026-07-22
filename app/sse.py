import asyncio
import json as jsonlib
from typing import Any, Awaitable, Callable

from sse_starlette.sse import EventSourceResponse

OnProgress = Callable[[str], Awaitable[None]]
Runner = Callable[[OnProgress], Awaitable[dict[str, Any]]]


def sse_stream(
    runner: Runner,
    lock: asyncio.Lock | None = None,
    busy_msg: str = "An operation is already running.",
) -> EventSourceResponse:
    if lock is not None and lock.locked():
        async def _busy():
            yield {"event": "done", "data": jsonlib.dumps({"ok": False, "error": busy_msg})}
        return EventSourceResponse(_busy())

    async def _generate():
        queue: asyncio.Queue[str | None] = asyncio.Queue()

        async def on_progress(msg: str) -> None:
            await queue.put(msg)

        async def _run() -> None:
            try:
                result = await runner(on_progress)
                await queue.put(None)
                await queue.put(jsonlib.dumps({"ok": True, **result}))
            except Exception as exc:
                await queue.put(None)
                await queue.put(jsonlib.dumps({"ok": False, "error": str(exc)}))

        async def _stream():
            task = asyncio.create_task(_run())
            while True:
                msg = await queue.get()
                if msg is None:
                    break
                yield {"event": "log", "data": msg}
            final = await queue.get()
            yield {"event": "done", "data": final}
            await task

        if lock is not None:
            async with lock:
                async for event in _stream():
                    yield event
        else:
            async for event in _stream():
                yield event

    return EventSourceResponse(_generate())
