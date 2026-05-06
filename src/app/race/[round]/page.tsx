import Link from "next/link";
import { notFound } from "next/navigation";
import { listRaces, loadRaceMeta } from "@/lib/race-data";
import { RaceLoader } from "@/components/race-loader";

// Page shell is cached for a day. The heavy replay JSON is served by the
// /api/race/[round] route which has its own (much longer) edge cache.
export const revalidate = 86400;

export default async function RacePage({ params }: { params: Promise<{ round: string }> }) {
  const { round: roundParam } = await params;
  const round = Number(roundParam);
  if (!Number.isFinite(round) || round < 1) notFound();

  const all = await listRaces(2025);
  const idx = all.findIndex((r) => r.round === round);
  if (idx === -1) notFound();
  const meta = await loadRaceMeta(2025, round);
  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx < all.length - 1 ? all[idx + 1] : null;

  // No OpenF1 session for this round yet — show the placeholder.
  if (!meta || meta.sessionKey === null) {
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
    <RaceLoader
      round={round}
      meta={meta}
      prev={prev ? { round: prev.round, name: prev.raceName } : null}
      next={next ? { round: next.round, name: next.raceName } : null}
    />
  );
}
