"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlusCircle, RefreshCw, ExternalLink } from "lucide-react";
import { getStats, type StatsData, type DomainStat, type RecentRun } from "@/lib/api";

// ---------------------------------------------------------------------------
// Colour tokens (match site palette)
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, string> = {
  pass:    "#10b981", // emerald-500
  fail:    "#ef4444", // red-500
  blocked: "#f59e0b", // amber-500
  flaky:   "#38bdf8", // sky-400
};

const STATUS_LABEL: Record<string, string> = {
  pass: "Pass", fail: "Fail", blocked: "Blocked", flaky: "Flaky",
};

const STATUS_TEXT: Record<string, string> = {
  pass: "text-emerald-400", fail: "text-red-400",
  blocked: "text-amber-300", flaky: "text-sky-300",
};

const STATUS_BG: Record<string, string> = {
  pass: "bg-emerald-500", fail: "bg-red-500",
  blocked: "bg-amber-500", flaky: "bg-sky-400",
};

const SEV_COLOR = { high: "#ef4444", medium: "#f59e0b", low: "#71717a" };
const SEV_TEXT  = { high: "text-red-400", medium: "text-amber-300", low: "text-zinc-400" };

// ---------------------------------------------------------------------------
// Donut chart (pure SVG)
// ---------------------------------------------------------------------------

