"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fileUrl, getApiBase, getResults, rerunFailed, type RunResults } from "@/lib/api";

export default function RunPage() {
  const params = useParams();
  const runId = params.runId as string;
  const [data, setData] = useState<RunResults | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rerunBusy, setRerunBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await getResults(runId);
        if (!cancelled) {
          setData(r);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Load failed");
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [runId]);

  const onRerun = async () => {
    setRerunBusy(true);
    try {
      const r = await rerunFailed(runId);
      window.location.href = `/runs/${r.run_id}`;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Rerun failed");
    } finally {
      setRerunBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <Link href="/" className="text-sm text-violet-400 hover:underline">
          ← New run
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-white">Run {runId}</h1>
        {err && (
          <p className="mt-4 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {err}
          </p>
        )}
        {!data && !err && <p className="mt-6 text-zinc-500">Loading…</p>}
        {data && (
          <div className="mt-6 space-y-6">
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  data.status === "completed"
                    ? "bg-emerald-950 text-emerald-300"
                    : data.status === "running"
                      ? "bg-amber-950 text-amber-200"
                      : "bg-zinc-800 text-zinc-300"
                }`}
              >
                {data.status}
              </span>
              <span>{data.viewport}</span>
              <a
                className="font-mono text-violet-400 hover:underline"
                href={data.url}
                target="_blank"
                rel="noreferrer"
              >
                {data.url}
              </a>
              <a
                className="ml-auto text-zinc-500 hover:text-zinc-300"
                href={`${getApiBase()}/export/${data.run_id}.json`}
                target="_blank"
                rel="noreferrer"
              >
                Export JSON
              </a>
            </div>
            <p className="text-sm text-zinc-300">{data.requirement_text}</p>

            {data.status === "completed" && (
              <button
                type="button"
                disabled={rerunBusy}
                onClick={() => void onRerun()}
                className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                Re-run failed / flaky / blocked
              </button>
            )}

            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-900 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Case</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((row, i) => {
                    const r = row as Record<string, string | string[] | undefined>;
                    return (
                      <tr key={i} className="border-t border-zinc-800">
                        <td className="px-3 py-2 text-zinc-200">{r.test_case_id}</td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              r.status === "pass"
                                ? "text-emerald-400"
                                : r.status === "blocked"
                                  ? "text-amber-300"
                                  : "text-red-300"
                            }
                          >
                            {String(r.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-zinc-400">{String(r.severity)}</td>
                        <td className="px-3 py-2 text-zinc-400">
                          <pre className="whitespace-pre-wrap font-sans text-xs">
                            {String(r.summary || r.actual || "")}
                          </pre>
                          {Array.isArray(r.evidence) && r.evidence.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {r.evidence.map((ev, j) => (
                                <a
                                  key={j}
                                  href={fileUrl(String(ev))}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-violet-400 hover:underline"
                                >
                                  {String(ev).split("/").pop()}
                                </a>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {data.results.length === 0 && data.status !== "completed" && (
              <p className="text-sm text-zinc-500">Tests are executing… this page refreshes every 2.5s.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
