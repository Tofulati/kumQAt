"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, MessageSquare, LayoutDashboard } from "lucide-react";

const links = [
  { href: "/", label: "New Run", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageSquare },
];

export default function NavBar() {
  const path = usePathname();
  return (
    <nav className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm">
      <div className="mx-auto flex h-12 max-w-5xl items-center gap-2 px-4">
        <Link href="/" className="mr-4 flex items-center gap-2 font-semibold tracking-tight text-white">
          <FlaskConical size={16} className="text-violet-400" />
          QABot
        </Link>

        <div className="flex gap-1">
          {links.map(({ href, label, icon: Icon }) => {
            const active = path === href || (href !== "/" && path.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-zinc-800 font-medium text-white"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                <Icon size={14} />
                {label}
              </Link>
            );
          })}
        </div>

        <span className="ml-auto hidden text-xs text-zinc-600 sm:block">
          DiamondHacks 2026 · Browser Use + Gemini
        </span>
      </div>
    </nav>
  );
}
