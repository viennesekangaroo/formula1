// One-shot migration: copy local data/f1.db → Turso.
//
// Usage:
//   npm run migrate:turso             # migrate everything
//   npm run migrate:turso -- --table=openf1_locations  # one table only
//   npm run migrate:turso -- --drop   # drop & recreate tables on Turso first
//
// The script is idempotent within a table: it deletes existing rows for the
// table before inserting (so re-running gives a clean copy).

import { createClient } from "@libsql/client";
import Database from "better-sqlite3";
import path from "node:path";
import { SCHEMA } from "../src/lib/db";

const LOCAL_DB = path.join(process.cwd(), "data", "f1.db");
const BATCH = 500;

// Table copy order respects FK dependencies.
const TABLES: { name: string; cols: string[] }[] = [
  { name: "circuits", cols: ["circuit_id","name","city","country","lat","lng","url"] },
  { name: "constructors", cols: ["constructor_id","name","nationality","url"] },
  { name: "drivers", cols: ["driver_id","code","permanent_num","given_name","family_name","full_name","dob","nationality","url"] },
  { name: "races", cols: ["season","round","race_name","date","time","circuit_id","url"] },
  { name: "race_results", cols: ["season","round","position","position_text","points","driver_id","driver_code","driver_number","constructor_id","grid_pos","laps","status","time_finished","fastest_lap_time","fastest_lap_rank","avg_speed_kph"] },
  { name: "qualifying", cols: ["season","round","position","driver_id","constructor_id","q1","q2","q3"] },
  { name: "pit_stops", cols: ["season","round","driver_id","stop","lap","time","duration_s","is_red_flag_hold"] },
  { name: "driver_standings", cols: ["season","round","position","points","wins","driver_id","constructor_id"] },
  { name: "constructor_standings", cols: ["season","round","position","points","wins","constructor_id"] },
  { name: "openf1_sessions", cols: ["session_key","meeting_key","season","round","session_type","session_name","date_start"] },
  { name: "openf1_drivers", cols: ["session_key","driver_number","acronym","full_name","team_name","team_color"] },
  { name: "openf1_laps", cols: ["session_key","driver_number","lap_number","lap_duration","duration_sector_1","duration_sector_2","duration_sector_3","date_start","is_pit_out_lap"] },
  { name: "openf1_positions", cols: ["session_key","driver_number","date","position"] },
  { name: "openf1_locations", cols: ["session_key","driver_number","t_sec","x","y"] },
  { name: "openf1_car_data", cols: ["session_key","driver_number","t_sec","speed","throttle","brake","n_gear","drs"] },
  { name: "openf1_pits", cols: ["session_key","driver_number","lap_number","pit_duration","date"] },
  { name: "meta", cols: ["key","value"] },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out: { table?: string; drop: boolean } = { drop: false };
  for (const a of args) {
    if (a === "--drop") out.drop = true;
    else if (a.startsWith("--table=")) out.table = a.slice("--table=".length);
  }
  return out;
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env.local");
  }

  const { table: onlyTable, drop } = parseArgs();
  const turso = createClient({ url, authToken });
  const local = new Database(LOCAL_DB, { readonly: true });

  // 1. Apply schema to Turso. SCHEMA contains CREATE TABLE IF NOT EXISTS so
  //    safe to run repeatedly. PRAGMAs at the top need to be stripped — Turso
  //    rejects them.
  if (drop) {
    console.log("Dropping existing tables on Turso (FK-safe order: reverse)…");
    for (const t of [...TABLES].reverse()) {
      await turso.execute(`DROP TABLE IF EXISTS ${t.name}`);
    }
  }
  console.log("Applying schema to Turso…");
  // Strip line comments (-- ...) before splitting on ;. SCHEMA has comment
  // blocks that would otherwise leave empty fragments after the split.
  const cleanedSchema = SCHEMA
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
  const stmts = cleanedSchema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.toUpperCase().startsWith("PRAGMA"));
  // Run sequentially because some CREATE TABLE statements reference others
  // (FKs) and Turso doesn't like batched DDL the same way.
  for (const s of stmts) {
    await turso.execute(s);
  }
  console.log(`  ${stmts.length} statements applied`);

  // 2. Copy data table by table.
  for (const t of TABLES) {
    if (onlyTable && t.name !== onlyTable) continue;

    const rows = local.prepare(`SELECT ${t.cols.join(",")} FROM ${t.name}`).all() as Record<string, unknown>[];
    if (rows.length === 0) {
      console.log(`${t.name}: 0 rows (skipping)`);
      continue;
    }

    // Wipe and refill so a re-run gives a clean copy.
    await turso.execute(`DELETE FROM ${t.name}`);

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
        args: args as never,
      });
      inserted += slice.length;
      if (rows.length > BATCH * 4 && inserted % (BATCH * 10) === 0) {
        const pct = Math.round((inserted / rows.length) * 100);
        process.stdout.write(`  ${t.name}: ${inserted}/${rows.length} (${pct}%)\r`);
      }
    }
    const secs = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`${t.name}: ${inserted} rows in ${secs}s${" ".repeat(20)}`);
  }

  local.close();
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
