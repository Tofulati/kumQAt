# AI QA Engineer (DiamondHacks)

Autonomous-ish end-to-end QA: **requirements → generated test cases → real browser runs → structured results** with screenshots and repro hints.

## Stack

- **Dashboard:** Next.js 15 (`apps/web`)
- **API:** FastAPI + SQLModel (SQLite) + Playwright (`apps/api`)
- **Required key:** `OPENAI_API_KEY` for LLM test planning, validation, and Browser Use agent execution
- **Packages:** `browser-use` + `langchain-openai` installed via `requirements.txt`

## Quick start

### 1. API

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
# Configure apps/api/.env  (set OPENAI_API_KEY to enable LLM planning, validation, and Browser Use agent)
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### 2. Web

```bash
cd apps/web
npm install
# Optional: echo 'NEXT_PUBLIC_API_URL=http://127.0.0.1:8000' > .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The browser calls **`/api/qa/*`** on the Next dev server, which proxies to FastAPI (default **`http://127.0.0.1:8000`**). Set **`QA_API_URL`** in `apps/web/.env.local` if your API runs elsewhere (e.g. Docker).

### 3. From the repo root (after API venv exists)

```bash
npm install
npm run dev:api    # terminal 1
npm run dev:web    # terminal 2
```

## API overview

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/generate-tests` | URL + requirement text → JSON test cases |
| `POST` | `/run-suite` | Queue a run (optional `test_cases`, `viewport`) |
| `POST` | `/run-test` | Queue a single case (`test_case` in body) |
| `GET` | `/results/{run_id}` | Status + per-case structured results |
| `GET` | `/runs` | Recent runs |
| `POST` | `/rerun-failed` | New run from failed/flaky/blocked cases |
| `GET` | `/export/{run_id}.json` | Full JSON export |
| `GET` | `/files/...` | Static artifacts (screenshots, traces) |

Data lives in `data/qa_engineer.db`; screenshots under `artifacts/{run_id}/`.

## Browser Use

**browser-use** and **langchain-openai** are installed via `pip install -r requirements.txt`. Each test case always gets a **Playwright** snapshot (screenshot + HTTP status). When `OPENAI_API_KEY` is set, a **Browser Use Agent** powered by `gpt-4o` also runs, following the generated test steps autonomously for richer traces (see `apps/api/services/browser_runner.py`). Without the key, the agent path is skipped and heuristic validation is used.

## Video Recordings

Every test case generates a `.webm` screen recording of the Playwright browser session. Recordings are saved at `artifacts/{run_id}/{case_id}/recording.webm` and served via the `/files/` static mount. The results UI embeds them inline.

## Chat Interface

Visit `http://localhost:3000/chat` to use the interactive mode: describe a test scenario in plain English, hit **Run**, and watch the Browser Use agent stream its actions back as a live chat log with embedded screenshots and video.

## Demo tip

Use a stable public URL (e.g. `https://example.com`) for the first run; avoid logins and captchas until you add human-in-the-loop.
