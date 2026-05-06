"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PAGES = [
  { href: "/", label: "Season" },
  { href: "/race/1", label: "Race" },
  { href: "/standings", label: "Standings" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const idx = PAGES.findIndex((p) => {
    if (p.href === pathname) return true;
    if (p.href === "/") return pathname === "/";
    const base = p.href.split("/").slice(0, 2).join("/"); // /race/1 -> /race
    return pathname.startsWith(base);
  });
  const safeIdx = idx === -1 ? 0 : idx;
  const prev = safeIdx > 0 ? PAGES[safeIdx - 1] : null;
  const next = safeIdx < PAGES.length - 1 ? PAGES[safeIdx + 1] : null;
  const current = PAGES[safeIdx];

  return (
    <header className="pointer-events-none fixed inset-x-0 bottom-8 z-30 px-8">
      <div className="pointer-events-auto absolute left-1/2 -translate-x-1/2 bottom-0 flex flex-col items-center gap-1.5 rounded-full border border-white/15 bg-black/80 px-5 py-2.5 backdrop-blur-lg">
        <span className="text-[10px] uppercase tracking-[0.3em] text-white/50">
          {current.label}
        </span>
        <div className="flex items-center gap-1">
          {PAGES.map((p, i) => (
            <Link
              key={p.href}
              href={p.href}
              title={p.label}
              aria-label={p.label}
              className="group flex h-5 items-center justify-center px-1"
            >
              <span
                className={`block h-1.5 rounded-full transition-all ${
                  i === safeIdx ? "w-6 bg-white/70" : "w-1.5 bg-white/25 group-hover:bg-white/70 group-hover:w-2.5"
                }`}
              />
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-end justify-between">
        <div className="pointer-events-auto">
          {prev ? (
            <Link
              href={prev.href}
              className="group flex items-center gap-2.5 rounded-full border border-white/15 bg-black/80 px-5 py-2.5 backdrop-blur-lg transition hover:border-white/40 hover:bg-white/10"
            >
              <span className="text-sm text-white/50 transition group-hover:text-white">←</span>
              <span className="text-xs uppercase tracking-[0.2em] text-white/60 transition group-hover:text-white">
                {prev.label}
              </span>
            </Link>
          ) : (
            <div />
          )}
        </div>

        <div className="pointer-events-auto">
          {next ? (
            <Link
              href={next.href}
              className="group flex items-center gap-2.5 rounded-full border border-white/15 bg-black/80 px-5 py-2.5 backdrop-blur-lg transition hover:border-white/40 hover:bg-white/10"
            >
              <span className="text-xs uppercase tracking-[0.2em] text-white/60 transition group-hover:text-white">
                {next.label}
              </span>
              <span className="text-sm text-white/50 transition group-hover:text-white">→</span>
            </Link>
          ) : (
            <div />
          )}
        </div>
      </div>
    </header>
  );
}
