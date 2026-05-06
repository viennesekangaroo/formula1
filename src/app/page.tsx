import { SeasonMap, type SeasonMapRound } from "@/components/season-map";
import { teamColor } from "@/lib/team-colors";
import { loadStaticSeason } from "@/lib/season-static";

export default async function Page() {
  let dbError: string | null = null;
  let rounds: SeasonMapRound[] = [];
  try {
    const data = await loadStaticSeason(2025);
    if (!data) throw new Error("season manifest not found — run npm run build:races");
    rounds = data.races
      .filter((r) => r.lat !== null && r.lng !== null)
      .map((r) => ({
        round: r.round,
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
          <h1 className="text-4xl">2025 Season</h1>
          <div className="flex items-center gap-2">
            <span
              className="cursor-not-allowed rounded border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-white/25"
              aria-disabled="true"
              title="No data yet"
            >
              ← 2024
            </span>
            <span
              className="cursor-not-allowed rounded border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-white/25"
              aria-disabled="true"
              title="No data yet"
            >
              2026 →
            </span>
          </div>
        </div>
        <p className="mt-3 text-sm text-white/50 max-w-2xl">
          Race-by-race visualization of the 2025 Formula 1 World Championship.
          Each dot is a round, colored by the winning constructor. Click to open
          the lap-by-lap replay.
        </p>
      </div>

      {dbError ? (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
          <div className="font-medium">Database not built yet.</div>
          <div className="mt-1 text-red-300/80">
            Run <code className="rounded bg-black/60 px-1.5 py-0.5">npm run ingest</code> to build{" "}
            <code>data/f1.db</code> from the Kaggle CSVs in <code>data/raw/</code>.
          </div>
          <div className="mt-2 text-xs text-red-300/60">{dbError}</div>
        </div>
      ) : (
        <SeasonMap rounds={rounds} />
      )}
    </div>
  );
}
