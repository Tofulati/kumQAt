import json
import os
import re
import uuid
from typing import Any

import httpx
from pydantic import ValidationError

from models.schemas import TestCase

PLANNER_SYSTEM = """You are a senior QA lead. Turn product requirements into minimal, executable browser test cases.
Return ONLY a JSON object with key "test_cases" whose value is an array. Each element must have:
id (string slug), name, goal, preconditions (array of strings), steps (array of strings),
expected_outcomes (array), failure_signals (array), priority (P0|P1|P2), tags (array).
Prefer 3-5 cases for MVP scope. Do not include markdown or commentary."""


def _slug(s: str) -> str:
    x = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    return x[:48] or "case"


def _fallback_cases(url: str, requirement_text: str, max_cases: int) -> list[TestCase]:
    base = requirement_text.strip() or "General smoke and critical flows"
    templates = [
        {
            "name": "Reach application",
            "goal": f"User can load the app from {url} and see meaningful content",
            "steps": [
                f"Open {url}",
                "Wait for main content to render",
                "Confirm no blocking error page",
            ],
            "expected_outcomes": [
                "Page loads with HTTP success",
                "Visible heading or navigation",
            ],
            "failure_signals": ["Blank page", "5xx error", "Connection refused"],
            "tags": ["smoke"],
        },
        {
            "name": "Primary navigation sanity",
            "goal": "Primary navigation or CTAs are present and clickable",
            "steps": [
                f"Open {url}",
                "Identify main nav or hero CTA",
                "Attempt one safe navigation click if present",
            ],
            "expected_outcomes": ["Interactive controls visible", "No immediate JS crash"],
            "failure_signals": ["Overlapping invisible UI", "Broken layout on load"],
            "tags": ["navigation"],
        },
        {
            "name": "Requirement-focused check",
            "goal": f"Exercise flows implied by: {base[:200]}",
            "steps": [
                f"Open {url}",
                "Explore UI paths related to the requirement",
                "Capture final state",
            ],
            "expected_outcomes": ["Flows complete without obvious breakage"],
            "failure_signals": ["Validation errors on valid data", "Infinite spinners"],
            "tags": ["feature"],
        },
        {
            "name": "Form or input resilience",
            "goal": "If forms exist, invalid input is handled predictably",
            "steps": [
                f"Open {url}",
                "Locate a form if any",
                "Submit empty or invalid fields once",
            ],
            "expected_outcomes": ["Inline validation or clear error messaging"],
            "failure_signals": ["Silent failure", "500 after submit"],
            "tags": ["forms"],
        },
        {
            "name": "Mobile viewport sanity",
            "goal": "Layout remains usable on a narrow viewport",
            "steps": [
                f"Open {url}",
                "Resize to mobile width",
                "Scroll and confirm primary content visible",
            ],
            "expected_outcomes": ["No horizontal overflow of critical controls"],
            "failure_signals": ["Critical buttons off-screen with no scroll"],
            "tags": ["responsive"],
        },
    ]
    out: list[TestCase] = []
    for i, t in enumerate(templates[:max_cases]):
        cid = f"tc_{_slug(t['name'])}_{uuid.uuid4().hex[:6]}"
        out.append(
            TestCase(
                id=cid,
                name=t["name"],
                goal=t["goal"],
                preconditions=["Site reachable", "No credentials assumed unless provided"],
                steps=t["steps"],
                expected_outcomes=t["expected_outcomes"],
                failure_signals=t["failure_signals"],
                priority="P0" if i == 0 else "P1",
                tags=t["tags"],
            )
        )
    return out


def _as_str_list(val: Any) -> list[str]:
    if not val:
        return []
    if not isinstance(val, list):
        return [str(val)]
    out: list[str] = []
    for x in val:
        if isinstance(x, str):
            out.append(x)
        elif x is not None:
            out.append(str(x))
    return out


async def generate_test_cases(
    url: str,
    requirement_text: str,
    max_cases: int,
) -> list[TestCase]:
    key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not key:
        return _fallback_cases(url, requirement_text, max_cases)

    user = f"Target URL: {url}\nRequirement:\n{requirement_text}\nGenerate at most {max_cases} cases."
    payload = {
        "model": os.getenv("OPENAI_PLANNER_MODEL", "gpt-4o-mini"),
        "messages": [
            {"role": "system", "content": PLANNER_SYSTEM},
            {"role": "user", "content": user},
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=payload,
            )
            r.raise_for_status()
            data = r.json()
            content = data["choices"][0]["message"]["content"]
            parsed: dict[str, Any] = json.loads(content)
            raw_list = parsed.get("test_cases") or parsed.get("cases") or []
            cases: list[TestCase] = []
            for item in raw_list[:max_cases]:
                if isinstance(item, dict):
                    cid = str(item.get("id") or f"tc_{uuid.uuid4().hex[:8]}")
                    try:
                        cases.append(
                            TestCase(
                                id=cid,
                                name=str(item.get("name", "Unnamed")),
                                goal=str(item.get("goal", "")),
                                preconditions=_as_str_list(item.get("preconditions")),
                                steps=_as_str_list(item.get("steps")),
                                expected_outcomes=_as_str_list(item.get("expected_outcomes")),
                                failure_signals=_as_str_list(item.get("failure_signals")),
                                priority=str(item.get("priority", "P1")),
                                tags=_as_str_list(item.get("tags")),
                            )
                        )
                    except ValidationError:
                        continue
            return cases if cases else _fallback_cases(url, requirement_text, max_cases)
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, TypeError, ValueError, ValidationError):
        return _fallback_cases(url, requirement_text, max_cases)
