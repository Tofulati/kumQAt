"use client";

import Link from "next/link";
import { ChevronDown, Brain, Globe, BarChart3, ShieldCheck, MessageSquare } from "lucide-react";

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

const FEATURES = [
  {
    icon: Brain,
    color: "text-amber-400",
    bg: "bg-amber-950/40",
    border: "border-amber-900/40",
    title: "AI Test Generation",
    desc: "Describe a requirement in plain English. Gemini writes structured test cases with steps, expected outcomes, and failure signals — no test framework expertise required.",
  },
  {
    icon: Globe,
    color: "text-violet-400",
    bg: "bg-violet-950/40",
    border: "border-violet-900/40",
    title: "Real Browser Execution",
    desc: "Browser Use Cloud opens a real Chromium browser, navigates your site, clicks buttons, fills forms, and follows multi-step flows exactly like a human QA engineer.",
  },
  {
    icon: BarChart3,
    color: "text-sky-400",
    bg: "bg-sky-950/40",
    border: "border-sky-900/40",
    title: "Structured Bug Reports",
    desc: "Every test produces a detailed card: status, severity, confidence, expected vs actual, suspected root cause, business impact, screenshots, and video recordings.",
  },
  {
    icon: ShieldCheck,
    color: "text-emerald-400",
    bg: "bg-emerald-950/40",
    border: "border-emerald-900/40",
    title: "Smart Result Classification",
    desc: "Outcomes are classified as pass, fail, blocked, or flaky. Blocked means a CAPTCHA or login wall stopped the agent. Flaky flags intermittent timing issues automatically.",
  },
];

const STATS = [
  {
    value: "< 5 min",
    label: "Time to first report",
    sub: "From URL to structured bug report",
  },
  {
    value: "4",
    label: "Result types",
    sub: "Pass, fail, blocked, flaky",
  },
  {
    value: "AI",
    label: "Validated results",
    sub: "Gemini reads every agent trace",
  },
];

const FAQ_ITEMS = [
  {
    q: 'What does "pass / fail / blocked / flaky" mean?',
    a: (
      <ul className="list-none space-y-1 text-sm text-zinc-400">
        <li>
          <span className="font-medium text-emerald-400">pass:</span> The agent
          completed all steps and found no issues matching the failure signals.
        </li>
        <li>
          <span className="font-medium text-red-400">fail:</span> One or more
          expected outcomes were not met, or an error was detected.
        </li>
        <li>
          <span className="font-medium text-amber-300">blocked:</span> The agent
          could not proceed. Usually a login wall, CAPTCHA, or bot-detection
          challenge prevented access.
        </li>
        <li>
          <span className="font-medium text-sky-300">flaky:</span> The result was
          inconsistent, sometimes passing and sometimes failing. Usually a timing
          or race condition.
        </li>
      </ul>
    ),
  },
  {
    q: "What does severity (low / medium / high) mean?",
    a: (
      <ul className="list-none space-y-1 text-sm text-zinc-400">
        <li>
          <span className="font-medium text-red-400">high:</span> Likely blocks
          users completely from using a feature.
        </li>
        <li>
          <span className="font-medium text-amber-300">medium:</span> Degrades
          the user experience but does not fully prevent use.
        </li>
        <li>
          <span className="font-medium text-zinc-400">low:</span> Minor or
          cosmetic issue with minimal user impact.
        </li>
      </ul>
    ),
  },
  {
    q: "What does confidence % mean?",
    a: (
      <p className="text-sm text-zinc-400">
        When Gemini validates results, confidence reflects how certain it is of
        the classification (e.g. 90% means very confident it&apos;s a real
        failure). When the AI key is unavailable and the heuristic fallback is
        used, confidence is lower (50-65%) because the classification is
        rule-based, not AI-validated.
      </p>
    ),
  },
  {
    q: "What does the agent actually do?",
    a: (
      <p className="text-sm text-zinc-400">
        Each test case runs in two stages. First, Playwright takes a screenshot
        and checks the HTTP status as a quick baseline. Second, the Browser Use
        Cloud agent opens a real browser, follows the test steps, navigates
        subpages, clicks buttons, fills forms, and reports what it found. The
        agent trace in each result card shows every step the agent took.
      </p>
    ),
  },
  {
    q: 'Why is a test marked "blocked"?',
    a: (
      <p className="text-sm text-zinc-400">
        Sites like LinkedIn, Google, or university portals often detect automated
        browsers and show a CAPTCHA or login wall. The agent stops and marks the
        case blocked rather than guessing. You can try re-running with
        credentials provided in the test requirement, or the Browser Use Cloud
        agent may bypass bot detection better than a plain headless browser.
      </p>
    ),
  },
  {
    q: 'What is "Requirement-focused check", "Smoke test", etc.?',
    a: (
      <p className="text-sm text-zinc-400">
        When you click Generate test cases, Gemini reads your requirement and
        creates named test cases. &quot;Reach application&quot; checks the page
        loads. &quot;Primary navigation sanity&quot; clicks your main nav.
        &quot;Requirement-focused check&quot; directly exercises the specific
        feature you described. &quot;Form or input resilience&quot; tests form
        validation. &quot;Mobile viewport sanity&quot; checks the layout on a
        narrow screen.
      </p>
    ),
  },
];

