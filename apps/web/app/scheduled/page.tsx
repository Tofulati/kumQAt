"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Clock, ExternalLink, PlusCircle, RefreshCw, Trash2 } from "lucide-react";
import { deleteSchedule, listSchedules, type Schedule } from "@/lib/api";
import { showToast } from "@/app/components/Toast";

const INTERVAL_LABEL: Record<string, string> = {
  hourly: "Every hour",
  daily:  "Every day",
  weekly: "Every week",
};

const INTERVAL_COLOR: Record<string, string> = {
  hourly: "bg-amber-950 text-amber-300 border-amber-800",
  daily:  "bg-violet-950 text-violet-300 border-violet-800",
  weekly: "bg-sky-950 text-sky-300 border-sky-800",
};

function formatNext(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return "due now";
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 60) return `in ${diffMins}m`;
  const diffHours = Math.round(diffMs / 3600000);
  if (diffHours < 24) return `in ${diffHours}h`;
  return `in ${Math.round(diffMs / 86400000)}d`;
}

export default function ScheduledPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setSchedules(await listSchedules());
    } catch {
      showToast("Could not load schedules.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const onDelete = async (id: string) => {
    setDeleting(id);
    try {
      await deleteSchedule(id);
      setSchedules((s) => s.filter((x) => x.id !== id));
      showToast("Schedule deleted.", "success");
    } catch {
      showToast("Failed to delete schedule.", "error");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="mx-auto max-w-5xl px-4 py-12">

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Scheduled runs</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Recurring Browser Use test suites that fire automatically.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <Link
              href="/new-run"
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-violet-600 px-4 py-2 text-sm font-semibold text-white hover:from-amber-300 hover:to-violet-500"
            >
              <PlusCircle size={14} />
              New schedule
            </Link>
          </div>
        </div>

        <div className="mt-8">
          {loading && (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
              ))}
            </div>
          )}

          {!loading && schedules.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40 py-20 text-center">
              <Clock size={32} className="text-zinc-700" />
              <p className="mt-3 text-sm text-zinc-500">No scheduled runs yet.</p>
              <p className="mt-1 text-xs text-zinc-600">
                Create one from the New Run page using the Schedule button.
              </p>
              <Link
                href="/new-run"
                className="mt-5 flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-violet-600 px-5 py-2 text-sm font-semibold text-white"
              >
                <PlusCircle size={14} />
                Create a schedule
              </Link>
            </div>
          )}

          {!loading && schedules.length > 0 && (
            <div className="space-y-3">
              {schedules.map((s) => (
                <ScheduleCard
                  key={s.id}
                  schedule={s}
                  deleting={deleting === s.id}
                  onDelete={() => void onDelete(s.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule card
// ---------------------------------------------------------------------------

function ScheduleCard({
  schedule: s,
  deleting,
  onDelete,
}: {
  schedule: Schedule;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${INTERVAL_COLOR[s.interval] ?? "bg-zinc-800 text-zinc-400 border-zinc-700"}`}
            >
              {INTERVAL_LABEL[s.interval] ?? s.interval}
            </span>
            <span className="font-mono text-sm font-medium text-zinc-200 truncate">
              {s.url}
            </span>
          </div>

          <p className="mt-2 line-clamp-2 text-xs text-zinc-500">{s.requirement_text}</p>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-600">
            <span className="flex items-center gap-1">
              <Clock size={11} />
              Next run: <span className="text-zinc-400 ml-0.5">{formatNext(s.next_run_at)}</span>
            </span>
            <span>
              Viewport: <span className="text-zinc-400">{s.viewport}</span>
            </span>
            <span>
              Created:{" "}
              <span className="text-zinc-400">
                {new Date(s.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </span>
            {s.last_run_id && (
              <Link
                href={`/runs/${s.last_run_id}`}
                className="flex items-center gap-1 text-violet-500 hover:text-violet-400"
              >
                <ExternalLink size={11} />
                Last run
              </Link>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="shrink-0 rounded-lg border border-zinc-700 p-2 text-zinc-500 hover:border-red-800 hover:bg-red-950/40 hover:text-red-400 disabled:opacity-40"
          aria-label="Delete schedule"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
