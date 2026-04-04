# QABot — Codebase Docs & DiamondHacks Battle Plan

---

## 1. What This Project Is

**AI QA Engineer** — paste a URL + a plain-English feature requirement, and the system:
1. Uses GPT-4o-mini to write structured test cases (or falls back to 5 hardcoded templates)
2. Runs each test case through a headless Chromium browser (Playwright)
3. Optionally runs a Browser Use AI agent that actually *navigates* the site following the test steps
4. Uses GPT-4o-mini to validate the result as `pass / fail / flaky / blocked`
5. Stores everything in SQLite and surfaces it in a Next.js dashboard

Prize targets: **Best Use of Browser Use** ($3,540 + iPhone 17 Pro), **CSE: Best Interactive AI** ($3,350 + iPad Air), **Best AI/ML**, **Best UI/UX**, and overall placement.

---

## 2. Full Architecture

```
apps/
├── api/               ← FastAPI backend (Python)
│   ├── main.py        ← App entry, CORS, mounts routers + /files static
│   ├── database.py    ← SQLite engine via SQLModel, init_db()
│   ├── models/
│   │   ├── db_models.py   ← Run, StoredTestCase, TestResultRow (SQLModel tables)
│   │   └── schemas.py     ← Pydantic request/response schemas (TestCase, TestResultPayload, etc.)
│   ├── routers/
│   │   ├── tests.py   ← POST /generate-tests
│   │   └── runs.py    ← POST /run-suite, /run-test, /rerun-failed; GET /results/{id}, /runs, /export/{id}.json
│   ├── services/
│   │   ├── planner.py      ← GPT-4o-mini → structured TestCase list (fallback: 5 hardcoded templates)
│   │   ├── browser_runner.py ← Playwright smoke + Browser Use agent execution
│   │   ├── orchestrator.py   ← Ties it all together: runs cases sequentially, writes results to DB
│   │   ├── validator.py      ← GPT-4o-mini classifies pass/fail/flaky/blocked (fallback: heuristics)
│   │   └── reporter.py       ← Builds human-readable summary string from TestResultPayload
│   └── storage/
│       └── artifacts.py  ← Creates per-run artifact dirs (artifacts/{run_id}/{case_id}/)
│
└── web/               ← Next.js 15 frontend
    ├── app/
    │   ├── page.tsx           ← Main form: URL + requirement + viewport → generate/run
    │   ├── runs/[runId]/page.tsx  ← Results page, polls every 2.5s
    │   └── api/qa/[...path]/route.ts ← Next.js proxy → FastAPI (avoids CORS)
    └── lib/
        └── api.ts    ← Typed fetch wrappers for all backend endpoints
```

### Database Tables

| Table | Key Fields |
|---|---|
| `run` | `id` (uuid), `url`, `requirement_text`, `status` (pending/running/completed), `viewport`, `created_at` |
| `storedtestcase` | `id` (`{run_id}__{case_id}`), `run_id`, `case_json` (serialized TestCase) |
| `testresultrow` | `id` (uuid), `run_id`, `result_json` (serialized TestResultPayload), `summary` |

Artifacts live in `apps/api/artifacts/{run_id}/{case_id}/viewport.png` and optionally `agent_trace.txt`.

### API Endpoints

| Method | Path | What it does |
|---|---|---|
| `POST` | `/generate-tests` | URL + text → JSON test cases (no browser run) |
| `POST` | `/run-suite` | Queues a full run in the background, returns `run_id` immediately |
| `POST` | `/run-test` | Same but for a single hand-crafted test case |
| `GET` | `/results/{run_id}` | Status + all per-case results (poll this) |
| `GET` | `/runs` | Last 20 runs |
| `POST` | `/rerun-failed` | Creates a new run from all fail/flaky/blocked cases of a previous run |
| `GET` | `/export/{run_id}.json` | Full JSON dump |
| `GET` | `/files/...` | Static file server for screenshots and traces |

### Key Service Flow

```
POST /run-suite
  └─ orchestrator.ensure_cases_for_run()
       └─ planner.generate_test_cases()   ← GPT-4o-mini or fallback templates
  └─ BackgroundTask: orchestrator.execute_run()
       for each TestCase:
         └─ browser_runner.execute_case()
              ├─ _run_playwright_smoke()   ← navigate, screenshot, get HTTP status + title
              └─ _run_browser_use_agent() ← (if BROWSER_USE_API_KEY set) AI agent follows steps
         └─ validator.validate_result()   ← GPT-4o-mini or heuristic classification
         └─ reporter.attach_evidence()
         └─ write TestResultRow to DB
```