function DonutChart({
  pass, fail, blocked, flaky,
}: {
  pass: number; fail: number; blocked: number; flaky: number;
}) {
  const total = pass + fail + blocked + flaky;
  const SIZE = 180;
  const R = 64;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const C = 2 * Math.PI * R;

  const segments = [
    { key: "pass",    value: pass,    color: STATUS_COLOR.pass },
    { key: "fail",    value: fail,    color: STATUS_COLOR.fail },
    { key: "blocked", value: blocked, color: STATUS_COLOR.blocked },
    { key: "flaky",   value: flaky,   color: STATUS_COLOR.flaky },
  ].filter((s) => s.value > 0);

  let cumulative = 0;
  const passRate = total > 0 ? Math.round((pass / total) * 100) : 0;

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-label="Status distribution donut chart">
      {/* Track */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#27272a" strokeWidth={20} />

      {total === 0 ? (
        <text x={cx} y={cy + 5} textAnchor="middle" fill="#52525b" fontSize="13" fontFamily="ui-sans-serif,system-ui,sans-serif">
          No data
        </text>
      ) : (
        <>
          {segments.map((seg) => {
            const len = (seg.value / total) * C;
            // Small gap between segments for visual separation
            const gapLen = segments.length > 1 ? Math.min(4, len * 0.08) : 0;
            const visLen = len - gapLen;
            const offset = C - cumulative;
            cumulative += len;
            return (
              <circle
                key={seg.key}
                cx={cx} cy={cy} r={R}
                fill="none"
                stroke={seg.color}
                strokeWidth={20}
                strokeDasharray={`${visLen} ${C}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            );
          })}
          {/* Centre: pass rate */}
          <text x={cx} y={cy - 8} textAnchor="middle" fill="white" fontSize="26" fontWeight="700" fontFamily="ui-sans-serif,system-ui,sans-serif">
            {passRate}%
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle" fill="#71717a" fontSize="11" fontFamily="ui-sans-serif,system-ui,sans-serif">
            pass rate
          </text>
          <text x={cx} y={cy + 28} textAnchor="middle" fill="#52525b" fontSize="10" fontFamily="ui-sans-serif,system-ui,sans-serif">
            {total} tests
          </text>
        </>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stacked bar (CSS, normalised to 100%)
// ---------------------------------------------------------------------------

function StackedBar({ pass, fail, blocked, flaky, total }: {
  pass: number; fail: number; blocked: number; flaky: number; total: number;
}) {
  if (total === 0) return <div className="h-2.5 w-full rounded-full bg-zinc-800" />;
  const segs = [
    { key: "pass",    value: pass,    color: "bg-emerald-500" },
    { key: "fail",    value: fail,    color: "bg-red-500" },
    { key: "blocked", value: blocked, color: "bg-amber-500" },
    { key: "flaky",   value: flaky,   color: "bg-sky-400" },
  ];
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
      {segs.map((s) =>
        s.value > 0 ? (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal severity bar
// ---------------------------------------------------------------------------

function SeverityBar({ label, value, max, color, textColor }: {
  label: string; value: number; max: number; color: string; textColor: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-4">
      <span className={`w-16 shrink-0 text-xs font-medium ${textColor}`}>{label}</span>
      <div className="flex-1 h-2.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-xs text-zinc-400">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-5 py-5">
      <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-extrabold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-600">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-sm text-zinc-500">No test runs yet. Run a test suite to see your dashboard.</p>
      <Link
        href="/new-run"
        className="mt-4 flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-violet-600 px-5 py-2 text-sm font-semibold text-white"
      >
        <PlusCircle size={14} />
        Create a run
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const d = await getStats();
      setData(d);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stats");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // Derived values
  const overall  = data?.overall  ?? { pass: 0, fail: 0, blocked: 0, flaky: 0 };
  const severity = data?.by_severity ?? { high: 0, medium: 0, low: 0 };
  const totalCases = data?.total_cases ?? 0;
  const passRate = totalCases > 0
    ? Math.round((overall.pass / totalCases) * 100)
    : 0;
  const maxSev = Math.max(severity.high, severity.medium, severity.low, 1);

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-12">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Quality metrics across all test runs
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {lastRefreshed
              ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Refresh"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-6 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="mt-8 space-y-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="h-72 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
              <div className="h-72 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && data?.total_runs === 0 && <EmptyState />}

        {/* Dashboard content */}
        {!loading && data && data.total_runs > 0 && (
          <div className="mt-8 space-y-6">

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                label="Total runs"
                value={String(data.total_runs)}
                sub="all time"
              />
              <StatCard
                label="Tests executed"
                value={String(totalCases)}
                sub="cases across all runs"
              />
              <StatCard
                label="Pass rate"
                value={`${passRate}%`}
                sub={`${overall.pass} of ${totalCases} passed`}
              />
              <StatCard
                label="Sites tested"
                value={String(data.by_domain.length)}
                sub="unique domains"
              />
            </div>

            {/* Donut + Domain breakdown */}
            <div className="grid gap-4 lg:grid-cols-2">

              {/* Status distribution */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Status distribution
                </p>
                <div className="mt-6 flex items-center gap-8">
                  <DonutChart {...overall} />
                  <div className="space-y-3">
                    {(["pass", "fail", "blocked", "flaky"] as const).map((s) => (
                      <div key={s} className="flex items-center gap-3">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: STATUS_COLOR[s] }}
                        />
                        <span className="text-sm text-zinc-400 w-16">{STATUS_LABEL[s]}</span>
                        <span className={`text-sm font-semibold tabular-nums ${STATUS_TEXT[s]}`}>
                          {overall[s]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* By domain */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Results by site
                </p>
                {data.by_domain.length === 0 ? (
                  <p className="mt-6 text-sm text-zinc-600">No domain data.</p>
                ) : (
                  <div className="mt-5 space-y-5">
                    {data.by_domain.slice(0, 6).map((d) => (
                      <DomainRow key={d.domain} d={d} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Severity + Recent runs */}
            <div className="grid gap-4 lg:grid-cols-2">

              {/* Severity */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Severity breakdown
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  Across all failed and flaky cases
                </p>
                <div className="mt-6 space-y-4">
                  <SeverityBar
                    label="High"
                    value={severity.high}
                    max={maxSev}
                    color={SEV_COLOR.high}
                    textColor={SEV_TEXT.high}
                  />
                  <SeverityBar
                    label="Medium"
                    value={severity.medium}
                    max={maxSev}
                    color={SEV_COLOR.medium}
                    textColor={SEV_TEXT.medium}
                  />
                  <SeverityBar
                    label="Low"
                    value={severity.low}
                    max={maxSev}
                    color={SEV_COLOR.low}
                    textColor={SEV_TEXT.low}
                  />
                </div>

                {/* Severity legend */}
                <div className="mt-6 space-y-2 border-t border-zinc-800 pt-4">
                  {[
                    { key: "high",   label: "High",   desc: "Likely blocks users completely" },
                    { key: "medium", label: "Medium", desc: "Degrades experience" },
                    { key: "low",    label: "Low",    desc: "Minor or cosmetic" },
                  ].map(({ key, label, desc }) => (
                    <div key={key} className="flex items-baseline gap-2">
                      <span className={`text-xs font-medium ${SEV_TEXT[key as keyof typeof SEV_TEXT]}`}>
                        {label}
                      </span>
                      <span className="text-xs text-zinc-600">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent runs */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                    Recent runs
                  </p>
                  <Link
                    href="/runs"
                    className="text-xs text-violet-400 hover:underline"
                  >
                    View all
                  </Link>
                </div>
                <div className="mt-4 space-y-1">
                  {data.recent_runs.map((r) => (
                    <RecentRunRow key={r.run_id} r={r} />
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DomainRow({ d }: { d: DomainStat }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="truncate text-xs font-medium text-zinc-300">{d.domain}</span>
        <div className="flex shrink-0 items-center gap-3 text-xs text-zinc-500">
          <span>{d.runs} {d.runs === 1 ? "run" : "runs"}</span>
          <span className="font-semibold text-zinc-300">
            {Math.round(d.pass_rate * 100)}% pass
          </span>
        </div>
      </div>
      <StackedBar
        pass={d.pass}
        fail={d.fail}
        blocked={d.blocked}
        flaky={d.flaky}
        total={d.total}
      />
      <div className="mt-1.5 flex gap-3 text-xs text-zinc-600">
        {(["pass", "fail", "blocked", "flaky"] as const).map((s) =>
          d[s] > 0 ? (
            <span key={s} className={STATUS_TEXT[s]}>
              {d[s]} {STATUS_LABEL[s].toLowerCase()}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

function RecentRunRow({ r }: { r: RecentRun }) {
  const total = r.pass + r.fail + r.blocked + r.flaky;
  const date = r.created_at
    ? new Date(r.created_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <Link
      href={`/runs/${r.run_id}`}
      className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-zinc-800/60"
    >
      {/* Status dot */}
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{
          backgroundColor:
            r.status === "completed"
              ? STATUS_COLOR.pass
              : r.status === "running"
                ? "#f59e0b"
                : "#52525b",
        }}
      />

      {/* Domain + ID */}
      <div className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-zinc-300">
          {r.domain}
        </span>
        <span className="font-mono text-xs text-zinc-600">
          {r.run_id.slice(0, 8)}
        </span>
      </div>

      {/* Mini result pills */}
      {total > 0 && (
        <div className="flex shrink-0 gap-1.5 text-xs">
          {(["pass", "fail", "blocked", "flaky"] as const).map((s) =>
            r[s] > 0 ? (
              <span key={s} className={`font-medium tabular-nums ${STATUS_TEXT[s]}`}>
                {r[s]}
              </span>
            ) : null,
          )}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1 text-xs text-zinc-600">
        <span>{date}</span>
        <ExternalLink size={11} className="opacity-40" />
      </div>
    </Link>
  );
}
