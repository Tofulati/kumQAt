import asyncio
import json
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from sqlmodel import Session, select

from database import get_session
from models.db_models import Run, StoredTestCase, TestResultRow
from models.schemas import (
    ChatRunRequest,
    DiscussRequest,
    RerunFailedRequest,
    RunOneCaseRequest,
    RunResultsResponse,
    RunSuiteRequest,
    RunSuiteResponse,
    TestCase,
)
from services.event_bus import close_queue, create_queue
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
    queue = create_queue(run_id)
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


@router.get("/stream/{run_id}")
async def stream_run(run_id: str, session: Session = Depends(get_session)):
    """Server-Sent Events stream for a run's live progress."""
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
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

    # Queue must exist before the task starts to avoid lost events
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


@router.get("/export/{run_id}.json")
def export_json(run_id: str, session: Session = Depends(get_session)):
    data = serialize_run_results(session, run_id)
    if not data:
        raise HTTPException(status_code=404, detail="Run not found")
    return JSONResponse(content=data)
