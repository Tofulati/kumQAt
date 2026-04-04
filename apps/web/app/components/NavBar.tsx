"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, MessageSquare, Info, PlusCircle, ListChecks, LayoutDashboard } from "lucide-react";

const links = [
  { href: "/",           label: "About",     icon: Info },
  { href: "/new-run",    label: "New Run",   icon: PlusCircle },
  { href: "/dashboard",  label: "Dashboard", icon: LayoutDashboard },
  { href: "/runs",       label: "Results",   icon: ListChecks },
  { href: "/chat",       label: "Chat",      icon: MessageSquare },
];

export default function NavBar() {
  const path = usePathname();
  return (
    <nav className="sticky top-0 z-50 border-b border-zinc-800/80 bg-black/80 backdrop-blur-md">
      <div className="mx-auto flex h-13 max-w-6xl items-center gap-2 px-5">
        {/* Logo */}
        <Link
          href="/"
          className="mr-5 flex items-center gap-2 font-bold tracking-tight text-white"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-violet-600">
            <FlaskConical size={14} className="text-white" />
          </div>
          <span className="bg-gradient-to-r from-amber-400 to-violet-400 bg-clip-text text-transparent">
            QABot
          </span>
        </Link>

        {/* Nav links */}
        <div className="flex gap-1">
          {links.map(({ href, label, icon: Icon }) => {
            // "/" must be exact so /new-run and /runs don't also highlight About
            const active =
              href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                }`}
              >
                <Icon size={14} />
                {label}
              </Link>
            );
          })}
        </div>

        <span className="ml-auto hidden text-xs text-zinc-600 sm:block">
          DiamondHacks 2026
        </span>
      </div>
    </nav>
  );
}
