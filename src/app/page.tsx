import Link from "next/link";
import { query } from "@/lib/db";

type RaceRow = {
  season: number;
  round: number;
  race_name: string;
  date: string;
  circuit_name: string;
  country: string;
  winner: string | null;
  winner_constructor: string | null;
  has_replay: number;
};

async function loadSeason(season: number): Promise<RaceRow[]> {
  return query<RaceRow>(
    `SELECT
      r.season AS season, r.round AS round, r.race_name AS race_name, r.date AS date,
      c.name AS circuit_name, c.country AS country,
      w.driver_name AS winner, w.constructor AS winner_constructor,
      CASE WHEN s.session_key IS NULL THEN 0 ELSE 1 END AS has_replay
    FROM races r
    LEFT JOIN circuits c ON c.circuit_id = r.circuit_id
    LEFT JOIN openf1_sessions s ON s.season = r.season AND s.round = r.round
    LEFT JOIN (
      SELECT rr.season, rr.round, d.full_name AS driver_name, cn.name AS constructor
      FROM race_results rr
      JOIN drivers d ON d.driver_id = rr.driver_id
      LEFT JOIN constructors cn ON cn.constructor_id = rr.constructor_id
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
      winner: r.winner as string | null,
      winner_constructor: r.winner_constructor as string | null,
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

  return (
    <div className="mx-auto max-w-4xl px-6 pt-16 pb-32">
      <div className="mb-10">
        <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">Formula 1</div>
        <h1 className="mt-2 text-4xl">2025 Season</h1>
        <p className="mt-3 text-sm text-white/50 max-w-2xl">
          Race-by-race visualization of the 2025 Formula 1 World Championship.
          Rounds with a replay link have lap-by-lap data ingested from OpenF1.
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
        <div className="overflow-hidden rounded border border-white/10">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-[0.2em] text-white/40">
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 w-10">#</th>
                <th className="px-4 py-3">Grand Prix</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Winner</th>
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody>
              {races.map((r) => (
                <tr key={r.round} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3 text-white/40 tabular-nums">{r.round.toString().padStart(2, "0")}</td>
                  <td className="px-4 py-3">
                    <div>{r.race_name}</div>
                    <div className="text-xs text-white/40">{r.circuit_name} · {r.country}</div>
                  </td>
                  <td className="px-4 py-3 text-white/60 tabular-nums">{r.date}</td>
                  <td className="px-4 py-3">
                    {r.winner ? (
                      <div>
                        <div>{r.winner}</div>
                        <div className="text-xs text-white/40">{r.winner_constructor}</div>
                      </div>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.has_replay ? (
                      <Link
                        href={`/race/${r.round}`}
                        className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70 hover:bg-white/10"
                      >
                        replay →
                      </Link>
                    ) : (
                      <span className="text-[10px] uppercase tracking-[0.2em] text-white/20">no data</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
