import Link from "next/link";
import { notFound } from "next/navigation";
import { loadRaceReplay, listRaces } from "@/lib/race-data";
import { RaceView } from "@/components/race-view";

// Race data is immutable once a race has happened — cache for a day.
// In prod, the first request hits Turso once and every subsequent request
// for the same round is served from the Vercel edge cache.
export const revalidate = 86400;

export default async function RacePage({ params }: { params: Promise<{ round: string }> }) {
  const { round: roundParam } = await params;
  const round = Number(roundParam);
  if (!Number.isFinite(round) || round < 1) notFound();

  const all = await listRaces(2025);
  const idx = all.findIndex((r) => r.round === round);
  if (idx === -1) notFound();
  const prev = all.slice(0, idx).reverse().find((r) => r.sessionKey !== null) ?? null;
  const next = all.slice(idx + 1).find((r) => r.sessionKey !== null) ?? null;

  const replay = await loadRaceReplay(2025, round);
  if (!replay) {
    return (
      <div className="mx-auto max-w-4xl px-6 pt-16 pb-32">
        <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">2025 · round {round}</div>
        <h1 className="mt-2 text-3xl">{all[idx].raceName}</h1>
        <div className="mt-1 text-sm text-white/40">
          {all[idx].circuitName} · {all[idx].country} · {all[idx].date}
        </div>
        <p className="mt-6 text-sm text-white/50">
          OpenF1 data for this round hasn’t been fetched yet. Run:
        </p>
        <pre className="mt-2 rounded bg-white/[0.04] px-3 py-2 text-xs text-white/70">npm run fetch:openf1 -- --round {round}</pre>
        <div className="mt-8 flex items-center justify-between text-xs">
          {prev ? <Link href={`/race/${prev.round}`} className="rounded border border-white/15 px-3 py-1 hover:bg-white/10">← {prev.raceName}</Link> : <span />}
          {next ? <Link href={`/race/${next.round}`} className="rounded border border-white/15 px-3 py-1 hover:bg-white/10">{next.raceName} →</Link> : <span />}
        </div>
      </div>
    );
  }

  return (
    <RaceView
      replay={replay}
      prev={prev ? { round: prev.round, name: prev.raceName } : null}
      next={next ? { round: next.round, name: next.raceName } : null}
    />
  );
}