---

## 3. What's Working vs. What's Broken

### ✅ Genuinely Working
- Full end-to-end pipeline (planner → Playwright → validator → DB → UI)
- Playwright headless browser: loads URL, takes screenshot, captures HTTP status + page title
- GPT-4o-mini planner with proper JSON mode
- GPT-4o-mini validator with heuristic fallback
- SQLite persistence across restarts
- Polling results page (2.5s interval)
- Rerun failed cases
- Export JSON
- Next.js proxy → FastAPI (no CORS issues)
- Artifact file serving

### ✅ Browser Use Bug — Fixed in PR 1

~~`browser_runner.py` imported non-existent `ChatBrowserUse`, crashing the agent path silently.~~

Fixed: agent now uses `langchain_openai.ChatOpenAI(model="gpt-4o")` passed as `llm=` to `Agent`. Gated on `OPENAI_API_KEY` (single key). `langchain-openai>=0.1.0` added to `requirements.txt`. Video recording also added in PR 1 — Playwright records `.webm` per test case via `record_video_dir` on the browser context.

### ⚠️ Playwright Runner Doesn't Execute Steps

`_run_playwright_smoke()` only does:
1. `page.goto(url)` — navigates to the URL
2. `page.screenshot()` — takes a single screenshot
3. Returns HTTP status + page title

It **never reads or executes the `case.steps` list** (e.g. "click Login button", "fill in email field"). The steps are only used in the Browser Use agent prompt. Without a working Browser Use, the system is doing smoke tests — not real QA.

### ⚠️ No Real-Time Streaming
The UI polls every 2.5s. There's no live view of what the browser agent is doing. This is a major missed demo opportunity.

---

## 4. Battle Plan — What to Build to Win

### Prize Stack We're Targeting

| Prize | Value | How We Win |
|---|---|---|
| **Best Use of Browser Use** | $3,540 + iPhone 17 Pro | Browser Use IS the primary engine, not a fallback. Show agents navigating real sites. |
| **CSE: Best Interactive AI** | $3,350 + iPad Air | Add a chat interface — describe a bug or feature in plain English, watch the agent test it live |
| **Best AI/ML Hack** | $160 | Already have AI throughout |
| **Best UI/UX** | $140 | Overhaul the results view |
| **Overall placement** | $1,800–$4,500 | Working, polished, genuinely useful |

---

### Priority 1 — Critical Fixes (Do First, ~45 min)

#### Fix 1: Fix Browser Use import + API usage

**File:** `apps/api/services/browser_runner.py`

The correct browser-use 0.12.6 API:
```python
from browser_use import Agent
from langchain_openai import ChatOpenAI

async def _run_browser_use_agent(case: TestCase, url: str) -> str:
    llm = ChatOpenAI(model="gpt-4o", temperature=0.0)
    agent = Agent(task=_task_prompt(case, url), llm=llm)
    result = await agent.run()
    return str(result)
```

Also add `langchain-openai` to `requirements.txt`.

**Gate it on `OPENAI_API_KEY`** (not a separate `BROWSER_USE_API_KEY`) so it works with one key.

#### Fix 2: Add `langchain-openai` dependency

**File:** `apps/api/requirements.txt`
```
langchain-openai>=0.1.0
```

---

### Priority 2 — High Impact Features (~3–4 hrs)

#### Feature A: Playwright Video Recording

Playwright supports `record_video_dir` out of the box. Add this to `_run_playwright_smoke()`:
- Record a `.webm` video of every test run
- Save to `artifacts/{run_id}/{case_id}/recording.webm`
- Expose via `/files/...`
- Show inline `<video>` tag in the results UI

**Why:** Video evidence is the single most compelling demo artifact. Judges see the agent navigate a real website.

#### Feature B: Live Agent Status Streaming (SSE)

Add a `GET /stream/{run_id}` Server-Sent Events endpoint that emits events as each test case completes. The frontend subscribes to this stream instead of polling.

Events to emit:
- `case_started` — test case name + index
- `case_completed` — status, summary, screenshot URL
- `run_completed` — final stats

**Why:** Watching the tests stream in live is a dramatically better demo than waiting for a page refresh.

#### Feature C: Overhaul the Results UI

