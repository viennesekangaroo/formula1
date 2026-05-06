// Pre-build the per-race replay JSON to public/api/race/N.json.br.
// Brotli-compressed so the over-the-wire transfer is tiny; Vercel ships
// these as static assets (free, edge-cached, no Turso quota).
//
// Usage:
//   npm run build:races                  # all races present in the local DB
//   npm run build:races -- --round 1
//   npm run build:races -- --season 2025
//
// Reads from the LOCAL data/f1.db (built via `npm run ingest` +
// `npm run fetch:openf1`). The runtime app reads the resulting .json.br
// files directly.

import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import Database from "better-sqlite3";

import type {
  RaceReplay, RaceMeta, RaceDriver, LapPoint, PositionEvent, PitEvent,
  DriverTrace, DriverTelemetry, TrackBounds,
} from "../src/lib/race-data";

const LOCAL_DB = path.join(process.cwd(), "data", "f1.db");

function parseArgs() {
  const args = process.argv.slice(2);
  const out: { season: number; round?: number } = { season: 2025 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--round") out.round = Number(args[++i]);
    else if (a === "--season") out.season = Number(args[++i]);
  }
  return out;
}

// Local-SQLite implementation of loadRaceReplay. Mirrors src/lib/race-data
// but with sync better-sqlite3 calls. Kept separate so the runtime path
// (Turso) and the build path (local) don't have to share an async API.
function loadReplayFromLocal(db: Database.Database, season: number, round: number): RaceReplay | null {
  const meta = db.prepare(`
    SELECT r.season AS season, r.round AS round, r.race_name AS raceName, r.date AS date,
           r.circuit_id AS circuitId, c.name AS circuitName, c.country AS country,
           s.session_key AS sessionKey
    FROM races r
    LEFT JOIN circuits c ON c.circuit_id = r.circuit_id
    LEFT JOIN openf1_sessions s ON s.season = r.season AND s.round = r.round
    WHERE r.season = ? AND r.round = ?
  `).get(season, round) as
    | (Omit<RaceMeta, "totalLaps"> & { sessionKey: number | null })
    | undefined;
  if (!meta || meta.sessionKey === null) return null;
  const sessionKey = meta.sessionKey;

  const totalLapsRow = db.prepare(`SELECT MAX(lap_number) AS n FROM openf1_laps WHERE session_key=?`).get(sessionKey) as { n: number | null };
  const totalLaps = totalLapsRow?.n ?? 0;

  const drivers = db.prepare(`
    SELECT od.driver_number AS driverNumber, od.acronym AS acronym, od.full_name AS fullName,
           od.team_name AS team, od.team_color AS teamColor,
           rr.status AS finishStatus, rr.laps AS classifiedLaps
    FROM openf1_drivers od
    LEFT JOIN race_results rr
      ON rr.season = ? AND rr.round = ? AND rr.driver_number = od.driver_number
    WHERE od.session_key = ?
    ORDER BY od.driver_number
  `).all(season, round, sessionKey) as RaceDriver[];

  type RawLap = { driver_number: number; lap_number: number; lap_duration: number | null; date_start: string | null };
  const rawLaps = db.prepare(`
    SELECT driver_number, lap_number, lap_duration, date_start
    FROM openf1_laps WHERE session_key = ?
    ORDER BY driver_number, lap_number
  `).all(sessionKey) as RawLap[];

  // Race start anchor: earliest lap-1 date_start. Falls back to earliest
  // date_start across any lap (red-flag restart races).
  let raceStartMs: number | null = null;
  for (const l of rawLaps) {
    if (l.lap_number === 1 && l.date_start) {
      const ms = Date.parse(l.date_start);
      if (raceStartMs === null || ms < raceStartMs) raceStartMs = ms;
    }
  }
  if (raceStartMs === null) {
    for (const l of rawLaps) {
      if (l.date_start) {
        const ms = Date.parse(l.date_start);
        if (raceStartMs === null || ms < raceStartMs) raceStartMs = ms;
      }
    }
  }
  if (raceStartMs === null) raceStartMs = 0;

  // Per-driver cumulative lap times.
  type DriverLap = { lap: number; lapEndSec: number; lapDuration: number | null };
  const byDriver = new Map<number, RawLap[]>();
  for (const l of rawLaps) {
    const arr = byDriver.get(l.driver_number) ?? [];
    arr.push(l);
    byDriver.set(l.driver_number, arr);
  }
  const driverLaps = new Map<number, DriverLap[]>();
  for (const [num, arr] of byDriver) {
    const out: DriverLap[] = [];
    let prevEnd = 0;
    for (const l of arr) {
      const dur = l.lap_duration;
      let endSec: number;
      if (l.date_start && dur !== null) endSec = (Date.parse(l.date_start) - raceStartMs) / 1000 + dur;
      else if (dur !== null) endSec = prevEnd + dur;
      else endSec = prevEnd + 90;
      if (endSec < prevEnd) endSec = prevEnd + (dur ?? 90);
      out.push({ lap: l.lap_number, lapEndSec: endSec, lapDuration: dur });
      prevEnd = endSec;
    }
    driverLaps.set(num, out);
  }

  const leaderEnd = new Map<number, number>();
  for (const lapsArr of driverLaps.values()) {
    for (const l of lapsArr) {
      const cur = leaderEnd.get(l.lap);
      if (cur === undefined || l.lapEndSec < cur) leaderEnd.set(l.lap, l.lapEndSec);
    }
  }

  const laps: LapPoint[] = [];
  for (const [num, arr] of driverLaps) {
    for (const l of arr) {
      const leader = leaderEnd.get(l.lap) ?? l.lapEndSec;
      laps.push({
        driverNumber: num,
        lap: l.lap,
        lapDuration: l.lapDuration,
        lapEndSec: l.lapEndSec,
        gapSec: l.lapEndSec - leader,
      });
    }
  }

  const rawPos = db.prepare(`
    SELECT driver_number, date, position FROM openf1_positions
    WHERE session_key = ? ORDER BY date
  `).all(sessionKey) as { driver_number: number; date: string; position: number }[];
  const positions: PositionEvent[] = rawPos.map((p) => ({
    driverNumber: p.driver_number,
    tSec: (Date.parse(p.date) - raceStartMs) / 1000,
    position: p.position,
  })).filter((p) => Number.isFinite(p.tSec));

  type RawPit = { driver_number: number; lap_number: number | null; pit_duration: number | null; date: string | null };
  const rawPits = db.prepare(`
    SELECT driver_number, lap_number, pit_duration, date FROM openf1_pits
    WHERE session_key = ? AND lap_number IS NOT NULL
  `).all(sessionKey) as RawPit[];
  const pits: PitEvent[] = rawPits.map((p) => ({
    driverNumber: p.driver_number,
    lap: p.lap_number!,
    durationSec: p.pit_duration ?? 0,
    tSec: p.date ? (Date.parse(p.date) - raceStartMs) / 1000 : 0,
  }));

  let durationSec = 0;
  for (const l of laps) if (l.lapEndSec > durationSec) durationSec = l.lapEndSec;

  const rawLocs = db.prepare(`
    SELECT driver_number, t_sec, x, y FROM openf1_locations
    WHERE session_key = ? ORDER BY driver_number, t_sec
  `).all(sessionKey) as { driver_number: number; t_sec: number; x: number; y: number }[];

  const traceMap = new Map<number, { t: number[]; x: number[]; y: number[] }>();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const row of rawLocs) {
    const tr = traceMap.get(row.driver_number) ?? { t: [], x: [], y: [] };
    tr.t.push(row.t_sec); tr.x.push(row.x); tr.y.push(row.y);
    traceMap.set(row.driver_number, tr);
    if (row.x < minX) minX = row.x;
    if (row.x > maxX) maxX = row.x;
    if (row.y < minY) minY = row.y;
    if (row.y > maxY) maxY = row.y;
  }
  const traces: DriverTrace[] = [];
  for (const [driverNumber, v] of traceMap) traces.push({ driverNumber, t: v.t, x: v.x, y: v.y });
  const trackBounds: TrackBounds | null = traces.length > 0 ? { minX, maxX, minY, maxY } : null;

  const rawCars = db.prepare(`
    SELECT driver_number, t_sec, speed, throttle, brake, n_gear, drs
    FROM openf1_car_data WHERE session_key = ?
    ORDER BY driver_number, t_sec
  `).all(sessionKey) as {
    driver_number: number; t_sec: number;
    speed: number | null; throttle: number | null; brake: number | null;
    n_gear: number | null; drs: number | null;
  }[];

  type TelMap = { t: number[]; speed: number[]; throttle: number[]; brake: number[]; gear: number[]; drs: number[] };
  const telMap = new Map<number, TelMap>();
  for (const r of rawCars) {
    const tm = telMap.get(r.driver_number) ?? { t: [], speed: [], throttle: [], brake: [], gear: [], drs: [] };
    tm.t.push(r.t_sec);
    tm.speed.push(r.speed ?? 0);
    tm.throttle.push(r.throttle ?? 0);
    tm.brake.push(r.brake ?? 0);
    tm.gear.push(r.n_gear ?? 0);
    tm.drs.push(r.drs ?? 0);
    telMap.set(r.driver_number, tm);
  }
  const telemetry: DriverTelemetry[] = [];
  for (const [driverNumber, v] of telMap) telemetry.push({ driverNumber, ...v });

  // Pit lane outline derivation — same algorithm as the runtime path.
  let pitLane = "";
  if (rawPits.length > 0 && traces.length > 0) {
    const driverTraces = new Map<number, DriverTrace>();
    for (const t of traces) driverTraces.set(t.driverNumber, t);
    type Pt = { x: number; y: number };
    const samples: Pt[] = [];
    for (const p of rawPits) {
      if (!p.date || p.lap_number === null) continue;
      const pitT = (Date.parse(p.date) - raceStartMs) / 1000;
      if (!Number.isFinite(pitT)) continue;
      const dur = p.pit_duration ?? 30;
      const winStart = pitT - 8;
      const winEnd = pitT + dur + 5;
      const tr = driverTraces.get(p.driver_number);
      if (!tr) continue;
      for (let i = 0; i < tr.t.length; i++) {
        const tt = tr.t[i];
        if (tt < winStart) continue;
        if (tt > winEnd) break;
        samples.push({ x: tr.x[i], y: tr.y[i] });
      }
    }
    if (samples.length > 0) {
      const BUCKET = 60;
      type Bucket = { sx: number; sy: number; n: number };
      const buckets = new Map<string, Bucket>();
      for (const s of samples) {
        const key = `${Math.round(s.x / BUCKET)}|${Math.round(s.y / BUCKET)}`;
        const b = buckets.get(key) ?? { sx: 0, sy: 0, n: 0 };
        b.sx += s.x; b.sy += s.y; b.n += 1;
        buckets.set(key, b);
      }
      const pts: { x: number; y: number }[] = [];
      for (const b of buckets.values()) {
        if (b.n < 3) continue;
        pts.push({ x: b.sx / b.n, y: b.sy / b.n });
      }
      pitLane = pts.map((p) => `M${p.x.toFixed(0)} ${p.y.toFixed(0)}l0 0`).join(" ");
    }
  }

  return {
    meta: { ...meta, totalLaps },
    drivers, laps, positions, pits, traces, telemetry, trackBounds, durationSec, pitLane,
  };
}

