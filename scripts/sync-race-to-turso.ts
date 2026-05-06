// Sync a single race's OpenF1 data (sessions, drivers, laps, positions,
// locations, car_data, pits) from local SQLite up to Turso. Additive — only
// touches rows for the given session_key, leaves other races alone.
//
// Usage: npm run sync:race -- --round 2

import { createClient, type InValue } from "@libsql/client";
import Database from "better-sqlite3";
import path from "node:path";

const LOCAL_DB = path.join(process.cwd(), "data", "f1.db");
// Larger batch = fewer round-trips. Turso accepts plenty here; the limit is
// SQLite's max-host-parameters (~32k). With 8-col tables (car_data) we can
// safely go to ~3500/batch. Keep some headroom.
const BATCH = 2000;

const TABLES: { name: string; cols: string[]; key: "session_key" }[] = [
  { name: "openf1_sessions", cols: ["session_key","meeting_key","season","round","session_type","session_name","date_start"], key: "session_key" },
  { name: "openf1_drivers", cols: ["session_key","driver_number","acronym","full_name","team_name","team_color"], key: "session_key" },
  { name: "openf1_laps", cols: ["session_key","driver_number","lap_number","lap_duration","duration_sector_1","duration_sector_2","duration_sector_3","date_start","is_pit_out_lap"], key: "session_key" },
  { name: "openf1_positions", cols: ["session_key","driver_number","date","position"], key: "session_key" },
  { name: "openf1_locations", cols: ["session_key","driver_number","t_sec","x","y"], key: "session_key" },
  { name: "openf1_car_data", cols: ["session_key","driver_number","t_sec","speed","throttle","brake","n_gear","drs"], key: "session_key" },
  { name: "openf1_pits", cols: ["session_key","driver_number","lap_number","pit_duration","date"], key: "session_key" },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out: { season: number; round?: number } = { season: 2025 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--round") out.round = Number(args[++i]);
    else if (a === "--season") out.season = Number(args[++i]);
  }
  if (out.round === undefined) throw new Error("Pass --round <N>");
  return out;
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required");

  const { season, round } = parseArgs();
  const local = new Database(LOCAL_DB, { readonly: true });
  const turso = createClient({ url, authToken });

  // Find session_key for this race in the local DB.
  const session = local.prepare(`SELECT session_key FROM openf1_sessions WHERE season=? AND round=?`).get(season, round) as
    | { session_key: number } | undefined;
  if (!session) {
    console.error(`No openf1_sessions row for ${season} R${round} in local DB.`);
    process.exit(1);
  }
  const sessionKey = session.session_key;
  console.log(`[${season} R${round}] session_key=${sessionKey}`);

  for (const t of TABLES) {
    const rows = local.prepare(`SELECT ${t.cols.join(",")} FROM ${t.name} WHERE ${t.key}=?`).all(sessionKey) as Record<string, unknown>[];
    if (rows.length === 0) { console.log(`  ${t.name}: 0 rows (skip)`); continue; }

    // Wipe just this session's rows on Turso, then refill.
    await turso.execute({ sql: `DELETE FROM ${t.name} WHERE ${t.key}=?`, args: [sessionKey] });

    const placeholderRow = "(" + t.cols.map(() => "?").join(",") + ")";
    let inserted = 0;
    const startMs = Date.now();
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const placeholders = slice.map(() => placeholderRow).join(",");
      const args: unknown[] = [];
      for (const r of slice) for (const c of t.cols) args.push(r[c] ?? null);
      await turso.execute({
        sql: `INSERT INTO ${t.name} (${t.cols.join(",")}) VALUES ${placeholders}`,
        args: args as InValue[],
      });
      inserted += slice.length;
      if (rows.length > BATCH * 4 && inserted % (BATCH * 10) === 0) {
        process.stdout.write(`  ${t.name}: ${inserted}/${rows.length}\r`);
      }
    }
    const secs = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`  ${t.name}: ${inserted} rows in ${secs}s${" ".repeat(20)}`);
  }

  local.close();
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
