"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BallLoader } from "@/components/ball-loader";
import { RaceView } from "@/components/race-view";
import type { RaceMeta, RaceReplay } from "@/lib/race-data";

type Props = {
  round: number;
  meta: RaceMeta;
  prev: { round: number; name: string } | null;
  next: { round: number; name: string } | null;
};

export function RaceLoader({ round, meta, prev, next }: Props) {
  const [replay, setReplay] = useState<RaceReplay | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReplay(null);
    setError(null);
    fetch(`/api/race/${round}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<RaceReplay>;
      })
      .then((data) => { if (!cancelled) setReplay(data); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [round]);

  if (replay) {
    return <RaceView replay={replay} prev={prev} next={next} />;
  }

  // Skeleton: show the same header layout RaceView will render so there's
  // no jump when the data arrives.
  return (
    <div className="mx-auto max-w-7xl px-6 pt-10 pb-32">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">
            2025 · round {meta.round}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl">{meta.raceName}</h1>
            <div className="flex items-center gap-2">
              {prev && (
                <Link
                  href={`/race/${prev.round}`}
                  className="rounded border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 hover:text-white"
                >
                  ← {prev.name}
                </Link>
              )}
              {next && (
                <Link
                  href={`/race/${next.round}`}
                  className="rounded border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 hover:text-white"
                >
                  {next.name} →
                </Link>
              )}
            </div>
          </div>
          <div className="mt-1 text-sm text-white/40">
            {meta.circuitName} · {meta.country} · {meta.date}
          </div>
        </div>
      </header>

      <div className="relative h-[60vh] rounded border border-white/10 bg-white/[0.02]">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-red-300">
            {error}
          </div>
        ) : (
          <BallLoader color="#e80020" label="loading race data" />
        )}
      </div>
    </div>
  );
}
