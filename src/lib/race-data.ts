import { query, queryOne } from "./db";

export type RaceMeta = {
  season: number;
  round: number;
  raceName: string;
  date: string;
  circuitId: string | null;
  circuitName: string | null;
  country: string | null;
  sessionKey: number | null;
  totalLaps: number;
};

export type RaceDriver = {
  driverNumber: number;
  acronym: string;
  fullName: string;
  team: string;
  teamColor: string | null;
  // From the Kaggle race_results.status column. "Finished", "+1 Lap", etc =
  // classified. Anything else ("Collision", "Engine", "Retired", "DNF" etc) =
  // retired. Null if we couldn't link this OpenF1 driver to a result row.
  finishStatus: string | null;
  // Laps actually completed per the official result. 0 = lap-1 incident, no
  // racing lap completed; treated as "did not race" by the renderer.
  classifiedLaps: number | null;
  // Final classified position from race_results (1-based). Drives the
  // running-order sort and lets us show finish times for completed races.
  finishPosition: number | null;
  // race_results.time_finished — for the winner this is total race time
  // ("1:24:38.241"), for others it's the gap to the leader ("+7.995").
  // Empty/null for retirees.
  timeFinished: string | null;
};

// Per-driver per-lap. lapEndSec is the playback clock at the end of that lap
// (cumulative race time in seconds, including pit-stop dwell). gapSec is the
// gap to the leader at lap end.
export type LapPoint = {
  driverNumber: number;
  lap: number;
  lapDuration: number | null;
  lapEndSec: number;
  gapSec: number;
};

// Position events keyed by elapsed seconds since race start.
export type PositionEvent = {
  driverNumber: number;
  tSec: number;
  position: number;
};

export type PitEvent = {
  driverNumber: number;
  lap: number;
  durationSec: number;
  /** Race-clock seconds at the start of the stop (entering the pit box). */
  tSec: number;
};

// Real (x,y) coordinate samples per driver, with t in seconds since race
// start. Plain number[] for serialization; the client converts to typed
// arrays once and binary-searches t during animation.
export type DriverTrace = {
  driverNumber: number;
  t: number[];
  x: number[];
  y: number[];
};

// Telemetry samples per driver (speed/throttle/brake/gear/drs). t shares the
// race-start anchor with DriverTrace.
export type DriverTelemetry = {
  driverNumber: number;
  t: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  drs: number[];
};

export type TrackBounds = { minX: number; maxX: number; minY: number; maxY: number };

// SVG path data for a derived pit-lane outline. Built by sampling low-speed
// pit-stop location data; sent down with the rest of the replay JSON.
export type PitLane = string;

export type RaceReplay = {
  meta: RaceMeta;
  drivers: RaceDriver[];
  laps: LapPoint[];
  positions: PositionEvent[];
  pits: PitEvent[];
  traces: DriverTrace[];
  telemetry: DriverTelemetry[];
  trackBounds: TrackBounds | null;
  durationSec: number;
  pitLane: PitLane;
};

export async function loadRaceMeta(season: number, round: number): Promise<RaceMeta | null> {
  const row = await queryOne<Omit<RaceMeta, "totalLaps"> & { sessionKey: number | null }>(
    `SELECT r.season AS season, r.round AS round, r.race_name AS raceName, r.date AS date,
           r.circuit_id AS circuitId, c.name AS circuitName, c.country AS country,
           s.session_key AS sessionKey
    FROM races r
    LEFT JOIN circuits c ON c.circuit_id = r.circuit_id
    LEFT JOIN openf1_sessions s ON s.season = r.season AND s.round = r.round
    WHERE r.season = ? AND r.round = ?`,
    [season, round],
    (r) => ({
      season: r.season as number,
      round: r.round as number,
      raceName: r.raceName as string,
      date: r.date as string,
      circuitId: r.circuitId as string | null,
      circuitName: r.circuitName as string | null,
      country: r.country as string | null,
      sessionKey: r.sessionKey as number | null,
    }),
  );
  if (!row) return null;

  let totalLaps = 0;
  if (row.sessionKey !== null) {
    const r = await queryOne<{ n: number | null }>(
      `SELECT MAX(lap_number) AS n FROM openf1_laps WHERE session_key=?`,
      [row.sessionKey],
      (r) => ({ n: r.n as number | null }),
    );
    totalLaps = r?.n ?? 0;
  }
  return { ...row, totalLaps };
}

