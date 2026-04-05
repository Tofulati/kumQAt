import os
from pathlib import Path

from models.schemas import TestCase


def _task_prompt(case: TestCase, url: str) -> str:
    return "\n".join(
        [
            "You are an autonomous QA agent executing ONE browser test.",
            f"Start URL: {url}",
            f"Test name: {case.name}",
            f"Goal: {case.goal}",
            "Preconditions: " + "; ".join(case.preconditions or ["Site reachable"]),
            "Follow these steps in order (adapt slightly if the UI blocks you; explain blockers):",
            *[f"{i+1}. {s}" for i, s in enumerate(case.steps or ["Open the start URL and explore the UI"])],
            "Expected outcomes: " + "; ".join(case.expected_outcomes or ["No critical breakage"]),
            "Failure signals to watch for: " + "; ".join(case.failure_signals or []),
            "Navigation safety rules:",
            "  - Prefer read-only actions: browse categories, scroll, search, read listings.",
            "  - For 'safe navigation click' tests: click category links, menu items, or browse links.",
            "  - AVOID action buttons that start multi-step flows: 'post', 'sign up', 'register', 'buy', 'checkout', 'delete', 'submit form'.",
            "  - If a step says 'one safe click', pick the most passive browsing action available.",
            "  - If login/MFA/captcha is required and not provided, stop with BLOCKED and why.",
            "  - Do not fill or submit forms unless the test explicitly asks for form testing.",
            "End with a line starting exactly: RESULT: PASS, RESULT: FAIL, or RESULT: BLOCKED — then one sentence rationale.",
        ]
    )


def _cloud_browser_use_available() -> bool:
    """Check if Browser Use Cloud API credentials are present."""
    return bool((os.getenv("BROWSER_USE_API_KEY") or "").strip())


def _local_browser_use_available() -> bool:
    """Check if local browser-use package + Gemini key are present."""
    if not os.getenv("GOOGLE_API_KEY"):
        return False
    try:
        import browser_use  # noqa: F401

        return True
    except ImportError:
        return False


def _browser_use_available() -> bool:
    return _cloud_browser_use_available() or _local_browser_use_available()


async def _run_browser_use_cloud_agent(
    case: TestCase,
    url: str,
    run_id: str,
    viewport: str = "desktop",
) -> tuple[str, list[str]]:
    """Execute via Browser Use Cloud API.

    Returns (trace_str, step_screenshot_urls).
    Creates a session first to get a live_url, emits it via SSE immediately.
    Uses highlight_elements=True so agent screenshots show element highlights.
    """
    from browser_use_sdk import AsyncBrowserUse
    from services.event_bus import emit as _emit

    key = (os.getenv("BROWSER_USE_API_KEY") or "").strip()
    client = AsyncBrowserUse(api_key=key)
    cloud_llm = os.getenv("BROWSER_USE_CLOUD_LLM", "gemini-3-flash-preview")

    vw, vh = (1280, 720) if viewport == "desktop" else (390, 844)

    # Create session first so we can emit the live URL before the task runs
    session = await client.sessions.create_session(
        start_url=url,
        browser_screen_width=vw,
        browser_screen_height=vh,
        keep_alive=False,
    )
    if session.live_url:
        await _emit(run_id, "case_live_url", {
            "case_id": case.id,
            "live_url": session.live_url,
        })

    created = await client.tasks.create_task(
        task=_task_prompt(case, url),
        start_url=url,
        llm=cloud_llm,  # type: ignore[arg-type]
        max_steps=20,
        session_id=session.id,
        highlight_elements=True,
    )
    task_id = created.id

    # SDK v2: lightweight polling is tasks.status(); wait() wraps that (300s, 2s interval).
    try:
        task_view = await client.tasks.wait(task_id, timeout=300.0, interval=2.0)
    except TimeoutError:
        task_view = await client.tasks.get_task(task_id)

    # Build trace and collect per-step screenshot URLs
    parts: list[str] = [f"Browser Use Cloud task {task_id} | status: {task_view.status}"]
    step_screenshots: list[str] = []

    for step in task_view.steps or []:
        parts.append(f"\nStep {step.number}: {step.next_goal}")
        if step.evaluation_previous_goal:
            parts.append(f"  ↳ eval: {step.evaluation_previous_goal}")
        if step.memory:
            parts.append(f"  ↳ memory: {step.memory[:200]}")
        if step.screenshot_url:
            step_screenshots.append(step.screenshot_url)

    if task_view.output:
        parts.append(f"\nFinal output: {task_view.output}")
    if task_view.is_success is not None:
        parts.append(f"Agent self-reported success: {task_view.is_success}")
    if task_view.judge_verdict:
        parts.append(f"Judge verdict: {task_view.judge_verdict}")

    return "\n".join(parts), step_screenshots


async def _run_browser_use_local_agent(case: TestCase, url: str) -> str:
    """Fallback: execute via local browser-use package with Gemini LLM."""
    from browser_use import Agent
    from langchain_google_genai import ChatGoogleGenerativeAI

    llm = ChatGoogleGenerativeAI(
        model=os.getenv("GEMINI_AGENT_MODEL", "gemini-3-flash-preview"),
        google_api_key=os.getenv("GOOGLE_API_KEY"),
        temperature=0.0,
    )
    agent = Agent(
        task=_task_prompt(case, url),
        llm=llm,
    )
    result = await agent.run()
    if result is None:
        return "Agent completed with no return payload."
    return str(result)


