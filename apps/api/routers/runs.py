import asyncio
import json
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from sqlmodel import Session, select

from database import get_session
from models.db_models import Run, ScheduledRun, StoredTestCase, TestResultRow
from models.schemas import (
    ChatRunRequest,
    DiscussRequest,
    RerunFailedRequest,
    RunOneCaseRequest,
    RunResultsResponse,
    RunSuiteRequest,
    RunSuiteResponse,
    ScheduleRunRequest,
    ScheduleRunResponse,
    TestCase,
)
from services.event_bus import close_queue, create_queue, get_or_create_queue
from services.orchestrator import (
    ensure_cases_for_run,
    execute_run,
    list_runs,
    serialize_run_results,
    stored_case_row_id,
)

router = APIRouter(tags=["runs"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_url(url: str) -> str:
    """Ensure URL has a scheme so Playwright can navigate to it.
    'ucsd.edu' → 'https://ucsd.edu', 'http://...' / 'https://...' left unchanged."""
    url = url.strip()
    if url and "://" not in url:
        url = "https://" + url
    return url


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------

async def _sse_generator(run_id: str):
    """Async generator that drains the run's event queue as SSE lines."""
    # Use get_or_create — never replace the queue the orchestrator is already
    # emitting to.  create_queue() would silently discard all buffered events.
    queue = get_or_create_queue(run_id)
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=15.0)
            except asyncio.TimeoutError:
                # keepalive comment so the connection doesn't time out
                yield ": ping\n\n"
                continue
            if event is None:
                # sentinel — run is done
                yield 'data: {"type":"done"}\n\n'
                return
            yield f"data: {json.dumps(event)}\n\n"
    finally:
        close_queue(run_id)


_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/stats")
def get_stats(session: Session = Depends(get_session)):
    """Aggregate quality metrics across all runs for the dashboard."""
    import statistics as _stats
    from urllib.parse import urlparse

    runs = session.exec(select(Run)).all()
    result_rows = session.exec(select(TestResultRow)).all()

    # Parse every result payload
    parsed: list[dict] = []
    for rr in result_rows:
        try:
            payload = json.loads(rr.result_json)
        except (json.JSONDecodeError, ValueError):
            continue
        parsed.append(
            {
                "run_id": rr.run_id,
                "status": payload.get("status", "fail"),
                "severity": payload.get("severity", "medium"),
                "confidence": float(payload.get("confidence", 0.5)),
            }
        )

    # Overall status counts
    overall: dict[str, int] = {"pass": 0, "fail": 0, "blocked": 0, "flaky": 0}
    for p in parsed:
        if p["status"] in overall:
            overall[p["status"]] += 1

    # Severity counts
    by_severity: dict[str, int] = {"high": 0, "medium": 0, "low": 0}
    for p in parsed:
        if p["severity"] in by_severity:
            by_severity[p["severity"]] += 1

    # Aggregate by domain
    run_map = {r.id: r for r in runs}
    domain_agg: dict[str, dict] = {}
    for p in parsed:
        run = run_map.get(p["run_id"])
        if not run:
            continue
        try:
            domain = urlparse(run.url).netloc or run.url
        except Exception:
            domain = run.url
        if domain not in domain_agg:
            domain_agg[domain] = {
                "domain": domain,
                "run_ids": set(),
                "pass": 0,
                "fail": 0,
                "blocked": 0,
                "flaky": 0,
                "confidences": [],
            }
        domain_agg[domain]["run_ids"].add(p["run_id"])
        if p["status"] in domain_agg[domain]:
            domain_agg[domain][p["status"]] += 1
        domain_agg[domain]["confidences"].append(p["confidence"])

    by_domain = []
    for data in sorted(
        domain_agg.values(),
        key=lambda d: sum(d[s] for s in ("pass", "fail", "blocked", "flaky")),
        reverse=True,
    ):
        total_cases = sum(data[s] for s in ("pass", "fail", "blocked", "flaky"))
        by_domain.append(
            {
                "domain": data["domain"],
                "runs": len(data["run_ids"]),
                "pass": data["pass"],
                "fail": data["fail"],
                "blocked": data["blocked"],
                "flaky": data["flaky"],
                "total": total_cases,
                "pass_rate": round(data["pass"] / total_cases, 3) if total_cases else 0,
                "avg_confidence": round(
                    _stats.mean(data["confidences"]) if data["confidences"] else 0, 3
                ),
            }
        )

    # Recent runs (up to 10) with per-run result summaries
    results_by_run: dict[str, dict[str, int]] = {}
    for p in parsed:
        if p["run_id"] not in results_by_run:
            results_by_run[p["run_id"]] = {"pass": 0, "fail": 0, "blocked": 0, "flaky": 0}
        if p["status"] in results_by_run[p["run_id"]]:
            results_by_run[p["run_id"]][p["status"]] += 1

    recent_runs = []
    for run in sorted(runs, key=lambda r: (r.created_at or ""), reverse=True)[:10]:
        counts = results_by_run.get(run.id, {"pass": 0, "fail": 0, "blocked": 0, "flaky": 0})
        try:
            domain = urlparse(run.url).netloc or run.url
        except Exception:
            domain = run.url
        recent_runs.append(
            {
                "run_id": run.id,
                "domain": domain,
                "url": run.url,
                "status": run.status,
                "created_at": run.created_at.isoformat() if run.created_at else "",
                **counts,
            }
        )

    return {
        "total_runs": len(runs),
        "total_cases": len(parsed),
        "overall": overall,
        "by_severity": by_severity,
        "by_domain": by_domain,
        "recent_runs": recent_runs,
    }


@router.get("/config-status")
def config_status():
    """Return which optional API keys are configured (values never exposed)."""
    import os as _os
    return {
        "google_api_key":    bool((_os.getenv("GOOGLE_API_KEY")    or "").strip()),
        "browser_use_api_key": bool((_os.getenv("BROWSER_USE_API_KEY") or "").strip()),
    }


@router.get("/runs")
def get_runs(limit: int = 20, session: Session = Depends(get_session)):
    return list_runs(session, limit)


@router.post("/run-suite", response_model=RunSuiteResponse)
async def run_suite(
    body: RunSuiteRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    url = _normalize_url(body.url)
    run_id = str(uuid.uuid4())
    run = Run(
        id=run_id,
        url=url,
        requirement_text=body.requirement_text,
        status="pending",
        viewport=body.viewport,
        created_at=datetime.utcnow(),
    )
    session.add(run)
    session.commit()
    await ensure_cases_for_run(
        session,
        run_id,
        url,
        body.requirement_text,
        body.max_cases,
        body.test_cases,
    )
    # Pre-create queue so /stream/{run_id} can subscribe before the task starts
    create_queue(run_id)
    background_tasks.add_task(execute_run, run_id)
    return RunSuiteResponse(
        run_id=run_id,
        message="Run queued. Poll GET /results/{run_id} or stream GET /stream/{run_id}.",
    )


@router.post("/run-test")
async def run_single_test(
    body: RunOneCaseRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    url = _normalize_url(body.url)
    run_id = str(uuid.uuid4())
    run = Run(
        id=run_id,
        url=url,
        requirement_text=body.requirement_text or "Single test run",
        status="pending",
        viewport=body.viewport,
        created_at=datetime.utcnow(),
    )
    session.add(run)
    session.commit()
    c = body.test_case
    st = StoredTestCase(
        id=stored_case_row_id(run_id, c.id),
        run_id=run_id,
        case_json=c.model_dump_json(),
    )
    session.add(st)
    session.commit()
    create_queue(run_id)
    background_tasks.add_task(execute_run, run_id)
    return {"run_id": run_id, "message": "Queued single test case."}


async def _sse_completed_generator(run_id: str):
    """Immediately emits run_completed + done for an already-finished run."""
    yield f'data: {json.dumps({"type": "run_completed", "data": {"run_id": run_id, "status": "completed"}})}\n\n'
    yield 'data: {"type":"done"}\n\n'


@router.get("/stream/{run_id}")
async def stream_run(run_id: str, session: Session = Depends(get_session)):
    """Server-Sent Events stream for a run's live progress."""
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    # If the run already finished (e.g. page refresh), send synthetic events
    # immediately so the UI transitions to the completed state right away.
    if run.status == "completed":
        return StreamingResponse(
            _sse_completed_generator(run_id),
            media_type="text/event-stream",
            headers=_SSE_HEADERS,
        )
    return StreamingResponse(
        _sse_generator(run_id),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.post("/chat-run")
async def chat_run(
    body: ChatRunRequest,
    session: Session = Depends(get_session),
):
    """
    Starts a single-case run and streams its events as SSE in the response body.

    Uses asyncio.create_task (not BackgroundTasks) so the coroutine runs on the
    event loop while the StreamingResponse generator is still open.
    """
    url = _normalize_url(body.url)
    run_id = str(uuid.uuid4())
    run = Run(
        id=run_id,
        url=url,
        requirement_text=body.requirement_text,
        status="pending",
        viewport=body.viewport,
        created_at=datetime.utcnow(),
    )
    session.add(run)
    session.commit()

    await ensure_cases_for_run(
        session,
        run_id,
        url,
        body.requirement_text,
        max_cases=1,
        provided=None,
    )

    # Queue must exist before the task starts to avoid lost events.
    # _sse_generator uses get_or_create_queue so it reuses this same queue.
    create_queue(run_id)
    asyncio.create_task(execute_run(run_id))

    return StreamingResponse(
        _sse_generator(run_id),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.get("/results/{run_id}", response_model=RunResultsResponse)
def get_results(run_id: str, session: Session = Depends(get_session)):
    data = serialize_run_results(session, run_id)
    if not data:
        raise HTTPException(status_code=404, detail="Run not found")
    return RunResultsResponse(
        run_id=data["run_id"],
        url=data["url"],
        requirement_text=data["requirement_text"],
        status=data["status"],
        viewport=data["viewport"],
        created_at=data["created_at"],
        results=data["results"],
        test_cases=data["test_cases"],
    )


@router.post("/rerun-failed")
async def rerun_failed(
    body: RerunFailedRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    old = session.get(Run, body.run_id)
    if not old:
        raise HTTPException(status_code=404, detail="Run not found")
    prev_results = session.exec(
        select(TestResultRow).where(TestResultRow.run_id == body.run_id)
    ).all()
    failed_case_ids: set[str] = set()
    for pr in prev_results:
        payload = json.loads(pr.result_json)
        if payload.get("status") in ("fail", "flaky", "blocked"):
            tid = payload.get("test_case_id")
            if tid:
                failed_case_ids.add(tid)
    if not failed_case_ids:
        raise HTTPException(status_code=400, detail="No failed, flaky, or blocked cases to rerun")

    stored = session.exec(
        select(StoredTestCase).where(StoredTestCase.run_id == body.run_id)
    ).all()
    cases: list[TestCase] = []
    for row in stored:
        c = TestCase.model_validate_json(row.case_json)
        if c.id in failed_case_ids:
            cases.append(c)

    run_id = str(uuid.uuid4())
    run = Run(
        id=run_id,
        url=old.url,
        requirement_text=f"Rerun failed from {body.run_id}",
        status="pending",
        viewport=old.viewport,
        created_at=datetime.utcnow(),
    )
    session.add(run)
    session.commit()
    for c in cases:
        st = StoredTestCase(
            id=stored_case_row_id(run_id, c.id),
            run_id=run_id,
            case_json=c.model_dump_json(),
        )
        session.add(st)
    session.commit()
    create_queue(run_id)
    background_tasks.add_task(execute_run, run_id)
    return {"run_id": run_id, "message": f"Rerunning {len(cases)} case(s)."}


@router.post("/discuss")
async def discuss_run(body: DiscussRequest, session: Session = Depends(get_session)):
    """
    Answer a question about an existing run's results using Gemini.
    No browser execution — pure Q&A over already-collected test data.
    """
    import os

    data = serialize_run_results(session, body.run_id)
    if not data:
        raise HTTPException(status_code=404, detail="Run not found")

    key = (os.getenv("GOOGLE_API_KEY") or "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="GOOGLE_API_KEY not configured")

    # Truncate heavy agent traces so we stay within context limits
    results_trimmed = []
    for r in data.get("results", []):
        r2 = dict(r)
        r2["agent_trace"] = (r2.get("agent_trace") or "")[:800]
        results_trimmed.append(r2)

    context_blob = json.dumps(
        {
            "run_id": data["run_id"],
            "url": data["url"],
            "requirement_text": data["requirement_text"],
            "status": data["status"],
            "test_cases": data.get("test_cases", []),
            "results": results_trimmed,
        },
        indent=2,
        ensure_ascii=False,
    )[:16000]

    system_prompt = (
        "You are a senior QA engineer reviewing automated browser test results. "
        "You have full access to the test run data below, including each test case's "
        "steps, expected outcomes, actual results, suspected issues, and agent traces. "
        "Answer the developer's questions concisely and actionably. "
        "Reference specific test case names and results. "
        "If asked to suggest fixes, be concrete. "
        "Do NOT re-run or re-execute anything — only analyse what is already in the data.\n\n"
        f"=== TEST RUN DATA ===\n{context_blob}"
    )

    # Build conversation turns
    turns: list[str] = []
    for msg in body.messages[:-1]:
        prefix = "Developer" if msg.role == "user" else "QA Assistant"
        turns.append(f"{prefix}: {msg.content}")
    last_question = body.messages[-1].content if body.messages else "Summarise the results."

    contents = "\n".join(turns) + f"\nDeveloper: {last_question}" if turns else f"Developer: {last_question}"

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=key)
        model = os.getenv("GEMINI_DISCUSS_MODEL", "gemini-2.0-flash")
        resp = client.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.4,
            ),
        )
        reply = (resp.text or "").strip()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini error: {e!s}") from e

    return {"reply": reply}


@router.post("/schedule-run", response_model=ScheduleRunResponse)
async def schedule_run(
    body: ScheduleRunRequest,
    session: Session = Depends(get_session),
):
    """Create a recurring scheduled test run."""
    from datetime import timedelta

    url = _normalize_url(body.url)
    schedule_id = str(uuid.uuid4())
    delta = {"hourly": timedelta(hours=1), "daily": timedelta(days=1), "weekly": timedelta(weeks=1)}.get(
        body.interval, timedelta(days=1)
    )
    now = datetime.utcnow()
    sched = ScheduledRun(
        id=schedule_id,
        url=url,
        requirement_text=body.requirement_text,
        viewport=body.viewport,
        interval=body.interval,
        next_run_at=now + delta,
        created_at=now,
    )
    session.add(sched)
    session.commit()
    return ScheduleRunResponse(
        schedule_id=schedule_id,
        message=f"Scheduled {body.interval} run for {url}.",
        next_run_at=sched.next_run_at.isoformat(),
    )


@router.get("/scheduled-runs")
def list_scheduled_runs(session: Session = Depends(get_session)):
    """List all scheduled runs, newest first."""
    schedules = session.exec(
        select(ScheduledRun).order_by(ScheduledRun.created_at)
    ).all()
    return [
        {
            "id": s.id,
            "url": s.url,
            "requirement_text": s.requirement_text,
            "viewport": s.viewport,
            "interval": s.interval,
            "next_run_at": s.next_run_at.isoformat(),
            "created_at": s.created_at.isoformat(),
            "last_run_id": s.last_run_id,
            "active": s.active,
        }
        for s in schedules
    ]


@router.delete("/scheduled-runs/{schedule_id}")
def delete_scheduled_run(schedule_id: str, session: Session = Depends(get_session)):
    sched = session.get(ScheduledRun, schedule_id)
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")
    session.delete(sched)
    session.commit()
    return {"message": "Schedule deleted"}


@router.get("/export/{run_id}.json")
def export_json(run_id: str, session: Session = Depends(get_session)):
    data = serialize_run_results(session, run_id)
    if not data:
        raise HTTPException(status_code=404, detail="Run not found")
    return JSONResponse(content=data)