export async function loadRaceReplay(season: number, round: number): Promise<RaceReplay | null> {
  const meta = await loadRaceMeta(season, round);
  if (!meta || meta.sessionKey === null) return null;

  const sessionKey = meta.sessionKey;

  // Fan out all 6 reads in parallel. They only depend on sessionKey, so the
  // network round-trips overlap — total wall-time is roughly the slowest
  // single query (locations) instead of the sum.
  type RawLap = {
    driver_number: number; lap_number: number; lap_duration: number | null; date_start: string | null;
  };
  type RawPos = { driver_number: number; date: string; position: number };
  type RawPit = { driver_number: number; lap_number: number | null; pit_duration: number | null; date: string | null };
  type RawLoc = { driver_number: number; t_sec: number; x: number; y: number };
  type RawCar = {
    driver_number: number; t_sec: number;
    speed: number | null; throttle: number | null; brake: number | null;
    n_gear: number | null; drs: number | null;
  };

  const [drivers, rawLaps, rawPos, rawPits, rawLocs, rawCars] = await Promise.all([
    query<RaceDriver>(
      `SELECT od.driver_number AS driverNumber, od.acronym AS acronym, od.full_name AS fullName,
             od.team_name AS team, od.team_color AS teamColor,
             rr.status AS finishStatus, rr.laps AS classifiedLaps,
             rr.position AS finishPosition, rr.time_finished AS timeFinished
      FROM openf1_drivers od
      LEFT JOIN race_results rr
        ON rr.season = ? AND rr.round = ? AND rr.driver_number = od.driver_number
      WHERE od.session_key = ?
      ORDER BY od.driver_number`,
      [season, round, sessionKey],
      (r) => ({
        driverNumber: r.driverNumber as number,
        acronym: r.acronym as string,
        fullName: r.fullName as string,
        team: r.team as string,
        teamColor: r.teamColor as string | null,
        finishStatus: r.finishStatus as string | null,
        classifiedLaps: r.classifiedLaps as number | null,
        finishPosition: r.finishPosition as number | null,
        timeFinished: r.timeFinished as string | null,
      }),
    ),
    query<RawLap>(
      `SELECT driver_number, lap_number, lap_duration, date_start
      FROM openf1_laps WHERE session_key = ?
      ORDER BY driver_number, lap_number`,
      [sessionKey],
      (r) => ({
        driver_number: r.driver_number as number,
        lap_number: r.lap_number as number,
        lap_duration: r.lap_duration as number | null,
        date_start: r.date_start as string | null,
      }),
    ),
    query<RawPos>(
      `SELECT driver_number, date, position FROM openf1_positions
      WHERE session_key = ? ORDER BY date`,
      [sessionKey],
      (r) => ({
        driver_number: r.driver_number as number,
        date: r.date as string,
        position: r.position as number,
      }),
    ),
    query<RawPit>(
      `SELECT driver_number, lap_number, pit_duration, date FROM openf1_pits
      WHERE session_key = ? AND lap_number IS NOT NULL`,
      [sessionKey],
      (r) => ({
        driver_number: r.driver_number as number,
        lap_number: r.lap_number as number | null,
        pit_duration: r.pit_duration as number | null,
        date: r.date as string | null,
      }),
    ),
    query<RawLoc>(
      `SELECT driver_number, t_sec, x, y FROM openf1_locations
      WHERE session_key = ?
      ORDER BY driver_number, t_sec`,
      [sessionKey],
      (r) => ({
        driver_number: r.driver_number as number,
        t_sec: r.t_sec as number,
        x: r.x as number,
        y: r.y as number,
      }),
    ),
    query<RawCar>(
      `SELECT driver_number, t_sec, speed, throttle, brake, n_gear, drs
      FROM openf1_car_data WHERE session_key = ?
      ORDER BY driver_number, t_sec`,
      [sessionKey],
      (r) => ({
        driver_number: r.driver_number as number,
        t_sec: r.t_sec as number,
        speed: r.speed as number | null,
        throttle: r.throttle as number | null,
        brake: r.brake as number | null,
        n_gear: r.n_gear as number | null,
        drs: r.drs as number | null,
      }),
    ),
  ]);

  // Race start: earliest lap-1 date_start across the field. Falls back to
  // the earliest date_start across *any* lap if lap-1 wasn't recorded
  // (red-flag restart races like Miami 2025).
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

  // Group raw laps by driver.
  const byDriver = new Map<number, RawLap[]>();
  for (const l of rawLaps) {
    const arr = byDriver.get(l.driver_number) ?? [];
    arr.push(l);
    byDriver.set(l.driver_number, arr);
  }

  // For each driver, compute lapEndSec as max(date_start ms + lap_duration*1000,
  // previousLapEnd + lap_duration*1000). Falling back to cumulative if dates
  // are missing.
  type DriverLap = { lap: number; lapEndSec: number; lapDuration: number | null };
  const driverLaps = new Map<number, DriverLap[]>();
  for (const [num, arr] of byDriver) {
    const out: DriverLap[] = [];
    let prevEnd = 0;
    for (const l of arr) {
      const dur = l.lap_duration;
      let endSec: number;
      if (l.date_start && dur !== null) {
        endSec = (Date.parse(l.date_start) - raceStartMs) / 1000 + dur;
      } else if (dur !== null) {
        endSec = prevEnd + dur;
      } else {
        // Missing duration — extrapolate by leader pace later; for now, pad.
        endSec = prevEnd + 90;
      }
      // Guard against negative (clock skew).
      if (endSec < prevEnd) endSec = prevEnd + (dur ?? 90);
      out.push({ lap: l.lap_number, lapEndSec: endSec, lapDuration: dur });
      prevEnd = endSec;
    }
    driverLaps.set(num, out);
  }

  // Compute leader times per lap: minimum lapEndSec across drivers who completed
  // that lap. The trace plots each driver's gap = lapEndSec - leaderLapEndSec.
  const leaderEnd = new Map<number, number>();
  for (const laps of driverLaps.values()) {
    for (const l of laps) {
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

  // Positions.
  const positions: PositionEvent[] = rawPos.map((p) => ({
    driverNumber: p.driver_number,
    tSec: (Date.parse(p.date) - raceStartMs) / 1000,
    position: p.position,
  })).filter((p) => Number.isFinite(p.tSec));

  // Pits.
  const pits: PitEvent[] = rawPits.map((p) => ({
    driverNumber: p.driver_number,
    lap: p.lap_number!,
    durationSec: p.pit_duration ?? 0,
    tSec: p.date ? (Date.parse(p.date) - raceStartMs) / 1000 : 0,
  }));

  // Total race duration: max lapEndSec across drivers.
  let durationSec = 0;
  for (const l of laps) if (l.lapEndSec > durationSec) durationSec = l.lapEndSec;

  // Real coordinate traces from OpenF1 /location (pulled in the parallel
  // fan-out above).
  const traceMap = new Map<number, { t: number[]; x: number[]; y: number[] }>();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const row of rawLocs) {
    const tr = traceMap.get(row.driver_number) ?? { t: [], x: [], y: [] };
    tr.t.push(row.t_sec);
    tr.x.push(row.x);
    tr.y.push(row.y);
    traceMap.set(row.driver_number, tr);
    if (row.x < minX) minX = row.x;
    if (row.x > maxX) maxX = row.x;
    if (row.y < minY) minY = row.y;
    if (row.y > maxY) maxY = row.y;
  }
  const traces: DriverTrace[] = [];
  for (const [driverNumber, v] of traceMap) {
    traces.push({ driverNumber, t: v.t, x: v.x, y: v.y });
  }
  const trackBounds = traces.length > 0 ? { minX, maxX, minY, maxY } : null;

  // Car telemetry traces (speed / throttle / brake / gear / drs) — pulled in
  // the parallel fan-out above.
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
  for (const [driverNumber, v] of telMap) {
    telemetry.push({ driverNumber, ...v });
  }

  // Derive a pit-lane outline from the GPS samples around each pit stop.
  // For every (driver, pit) pair, take that driver's location samples in
  // [pitT - 8s, pitT + duration + 5s] — that captures the pit-entry path,
  // the static pit box, and pit-exit. Median-smoothed and plotted as one
  // big polyline; visually it resolves into the pit lane shape.
  let pitLane = "";
  if (rawPits.length > 0 && traces.length > 0) {
    const driverTraces = new Map<number, DriverTrace>();
    for (const t of traces) driverTraces.set(t.driverNumber, t);
    type Pt = { t: number; x: number; y: number };
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
      // Linear scan; per-driver traces are sorted by t. Pit stops only
      // happen a few times per race so this is cheap.
      for (let i = 0; i < tr.t.length; i++) {
        const tt = tr.t[i];
        if (tt < winStart) continue;
        if (tt > winEnd) break;
        samples.push({ t: tt, x: tr.x[i], y: tr.y[i] });
      }
    }
    if (samples.length > 0) {
      // Sort by (x,y) into spatial buckets and emit one smoothed point per
      // bucket. The pit lane is a 1D shape so a small bucket size collapses
      // overlapping driver samples into a clean line.
      const BUCKET = 60; // coord units
      type Bucket = { sx: number; sy: number; n: number };
      const buckets = new Map<string, Bucket>();
      for (const s of samples) {
        const key = `${Math.round(s.x / BUCKET)}|${Math.round(s.y / BUCKET)}`;
        const b = buckets.get(key) ?? { sx: 0, sy: 0, n: 0 };
        b.sx += s.x; b.sy += s.y; b.n += 1;
        buckets.set(key, b);
      }
      // Emit centroids; only keep buckets seen by ≥3 samples to drop noise.
      const pts: { x: number; y: number }[] = [];
      for (const b of buckets.values()) {
        if (b.n < 3) continue;
        pts.push({ x: b.sx / b.n, y: b.sy / b.n });
      }
      // Render as disconnected dots — connecting them via a polyline would
      // zig-zag because we don't know the right order in 2D. SVG-wise we
      // can render this as many tiny "M…l 0 0" subpaths and stroke them
      // with a wide round-cap so they read as a continuous fat line.
      pitLane = pts.map((p) => `M${p.x.toFixed(0)} ${p.y.toFixed(0)}l0 0`).join(" ");
    }
  }

  return { meta, drivers, laps, positions, pits, traces, telemetry, trackBounds, durationSec, pitLane };
}

export async function listRaces(season: number): Promise<{
  round: number; raceName: string; date: string; circuitId: string;
  country: string; circuitName: string; sessionKey: number | null;
}[]> {
  return query(
    `SELECT r.round AS round, r.race_name AS raceName, r.date AS date, r.circuit_id AS circuitId,
           c.country AS country, c.name AS circuitName,
           s.session_key AS sessionKey
    FROM races r
    LEFT JOIN circuits c ON c.circuit_id = r.circuit_id
    LEFT JOIN openf1_sessions s ON s.season = r.season AND s.round = r.round
    WHERE r.season = ?
    ORDER BY r.round`,
    [season],
    (r) => ({
      round: r.round as number,
      raceName: r.raceName as string,
      date: r.date as string,
      circuitId: r.circuitId as string,
      country: r.country as string,
      circuitName: r.circuitName as string,
      sessionKey: r.sessionKey as number | null,
    }),
  );
}

