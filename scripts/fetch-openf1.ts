// Fetch OpenF1 lap/position/pit data for 2025 Race sessions and store in
// data/f1.db. Free tier is 3 req/s — we throttle to ~2.5 to stay safe.
//
// Usage:
//   npm run fetch:openf1 -- --round 1
//   npm run fetch:openf1 -- --all
//   npm run fetch:openf1 -- --season 2025 --round 1

import { openDb } from "../src/lib/db-local";

const BASE = "https://api.openf1.org/v1";
const MIN_REQUEST_INTERVAL_MS = 400; // ~2.5 req/s

let lastRequestAt = 0;
async function getJson<T = unknown>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  // Throttle.
  const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url.toString());
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429) {
      // Backoff and retry.
      const backoff = 1000 * Math.pow(2, attempt);
      console.warn(`  429 from ${url.pathname}${url.search}, backing off ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    throw new Error(`OpenF1 ${res.status} ${res.statusText} for ${url.toString()}`);
  }
  throw new Error(`OpenF1 retries exhausted for ${url.toString()}`);
}

type OF1Session = {
  session_key: number;
  meeting_key: number;
  session_type: string;
  session_name: string;
  date_start: string;
  country_name: string;
  location: string;
  year: number;
};

type OF1Driver = {
  session_key: number;
  driver_number: number;
  name_acronym: string;
  full_name: string;
  team_name: string;
  team_colour?: string;
};

type OF1Lap = {
  session_key: number;
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  date_start: string | null;
  is_pit_out_lap: boolean;
};

type OF1Position = {
  session_key: number;
  driver_number: number;
  date: string;
  position: number;
};

type OF1Pit = {
  session_key: number;
  driver_number: number;
  lap_number: number | null;
  pit_duration: number | null;
  date: string;
};

type OF1Location = {
  session_key: number;
  driver_number: number;
  date: string;
  x: number;
  y: number;
  z: number;
};

type OF1Car = {
  session_key: number;
  driver_number: number;
  date: string;
  speed: number;
  throttle: number;
  brake: number;
  n_gear: number;
  drs: number;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out: { season: number; round?: number; all: boolean; telemetry: boolean; telemetryHz: number } = {
    season: 2025, all: false, telemetry: false, telemetryHz: 2,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--all") out.all = true;
    else if (a === "--round") out.round = Number(args[++i]);
    else if (a === "--season") out.season = Number(args[++i]);
    else if (a === "--telemetry" || a === "--locations") out.telemetry = true;
    else if (a === "--telemetry-hz" || a === "--location-hz") out.telemetryHz = Number(args[++i]);
  }
  if (!out.all && out.round === undefined) {
    throw new Error("Pass --round <N> or --all");
  }
  return out;
}

async function fetchLocations(
  db: ReturnType<typeof openDb>, sessionKey: number, drivers: OF1Driver[], hz: number,
) {
  // Race-start anchor: earliest date_start across any lap. Some races
  // (e.g. red-flag restarts) don't have a date_start on lap 1, so we fall
  // back to the earliest available lap.
  const firstLap = db.prepare(
    `SELECT date_start FROM openf1_laps WHERE session_key=?
     AND date_start IS NOT NULL ORDER BY date_start ASC LIMIT 1`,
  ).get(sessionKey) as { date_start: string } | undefined;
  if (!firstLap) {
    console.warn(`  fetch skipped — no lap date_start in DB`);
    return;
  }
  const raceStartMs = Date.parse(firstLap.date_start);
  const intervalMs = Math.max(50, Math.round(1000 / hz));

  db.prepare(`DELETE FROM openf1_locations WHERE session_key=?`).run(sessionKey);
  const ins = db.prepare(`INSERT INTO openf1_locations
    (session_key, driver_number, t_sec, x, y) VALUES (?, ?, ?, ?, ?)`);

  let totalKept = 0;
  let skipped = 0;
  for (const d of drivers) {
    let data: OF1Location[];
    try {
      data = await getJson<OF1Location[]>("/location", { session_key: sessionKey, driver_number: d.driver_number });
    } catch (e) {
      // OpenF1 sometimes 422s for individual drivers (no telemetry recorded
      // for that car in this session). Skip them rather than aborting the
      // whole race.
      console.warn(`    skip driver #${d.driver_number} location: ${e instanceof Error ? e.message : e}`);
      skipped++;
      continue;
    }
    if (!Array.isArray(data) || data.length === 0) continue;
    // Sort defensively; OpenF1 returns ordered but no contract.
    data.sort((a, b) => a.date.localeCompare(b.date));

    db.transaction(() => {
      let lastKeptMs = -Infinity;
      for (const p of data) {
        const ms = Date.parse(p.date);
        if (!Number.isFinite(ms)) continue;
        if (ms - lastKeptMs < intervalMs) continue;
        // Drop pre-race & post-race samples (cars stay in pit lane sending GPS).
        // Keep a small pre-grid window (-30s) so the grid formation is visible.
        const tSec = (ms - raceStartMs) / 1000;
        if (tSec < -30) continue;
        ins.run(sessionKey, d.driver_number, tSec, p.x, p.y);
        lastKeptMs = ms;
        totalKept++;
      }
    })();
  }
  console.log(`  locations: ${totalKept} (${hz}Hz)`);
}

