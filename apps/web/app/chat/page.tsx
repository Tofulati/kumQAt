"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  chatRun,
  fileUrl,
  getResults,
  parseSseChunk,
  type ChatMessage,
  type SseEvent,
} from "@/lib/api";

export default function ChatPage() {
  const searchParams = useSearchParams();

  const [url, setUrl] = useState("https://example.com");
  const [requirement, setRequirement] = useState(
    "Smoke test: page loads, primary content visible, no obvious errors.",
  );
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Pre-populate from ?from_run= query param
  useEffect(() => {
    const fromRun = searchParams.get("from_run");
    if (!fromRun) return;
    getResults(fromRun)
      .then((r) => {
        setUrl(r.url);
        setRequirement(r.requirement_text);
        pushMessage({
          role: "system",
          text: `Loaded context from run ${fromRun.slice(0, 8)}… — URL and requirement pre-filled.`,
        });
      })
      .catch(() => {/* ignore */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function pushMessage(msg: ChatMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  const onRun = async () => {
    if (running) return;
    const trimmedUrl = url.trim();
    const trimmedReq = requirement.trim();
    if (!trimmedUrl || !trimmedReq) return;

    pushMessage({ role: "user", text: `Testing: ${trimmedReq}\n${trimmedUrl}` });
    setRunning(true);

    const { bodyPromise, controller } = chatRun({
      url: trimmedUrl,
      requirement_text: trimmedReq,
      viewport,
    });
    cancelRef.current = () => controller.abort();

    try {
      const body = await bodyPromise;
      if (!body) {
        pushMessage({ role: "system", text: "No response stream received." });
        setRunning(false);
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE blocks (separated by \n\n)
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const events = parseSseChunk(block + "\n\n");
          for (const event of events) {
            handleSseEvent(event);
          }
        }
      }

      // Flush any remaining buffer
      if (buffer.trim()) {
        for (const event of parseSseChunk(buffer)) {
          handleSseEvent(event);
        }
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
          text: `Starting run — ${total} test case${total !== 1 ? "s" : ""} queued.`,
        });
        break;
      }
      case "case_started": {
        const name = event.data.name as string;
        const idx = (event.data.index as number) + 1;
        pushMessage({
          role: "agent",
          text: `▶ Running case ${idx}: ${name}`,
        });
        break;
      }
      case "case_completed": {
        const status = event.data.status as string;
        const summary = (event.data.summary as string) ?? "";
        const evidence = (event.data.evidence as string[]) ?? [];

        const statusEmoji: Record<string, string> = {
          pass: "✅",
          fail: "❌",
          blocked: "⚠️",
          flaky: "🔄",
        };
        const emoji = statusEmoji[status] ?? "•";
        const firstLine = summary.split("\n")[0] ?? summary;

        const png = evidence.find((e) => e.endsWith(".png"));
        const webm = evidence.find((e) => e.endsWith(".webm"));

        pushMessage({
          role: "agent",
          text: `${emoji} ${firstLine}`,
          imageUrl: png ? fileUrl(png) : undefined,
          videoUrl: webm ? fileUrl(webm) : undefined,
        });
        break;
      }
      case "run_completed": {
        const runId = event.data.run_id as string;
        pushMessage({
          role: "system",
          text: `Run complete.`,
          runId,
        });
        break;
      }
      case "done":
        break;
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Top nav */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center gap-6 text-sm">
        <Link href="/" className="text-violet-400 hover:underline font-semibold">
          QABot
        </Link>
        <Link href="/" className="text-zinc-400 hover:text-zinc-200">Runs</Link>
        <span className="text-zinc-200 font-medium">Chat</span>
      </header>

      <div className="flex flex-1 overflow-hidden max-w-6xl w-full mx-auto px-4 py-6 gap-6">
        {/* Left panel — inputs */}
        <aside className="w-80 shrink-0 flex flex-col gap-4">
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
        </aside>

        {/* Right panel — chat log */}
        <main className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
          {messages.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-zinc-600 text-sm text-center max-w-xs">
                Enter a URL and requirement on the left, then hit <strong className="text-zinc-400">▶ Run</strong> to watch the agent test your site live.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}

          <div ref={bottomRef} />
        </main>
      </div>
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
