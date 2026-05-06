import Link from "next/link";
import { notFound } from "next/navigation";
import { SeasonMap, type SeasonMapRound } from "@/components/season-map";
import { teamColor } from "@/lib/team-colors";
import { loadStaticSeason, listAvailableSeasons } from "@/lib/season-static";

export const revalidate = 86400;

export default async function SeasonPage({ params }: { params: Promise<{ season: string }> }) {
  const { season: seasonParam } = await params;
  const season = Number(seasonParam);
  if (!Number.isFinite(season) || season < 2000 || season > 2100) notFound();

  const all = await listAvailableSeasons();
  const idx = all.indexOf(season);
  if (idx === -1) {
    // Season exists conceptually but no data file yet.
    return (
      <div className="mx-auto max-w-4xl px-6 pt-16 pb-32">
        <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">Formula 1</div>
        <h1 className="mt-2 text-4xl">{season} Season</h1>
        <p className="mt-3 text-sm text-white/50 max-w-2xl">
          No data yet for {season}. Available:{" "}
          {all.length === 0
            ? "(none)"
            : all.map((y, i) => (
                <span key={y}>
                  <Link href={`/${y}`} className="underline hover:text-white">{y}</Link>
                  {i < all.length - 1 ? ", " : ""}
                </span>
              ))}
          .
        </p>
      </div>
    );
  }

  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx < all.length - 1 ? all[idx + 1] : null;

  let rounds: SeasonMapRound[] = [];
  let dbError: string | null = null;
  try {
    const data = await loadStaticSeason(season);
    if (!data) throw new Error("season manifest missing");
    rounds = data.races
      .filter((r) => r.lat !== null && r.lng !== null)
      .map((r) => ({
        round: r.round,
        season,
        raceName: r.raceName,
        circuitName: r.circuitName ?? "",
        country: r.country ?? "",
        date: r.date,
        lat: r.lat as number,
        lng: r.lng as number,
        winner: r.winnerName,
        winnerConstructor: r.winnerConstructor,
        color: teamColor(r.winnerConstructorId, r.winnerTeamColor),
        hasReplay: r.hasReplay,
      }));
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 pt-16 pb-32">
      <div className="mb-8">
        <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">Formula 1</div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-4xl">{season} Season</h1>
          <div className="flex items-center gap-2">
            {prev ? (
              <Link
                href={`/${prev}`}
                className="rounded border border-white/15 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-white/70 hover:bg-white/10 hover:text-white"
              >
                ← {prev}
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-white/25" aria-disabled="true" title="No data yet">
                ← {season - 1}
              </span>
            )}
            {next ? (
              <Link
                href={`/${next}`}
                className="rounded border border-white/15 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-white/70 hover:bg-white/10 hover:text-white"
              >
                {next} →
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-white/25" aria-disabled="true" title="No data yet">
                {season + 1} →
              </span>
            )}
          </div>
        </div>
        <p className="mt-3 text-sm text-white/50 max-w-2xl">
          Race-by-race visualization of the {season} Formula 1 World Championship.
          Each dot is a round, colored by the winning constructor. Click to open
          the lap-by-lap replay.
        </p>
      </div>

      {dbError ? (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
          {dbError}
        </div>
      ) : (
        <SeasonMap rounds={rounds} />
      )}
    </div>
  );
}
