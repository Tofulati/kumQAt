"use client";

import { Check } from "lucide-react";
import type { TestResult } from "@/lib/api";

type Props = {
  results: TestResult[];
  status: string;
  total: number;
};

export default function SummaryBar({ results, status, total }: Props) {
  const counts = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const pct = total > 0 ? Math.round((results.length / total) * 100) : 0;
  const done = status === "completed";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap gap-3">
        <Pill count={counts.pass ?? 0} label="Passed" color="emerald" />
        <Pill count={counts.fail ?? 0} label="Failed" color="red" />
        <Pill count={counts.blocked ?? 0} label="Blocked" color="amber" />
        <Pill count={counts.flaky ?? 0} label="Flaky" color="sky" />

        {done && (
          <span className="ml-auto flex items-center gap-1.5 text-sm text-emerald-400">
            <Check size={14} />
            Run complete
          </span>
        )}
      </div>

      {!done && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-zinc-500">
            <span>Running</span>
            <span>
              {results.length} / {total || "?"} cases
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: "emerald" | "red" | "amber" | "sky";
}) {
  const styles: Record<string, string> = {
    emerald: "bg-emerald-950 text-emerald-300 border-emerald-800",
    red: "bg-red-950 text-red-300 border-red-800",
    amber: "bg-amber-950 text-amber-200 border-amber-800",
    sky: "bg-sky-950 text-sky-300 border-sky-800",
  };
  return (
    <span className={`rounded-full border px-3 py-0.5 text-sm font-medium ${styles[color]}`}>
      {count} {label}
    </span>
  );
}
