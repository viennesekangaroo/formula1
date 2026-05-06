// Ingest the Kaggle "Formula 1 Live Tracker 2024-2026" CSVs into data/f1.db.
// Reads from data/raw/*.csv and rebuilds the database from scratch each run.

import path from "node:path";
import fs from "node:fs";
import Papa from "papaparse";
import { openDb, DB_FILE } from "../src/lib/db-local";

const RAW = path.join(process.cwd(), "data", "raw");

function readCsv<T = Record<string, string>>(name: string): T[] {
  const text = fs.readFileSync(path.join(RAW, name), "utf8");
  const parsed = Papa.parse<T>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    console.warn(`[${name}] ${parsed.errors.length} parse warning(s) — first:`, parsed.errors[0]);
  }
  return parsed.data;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

function bool01(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).toLowerCase();
  if (s === "true" || s === "1") return 1;
  if (s === "false" || s === "0") return 0;
  return null;
}

function main() {
  // Wipe and rebuild from scratch — ingest is cheap (10s of MB) and avoids
  // duplicate-row issues if the CSVs are updated.
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
  ["-shm", "-wal"].forEach((suf) => {
    const p = DB_FILE + suf;
    if (fs.existsSync(p)) fs.rmSync(p);
  });

  const db = openDb();
  db.pragma("synchronous = OFF");

  const tx = db.transaction(() => {
    // circuits
    const circuits = readCsv("circuits.csv");
    const insCircuit = db.prepare(`INSERT OR REPLACE INTO circuits
      (circuit_id, name, city, country, lat, lng, url) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const r of circuits) {
      insCircuit.run(r.circuit_id, r.name, r.city, r.country, num(r.lat), num(r.lng), r.url);
    }
    console.log(`circuits: ${circuits.length}`);

    // constructors
    const constructors = readCsv("constructors.csv");
    const insCons = db.prepare(`INSERT OR REPLACE INTO constructors
      (constructor_id, name, nationality, url) VALUES (?, ?, ?, ?)`);
    for (const r of constructors) {
      insCons.run(r.constructor_id, r.name, r.nationality, r.url);
    }
    console.log(`constructors: ${constructors.length}`);

    // drivers
    const drivers = readCsv("drivers.csv");
    const insDriver = db.prepare(`INSERT OR REPLACE INTO drivers
      (driver_id, code, permanent_num, given_name, family_name, full_name, dob, nationality, url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of drivers) {
      insDriver.run(r.driver_id, r.code, num(r.permanent_num),
        r.given_name, r.family_name, r.full_name, r.dob, r.nationality, r.url);
    }
    console.log(`drivers: ${drivers.length}`);

    // races
    const races = readCsv("races.csv");
    const insRace = db.prepare(`INSERT OR REPLACE INTO races
      (season, round, race_name, date, time, circuit_id, url) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const r of races) {
      insRace.run(intOrNull(r.season), intOrNull(r.round), r.race_name, r.date, r.time, r.circuit_id, r.url);
    }
    console.log(`races: ${races.length}`);

    // race_results
    const results = readCsv("race_results.csv");
    const insRes = db.prepare(`INSERT OR REPLACE INTO race_results
      (season, round, position, position_text, points, driver_id, driver_code, driver_number,
       constructor_id, grid_pos, laps, status, time_finished, fastest_lap_time, fastest_lap_rank, avg_speed_kph)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of results) {
      insRes.run(
        intOrNull(r.season), intOrNull(r.round),
        intOrNull(r.position), r.position_text, num(r.points),
        r.driver_id, r.driver_code, intOrNull(r.driver_number),
        r.constructor_id, intOrNull(r.grid_pos), intOrNull(r.laps),
        r.status, r.time_finished, r.fastest_lap_time,
        intOrNull(r.fastest_lap_rank), num(r.avg_speed_kph),
      );
    }
    console.log(`race_results: ${results.length}`);

    // qualifying
    const quals = readCsv("qualifying.csv");
    const insQ = db.prepare(`INSERT OR REPLACE INTO qualifying
      (season, round, position, driver_id, constructor_id, q1, q2, q3)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of quals) {
      insQ.run(intOrNull(r.season), intOrNull(r.round), intOrNull(r.position),
        r.driver_id, r.constructor_id, r.q1, r.q2, r.q3);
    }
    console.log(`qualifying: ${quals.length}`);

    // pit_stops
    const pits = readCsv("pit_stops.csv");
    const insP = db.prepare(`INSERT OR REPLACE INTO pit_stops
      (season, round, driver_id, stop, lap, time, duration_s, is_red_flag_hold)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of pits) {
      insP.run(intOrNull(r.season), intOrNull(r.round), r.driver_id,
        intOrNull(r.stop), intOrNull(r.lap), r.time, num(r.duration_s), bool01(r.is_red_flag_hold));
    }
    console.log(`pit_stops: ${pits.length}`);

    // driver_standings
    const ds = readCsv("driver_standings.csv");
    const insDs = db.prepare(`INSERT OR REPLACE INTO driver_standings
      (season, round, position, points, wins, driver_id, constructor_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const r of ds) {
      insDs.run(intOrNull(r.season), intOrNull(r.round), num(r.position),
        num(r.points), intOrNull(r.wins), r.driver_id, r.constructor_id);
    }
    console.log(`driver_standings: ${ds.length}`);

    // constructor_standings
    const cs = readCsv("constructor_standings.csv");
    const insCs = db.prepare(`INSERT OR REPLACE INTO constructor_standings
      (season, round, position, points, wins, constructor_id)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const r of cs) {
      insCs.run(intOrNull(r.season), intOrNull(r.round), intOrNull(r.position),
        num(r.points), intOrNull(r.wins), r.constructor_id);
    }
    console.log(`constructor_standings: ${cs.length}`);

    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('ingested_at', ?)`)
      .run(new Date().toISOString());
  });

  tx();
  db.close();
  console.log(`\nWrote ${DB_FILE}`);
}

main();
