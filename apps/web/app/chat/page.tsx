"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  chatRun,
  discussRun,
  fileUrl,
  getResults,
  parseSseChunk,
  type ChatMessage,
  type RunResults,
  type SseEvent,
} from "@/lib/api";

// ─── helpers ────────────────────────────────────────────────────────────────

const STATUS_EMOJI: Record<string, string> = {
  pass: "✅",
  fail: "❌",
  blocked: "⚠️",
  flaky: "🔄",
};

function normalizeUrl(raw: string) {
  const t = raw.trim();
  return t && !t.includes("://") ? `https://${t}` : t;
}

// ─── component ──────────────────────────────────────────────────────────────

export default function ChatPage() {
  const searchParams = useSearchParams();

  // "discuss" mode = loaded from an existing run; "new-run" = start fresh
  const [mode, setMode] = useState<"discuss" | "new-run">("new-run");
  const [existingRun, setExistingRun] = useState<RunResults | null>(null);
  const [fromRunId, setFromRunId] = useState<string | null>(null);

  // New-run inputs
  const [url, setUrl] = useState("https://example.com");
  const [requirement, setRequirement] = useState(
    "Smoke test: page loads, primary content visible, no obvious errors.",
  );
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");

  // Shared chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);

  // Discuss-mode Q&A state
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  // conversation history for multi-turn context
  const discussHistory = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const cancelRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Load from_run on mount ────────────────────────────────────────────────
  useEffect(() => {
    const fromRun = searchParams.get("from_run");
    if (!fromRun) return;

    setFromRunId(fromRun);
    setMode("discuss");

    getResults(fromRun)
      .then((r) => {
        setExistingRun(r);
        setUrl(r.url);
        setRequirement(r.requirement_text);

        // Inject summary messages from existing results
        const initial: ChatMessage[] = [
          {
            role: "system",
            text: `📋 Loaded run ${fromRun.slice(0, 8)}… for ${r.url}\n${r.test_cases.length} test cases · status: ${r.status}`,
          },
        ];

        for (const result of r.results) {
          const tc = r.test_cases.find((c) => c.id === result.test_case_id);
          const name = tc?.name ?? result.test_case_id;
          const emoji = STATUS_EMOJI[result.status] ?? "•";
          const summary = (result.summary as string) ?? "";
          const png = (result.evidence as string[])?.find((e: string) => e.endsWith(".png"));
          const webm = (result.evidence as string[])?.find((e: string) => e.endsWith(".webm"));
          initial.push({
            role: "agent",
            text: `${emoji} **${name}** — ${result.status.toUpperCase()}\n${summary}`,
            imageUrl: png ? fileUrl(png) : undefined,
            videoUrl: webm ? fileUrl(webm) : undefined,
          });
        }

        initial.push({
          role: "system",
          text: "Ask me anything about these results — what failed, why, how to fix it, or request a re-run.",
        });

        setMessages(initial);
      })
      .catch(() => {
        setMode("new-run");
        pushMessage({ role: "system", text: "Could not load run — starting fresh." });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function pushMessage(msg: ChatMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  // ── Discuss Q&A ───────────────────────────────────────────────────────────
  const onAsk = async () => {
    if (asking || !question.trim() || !fromRunId) return;

    const userText = question.trim();
    setQuestion("");
    pushMessage({ role: "user", text: userText });
    discussHistory.current.push({ role: "user", content: userText });
    setAsking(true);

    try {
      const reply = await discussRun(fromRunId, discussHistory.current);
      discussHistory.current.push({ role: "assistant", content: reply });
      pushMessage({ role: "agent", text: reply });
    } catch (e) {
      pushMessage({ role: "system", text: `Error: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setAsking(false);
    }
  };

  // ── New run ───────────────────────────────────────────────────────────────
  const onRun = async () => {
    if (running) return;
    const finalUrl = normalizeUrl(url);
    const trimmedReq = requirement.trim();
    if (!finalUrl || !trimmedReq) return;

    setUrl(finalUrl);
    pushMessage({ role: "user", text: `Testing: ${trimmedReq}\n${finalUrl}` });
    setRunning(true);

    const { bodyPromise, controller } = chatRun({
      url: finalUrl,
      requirement_text: trimmedReq,
      viewport,
    });
    cancelRef.current = () => controller.abort();

    try {
      const body = await bodyPromise;
      if (!body) {
        pushMessage({ role: "system", text: "No response stream received." });
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          for (const event of parseSseChunk(block + "\n\n")) {
            handleSseEvent(event);
          }
        }
      }
      if (buffer.trim()) {
        for (const event of parseSseChunk(buffer)) handleSseEvent(event);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        pushMessage({ role: "system", text: `Error: ${e.message}` });
      }
    } finally {
      setRunning(false);
      cancelRef.current = null;
    }
  };

  function handleSseEvent(event: SseEvent) {
    switch (event.type) {
      case "run_started": {
        const total = event.data.total as number;
        pushMessage({ role: "system", text: `Starting — ${total} test case${total !== 1 ? "s" : ""} queued.` });
        break;
      }
      case "case_started": {
        const name = event.data.name as string;
        const idx = (event.data.index as number) + 1;
        pushMessage({ role: "agent", text: `▶ Running case ${idx}: ${name}` });
        break;
      }
      case "case_completed": {
        const status = event.data.status as string;
        const summary = (event.data.summary as string) ?? "";
        const evidence = (event.data.evidence as string[]) ?? [];
        const emoji = STATUS_EMOJI[status] ?? "•";
        const png = evidence.find((e) => e.endsWith(".png"));
        const webm = evidence.find((e) => e.endsWith(".webm"));
        pushMessage({
          role: "agent",
          text: `${emoji} ${summary.split("\n")[0] ?? summary}`,
          imageUrl: png ? fileUrl(png) : undefined,
          videoUrl: webm ? fileUrl(webm) : undefined,
        });
        break;
      }
      case "run_completed": {
        const runId = event.data.run_id as string;
        // Switch to discuss mode with the freshly-completed run
        setFromRunId(runId);
        setMode("discuss");
        discussHistory.current = [];
        pushMessage({
          role: "system",
          text: `Run complete. You can now ask questions about the results.`,
          runId,
        });
        // Reload results so discuss mode has full data
        getResults(runId)
          .then((r) => setExistingRun(r))
          .catch(() => {/* already shown in chat */});
        break;
      }
      default:
        break;
    }
  }

  const onStop = () => {
    cancelRef.current?.();
    pushMessage({ role: "system", text: "Stopped by user." });
    setRunning(false);
    cancelRef.current = null;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Top nav */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center gap-6 text-sm">
        <Link href="/" className="text-violet-400 hover:underline font-semibold">QABot</Link>
        <Link href="/" className="text-zinc-400 hover:text-zinc-200">Runs</Link>
        <span className="text-zinc-200 font-medium">Chat</span>
        {fromRunId && (
          <Link
            href={`/runs/${fromRunId}`}
            className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
          >
            ← Back to full results
          </Link>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden max-w-6xl w-full mx-auto px-4 py-6 gap-6">
        {/* Left panel */}
        <aside className="w-80 shrink-0 flex flex-col gap-4">
          {mode === "discuss" && existingRun ? (
            /* Discuss-mode sidebar */
            <>
              <div>
                <p className="text-xs uppercase tracking-widest text-violet-400 mb-1">
                  Analysing Run
                </p>
                <p className="font-mono text-xs text-zinc-400 break-all">{existingRun.url}</p>
                <p className="mt-1 text-xs text-zinc-500 italic line-clamp-3">
                  &ldquo;{existingRun.requirement_text}&rdquo;
                </p>
              </div>

              {/* Quick stats */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {(["pass", "fail", "blocked", "flaky"] as const).map((s) => {
                  const count = existingRun.results.filter(
                    (r) => (r as { status: string }).status === s,
                  ).length;
                  const colours: Record<string, string> = {
                    pass: "text-emerald-300 bg-emerald-950/60",
                    fail: "text-red-300 bg-red-950/60",
                    blocked: "text-amber-200 bg-amber-950/60",
                    flaky: "text-sky-300 bg-sky-950/60",
                  };
                  return (
                    <div
                      key={s}
                      className={`rounded-lg px-2 py-1.5 text-center font-medium ${colours[s]}`}
                    >
                      {count} {s}
                    </div>
                  );
                })}
              </div>

              <Link
                href={`/runs/${fromRunId}`}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 text-center hover:bg-zinc-800"
              >
                View full results page →
              </Link>

              <hr className="border-zinc-800" />

              <button
                type="button"
                onClick={() => {
                  setMode("new-run");
                  setFromRunId(null);
                  setExistingRun(null);
                  discussHistory.current = [];
                  setMessages([]);
                }}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                + Start a new run instead
              </button>
            </>
          ) : (
            /* New-run sidebar */
            <>
              <div>
                <p className="text-xs uppercase tracking-widest text-violet-400 mb-1">
                  Interactive QA Agent
                </p>
                <p className="text-xs text-zinc-500">
                  Describe a test scenario and watch the Browser Use agent run it live.
                </p>
              </div>

              <label className="block text-sm font-medium text-zinc-300">
                Target URL
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-violet-500"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={running}
                />
              </label>

              <label className="block text-sm font-medium text-zinc-300">
                Test requirement
                <textarea
                  rows={5}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500 resize-none"
                  value={requirement}
                  onChange={(e) => setRequirement(e.target.value)}
                  disabled={running}
                />
              </label>

              <label className="text-sm text-zinc-300">
                Viewport
                <select
                  className="ml-2 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-white text-sm"
                  value={viewport}
                  onChange={(e) => setViewport(e.target.value as "desktop" | "mobile")}
                  disabled={running}
                >
                  <option value="desktop">Desktop</option>
                  <option value="mobile">Mobile</option>
                </select>
              </label>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={running}
                  onClick={() => void onRun()}
                  className="flex-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  {running ? "Running…" : "▶ Run"}
                </button>
                {running && (
                  <button
                    type="button"
                    onClick={onStop}
                    className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-white hover:bg-zinc-700"
                  >
                    ■ Stop
                  </button>
                )}
              </div>

              {running && (
                <div className="flex items-center gap-2 text-xs text-amber-300 animate-pulse">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                  Agent is running…
                </div>
              )}
            </>
          )}
        </aside>

        {/* Right panel — chat log + Q&A input */}
        <main className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
            {messages.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-zinc-600 text-sm text-center max-w-xs">
                  Enter a URL and requirement on the left, then hit{" "}
                  <strong className="text-zinc-400">▶ Run</strong> to watch the agent test your
                  site live.
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}

            <div ref={bottomRef} />
          </div>

          {/* Q&A input — only shown in discuss mode */}
          {mode === "discuss" && (
            <div className="flex gap-2 pt-2 border-t border-zinc-800">
              <input
                type="text"
                placeholder="Ask about these results… (e.g. Why did the nav test fail?)"
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-violet-500 disabled:opacity-50"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void onAsk(); } }}
                disabled={asking}
              />
              <button
                type="button"
                onClick={() => void onAsk()}
                disabled={asking || !question.trim()}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50 shrink-0"
              >
                {asking ? "…" : "Ask"}
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── MessageBubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-lg rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? "bg-violet-700 text-white rounded-br-sm"
            : isSystem
              ? "bg-zinc-800/60 text-zinc-400 border border-zinc-700 rounded-bl-sm italic text-xs"
              : "bg-zinc-800 text-zinc-200 rounded-bl-sm"
        }`}
      >
        <p className="whitespace-pre-wrap">{msg.text}</p>

        {msg.imageUrl && (
          <img
            src={msg.imageUrl}
            alt="screenshot"
            loading="lazy"
            className="mt-2 w-full rounded-lg border border-zinc-700"
          />
        )}

        {msg.videoUrl && (
          <video controls className="mt-2 w-full rounded-lg border border-zinc-700">
            <source src={msg.videoUrl} type="video/webm" />
          </video>
        )}

        {msg.runId && (
          <Link
            href={`/runs/${msg.runId}`}
            className="mt-2 block text-xs text-violet-400 hover:underline"
          >
            View full results →
          </Link>
        )}
      </div>
    </div>
  );
}
