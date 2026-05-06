// Watches the local SQLite for new openf1_sessions rows that aren't yet on
// Turso, and pushes their data up. Run alongside the bulk fetch so each
// completed race lands on Turso shortly after it lands locally.
//
// Usage:  npm run auto:sync
// Stop with Ctrl+C; safe to re-run anytime.

import { createClient, type InValue } from "@libsql/client";
import Database from "better-sqlite3";
import path from "node:path";
import { loadRaceReplay } from "../src/lib/race-data";

const LOCAL_DB = path.join(process.cwd(), "data", "f1.db");
const BATCH = 2000;
const POLL_MS = 30_000;

const TABLES: { name: string; cols: string[] }[] = [
  { name: "openf1_sessions", cols: ["session_key","meeting_key","season","round","session_type","session_name","date_start"] },
  { name: "openf1_drivers", cols: ["session_key","driver_number","acronym","full_name","team_name","team_color"] },
  { name: "openf1_laps", cols: ["session_key","driver_number","lap_number","lap_duration","duration_sector_1","duration_sector_2","duration_sector_3","date_start","is_pit_out_lap"] },
  { name: "openf1_positions", cols: ["session_key","driver_number","date","position"] },
  { name: "openf1_locations", cols: ["session_key","driver_number","t_sec","x","y"] },
  { name: "openf1_car_data", cols: ["session_key","driver_number","t_sec","speed","throttle","brake","n_gear","drs"] },
  { name: "openf1_pits", cols: ["session_key","driver_number","lap_number","pit_duration","date"] },
];

async function syncOne(local: Database.Database, turso: ReturnType<typeof createClient>, sessionKey: number) {
  // Delete child rows first (reverse FK order) so we don't violate foreign
  // key constraints on Turso. openf1_sessions is the parent of every other
  // openf1_* table, so it must be deleted last and inserted first.
  for (let i = TABLES.length - 1; i >= 0; i--) {
    await turso.execute({ sql: `DELETE FROM ${TABLES[i].name} WHERE session_key=?`, args: [sessionKey] });
  }

  for (const t of TABLES) {
    const rows = local.prepare(`SELECT ${t.cols.join(",")} FROM ${t.name} WHERE session_key=?`).all(sessionKey) as Record<string, unknown>[];
    if (rows.length === 0) continue;
    const placeholderRow = "(" + t.cols.map(() => "?").join(",") + ")";
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const placeholders = slice.map(() => placeholderRow).join(",");
      const args: unknown[] = [];
      for (const r of slice) for (const c of t.cols) args.push(r[c] ?? null);
      await turso.execute({
        sql: `INSERT INTO ${t.name} (${t.cols.join(",")}) VALUES ${placeholders}`,
        args: args as InValue[],
      });
    }
    process.stdout.write(`${t.name}:${rows.length} `);
  }
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required");

  const turso = createClient({ url, authToken });
  console.log("Auto-sync watcher started. Polling local DB every 30s. Ctrl+C to stop.\n");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const local = new Database(LOCAL_DB, { readonly: true });
      const localSessions = local.prepare(`SELECT session_key, season, round FROM openf1_sessions ORDER BY round`).all() as
        { session_key: number; season: number; round: number }[];

      const remoteRows = await turso.execute(`SELECT session_key FROM openf1_sessions`);
      const remoteSet = new Set<number>();
      for (const r of remoteRows.rows) remoteSet.add(Number(r[0]));

      // Also re-check size of locations on Turso vs local — if mismatched,
      // the prior sync may have been partial; re-sync.
      const local2 = local;
      const incomplete: { session_key: number; season: number; round: number }[] = [];
      for (const s of localSessions) {
        if (!remoteSet.has(s.session_key)) { incomplete.push(s); continue; }
        const localCount = (local2.prepare(`SELECT COUNT(*) AS n FROM openf1_locations WHERE session_key=?`).get(s.session_key) as { n: number }).n;
        const r = await turso.execute({ sql: `SELECT COUNT(*) FROM openf1_locations WHERE session_key=?`, args: [s.session_key] });
        const remoteCount = Number(r.rows[0][0]);
        if (remoteCount !== localCount) incomplete.push(s);
      }
      local.close();

      if (incomplete.length === 0) {
        process.stdout.write(`[${new Date().toLocaleTimeString()}] up-to-date (${localSessions.length} races on Turso)\r`);
      } else {
        for (const s of incomplete) {
          const start = Date.now();
          process.stdout.write(`\n[${new Date().toLocaleTimeString()}] R${s.round} sync: `);
          const localR = new Database(LOCAL_DB, { readonly: true });
          await syncOne(localR, turso, s.session_key);
          localR.close();
          const secs = ((Date.now() - start) / 1000).toFixed(1);
          process.stdout.write(`(${secs}s) `);

          // Precompute the replay JSON immediately after sync so the API
          // route can serve it from cache on the very first request.
          try {
            const replay = await loadRaceReplay(s.season, s.round);
            if (replay) {
              const json = JSON.stringify(replay);
              await turso.execute({
                sql: `INSERT OR REPLACE INTO replay_cache (season, round, json, built_at) VALUES (?, ?, ?, ?)`,
                args: [s.season, s.round, json, new Date().toISOString()],
              });
              process.stdout.write(`+ cache ${(json.length / 1024 / 1024).toFixed(1)}MB`);
            }
          } catch (e) {
            process.stdout.write(`cache failed: ${e instanceof Error ? e.message : e}`);
          }
          process.stdout.write("\n");
        }
      }
    } catch (e) {
      console.error("\n  poll error:", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