async function main() {
  if (!existsSync(LOCAL_DB)) {
    console.error(`[build:races] ${LOCAL_DB} not found. Run 'npm run ingest' first.`);
    process.exit(1);
  }

  const { season, round } = parseArgs();
  const db = new Database(LOCAL_DB, { readonly: true });

  let rounds: number[];
  if (round !== undefined) {
    rounds = [round];
  } else {
    const r = db.prepare(`SELECT DISTINCT round FROM openf1_sessions WHERE season=? ORDER BY round`).all(season) as { round: number }[];
    rounds = r.map((row) => row.round);
  }

  // Season-prefixed output so we can host multiple seasons side by side
  // without stomping each other.
  const outDir = path.join(process.cwd(), "public", "api", "race", String(season));
  await fs.mkdir(outDir, { recursive: true });

  console.log(`[build:races] generating ${rounds.length} race(s) -> ${outDir}`);
  let totalRawBytes = 0;
  let totalBrBytes = 0;
  const built: number[] = [];

  for (const r of rounds) {
    const start = Date.now();
    process.stdout.write(`  R${r}: `);
    const replay = loadReplayFromLocal(db, season, r);
    if (!replay) { console.log("no data"); continue; }
    // Skip stubs — races where OpenF1 has a session entry but no actual
    // lap timing yet (upcoming races). The page treats those as "no
    // replay yet" via the season manifest.
    if (replay.laps.length === 0) {
      console.log("no laps yet — skipping");
      continue;
    }
    const json = JSON.stringify(replay);
    const raw = Buffer.byteLength(json, "utf8");
    // Brotli with high quality (slow at build time, small at runtime).
    const br = brotliCompressSync(Buffer.from(json), {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      },
    });
    await fs.writeFile(path.join(outDir, `${r}.json.br`), br);
    totalRawBytes += raw;
    totalBrBytes += br.byteLength;
    built.push(r);
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `${(raw / 1024 / 1024).toFixed(1)} MB raw -> ` +
      `${(br.byteLength / 1024 / 1024).toFixed(1)} MB br ` +
      `(${secs}s)`,
    );
  }

  // Season manifest: enough info to render the season-index page and the
  // race-shell header (title, circuit, date, prev/next links) without ever
  // touching Turso at runtime.
  type SeasonRow = {
    season: number; round: number; raceName: string; date: string;
    circuitId: string | null; circuitName: string | null; country: string | null;
    hasReplay: boolean;
    winnerName: string | null; winnerConstructor: string | null;
    winnerConstructorId: string | null; winnerTeamColor: string | null;
    lat: number | null; lng: number | null;
  };
  const seasonRows = db.prepare(`
    SELECT
      r.season AS season, r.round AS round, r.race_name AS raceName, r.date AS date,
      r.circuit_id AS circuitId, c.name AS circuitName, c.country AS country,
      c.lat AS lat, c.lng AS lng,
      CASE WHEN s.session_key IS NULL THEN 0
           WHEN (SELECT COUNT(*) FROM openf1_laps WHERE session_key = s.session_key) = 0 THEN 0
           ELSE 1 END AS hasReplay,
      w.driver_name AS winnerName,
      w.constructor AS winnerConstructor,
      w.constructor_id AS winnerConstructorId,
      w.team_color AS winnerTeamColor
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
    ORDER BY r.round ASC
  `).all(season).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      season: row.season as number,
      round: row.round as number,
      raceName: row.raceName as string,
      date: row.date as string,
      circuitId: row.circuitId as string | null,
      circuitName: row.circuitName as string | null,
      country: row.country as string | null,
      hasReplay: row.hasReplay === 1,
      winnerName: row.winnerName as string | null,
      winnerConstructor: row.winnerConstructor as string | null,
      winnerConstructorId: row.winnerConstructorId as string | null,
      winnerTeamColor: row.winnerTeamColor as string | null,
      lat: row.lat as number | null,
      lng: row.lng as number | null,
    } satisfies SeasonRow;
  });

  await fs.writeFile(
    path.join(process.cwd(), "public", "api", `season-${season}.json`),
    JSON.stringify({ season, generatedAt: new Date().toISOString(), races: seasonRows }),
    "utf8",
  );

  const manifest = { season, rounds: built, generatedAt: new Date().toISOString() };
  await fs.writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  db.close();
  console.log(
    `[build:races] done. ` +
    `Total: ${(totalRawBytes / 1024 / 1024).toFixed(1)} MB raw -> ` +
    `${(totalBrBytes / 1024 / 1024).toFixed(1)} MB br`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