// ---------------------------------------------------------------------------
// About / landing page
// ---------------------------------------------------------------------------

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-black text-zinc-100">

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center overflow-hidden px-4 pb-24 pt-24 text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_-5%,rgba(124,58,237,0.22),transparent)]" />

        <p className="relative mb-5 text-xs font-semibold uppercase tracking-[0.25em] text-violet-400">
          DiamondHacks 2026 · Kumqat
        </p>

        <h1 className="relative max-w-3xl text-5xl font-extrabold leading-tight tracking-tight sm:text-6xl">
          <span className="bg-gradient-to-r from-amber-400 via-violet-400 to-purple-500 bg-clip-text text-transparent">
            Requirements to browser runs to bug reports
          </span>
        </h1>

        <p className="relative mt-6 max-w-xl text-base text-zinc-400">
          Describe what to test in plain English. Kumqat generates AI-written
          test cases, runs them in a real browser with the Browser Use Cloud
          agent, and delivers structured bug reports automatically.
        </p>

        <div className="relative mt-9 flex flex-wrap justify-center gap-4">
          <Link
            href="/new-run"
            className="rounded-xl bg-gradient-to-r from-amber-400 to-violet-600 px-8 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:from-amber-300 hover:to-violet-500"
          >
            Start Testing Now
          </Link>
          <Link
            href="/chat"
            className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/60 px-8 py-3 text-sm font-semibold text-zinc-200 transition-all hover:bg-zinc-800"
          >
            <MessageSquare size={15} />
            Chat Interface
          </Link>
        </div>
      </section>

      {/* ── Feature cards ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 pb-20">
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, color, bg, border, title, desc }) => (
            <div
              key={title}
              className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 ${border}`}
            >
              <div
                className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}
              >
                <Icon size={19} className={color} />
              </div>
              <h3 className={`text-base font-semibold ${color}`}>{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Why Kumqat ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-y border-zinc-800/60 bg-zinc-950/60 py-20 text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(124,58,237,0.08),transparent)]" />

        <h2 className="relative text-3xl font-bold sm:text-4xl">
          <span className="bg-gradient-to-r from-amber-400 via-violet-400 to-purple-500 bg-clip-text text-transparent">
            Why Choose Kumqat?
          </span>
        </h2>

        <div className="relative mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-5 px-4 sm:grid-cols-3">
          {STATS.map(({ value, label, sub }) => (
            <div
              key={label}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-6 py-8"
            >
              <p className="text-4xl font-extrabold text-white">{value}</p>
              <p className="mt-2 text-sm font-semibold text-violet-400">{label}</p>
              <p className="mt-1 text-xs text-zinc-500">{sub}</p>
            </div>
          ))}
        </div>

        <p className="relative mx-auto mt-10 max-w-2xl px-4 text-sm text-zinc-400">
          Kumqat is an AI-powered browser QA platform that turns product
          requirements into executable browser test cases, runs them against your
          live site with a real browser agent, and delivers structured, actionable
          bug reports in minutes.
        </p>

        <Link
          href="/new-run"
          className="relative mt-8 inline-block rounded-xl bg-gradient-to-r from-amber-400 to-violet-600 px-8 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:from-amber-300 hover:to-violet-500"
        >
          Get Started Now
        </Link>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="text-base font-semibold text-zinc-200">
          Frequently asked questions
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Understanding your QA results
        </p>
        <div className="mt-4 space-y-2">
          {FAQ_ITEMS.map((item) => (
            <details
              key={item.q}
              className="group rounded-xl border border-zinc-800 bg-zinc-900/40"
            >
              <summary className="flex cursor-pointer select-none list-none items-center justify-between px-4 py-3 text-sm font-medium text-zinc-200 hover:text-white">
                <span>{item.q}</span>
                <ChevronDown
                  size={16}
                  className="ml-4 shrink-0 text-violet-400 transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="border-t border-zinc-800 px-4 py-3">
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
