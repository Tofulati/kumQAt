"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  generateTests,
  listRuns,
  runSuite,
  type TestCase,
} from "@/lib/api";

export default function Home() {
  const [url, setUrl] = useState("https://example.com");
  const [requirement, setRequirement] = useState(
    "Smoke test: page loads, primary content visible, no obvious errors.",
  );
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [cases, setCases] = useState<TestCase[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<
    { run_id: string; url: string; status: string; created_at: string }[]
  >([]);

  const refreshRuns = useCallback(async () => {
    try {
      const rows = await listRuns();
      setRecent(rows);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  const onGenerate = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await generateTests({
        url: url.trim(),
        requirement_text: requirement,
        max_cases: 5,
      });
      setCases(res.test_cases);
      const sel: Record<string, boolean> = {};
      for (const c of res.test_cases) sel[c.id] = true;
      setSelected(sel);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setLoading(false);
    }
  };

  const onRun = async () => {
    setError(null);
    setLoading(true);
    try {
      const chosen = cases.filter((c) => selected[c.id]);
      const toRun =
        chosen.length > 0 ? chosen : cases.length > 0 ? cases : undefined;
      const res = await runSuite({
        url: url.trim(),
        requirement_text: requirement,
        test_cases: toRun,
        max_cases: 5,
        viewport,
      });
      window.location.href = `/runs/${res.run_id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-[0.2em] text-violet-400">
            DiamondHacks · AI QA Engineer
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">
            Requirements → browser runs → bug reports
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-zinc-400">
            Requests use the Next.js proxy at{" "}
            <code className="rounded bg-zinc-900 px-1">/api/qa/*</code> → FastAPI (default{" "}
            <code className="rounded bg-zinc-900 px-1">http://127.0.0.1:8000</code>). Override with{" "}
            <code className="rounded bg-zinc-900 px-1">QA_API_URL</code> in{" "}
            <code className="rounded bg-zinc-900 px-1">apps/web/.env.local</code> if needed.
            Optional: <code className="rounded bg-zinc-900 px-1">OPENAI_API_KEY</code> for smarter
            plans/validation; <code className="rounded bg-zinc-900 px-1">BROWSER_USE_API_KEY</code> in{" "}
            <code className="rounded bg-zinc-900 px-1">apps/api/.env</code> for Browser Use agents.
          </p>
        </header>

        <section className="space-y-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-xl">
          <label className="block text-sm font-medium text-zinc-300">
            Target URL
            <input
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-violet-500"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>

          <label className="block text-sm font-medium text-zinc-300">
            Feature / requirement to test
            <textarea
              rows={5}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
            />
          </label>

          <div className="flex flex-wrap gap-4">
            <label className="text-sm text-zinc-300">
              Viewport{" "}
              <select
                className="ml-2 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-white"
                value={viewport}
                onChange={(e) => setViewport(e.target.value as "desktop" | "mobile")}
              >
                <option value="desktop">Desktop</option>
                <option value="mobile">Mobile</option>
              </select>
            </label>
          </div>

          {error && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={loading}
              onClick={() => void onGenerate()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              Generate test cases
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void onRun()}
              className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              Run suite
            </button>
          </div>

          {cases.length > 0 && (
            <div className="border-t border-zinc-800 pt-6">
              <h2 className="text-sm font-semibold text-zinc-200">Generated cases</h2>
              <ul className="mt-3 space-y-3">
                {cases.map((c) => (
                  <li
                    key={c.id}
                    className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!!selected[c.id]}
                      onChange={(e) =>
                        setSelected((s) => ({ ...s, [c.id]: e.target.checked }))
                      }
                    />
                    <div>
                      <div className="font-medium text-white">{c.name}</div>
                      <div className="text-xs text-zinc-500">{c.id}</div>
                      <p className="mt-1 text-sm text-zinc-400">{c.goal}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-zinc-500">
                Uncheck cases to skip. If none are checked, all generated cases run.
              </p>
            </div>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold text-zinc-300">Recent runs</h2>
          <ul className="mt-3 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {recent.length === 0 && (
              <li className="px-4 py-6 text-sm text-zinc-500">No runs yet.</li>
            )}
            {recent.map((r) => (
              <li key={r.run_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <Link
                    href={`/runs/${r.run_id}`}
                    className="font-mono text-sm text-violet-400 hover:underline"
                  >
                    {r.run_id.slice(0, 8)}…
                  </Link>
                  <div className="text-xs text-zinc-500">{r.url}</div>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    r.status === "completed"
                      ? "bg-emerald-950 text-emerald-300"
                      : r.status === "running"
                        ? "bg-amber-950 text-amber-200"
                        : "bg-zinc-800 text-zinc-300"
                  }`}
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