async function fetchCarData(
  db: ReturnType<typeof openDb>, sessionKey: number, drivers: OF1Driver[], hz: number,
) {
  const firstLap = db.prepare(
    `SELECT date_start FROM openf1_laps WHERE session_key=?
     AND date_start IS NOT NULL ORDER BY date_start ASC LIMIT 1`,
  ).get(sessionKey) as { date_start: string } | undefined;
  if (!firstLap) {
    console.warn(`  car_data fetch skipped — no lap date_start in DB`);
    return;
  }
  const raceStartMs = Date.parse(firstLap.date_start);
  const intervalMs = Math.max(50, Math.round(1000 / hz));

  db.prepare(`DELETE FROM openf1_car_data WHERE session_key=?`).run(sessionKey);
  const ins = db.prepare(`INSERT INTO openf1_car_data
    (session_key, driver_number, t_sec, speed, throttle, brake, n_gear, drs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  let totalKept = 0;
  for (const d of drivers) {
    let data: OF1Car[];
    try {
      data = await getJson<OF1Car[]>("/car_data", { session_key: sessionKey, driver_number: d.driver_number });
    } catch (e) {
      console.warn(`    skip driver #${d.driver_number} car_data: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (!Array.isArray(data) || data.length === 0) continue;
    data.sort((a, b) => a.date.localeCompare(b.date));

    db.transaction(() => {
      let lastKeptMs = -Infinity;
      for (const p of data) {
        const ms = Date.parse(p.date);
        if (!Number.isFinite(ms)) continue;
        if (ms - lastKeptMs < intervalMs) continue;
        const tSec = (ms - raceStartMs) / 1000;
        if (tSec < -30) continue;
        ins.run(sessionKey, d.driver_number, tSec, p.speed, p.throttle, p.brake, p.n_gear, p.drs);
        lastKeptMs = ms;
        totalKept++;
      }
    })();
  }
  console.log(`  car_data: ${totalKept} (${hz}Hz)`);
}

