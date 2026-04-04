"use client";

import { AlertTriangle } from "lucide-react";
import { fileUrl, type TestCase, type TestResult } from "@/lib/api";

const STATUS_STYLES: Record<string, string> = {
  pass: "bg-emerald-950 text-emerald-300 border-emerald-800",
  fail: "bg-red-950 text-red-300 border-red-800",
  blocked: "bg-amber-950 text-amber-200 border-amber-800",
  flaky: "bg-sky-950 text-sky-300 border-sky-800",
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
  pass: "All expected outcomes were met",
  fail: "One or more expected outcomes were not met",
  blocked: "Could not run: auth, CAPTCHA, or bot protection prevented access",
  flaky: "Result was inconsistent across attempts",
};

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-red-950/60 text-red-400",
  medium: "bg-amber-950/60 text-amber-300",
  low: "bg-zinc-800 text-zinc-400",
};

const SEVERITY_DESCRIPTIONS: Record<string, string> = {
  high: "Likely blocks users",
  medium: "Degrades experience",
  low: "Minor or cosmetic",
};

function Badge({ label, style, title }: { label: string; style: string; title?: string }) {
  return (
    <span
      title={title}
      className={`cursor-help rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}
    >
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

  const isProblem = result.status !== "pass";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white">{name}</span>
        <Badge
          label={result.status.toUpperCase()}
          style={statusStyle}
          title={STATUS_DESCRIPTIONS[result.status]}
        />
        <Badge
          label={`${result.severity} severity`}
          style={`rounded-full px-2 py-0.5 text-xs ${sevStyle}`}
          title={SEVERITY_DESCRIPTIONS[result.severity]}
        />
        <span className="ml-auto text-xs text-zinc-500">
          {Math.round(result.confidence * 100)}% confidence
        </span>
      </div>

      {/* Test goal */}
      {testCase?.goal && (
        <p className="mt-2 text-xs text-zinc-500">
          <span className="font-semibold uppercase tracking-wide text-zinc-600">Goal: </span>
          {testCase.goal}
        </p>
      )}

      {/* Steps tested */}
      {testCase?.steps && testCase.steps.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600">
            Steps tested
          </p>
          <ol className="list-decimal list-inside space-y-0.5">
            {testCase.steps.slice(0, 4).map((s, i) => (
              <li key={i} className="text-xs text-zinc-400">
                {s}
              </li>
            ))}
            {testCase.steps.length > 4 && (
              <li className="text-xs text-zinc-600">+{testCase.steps.length - 4} more</li>
            )}
          </ol>
        </div>
      )}

      {/* Expected vs Actual */}
      {(result.expected || result.actual) && (
        <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-zinc-950/50 p-3 text-xs">
          {result.expected && (
            <div>
              <p className="mb-0.5 font-semibold uppercase tracking-wide text-zinc-500">Expected</p>
              <p className="text-zinc-300">{result.expected}</p>
            </div>
          )}
          {result.actual && (
            <div>
              <p className="mb-0.5 font-semibold uppercase tracking-wide text-zinc-500">Actual</p>
              <p className={isProblem ? "text-red-300" : "text-zinc-300"}>{result.actual}</p>
            </div>
          )}
        </div>
      )}

      {/* Suspected issue */}
      {result.suspected_issue && (
        <div className="mt-3 flex gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
          <div>
            <p className="text-xs font-semibold text-amber-400">Suspected issue</p>
            <p className="mt-0.5 text-sm text-amber-200">{result.suspected_issue}</p>
          </div>
        </div>
      )}

      {/* Business impact */}
      {result.business_impact && (
        <p className="mt-2 text-xs text-zinc-500">
          <span className="font-semibold text-zinc-600">Impact: </span>
          {result.business_impact}
        </p>
      )}

      {/* Screenshots */}
      {pngEvidence.length > 0 && (
        <div className="mt-3 space-y-2">
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
        <div className="mt-3 space-y-2">
          {videoEvidence.map((v) => (
            <video key={v} controls className="w-full rounded-lg border border-zinc-700">
              <source src={fileUrl(v)} type="video/webm" />
            </video>
          ))}
        </div>
      )}

      {/* Repro steps + agent trace (collapsed) */}
      {(reproSteps.length > 0 || result.agent_trace) && (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-xs text-violet-400 hover:text-violet-300">
            Repro steps and agent trace
          </summary>

          <div className="mt-3 space-y-3">
            {reproSteps.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Repro steps
                </p>
                <ol className="list-decimal list-inside space-y-1">
                  {reproSteps.map((s, i) => (
                    <li key={i} className="text-sm text-zinc-400">
                      {s}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {result.agent_trace && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Agent trace
                </p>
                <pre className="max-h-64 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-3 text-xs text-zinc-500">
                  {result.agent_trace}
                </pre>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
