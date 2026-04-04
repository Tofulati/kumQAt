import json
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from database import get_session
from models.db_models import Run, StoredTestCase, TestResultRow
from models.schemas import (
    RerunFailedRequest,
    RunOneCaseRequest,
    RunResultsResponse,
    RunSuiteRequest,
    RunSuiteResponse,
    TestCase,
)
from services.orchestrator import (
    ensure_cases_for_run,
    execute_run,
    list_runs,
    serialize_run_results,
    stored_case_row_id,
)

router = APIRouter(tags=["runs"])


@router.get("/runs")
def get_runs(limit: int = 20, session: Session = Depends(get_session)):
    return list_runs(session, limit)


@router.post("/run-suite", response_model=RunSuiteResponse)
async def run_suite(
    body: RunSuiteRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    run_id = str(uuid.uuid4())
    run = Run(
        id=run_id,
        url=body.url,
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
        body.url,
        body.requirement_text,
        body.max_cases,
        body.test_cases,
    )
    background_tasks.add_task(execute_run, run_id)
    return RunSuiteResponse(
        run_id=run_id,
        message="Run queued. Poll GET /results/{run_id} for progress.",
    )


@router.post("/run-test")
async def run_single_test(
    body: RunOneCaseRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    run_id = str(uuid.uuid4())
    run = Run(
        id=run_id,
        url=body.url,
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
    background_tasks.add_task(execute_run, run_id)
    return {"run_id": run_id, "message": "Queued single test case."}


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
    background_tasks.add_task(execute_run, run_id)
    return {"run_id": run_id, "message": f"Rerunning {len(cases)} case(s)."}


@router.get("/export/{run_id}.json")
def export_json(run_id: str, session: Session = Depends(get_session)):
    data = serialize_run_results(session, run_id)
    if not data:
        raise HTTPException(status_code=404, detail="Run not found")
    return JSONResponse(content=data)