async def _run_browser_use_agent(
    case: TestCase,
    url: str,
    run_id: str,
    viewport: str = "desktop",
) -> tuple[str, list[str]]:
    """Dispatch to cloud API if available, otherwise fall back to local agent.

    Returns (trace_str, step_screenshot_urls).
    """
    if _cloud_browser_use_available():
        return await _run_browser_use_cloud_agent(case, url, run_id, viewport)
    # Local agent doesn't provide step screenshots
    trace = await _run_browser_use_local_agent(case, url)
    return trace, []


async def _http_smoke(url: str) -> tuple[str, str, str, bool]:
    """Lightweight HTTP check using httpx — no browser required.

    Returns: (trace_str, page_title, final_url, http_ok)
    """
    import re

    import httpx

    trace_parts: list[str] = []
    title = ""
    final_url = url
    http_ok = True

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=20.0,
            headers={"User-Agent": "Mozilla/5.0 (compatible; KumqatQA/1.0)"},
        ) as client:
            resp = await client.get(url)
            status_code = resp.status_code
            http_ok = 200 <= status_code < 400
            final_url = str(resp.url)
            trace_parts.append(f"HTTP status: {status_code}")

            if status_code == 403:
                trace_parts.append("BLOCKED: server returned 403 Forbidden — likely bot/WAF block")
            elif status_code == 429:
                trace_parts.append("BLOCKED: server returned 429 Too Many Requests — rate limited")
            elif status_code >= 500:
                trace_parts.append(f"SERVER ERROR: {status_code} — upstream service failure")
            elif not http_ok:
                trace_parts.append(f"HTTP ERROR: {status_code}")

            # Extract <title> from HTML
            m = re.search(r"<title[^>]*>([^<]{1,200})</title>", resp.text, re.IGNORECASE)
            title = m.group(1).strip() if m else ""
            trace_parts.append(f"Title: {title}")
            trace_parts.append(f"Final URL: {final_url}")

            # Detect bot-challenge pages that return 200 but show a block screen
            body_lower = resp.text.lower()
            if any(kw in body_lower for kw in (
                "captcha", "verify you are human", "cloudflare", "access denied",
                "bot detection", "ddos protection",
            )):
                trace_parts.append(
                    "BLOCKED: page content indicates a bot-challenge or WAF interstitial (Cloudflare/CAPTCHA)"
                )

    except httpx.InvalidURL:
        http_ok = False
        trace_parts.append(f"NETWORK ERROR: Invalid URL '{url}' — missing scheme (http/https)?")
    except httpx.ConnectError:
        http_ok = False
        trace_parts.append(f"NETWORK ERROR: Connection refused — server at '{url}' is not accepting connections.")
    except httpx.TimeoutException:
        http_ok = False
        trace_parts.append(f"NETWORK ERROR: Connection timed out navigating to '{url}'.")
    except Exception as e:
        http_ok = False
        err = str(e)
        if "ssl" in err.lower() or "tls" in err.lower():
            trace_parts.append(f"NETWORK ERROR: SSL/TLS error for '{url}': {err[:200]}")
        else:
            trace_parts.append(f"NETWORK ERROR: {err[:400]}")

    return "\n".join(trace_parts), title, final_url, http_ok


async def execute_case(
    case: TestCase,
    url: str,
    viewport: str,
    run_id: str,
    base_dir: Path,
) -> tuple[str, str, str, list[str], bool, dict[str, float]]:
    """
    Returns: trace, page_title, final_url, evidence_rel_paths, http_ok, timings
    timings keys: http_smoke, browser_agent (seconds, rounded to 2dp)
    """
    import time

    case_dir = base_dir / case.id
    case_dir.mkdir(parents=True, exist_ok=True)
    evidence: list[str] = []
    timings: dict[str, float] = {}

    # Fast HTTP baseline — no browser needed
    t0 = time.perf_counter()
    http_trace, title, final_url, http_ok = await _http_smoke(url)
    timings["http_smoke"] = round(time.perf_counter() - t0, 2)

    if _browser_use_available():
        try:
            t0 = time.perf_counter()
            bu_trace, step_screenshots = await _run_browser_use_agent(case, url, run_id, viewport)
            timings["browser_agent"] = round(time.perf_counter() - t0, 2)
            combined = f"--- HTTP snapshot ---\n{http_trace}\n\n--- Browser Use agent ---\n{bu_trace}"
            agent_log = case_dir / "agent_trace.txt"
            agent_log.write_text(combined, encoding="utf-8")
            evidence.append(f"/files/{run_id}/{case.id}/agent_trace.txt")
            # Browser Use step screenshots (CDN URLs) with highlight_elements drawn on them
            evidence.extend(step_screenshots)
            return combined, title, final_url, evidence, http_ok, timings
        except Exception as e:
            timings["browser_agent"] = round(time.perf_counter() - t0, 2)
            err = f"{http_trace}\n\nBrowser Use error: {e!s}"
            return err, title, final_url, evidence, http_ok, timings

    return http_trace, title, final_url, evidence, http_ok, timings
