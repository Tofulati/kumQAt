"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Clock, TriangleAlert, X } from "lucide-react";
import { createSchedule, generateTests, listRuns, runSuite, type ScheduleInterval, type TestCase } from "@/lib/api";
import { showToast } from "@/app/components/Toast";

const PRIORITY_STYLES: Record<string, string> = {
  P0: "bg-rose-950 text-rose-300 border-rose-800",
  P1: "bg-amber-950 text-amber-200 border-amber-800",
  P2: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

export default function NewRunPage() {
  const [url, setUrl] = useState("https://example.com");
  const [requirement, setRequirement] = useState(
    "Smoke test: page loads, primary content visible, no obvious errors.",
  );
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [cases, setCases] = useState<TestCase[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRunModal, setShowRunModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
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

  const normalizeUrl = (raw: string) => {
    const trimmed = raw.trim();
    return trimmed && !trimmed.includes("://") ? `https://${trimmed}` : trimmed;
  };

  const onGenerate = async () => {
    setError(null);
    setLoading(true);
    const normalizedUrl = normalizeUrl(url);
    setUrl(normalizedUrl);
    try {
      const res = await generateTests({
        url: normalizedUrl,
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
    const normalizedUrl = normalizeUrl(url);
    setUrl(normalizedUrl);
    try {
      const chosen = cases.filter((c) => selected[c.id]);
      const toRun =
        chosen.length > 0 ? chosen : cases.length > 0 ? cases : undefined;
      const res = await runSuite({
        url: normalizedUrl,
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

  const onSchedule = async (interval: ScheduleInterval) => {
    const normalizedUrl = normalizeUrl(url);
    setUrl(normalizedUrl);
    try {
      const res = await createSchedule({
        url: normalizedUrl,
        requirement_text: requirement,
        viewport,
        interval,
      });
      showToast(
        `Scheduled ${interval} run for ${normalizedUrl}. First run: ${new Date(res.next_run_at).toLocaleString()}.`,
        "success",
      );
      void refreshRuns();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Schedule failed";
      showToast(msg, "error");
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="mx-auto max-w-5xl px-4 py-12">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">New test run</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Enter a URL and describe what to test. Generate AI test cases, review them, then run.
          </p>
        </div>

        <section className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
          <div>
            <label className="block text-sm font-medium text-zinc-300" htmlFor="url-input">
              Target URL
            </label>
            <input
              id="url-input"
              className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300" htmlFor="req-input">
              Feature / requirement to test
            </label>
            <textarea
              id="req-input"
              rows={4}
              className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-zinc-300" htmlFor="viewport-select">
              Viewport
            </label>
            <select
              id="viewport-select"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white outline-none focus:border-violet-500"
              value={viewport}
              onChange={(e) => setViewport(e.target.value as "desktop" | "mobile")}
            >
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>
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
              {loading ? "Working..." : "Generate test cases"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setShowRunModal(true)}
              className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              Run suite
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setShowScheduleModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-violet-800/60 bg-violet-950/40 px-4 py-2 text-sm font-medium text-violet-300 hover:bg-violet-950/70 disabled:opacity-50"
            >
              <Clock size={14} />
              Schedule
            </button>
          </div>

          {cases.length > 0 && (
            <div className="border-t border-zinc-800 pt-5">
              <h2 className="text-sm font-semibold text-zinc-200">Generated test cases</h2>
              <ul className="mt-3 space-y-3">
                {cases.map((c) => {
                  const priorityStyle = PRIORITY_STYLES[c.priority] ?? PRIORITY_STYLES.P2;
                  return (
                    <li key={c.id} className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={!!selected[c.id]}
                        onChange={(e) =>
                          setSelected((s) => ({ ...s, [c.id]: e.target.checked }))
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-white">{c.name}</span>
                          {c.priority && (
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${priorityStyle}`}>
                              {c.priority}
                            </span>
                          )}
                          {c.tags?.map((tag) => (
                            <span key={tag} className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                              {tag}
                            </span>
                          ))}
                        </div>
                        {c.goal && <p className="mt-1 text-xs text-zinc-500">{c.goal}</p>}
                        {c.steps && c.steps.length > 0 && (
                          <ol className="mt-1.5 list-inside list-decimal space-y-0.5">
                            {c.steps.slice(0, 3).map((s, i) => (
                              <li key={i} className="text-xs text-zinc-400">{s}</li>
                            ))}
                            {c.steps.length > 3 && (
                              <li className="text-xs text-zinc-600">+{c.steps.length - 3} more steps</li>
                            )}
                          </ol>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-zinc-500">
                Uncheck cases to skip. If none are checked, all generated cases run.
              </p>
            </div>
          )}
        </section>

        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300">Recent runs</h2>
            <Link href="/runs" className="flex items-center gap-1 text-xs text-violet-400 hover:underline">
              View all
              <ArrowRight size={12} />
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {recent.length === 0 && (
              <li className="px-4 py-6 text-sm text-zinc-500">No runs yet.</li>
            )}
            {recent.slice(0, 5).map((r) => (
              <li key={r.run_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <Link href={`/runs/${r.run_id}`} className="font-mono text-sm text-violet-400 hover:underline">
                    {r.run_id.slice(0, 8)}
                  </Link>
                  <div className="text-xs text-zinc-500">{r.url}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  r.status === "completed"
                    ? "bg-emerald-950 text-emerald-300"
                    : r.status === "running"
                      ? "bg-amber-950 text-amber-200"
                      : "bg-zinc-800 text-zinc-400"
                }`}>
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {showRunModal && (
        <RunModal
          onConfirm={() => { setShowRunModal(false); void onRun(); }}
          onCancel={() => setShowRunModal(false)}
        />
      )}

      {showScheduleModal && (
        <ScheduleModal
          onConfirm={(interval) => { setShowScheduleModal(false); void onSchedule(interval); }}
          onCancel={() => setShowScheduleModal(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run suite confirmation modal
// ---------------------------------------------------------------------------

function RunModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmed = typed === "run suite";

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-start justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-950 text-amber-400">
              <TriangleAlert size={16} />
            </div>
            <h2 className="text-base font-semibold text-white">Confirm Run Suite</h2>
          </div>
          <button type="button" onClick={onCancel} className="ml-4 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <p className="text-sm text-zinc-300">
            Please type{" "}
            <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-violet-300">run suite</code>{" "}
            to confirm you want to launch a full browser test run against the target URL.
          </p>
          <p className="text-sm text-zinc-500">
            This will open a real browser, execute each test case using the Browser Use Cloud agent, and may consume API credits.
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400" htmlFor="confirm-input">
              Type to confirm
            </label>
            <input
              id="confirm-input"
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && confirmed) onConfirm(); }}
              placeholder="run suite"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-zinc-800 px-6 py-4">
          <button type="button" onClick={onCancel} className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={!confirmed} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
            Confirm run
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule modal
// ---------------------------------------------------------------------------

const INTERVALS: { value: ScheduleInterval; label: string; desc: string }[] = [
  { value: "hourly", label: "Hourly",  desc: "Run every 60 minutes" },
  { value: "daily",  label: "Daily",   desc: "Run once every 24 hours" },
  { value: "weekly", label: "Weekly",  desc: "Run once every 7 days" },
];

function ScheduleModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (interval: ScheduleInterval) => void;
  onCancel: () => void;
}) {
  const [interval, setInterval] = useState<ScheduleInterval>("daily");
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmed = typed === "schedule";

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-start justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-950 text-violet-400">
              <Clock size={16} />
            </div>
            <h2 className="text-base font-semibold text-white">Schedule Recurring Run</h2>
          </div>
          <button type="button" onClick={onCancel} className="ml-4 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <p className="text-sm text-zinc-400">
            Set this test suite to run automatically at a fixed interval using the Browser Use Cloud agent. Runs fire in the background and appear in your Results history.
          </p>

          <div>
            <p className="mb-2 text-xs font-medium text-zinc-400">Run frequency</p>
            <div className="grid grid-cols-3 gap-2">
              {INTERVALS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setInterval(opt.value)}
                  className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                    interval === opt.value
                      ? "border-violet-600 bg-violet-950/60 text-violet-300"
                      : "border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                >
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="mt-0.5 text-xs opacity-70">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400" htmlFor="schedule-confirm-input">
              Type <span className="font-mono text-violet-300">schedule</span> to confirm
            </label>
            <input
              id="schedule-confirm-input"
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && confirmed) onConfirm(interval); }}
              placeholder="schedule"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-zinc-800 px-6 py-4">
          <button type="button" onClick={onCancel} className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(interval)}
            disabled={!confirmed}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Clock size={14} />
            Create schedule
          </button>
        </div>
      </div>
    </div>
  );
}
