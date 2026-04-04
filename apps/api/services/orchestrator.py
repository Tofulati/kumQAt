import json
import uuid
from datetime import datetime

from sqlmodel import Session, select

from database import engine
from models.db_models import Run, StoredTestCase, TestResultRow
from models.schemas import TestCase, TestResultPayload
from services.browser_runner import execute_case
from services.planner import generate_test_cases
from services.reporter import attach_evidence, build_summary
from services.validator import validate_result
from storage.artifacts import run_dir


def stored_case_row_id(run_id: str, logical_case_id: str) -> str:
    safe = logical_case_id.replace("/", "_")
    return f"{run_id}__{safe}"


async def execute_run(run_id: str) -> None:
    with Session(engine) as session:
        run = session.get(Run, run_id)
        if not run:
            return
        run.status = "running"
        session.add(run)
        session.commit()

        cases_rows = session.exec(
            select(StoredTestCase).where(StoredTestCase.run_id == run_id)
        ).all()
        base = run_dir(run_id)

        for row in cases_rows:
            case = TestCase.model_validate_json(row.case_json)
            try:
                trace, title, final_url, evidence_paths, http_ok = await execute_case(
                    case,
                    run.url,
                    run.viewport,
                    run_id,
                    base,
                )
                validated = await validate_result(
                    case,
                    trace,
                    title,
                    final_url,
                    evidence_paths,
                    http_ok,
                )
                validated = attach_evidence(validated, evidence_paths)
            except Exception as e:
                trace = str(e)
                validated = TestResultPayload(
                    test_case_id=case.id,
                    status="fail",
                    severity="high",
                    confidence=0.95,
                    failed_step="Browser execution",
                    expected=case.goal,
                    actual=f"Runner error: {e!s}",
                    repro_steps=list(case.steps[:8]) if case.steps else [f"Open {run.url}"],
                    evidence=[],
                    suspected_issue="Playwright/Chromium failed to launch or navigate. "
                    "Run `playwright install chromium` and ensure a non-sandboxed environment if needed.",
                    business_impact="No browser verification was possible for this case.",
                    agent_trace=trace,
                )
                validated.summary = build_summary(validated)
            else:
                validated.summary = build_summary(validated)

            res = TestResultRow(
                id=str(uuid.uuid4()),
                run_id=run_id,
                result_json=validated.model_dump_json(),
                summary=validated.summary,
            )
            session.add(res)
            session.commit()

        run = session.get(Run, run_id)
        if run:
            run.status = "completed"
            session.add(run)
            session.commit()


async def ensure_cases_for_run(
    session: Session,
    run_id: str,
    url: str,
    requirement_text: str,
    max_cases: int,
    provided: list[TestCase] | None,
) -> list[TestCase]:
    if provided:
        cases = provided
    else:
        cases = await generate_test_cases(url, requirement_text, max_cases)
    for c in cases:
        st = StoredTestCase(
            id=stored_case_row_id(run_id, c.id),
            run_id=run_id,
            case_json=c.model_dump_json(),
        )
        session.add(st)
    session.commit()
    return cases


def serialize_run_results(session: Session, run_id: str) -> dict:
    run = session.get(Run, run_id)
    if not run:
        return {}
    cases = session.exec(
        select(StoredTestCase).where(StoredTestCase.run_id == run_id)
    ).all()
    results = session.exec(select(TestResultRow).where(TestResultRow.run_id == run_id)).all()
    return {
        "run_id": run.id,
        "url": run.url,
        "requirement_text": run.requirement_text,
        "status": run.status,
        "viewport": run.viewport,
        "created_at": run.created_at.isoformat() + "Z",
        "test_cases": [json.loads(c.case_json) for c in cases],
        "results": [json.loads(r.result_json) for r in results],
    }


def list_runs(session: Session, limit: int = 20) -> list[dict]:
    rows = session.exec(select(Run).order_by(Run.created_at.desc()).limit(limit)).all()
    out = []
    for run in rows:
        out.append(
            {
                "run_id": run.id,
                "url": run.url,
                "status": run.status,
                "created_at": run.created_at.isoformat() + "Z",
                "requirement_text": run.requirement_text[:120],
            }
        )
    return out