async function fetchOneRace(
  db: ReturnType<typeof openDb>, season: number, round: number,
  opts: { telemetry: boolean; telemetryHz: number },
) {
  console.log(`\n[${season} R${round}]`);

  const race = db.prepare(`SELECT race_name, date FROM races WHERE season=? AND round=?`).get(season, round) as
    | { race_name: string; date: string }
    | undefined;
  if (!race) {
    console.warn(`  not in races table — skipping`);
    return;
  }
  console.log(`  ${race.race_name} (${race.date})`);

  // Find the Race session for this date. OpenF1 uses date_start which is a
  // datetime; we match by year + the race date's day.
  const sessions = await getJson<OF1Session[]>("/sessions", { year: season, session_type: "Race" });
  // Try exact date match first, then ±1 day for races whose UTC start
  // straddles midnight in their local time (e.g. Vegas night race).
  const raceDayMs = Date.parse(race.date + "T12:00:00Z");
  let target = sessions.find((s) => s.date_start.startsWith(race.date));
  if (!target) {
    target = sessions.find((s) => Math.abs(Date.parse(s.date_start) - raceDayMs) <= 36 * 3600 * 1000);
  }
  if (!target) {
    console.warn(`  no OpenF1 Race session matches date ${race.date} — skipping`);
    return;
  }
  console.log(`  session_key=${target.session_key} meeting_key=${target.meeting_key}`);

  // Replace any existing rows for this session_key so re-runs are clean.
  // Delete child tables first (reverse FK order) so we don't violate FK
  // constraints. openf1_sessions is the parent, deleted last.
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM openf1_locations WHERE session_key=?`).run(target.session_key);
    db.prepare(`DELETE FROM openf1_car_data WHERE session_key=?`).run(target.session_key);
    db.prepare(`DELETE FROM openf1_pits WHERE session_key=?`).run(target.session_key);
    db.prepare(`DELETE FROM openf1_positions WHERE session_key=?`).run(target.session_key);
    db.prepare(`DELETE FROM openf1_laps WHERE session_key=?`).run(target.session_key);
    db.prepare(`DELETE FROM openf1_drivers WHERE session_key=?`).run(target.session_key);
    db.prepare(`DELETE FROM openf1_sessions WHERE session_key=?`).run(target.session_key);

    db.prepare(`INSERT INTO openf1_sessions
      (session_key, meeting_key, season, round, session_type, session_name, date_start)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      target.session_key, target.meeting_key, season, round,
      target.session_type, target.session_name, target.date_start,
    );
  });
  tx();

  const drivers = await getJson<OF1Driver[]>("/drivers", { session_key: target.session_key });
  const insDriver = db.prepare(`INSERT INTO openf1_drivers
    (session_key, driver_number, acronym, full_name, team_name, team_color) VALUES (?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (const d of drivers) {
      insDriver.run(target.session_key, d.driver_number, d.name_acronym, d.full_name, d.team_name, d.team_colour ?? null);
    }
  })();
  console.log(`  drivers: ${drivers.length}`);

  const laps = await getJson<OF1Lap[]>("/laps", { session_key: target.session_key });
  const insLap = db.prepare(`INSERT INTO openf1_laps
    (session_key, driver_number, lap_number, lap_duration, duration_sector_1, duration_sector_2, duration_sector_3, date_start, is_pit_out_lap)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (const l of laps) {
      insLap.run(
        target.session_key, l.driver_number, l.lap_number,
        l.lap_duration, l.duration_sector_1, l.duration_sector_2, l.duration_sector_3,
        l.date_start, l.is_pit_out_lap ? 1 : 0,
      );
    }
  })();
  console.log(`  laps: ${laps.length}`);

  const positions = await getJson<OF1Position[]>("/position", { session_key: target.session_key });
  const insPos = db.prepare(`INSERT INTO openf1_positions
    (session_key, driver_number, date, position) VALUES (?, ?, ?, ?)`);
  db.transaction(() => {
    for (const p of positions) {
      insPos.run(target.session_key, p.driver_number, p.date, p.position);
    }
  })();
  console.log(`  positions: ${positions.length}`);

  const pits = await getJson<OF1Pit[]>("/pit", { session_key: target.session_key });
  const insPit = db.prepare(`INSERT INTO openf1_pits
    (session_key, driver_number, lap_number, pit_duration, date) VALUES (?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (const p of pits) {
      insPit.run(target.session_key, p.driver_number, p.lap_number, p.pit_duration, p.date);
    }
  })();
  console.log(`  pits: ${pits.length}`);

  if (opts.telemetry) {
    await fetchLocations(db, target.session_key, drivers, opts.telemetryHz);
    await fetchCarData(db, target.session_key, drivers, opts.telemetryHz);
  }
}

async function main() {
  const { season, round, all, telemetry, telemetryHz } = parseArgs();
  const db = openDb();
  const opts = { telemetry, telemetryHz };

  if (all) {
    const rounds = db.prepare(`SELECT round FROM races WHERE season=? ORDER BY round`).all(season) as { round: number }[];
    for (const r of rounds) {
      try {
        await fetchOneRace(db, season, r.round, opts);
      } catch (e) {
        console.error(`  ERROR on ${season} R${r.round}:`, e instanceof Error ? e.message : e);
      }
    }
  } else if (round !== undefined) {
    await fetchOneRace(db, season, round, opts);
  }

  db.close();
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
