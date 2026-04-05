import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

load_dotenv(Path(__file__).resolve().parent / ".env")

import models.db_models  # noqa: F401 — register tables
from database import ROOT, engine, init_db
from routers import runs, tests

ARTIFACTS_DIR = ROOT / "artifacts"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Kumqat API", version="0.1.0")

origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tests.router)
app.include_router(runs.router)
app.mount("/files", StaticFiles(directory=str(ARTIFACTS_DIR)), name="files")


@app.on_event("startup")
async def on_startup():
    init_db()
    _log_key_status()
    asyncio.create_task(_scheduler_loop())


def _log_key_status() -> None:
    log = logging.getLogger("uvicorn.error")
    google_key = bool((os.getenv("GOOGLE_API_KEY") or "").strip())
    bu_key = bool((os.getenv("BROWSER_USE_API_KEY") or "").strip())

    if google_key:
        log.info("Kumqat: GOOGLE_API_KEY configured — Gemini planner, validator, and /discuss active")
    else:
        log.warning(
            "Kumqat: GOOGLE_API_KEY is NOT SET.\n"
            "  Effect: test-case generation uses fallback templates; validation uses heuristics;\n"
            "          /discuss returns 503; chat Q&A is unavailable.\n"
            "  Fix   : add GOOGLE_API_KEY=<your_key> to apps/api/.env and restart."
        )

    if bu_key:
        log.info("Kumqat: BROWSER_USE_API_KEY configured — Browser Use Cloud agent active")
    else:
        log.warning(
            "Kumqat: BROWSER_USE_API_KEY is NOT SET.\n"
            "  Effect: Browser Use Cloud agent unavailable; runs use Playwright smoke tests only.\n"
            "  Fix   : add BROWSER_USE_API_KEY=<your_key> to apps/api/.env and restart."
        )


# ---------------------------------------------------------------------------
# Background scheduler
# ---------------------------------------------------------------------------

_INTERVAL_DELTA: dict[str, timedelta] = {
    "hourly": timedelta(hours=1),
    "daily":  timedelta(days=1),
    "weekly": timedelta(weeks=1),
}

log = logging.getLogger("uvicorn.error")


async def _scheduler_loop() -> None:
    """Poll every 30 s and fire any scheduled runs that are due."""
    while True:
        try:
            await asyncio.sleep(30)
            await _execute_due_schedules()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            log.warning("Kumqat scheduler error: %s", exc)


async def _execute_due_schedules() -> None:
    from sqlmodel import Session, select
    from models.db_models import Run, ScheduledRun
    from services.event_bus import create_queue
    from services.orchestrator import ensure_cases_for_run, execute_run

    now = datetime.utcnow()
    tasks: list[tuple[str, str, str, str]] = []

    with Session(engine) as session:
        due = session.exec(
            select(ScheduledRun)
            .where(ScheduledRun.active == True)  # noqa: E712
            .where(ScheduledRun.next_run_at <= now)
        ).all()

        for sched in due:
            run_id = str(uuid.uuid4())
            session.add(
                Run(
                    id=run_id,
                    url=sched.url,
                    requirement_text=sched.requirement_text,
                    status="pending",
                    viewport=sched.viewport,
                    created_at=now,
                )
            )
            sched.next_run_at = now + _INTERVAL_DELTA.get(sched.interval, timedelta(days=1))
            sched.last_run_id = run_id
            session.add(sched)
            tasks.append((run_id, sched.url, sched.requirement_text, sched.viewport))

        if tasks:
            session.commit()

    for run_id, url, req, _viewport in tasks:
        with Session(engine) as sess:
            await ensure_cases_for_run(sess, run_id, url, req, 5, None)
        create_queue(run_id)
        asyncio.create_task(execute_run(run_id))
        log.info("Kumqat scheduler: fired scheduled run %s for %s", run_id[:8], url)


@app.get("/health")
def health():
    return {"status": "ok"}
