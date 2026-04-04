"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  MessageSquare,
  Play,
  Plus,
  Square,
} from "lucide-react";
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

const STATUS_LABEL: Record<string, string> = {
  pass: "PASS",
  fail: "FAIL",
  blocked: "BLOCKED",
  flaky: "FLAKY",
};

function normalizeUrl(raw: string) {
  const t = raw.trim();
  return t && !t.includes("://") ? `https://${t}` : t;
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<"discuss" | "new-run">("new-run");
  const [existingRun, setExistingRun] = useState<RunResults | null>(null);
  const [fromRunId, setFromRunId] = useState<string | null>(null);

  const [url, setUrl] = useState("https://example.com");
  const [requirement, setRequirement] = useState(
    "Smoke test: page loads, primary content visible, no obvious errors.",
  );
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const discussHistory = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const cancelRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load from_run on mount
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

        const initial: ChatMessage[] = [
          {
            role: "system",
            text: `Loaded run ${fromRun.slice(0, 8)} for ${r.url}\n${r.test_cases.length} test cases, status: ${r.status}`,
          },
        ];

        for (const result of r.results) {
          const tc = r.test_cases.find((c) => c.id === result.test_case_id);
          const name = tc?.name ?? result.test_case_id;
          const statusLabel = STATUS_LABEL[result.status] ?? result.status.toUpperCase();
          const summary = (result.summary as string) ?? "";
          const png = (result.evidence as string[])?.find((e: string) => e.endsWith(".png"));
          const webm = (result.evidence as string[])?.find((e: string) => e.endsWith(".webm"));
          initial.push({
            role: "agent",
            text: `[${statusLabel}] ${name}\n${summary}`,
            imageUrl: png ? fileUrl(png) : undefined,
            videoUrl: webm ? fileUrl(webm) : undefined,
          });
        }

        initial.push({
          role: "system",
          text: "Ask anything about these results: what failed, why, how to fix it, or request a re-run.",
        });

        setMessages(initial);
      })
      .catch(() => {
        setMode("new-run");
        pushMessage({ role: "system", text: "Could not load run. Starting fresh." });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function pushMessage(msg: ChatMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  // Discuss Q&A
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
      pushMessage({
        role: "system",
        text: `Error: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setAsking(false);
    }
  };

  // New run
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
        pushMessage({
          role: "system",
          text: `Starting: ${total} test case${total !== 1 ? "s" : ""} queued.`,
        });
        break;
      }
      case "case_started": {
        const name = event.data.name as string;
        const idx = (event.data.index as number) + 1;
        pushMessage({ role: "agent", text: `Running case ${idx}: ${name}` });
        break;
      }
      case "case_completed": {
        const status = event.data.status as string;
        const summary = (event.data.summary as string) ?? "";
        const evidence = (event.data.evidence as string[]) ?? [];
        const statusLabel = STATUS_LABEL[status] ?? status.toUpperCase();
        const png = evidence.find((e) => e.endsWith(".png"));
        const webm = evidence.find((e) => e.endsWith(".webm"));
        pushMessage({
          role: "agent",
          text: `[${statusLabel}] ${summary.split("\n")[0] ?? summary}`,
          imageUrl: png ? fileUrl(png) : undefined,
          videoUrl: webm ? fileUrl(webm) : undefined,
        });
        break;
      }
      case "run_completed": {
        const runId = event.data.run_id as string;
        setFromRunId(runId);
        setMode("discuss");
        discussHistory.current = [];
        pushMessage({
          role: "system",
          text: "Run complete. You can now ask questions about the results.",
          runId,
        });
        getResults(runId)
          .then((r) => setExistingRun(r))
          .catch(() => {});
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

  return (
    <div className="flex h-[calc(100vh-3rem)] bg-zinc-950 text-zinc-100">
      {/* Left panel */}
      <aside className="flex w-72 shrink-0 flex-col gap-4 border-r border-zinc-800 p-5">
        {mode === "discuss" && existingRun ? (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">
                Analysing run
              </p>
              <p className="mt-1 break-all font-mono text-xs text-zinc-400">{existingRun.url}</p>
              <p className="mt-1 line-clamp-3 text-xs italic text-zinc-500">
                {existingRun.requirement_text}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {(["pass", "fail", "blocked", "flaky"] as const).map((s) => {
                const count = existingRun.results.filter(
                  (r) => (r as { status: string }).status === s,
                ).length;
                const colours: Record<string, string> = {
                  pass: "bg-emerald-950 text-emerald-300 border border-emerald-800",
                  fail: "bg-red-950 text-red-300 border border-red-800",
                  blocked: "bg-amber-950 text-amber-200 border border-amber-800",
                  flaky: "bg-sky-950 text-sky-300 border border-sky-800",
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

            {fromRunId && (
              <Link
                href={`/runs/${fromRunId}`}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                <ExternalLink size={12} />
                View full results
              </Link>
            )}

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
              className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              <Plus size={12} />
              Start a new run
            </button>
          </>
        ) : (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">
                Interactive QA agent
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Describe a test scenario and watch the Browser Use agent run it live.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400" htmlFor="chat-url">
                Target URL
              </label>
              <input
                id="chat-url"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-violet-500"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={running}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400" htmlFor="chat-req">
                Test requirement
              </label>
              <textarea
                id="chat-req"
                rows={5}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white outline-none focus:border-violet-500"
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                disabled={running}
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-zinc-400" htmlFor="chat-viewport">
                Viewport
              </label>
              <select
                id="chat-viewport"
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white outline-none"
                value={viewport}
                onChange={(e) => setViewport(e.target.value as "desktop" | "mobile")}
                disabled={running}
              >
                <option value="desktop">Desktop</option>
                <option value="mobile">Mobile</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={running}
                onClick={() => void onRun()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                <Play size={14} />
                {running ? "Running..." : "Run"}
              </button>
              {running && (
                <button
                  type="button"
                  onClick={onStop}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-white hover:bg-zinc-700"
                >
                  <Square size={14} />
                  Stop
                </button>
              )}
            </div>

            {running && (
              <div className="flex items-center gap-2 text-xs text-amber-300">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                Agent is running...
              </div>
            )}
          </>
        )}
      </aside>

      {/* Chat area */}
      <main className="flex flex-1 flex-col">
        {/* Back link */}
        {fromRunId && (
          <div className="border-b border-zinc-800 px-5 py-2">
            <Link
              href={`/runs/${fromRunId}`}
              className="flex w-fit items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
            >
              <ArrowLeft size={12} />
              Back to full results
            </Link>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="max-w-xs text-center text-sm text-zinc-600">
                Enter a URL and requirement on the left, then click{" "}
                <strong className="text-zinc-400">Run</strong> to watch the agent test your site.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}

          <div ref={bottomRef} />
        </div>

        {/* Q&A input (discuss mode only) */}
        {mode === "discuss" && (
          <div className="border-t border-zinc-800 p-4">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ask about these results..."
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-violet-500 disabled:opacity-50"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onAsk();
                  }
                }}
                disabled={asking}
              />
              <button
                type="button"
                onClick={() => void onAsk()}
                disabled={asking || !question.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                <MessageSquare size={14} />
                {asking ? "Asking..." : "Ask"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-lg rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? "rounded-br-sm bg-violet-700 text-white"
            : isSystem
              ? "rounded-bl-sm border border-zinc-700 bg-zinc-800/60 text-xs italic text-zinc-400"
              : "rounded-bl-sm bg-zinc-800 text-zinc-200"
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
            className="mt-2 flex items-center gap-1 text-xs text-violet-400 hover:underline"
          >
            <ExternalLink size={11} />
            View full results
          </Link>
        )}
      </div>
    </div>
  );
}
