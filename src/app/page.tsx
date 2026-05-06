import { query } from "@/lib/db";
import { SeasonMap, type SeasonMapRound } from "@/components/season-map";
import { teamColor } from "@/lib/team-colors";

type RaceRow = {
  season: number;
  round: number;
  race_name: string;
  date: string;
  circuit_name: string;
  country: string;
  lat: number | null;
  lng: number | null;
  winner: string | null;
  winner_constructor_id: string | null;
  winner_constructor: string | null;
  winner_team_color: string | null;
  has_replay: number;
};

async function loadSeason(season: number): Promise<RaceRow[]> {
  return query<RaceRow>(
    `SELECT
      r.season AS season, r.round AS round, r.race_name AS race_name, r.date AS date,
      c.name AS circuit_name, c.country AS country, c.lat AS lat, c.lng AS lng,
      w.driver_name AS winner,
      w.constructor_id AS winner_constructor_id,
      w.constructor AS winner_constructor,
      w.team_color AS winner_team_color,
      CASE WHEN s.session_key IS NULL THEN 0 ELSE 1 END AS has_replay
    FROM races r
    LEFT JOIN circuits c ON c.circuit_id = r.circuit_id
    LEFT JOIN openf1_sessions s ON s.season = r.season AND s.round = r.round
    LEFT JOIN (
      SELECT rr.season, rr.round,
             d.full_name AS driver_name,
             rr.constructor_id AS constructor_id,
             cn.name AS constructor,
             od.team_color AS team_color
      FROM race_results rr
      JOIN drivers d ON d.driver_id = rr.driver_id
      LEFT JOIN constructors cn ON cn.constructor_id = rr.constructor_id
      LEFT JOIN openf1_sessions os ON os.season = rr.season AND os.round = rr.round
      LEFT JOIN openf1_drivers od
        ON od.session_key = os.session_key AND od.driver_number = rr.driver_number
      WHERE rr.position = 1
    ) w ON w.season = r.season AND w.round = r.round
    WHERE r.season = ?
    ORDER BY r.round ASC`,
    [season],
    (r) => ({
      season: r.season as number,
      round: r.round as number,
      race_name: r.race_name as string,
      date: r.date as string,
      circuit_name: r.circuit_name as string,
      country: r.country as string,
      lat: r.lat as number | null,
      lng: r.lng as number | null,
      winner: r.winner as string | null,
      winner_constructor_id: r.winner_constructor_id as string | null,
      winner_constructor: r.winner_constructor as string | null,
      winner_team_color: r.winner_team_color as string | null,
      has_replay: r.has_replay as number,
    }),
  );
}

export default async function Page() {
  let races: RaceRow[] = [];
  let dbError: string | null = null;
  try {
    races = await loadSeason(2025);
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const rounds: SeasonMapRound[] = races
    .filter((r) => r.lat !== null && r.lng !== null)
    .map((r) => ({
      round: r.round,
      raceName: r.race_name,
      circuitName: r.circuit_name,
      country: r.country,
      date: r.date,
      lat: r.lat as number,
      lng: r.lng as number,
      winner: r.winner,
      winnerConstructor: r.winner_constructor,
      color: teamColor(r.winner_constructor_id, r.winner_team_color),
      hasReplay: r.has_replay === 1,
    }));

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
