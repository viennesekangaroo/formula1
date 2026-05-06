// Build pre-rendered replay JSON for each race that has OpenF1 data, store
// in Turso's replay_cache table. After running this, /api/race/[round] can
// fetch a single row instead of doing 6 large queries + reshape.
//
// Usage:
//   npm run precompute                       # all races with data
//   npm run precompute -- --round 1          # one race
//   npm run precompute -- --force            # rebuild even if already cached

import { createClient } from "@libsql/client";
import { loadRaceReplay } from "../src/lib/race-data";

function parseArgs() {
  const args = process.argv.slice(2);
  const out: { season: number; round?: number; force: boolean } = { season: 2025, force: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--force") out.force = true;
    else if (a === "--round") out.round = Number(args[++i]);
    else if (a === "--season") out.season = Number(args[++i]);
  }
  return out;
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error("TURSO env vars required");
  const turso = createClient({ url, authToken });
  const { season, round, force } = parseArgs();

  // Pick the rounds to build.
  let rounds: number[];
  if (round !== undefined) {
    rounds = [round];
  } else {
    const r = await turso.execute({
      sql: `SELECT DISTINCT round FROM openf1_sessions WHERE season=? ORDER BY round`,
      args: [season],
    });
    rounds = r.rows.map((row) => Number(row[0]));
  }

  // Skip rounds already cached unless --force.
  if (!force) {
    const have = await turso.execute({
      sql: `SELECT round FROM replay_cache WHERE season=?`,
      args: [season],
    });
    const cached = new Set<number>(have.rows.map((row) => Number(row[0])));
    rounds = rounds.filter((r) => !cached.has(r));
    if (rounds.length === 0) {
      console.log("All requested rounds already cached. Use --force to rebuild.");
      return;
    }
  }

  console.log(`Building replay cache for ${rounds.length} round(s): ${rounds.join(", ")}`);
  const builtAt = new Date().toISOString();

  for (const r of rounds) {
    const start = Date.now();
    process.stdout.write(`R${r}: building… `);
    const replay = await loadRaceReplay(season, r);
    if (!replay) {
      console.log("no data — skipping");
      continue;
    }
    const json = JSON.stringify(replay);
    process.stdout.write(`${(json.length / 1024 / 1024).toFixed(1)} MB · `);
    await turso.execute({
      sql: `INSERT OR REPLACE INTO replay_cache (season, round, json, built_at) VALUES (?, ?, ?, ?)`,
      args: [season, r, json, builtAt],
    });
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`stored in ${secs}s`);
  }

  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
