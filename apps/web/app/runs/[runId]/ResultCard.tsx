"use client";

import { fileUrl, type TestCase, type TestResult } from "@/lib/api";

const STATUS_STYLES: Record<string, string> = {
  pass: "bg-emerald-950 text-emerald-300 border-emerald-800",
  fail: "bg-red-950 text-red-300 border-red-800",
  blocked: "bg-amber-950 text-amber-200 border-amber-800",
  flaky: "bg-sky-950 text-sky-300 border-sky-800",
};

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-red-950/60 text-red-400",
  medium: "bg-amber-950/60 text-amber-300",
  low: "bg-zinc-800 text-zinc-400",
};

function Badge({ label, style }: { label: string; style: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}

type Props = {
  result: TestResult;
  testCase?: TestCase;
};

export default function ResultCard({ result, testCase }: Props) {
  const name = testCase?.name ?? result.test_case_id;
  const statusStyle = STATUS_STYLES[result.status] ?? "bg-zinc-800 text-zinc-300 border-zinc-700";
  const sevStyle = SEVERITY_STYLES[result.severity] ?? SEVERITY_STYLES.medium;

  const evidence = result.evidence ?? [];
  const reproSteps = result.repro_steps ?? [];
  const pngEvidence = evidence.filter((e) => e.endsWith(".png"));
  const videoEvidence = evidence.filter((e) => e.endsWith(".webm"));

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-white">{name}</span>
        <Badge label={result.status.toUpperCase()} style={statusStyle} />
        <Badge label={result.severity} style={`rounded-full px-2 py-0.5 text-xs ${sevStyle}`} />
        <span className="ml-auto text-xs text-zinc-500">
          {Math.round(result.confidence * 100)}% confidence
        </span>
      </div>

      {/* One-line summary */}
      {result.summary && (
        <p className="mt-2 text-sm text-zinc-400 line-clamp-2">{result.summary.split("\n")[0]}</p>
      )}

      {/* Expandable details */}
      <details className="mt-3 group">
        <summary className="cursor-pointer text-xs text-violet-400 hover:text-violet-300 select-none">
          View details ▾
        </summary>

        <div className="mt-3 space-y-4">
          {/* Screenshots */}
          {pngEvidence.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Screenshot</p>
              {pngEvidence.map((p) => (
                <img
                  key={p}
                  src={fileUrl(p)}
                  alt="viewport screenshot"
                  loading="lazy"
                  className="w-full rounded-lg border border-zinc-700"
                />
              ))}
            </div>
          )}

          {/* Video recordings */}
          {videoEvidence.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Recording</p>
              {videoEvidence.map((v) => (
                <video key={v} controls className="w-full rounded-lg border border-zinc-700">
                  <source src={fileUrl(v)} type="video/webm" />
                  Your browser does not support video playback.
                </video>
              ))}
            </div>
          )}

          {/* Expected vs Actual */}
          {(result.expected || result.actual) && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              {result.expected && (
                <div>
                  <p className="font-semibold text-zinc-500 uppercase tracking-wide mb-0.5">Expected</p>
                  <p className="text-zinc-300">{result.expected}</p>
                </div>
              )}
              {result.actual && (
                <div>
                  <p className="font-semibold text-zinc-500 uppercase tracking-wide mb-0.5">Actual</p>
                  <p className="text-zinc-300">{result.actual}</p>
                </div>
              )}
            </div>
          )}

          {/* Repro steps */}
          {reproSteps.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Repro steps</p>
              <ol className="list-decimal list-inside space-y-1">
                {reproSteps.map((s, i) => (
                  <li key={i} className="text-sm text-zinc-400">{s}</li>
                ))}
              </ol>
            </div>
          )}

          {/* Suspected issue callout */}
          {result.suspected_issue && (
            <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2">
              <p className="text-xs font-semibold text-amber-400 mb-0.5">Suspected issue</p>
              <p className="text-sm text-amber-200">{result.suspected_issue}</p>
            </div>
          )}

          {/* Business impact */}
          {result.business_impact && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-0.5">Business impact</p>
              <p className="text-sm text-zinc-400">{result.business_impact}</p>
            </div>
          )}

          {/* Agent trace */}
          {result.agent_trace && (
            <details>
              <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-400 select-none">
                Agent trace ▾
              </summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-950 p-3 text-xs text-zinc-500 overflow-x-auto max-h-64 overflow-y-auto">
                {result.agent_trace}
              </pre>
            </details>
          )}
        </div>
      </details>
    </div>
  );
}
