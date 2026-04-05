"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastKind = "error" | "warning" | "success" | "info";

type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

// ---------------------------------------------------------------------------
// Module-level pub/sub — any component can call showToast() without context
// ---------------------------------------------------------------------------

type Listener = (item: Omit<ToastItem, "id">) => void;
const _listeners = new Set<Listener>();

export function showToast(message: string, kind: ToastKind = "info") {
  _listeners.forEach((l) => l({ kind, message }));
}

// ---------------------------------------------------------------------------
// ToastContainer — mount once in layout, renders nothing until toasts exist
// ---------------------------------------------------------------------------

const KIND_STYLES: Record<ToastKind, string> = {
  error:   "border-red-800   bg-red-950   text-red-200",
  warning: "border-amber-800 bg-amber-950 text-amber-200",
  success: "border-emerald-800 bg-emerald-950 text-emerald-200",
  info:    "border-zinc-700  bg-zinc-900  text-zinc-200",
};

const KIND_ICONS: Record<ToastKind, React.ReactNode> = {
  error:   <XCircle      size={16} className="shrink-0 text-red-400" />,
  warning: <AlertTriangle size={16} className="shrink-0 text-amber-400" />,
  success: <CheckCircle  size={16} className="shrink-0 text-emerald-400" />,
  info:    <Info         size={16} className="shrink-0 text-zinc-400" />,
};

const AUTO_DISMISS_MS = 7000;

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  useEffect(() => {
    const handler: Listener = ({ kind, message }) => {
      const id = ++counterRef.current;
      setToasts((prev) => [...prev, { id, kind, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, AUTO_DISMISS_MS);
    };
    _listeners.add(handler);
    return () => {
      _listeners.delete(handler);
    };
  }, []);

  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-xl text-sm max-w-sm ${KIND_STYLES[t.kind]}`}
        >
          {KIND_ICONS[t.kind]}
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
