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

export type RunResults = {
  run_id: string;
  url: string;
  requirement_text: string;
  status: string;
  viewport: string;
  created_at: string;
  results: Record<string, unknown>[];
  test_cases: TestCase[];
};

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
