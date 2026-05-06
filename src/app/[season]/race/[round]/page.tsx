import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStaticSeason } from "@/lib/season-static";
import { RaceLoader } from "@/components/race-loader";

export const revalidate = 86400;

export default async function RacePage({ params }: { params: Promise<{ season: string; round: string }> }) {
  const { season: seasonParam, round: roundParam } = await params;
  const season = Number(seasonParam);
  const round = Number(roundParam);
  if (!Number.isFinite(season) || season < 2000 || season > 2100) notFound();
  if (!Number.isFinite(round) || round < 1) notFound();

  const data = await loadStaticSeason(season);
  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-6 pt-16 pb-32">
        <h1 className="text-3xl">No data for {season}</h1>
        <p className="mt-3 text-sm text-white/50">
          Run <code className="rounded bg-white/10 px-1.5 py-0.5">npm run build:races -- --season {season}</code>.
        </p>
      </div>
    );
  }

  const all = data.races;
  const idx = all.findIndex((r) => r.round === round);
  if (idx === -1) notFound();
  const row = all[idx];
  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx < all.length - 1 ? all[idx + 1] : null;

  if (!row.hasReplay) {
    return (
      <div className="mx-auto max-w-4xl px-6 pt-16 pb-32">
        <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">{season} · round {round}</div>
        <h1 className="mt-2 text-3xl">{row.raceName}</h1>
        <div className="mt-1 text-sm text-white/40">
          {row.circuitName} · {row.country} · {row.date}
        </div>
        <p className="mt-6 text-sm text-white/50">
          OpenF1 data for this round hasn’t been fetched yet. Run:
        </p>
        <pre className="mt-2 rounded bg-white/[0.04] px-3 py-2 text-xs text-white/70">npm run fetch:openf1 -- --season {season} --round {round}</pre>
        <div className="mt-8 flex items-center justify-between text-xs">
          {prev ? <Link href={`/${season}/race/${prev.round}`} className="rounded border border-white/15 px-3 py-1 hover:bg-white/10">← {prev.raceName}</Link> : <span />}
          {next ? <Link href={`/${season}/race/${next.round}`} className="rounded border border-white/15 px-3 py-1 hover:bg-white/10">{next.raceName} →</Link> : <span />}
        </div>
      </div>
    );
  }

  const meta = {
    season,
    round,
    raceName: row.raceName,
    date: row.date,
    circuitId: row.circuitId,
    circuitName: row.circuitName,
    country: row.country,
    sessionKey: 1, // truthy — actual key is irrelevant in static mode
    totalLaps: 0,
  };

  return (
    <RaceLoader
      season={season}
      round={round}
      meta={meta}
      prev={prev ? { round: prev.round, name: prev.raceName } : null}
      next={next ? { round: next.round, name: next.raceName } : null}
    />
  );
}
