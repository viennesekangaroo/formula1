"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteHeader() {
  const pathname = usePathname();
  // Pull the season year out of /<year>(/race/<n>)? so the Season/Race nav
  // stays scoped to whichever year the user is viewing. Falls back to no
  // prefix when on /, /race/N, or any path without a year — those
  // already redirect to the latest available season.
  const seasonMatch = pathname.match(/^\/(\d{4})(?:\/|$)/);
  const seasonPrefix = seasonMatch ? `/${seasonMatch[1]}` : "";
  const PAGES = [
    { href: seasonPrefix || "/", label: "Season" },
    { href: `${seasonPrefix}/race/1`, label: "Race" },
  ];

  const isRace = pathname.includes("/race/") || pathname === "/race";
  const idx = isRace ? 1 : 0;
  const prev = idx > 0 ? PAGES[idx - 1] : null;
  const next = idx < PAGES.length - 1 ? PAGES[idx + 1] : null;
  const current = PAGES[idx];

  return (
    <header className="pointer-events-none fixed inset-x-0 bottom-8 z-30 px-8">
      <div className="group pointer-events-auto absolute left-1/2 -translate-x-1/2 bottom-0 flex flex-col items-center gap-1.5 rounded-full border border-white/15 bg-black/80 px-5 py-2.5 backdrop-blur-lg">
        {/* Label is hidden by default and only revealed when the pill is
            hovered/focused — keeps the indicator compact when at rest. */}
        <span className="text-[10px] uppercase tracking-[0.3em] text-white/50 max-h-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:max-h-4 group-hover:opacity-100 group-focus-within:max-h-4 group-focus-within:opacity-100">
          {current.label}
        </span>
        <div className="flex items-center gap-1">
          {PAGES.map((p, i) => (
            <Link
              key={p.href}
              href={p.href}
              title={p.label}
              aria-label={p.label}
              className="group/dot flex h-5 items-center justify-center px-1"
            >
              <span
                className={`block h-1.5 rounded-full transition-all ${
                  i === idx ? "w-6 bg-white/70" : "w-1.5 bg-white/25 group-hover/dot:bg-white/70 group-hover/dot:w-2.5"
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
