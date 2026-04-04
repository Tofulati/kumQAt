/** Browser: same-origin proxy (avoids CORS / wrong NEXT_PUBLIC_API_URL). Server: direct backend. */
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    return "/api/qa";
  }
  return (
    process.env.QA_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
}

async function httpError(r: Response): Promise<Error> {
  const text = await r.text();
  let detail = text;
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    if (j.detail !== undefined) detail = JSON.stringify(j.detail);
  } catch {
    /* keep raw */
  }
  return new Error(`${r.status} ${r.statusText}: ${detail}`);
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type TestCase = {
  id: string;
  name: string;
  goal: string;
  preconditions: string[];
  steps: string[];
  expected_outcomes: string[];
  failure_signals: string[];
  priority: string;
  tags: string[];
};

export type TestResult = {
  test_case_id: string;
  status: "pass" | "fail" | "flaky" | "blocked";
  severity: "low" | "medium" | "high";
  confidence: number;
  failed_step: string | null;
  expected: string;
  actual: string;
  repro_steps: string[];
  evidence: string[];
  suspected_issue: string;
  business_impact: string;
  agent_trace: string;
  summary: string;
};

export type SseEvent = {
  type:
    | "run_started"
    | "case_started"
    | "case_completed"
    | "run_completed"
    | "done"
    | string;
  data: Record<string, unknown>;
};

export type ChatMessage = {
  role: "user" | "agent" | "system";
  text: string;
  imageUrl?: string;
  videoUrl?: string;
  runId?: string;
};

export type RunResults = {
  run_id: string;
  url: string;
  requirement_text: string;
  status: string;
  viewport: string;
  created_at: string;
  results: TestResult[];
  test_cases: TestCase[];
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export async function generateTests(body: {
  url: string;
  requirement_text: string;
  max_cases?: number;
}): Promise<{ test_cases: TestCase[] }> {
  const r = await fetch(`${getApiBase()}/generate-tests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: body.url,
      requirement_text: body.requirement_text,
      max_cases: body.max_cases ?? 5,
    }),
  });
  if (!r.ok) throw await httpError(r);
  return r.json();
}

export async function runSuite(body: {
  url: string;
  requirement_text: string;
  test_cases?: TestCase[];
  max_cases?: number;
  viewport: "desktop" | "mobile";
}): Promise<{ run_id: string; message: string }> {
  const r = await fetch(`${getApiBase()}/run-suite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw await httpError(r);
  return r.json();
}

export async function getResults(runId: string): Promise<RunResults> {
  const r = await fetch(`${getApiBase()}/results/${runId}`);
  if (!r.ok) throw await httpError(r);
  return r.json();
}

export async function listRuns(): Promise<
  { run_id: string; url: string; status: string; created_at: string; requirement_text: string }[]
> {
  const r = await fetch(`${getApiBase()}/runs`);
  if (!r.ok) throw await httpError(r);
  return r.json();
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

export type DomainStat = {
  domain: string;
  runs: number;
  pass: number;
  fail: number;
  blocked: number;
  flaky: number;
  total: number;
  pass_rate: number;
  avg_confidence: number;
};

export type RecentRun = {
  run_id: string;
  domain: string;
  url: string;
  status: string;
  created_at: string;
  pass: number;
  fail: number;
  blocked: number;
  flaky: number;
};

export type StatsData = {
  total_runs: number;
  total_cases: number;
  overall: { pass: number; fail: number; blocked: number; flaky: number };
  by_severity: { high: number; medium: number; low: number };
  by_domain: DomainStat[];
  recent_runs: RecentRun[];
};

export async function getStats(): Promise<StatsData> {
  const r = await fetch(`${getApiBase()}/stats`);
  if (!r.ok) throw await httpError(r);
  return r.json() as Promise<StatsData>;
}

export async function rerunFailed(runId: string): Promise<{ run_id: string; message: string }> {
  const r = await fetch(`${getApiBase()}/rerun-failed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_id: runId }),
  });
  if (!r.ok) throw await httpError(r);
  return r.json();
}

export function fileUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${getApiBase()}${path.startsWith("/") ? path : `/${path}`}`;
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

/**
 * Subscribe to live events for a run via EventSource (GET /stream/{runId}).
 * Returns a cleanup function — call it from useEffect's return.
 */
export function streamRunEvents(
  runId: string,
  onEvent: (e: SseEvent) => void,
  onClose: () => void,
): () => void {
  const source = new EventSource(`/api/qa/stream/${runId}`);
  source.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as SseEvent;
      onEvent(event);
      if (event.type === "done") {
        onClose();
        source.close();
      }
    } catch {
      /* ignore malformed frames */
    }
  };
  source.onerror = () => {
    onClose();
    source.close();
  };
  return () => source.close();
}

/**
 * Parse raw SSE text chunks (possibly containing multiple events) into SseEvent[].
 * Used when consuming a POST streaming response with fetch + ReadableStream.
 */
export function parseSseChunk(chunk: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of chunk.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) {
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          events.push(JSON.parse(raw) as SseEvent);
        } catch {
          /* skip */
        }
      }
    }
  }
  return events;
}

/**
 * Ask a question about an existing completed/in-progress run.
 * No new browser execution — pure Gemini Q&A over collected results.
 */
export async function discussRun(
  runId: string,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const r = await fetch(`${getApiBase()}/discuss`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_id: runId, messages }),
  });
  if (!r.ok) throw await httpError(r);
  const data = (await r.json()) as { reply: string };
  return data.reply;
}

/**
 * Start a /chat-run POST and return a streaming body + abort controller.
 * The caller must read response.body with a ReadableStream reader.
 */
export function chatRun(body: {
  url: string;
  requirement_text: string;
  viewport: "desktop" | "mobile";
}): { bodyPromise: Promise<ReadableStream<Uint8Array> | null>; controller: AbortController } {
  const controller = new AbortController();
  const bodyPromise = fetch("/api/qa/chat-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).then((r) => r.body);
  return { bodyPromise, controller };
}
