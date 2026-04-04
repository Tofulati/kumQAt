import json
import os
from typing import Any

import httpx

from models.schemas import TestCase, TestResultPayload

VALIDATOR_SYSTEM = """You are a QA validator. Given a test case, executor trace, page metadata, and evidence paths,
classify outcome as pass, fail, flaky, or blocked.
Output ONLY JSON with keys: status, severity (low|medium|high), confidence (0-1), failed_step (string or null),
expected (short), actual (short), repro_steps (array of strings), suspected_issue, business_impact.
blocked = login/MFA/captcha missing. fail = clear unmet expectation. pass = criteria reasonably met."""


async def validate_result(
    case: TestCase,
    trace: str,
    page_title: str,
    final_url: str,
    evidence: list[str],
    http_ok: bool,
) -> TestResultPayload:
    key = os.getenv("OPENAI_API_KEY")
    if key:
        user = json.dumps(
            {
                "test_case": case.model_dump(),
                "agent_trace": trace[:12000],
                "page_title": page_title,
                "final_url": final_url,
                "evidence": evidence,
                "http_reachable": http_ok,
            },
            ensure_ascii=False,
        )
        payload = {
            "model": os.getenv("OPENAI_VALIDATOR_MODEL", "gpt-4o-mini"),
            "messages": [
                {"role": "system", "content": VALIDATOR_SYSTEM},
                {"role": "user", "content": user},
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }
        async with httpx.AsyncClient(timeout=90.0) as client:
            r = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=payload,
            )
            r.raise_for_status()
            data = r.json()
            raw = json.loads(data["choices"][0]["message"]["content"])
            return _payload_from_dict(case.id, raw, trace)

    return _heuristic_validate(case, trace, page_title, final_url, evidence, http_ok)


def _payload_from_dict(case_id: str, raw: dict[str, Any], trace: str) -> TestResultPayload:
    status = raw.get("status", "fail")
    if status not in ("pass", "fail", "flaky", "blocked"):
        status = "fail"
    sev = raw.get("severity", "medium")
    if sev not in ("low", "medium", "high"):
        sev = "medium"
    return TestResultPayload(
        test_case_id=case_id,
        status=status,
        severity=sev,
        confidence=float(raw.get("confidence", 0.7)),
        failed_step=raw.get("failed_step"),
        expected=str(raw.get("expected", "")),
        actual=str(raw.get("actual", "")),
        repro_steps=list(raw.get("repro_steps") or []),
        evidence=[],
        suspected_issue=str(raw.get("suspected_issue", "")),
        business_impact=str(raw.get("business_impact", "")),
        agent_trace=trace,
    )


def _heuristic_validate(
    case: TestCase,
    trace: str,
    page_title: str,
    final_url: str,
    evidence: list[str],
    http_ok: bool,
) -> TestResultPayload:
    tl = trace.lower()
    blocked_markers = ("captcha", "mfa", "2fa", "login required", "blocked", "authentication required")
    if any(m in tl for m in blocked_markers):
        return TestResultPayload(
            test_case_id=case.id,
            status="blocked",
            severity="medium",
            confidence=0.55,
            failed_step=None,
            expected="; ".join(case.expected_outcomes[:2]) or case.goal,
            actual="Flow stopped before completion (auth or blocker).",
            repro_steps=case.steps[:5] if case.steps else [f"Open {final_url}"],
            evidence=evidence,
            suspected_issue="Human-in-the-loop may be required (login/MFA/captcha).",
            business_impact="Cannot verify end-to-end without credentials.",
            agent_trace=trace,
        )

    if not http_ok or not page_title.strip():
        return TestResultPayload(
            test_case_id=case.id,
            status="fail",
            severity="high",
            confidence=0.65,
            failed_step="Load target page",
            expected="Page loads with visible content",
            actual="Missing title or failed navigation.",
            repro_steps=case.steps[:5] if case.steps else [f"Open {final_url}"],
            evidence=evidence,
            suspected_issue="Network error, DNS, or blocking response.",
            business_impact="Users may be unable to access the app.",
            agent_trace=trace,
        )

    if "error" in tl and "no error" not in tl:
        return TestResultPayload(
            test_case_id=case.id,
            status="fail",
            severity="medium",
            confidence=0.6,
            failed_step=case.steps[0] if case.steps else "Execute flow",
            expected="; ".join(case.expected_outcomes[:2]) or case.goal,
            actual="Trace mentions an error state.",
            repro_steps=case.steps[:6],
            evidence=evidence,
            suspected_issue="See trace for UI or runtime error hints.",
            business_impact="Feature may be unreliable.",
            agent_trace=trace,
        )

    return TestResultPayload(
        test_case_id=case.id,
        status="pass",
        severity="low",
        confidence=0.62,
        failed_step=None,
        expected="; ".join(case.expected_outcomes[:2]) or case.goal,
        actual=f"Loaded: {page_title[:80]} — trace length {len(trace)} chars.",
        repro_steps=case.steps[:4] if case.steps else [f"Open {final_url}"],
        evidence=evidence,
        suspected_issue="",
        business_impact="No blocking issue detected by heuristics.",
        agent_trace=trace,
    )