Current UI is a raw `<table>`. Replace with:
- **Summary bar at top:** `✅ 3 passed  ❌ 1 failed  ⚠️ 1 blocked  🔵 2 running`
- **Per-case cards** with inline screenshot thumbnail, collapsible step trace, repro steps
- **Progress bar** while running
- **"Watch it run"** — embed the video recording or a live screenshot feed

#### Feature D: Interactive Chat Interface (hits CSE: Best Interactive AI)

Add a second page or modal: **"Chat with your QA agent"**
- User types: "Test that the login flow works with invalid credentials"
- System generates 1 test case from that prompt
- Browser Use agent runs it immediately
- Results stream back as the agent narrates what it's doing
- Show live Playwright screenshots as the agent navigates

This directly targets the CSE track: "interactive software... AI makes it dynamically respond to user input... engaging and fun."

#### Feature E: Crawl Mode

Add a toggle "Discover pages" that:
1. Playwright crawls the site to find all internal links (limit 10)
2. Auto-generates test cases for each discovered page
3. Runs them all in parallel batches

**Why:** Transforms this from a "test one URL" tool to an "audit my entire site" tool. Much more impressive scope.

---

### Priority 3 — Polish (~1–2 hrs)

- **Shareable report:** `GET /report/{run_id}` returns a self-contained HTML page with all results + screenshots embedded as base64 — shareable with zero dependencies
- **Severity heatmap:** Visual grid of all test cases, colored by severity — great for screenshots in the demo video
- **Better branding:** Name it something catchier than "AI QA Engineer". Suggestion: **"BugSwarm"** or **"QABot"** with a logo

---

## 5. Demo Script (for the 3-min video)

1. **(0:00–0:20)** Problem: QA testing is slow, manual, and doesn't scale. Show a developer manually clicking through a website.
2. **(0:20–0:45)** Open QABot. Type a URL (`https://news.ycombinator.com`). Type the requirement: "Test that the submit story flow works correctly."
3. **(0:45–1:30)** Click "Run". Watch the live stream: Browser Use agent opens the browser, navigates to submit, fills in the form, detects the login wall. Streams status back in real time.
4. **(1:30–2:00)** Results page: summary card (1 blocked, 2 pass), inline video recording of the agent navigating, repro steps with exact steps to reproduce the failure.
5. **(2:00–2:30)** Chat interface: type "Now test mobile responsiveness" → new test case runs → pass with screenshot evidence.
6. **(2:30–3:00)** Export report → shareable HTML. Close with: "What took a QA team hours now takes 60 seconds."

---

## 6. File-by-File Change Summary

| File | Change |
|---|---|
| `apps/api/requirements.txt` | Add `langchain-openai>=0.1.0` |
| `apps/api/services/browser_runner.py` | Fix Browser Use import + Agent constructor; add video recording to Playwright |
| `apps/api/routers/runs.py` | Add `GET /stream/{run_id}` SSE endpoint |
| `apps/api/services/orchestrator.py` | Emit SSE events during execution; add parallel execution option |
| `apps/web/app/page.tsx` | Add chat input, improve form UX |
| `apps/web/app/runs/[runId]/page.tsx` | Replace table with cards, inline screenshots/video, live stream, progress bar |
| `apps/web/lib/api.ts` | Add SSE stream helper, report URL helper |
| `apps/api/routers/runs.py` | Add `GET /report/{run_id}` HTML export |

---

## 7. Environment Variables Needed

**`apps/api/.env`:**
```
OPENAI_API_KEY=sk-...          # Required for planner + validator + Browser Use agent
OPENAI_PLANNER_MODEL=gpt-4o-mini   # Optional override
OPENAI_VALIDATOR_MODEL=gpt-4o-mini # Optional override
CORS_ORIGINS=http://localhost:3000  # Default is fine for local
```

No separate `BROWSER_USE_API_KEY` needed — once the import is fixed, Browser Use runs on `OPENAI_API_KEY`.

---

## 8. Lessons from the Swarm AI Reference Project

The Swarm AI team at TreeHacks claimed "1,000 concurrent calls" but had a hard cap of 10 and sequential execution with 10-second sleep delays. Their frontend hardcoded phone numbers and call counts. The demo only worked for a single inbound call.

**Our advantage:** Every feature in QABot either works or can be fixed with small, targeted changes. There is no fake concurrency, no hardcoded values, no placeholder URLs. The core Playwright pipeline is genuinely functional today. We just need to:
1. Fix the Browser Use import (1 line)
2. Upgrade the runner to use video + real step execution
3. Build a better UI

Start there. Win from there.
