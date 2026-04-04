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
            "Rules: prefer visible UI; after major actions note what you see; "
            "if login/MFA/captcha is required and not provided, stop with BLOCKED and why.",
            "End with a short RESULT line: PASS, FAIL, or BLOCKED and one-sentence rationale.",
        ]
    )


def _browser_use_available() -> bool:
    if not os.getenv("OPENAI_API_KEY"):
        return False
    try:
        import browser_use  # noqa: F401

        return True
    except ImportError:
        return False


async def _run_browser_use_agent(case: TestCase, url: str) -> str:
    from browser_use import Agent
    from langchain_openai import ChatOpenAI

    llm = ChatOpenAI(model="gpt-4o", temperature=0.0)
    agent = Agent(
        task=_task_prompt(case, url),
        llm=llm,
    )
    result = await agent.run()
    if result is None:
        return "Agent completed with no return payload."
    return str(result)


async def _run_playwright_smoke(
    url: str,
    viewport: str,
    shot_path: Path,
    video_dir: Path,
) -> tuple[str, str, str, bool, str | None]:
    from playwright.async_api import async_playwright

    vw, vh = (1280, 720) if viewport == "desktop" else (390, 844)
    trace_parts: list[str] = []
    http_ok = True
    final_url = url
    title = ""
    video_path_raw: str | None = None

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context(
                viewport={"width": vw, "height": vh},
                record_video_dir=str(video_dir),
                record_video_size={"width": vw, "height": vh},
            )
            page = await context.new_page()
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            if resp is not None:
                http_ok = 200 <= resp.status < 400
                trace_parts.append(f"HTTP status: {resp.status}")
            await page.wait_for_timeout(800)
            title = await page.title()
            final_url = page.url
            trace_parts.append(f"Title: {title}")
            trace_parts.append(f"Final URL: {final_url}")
            await page.screenshot(path=str(shot_path), full_page=False)
            trace_parts.append(f"Screenshot saved: {shot_path.name}")
            # Must retrieve video path BEFORE context.close() finalises the file
            if page.video:
                try:
                    video_path_raw = await page.video.path()
                except Exception:
                    video_path_raw = None
        except Exception as e:
            http_ok = False
            trace_parts.append(f"Playwright error: {e!s}")
        finally:
            try:
                await context.close()  # finalises the .webm recording
            except Exception:
                pass
            await browser.close()

    return "\n".join(trace_parts), title, final_url, http_ok, video_path_raw


async def execute_case(
    case: TestCase,
    url: str,
    viewport: str,
    run_id: str,
    base_dir: Path,
) -> tuple[str, str, str, list[str], bool]:
    """
    Returns: trace, page_title, final_url, evidence_rel_paths, http_ok
    """
    case_dir = base_dir / case.id
    case_dir.mkdir(parents=True, exist_ok=True)
    evidence: list[str] = []

    shot = case_dir / "viewport.png"
    pw_trace, title, final_url, http_ok, video_path_raw = await _run_playwright_smoke(
        url, viewport, shot, video_dir=case_dir
    )
    evidence.append(f"/files/{run_id}/{case.id}/viewport.png")

    # Rename Playwright's UUID-named video to a stable path and add to evidence
    if video_path_raw:
        try:
            raw = Path(video_path_raw)
            if raw.exists():
                dest = case_dir / "recording.webm"
                raw.rename(dest)
                evidence.append(f"/files/{run_id}/{case.id}/recording.webm")
        except Exception:
            pass

    if _browser_use_available():
        try:
            bu_trace = await _run_browser_use_agent(case, url)
            combined = f"--- Playwright snapshot ---\n{pw_trace}\n\n--- Browser Use agent ---\n{bu_trace}"
            agent_log = case_dir / "agent_trace.txt"
            agent_log.write_text(combined, encoding="utf-8")
            evidence.append(f"/files/{run_id}/{case.id}/agent_trace.txt")
            return combined, title, final_url, evidence, http_ok
        except Exception as e:
            err = f"{pw_trace}\n\nBrowser Use error: {e!s}"
            return err, title, final_url, evidence, http_ok

    return pw_trace, title, final_url, evidence, http_ok
