// Data access layer. Reads from Turso (libSQL) in production and during dev.
// The local SQLite file at data/f1.db is only used by ingest/migration
// scripts (which import getLocalDb directly), never at request time.

import { createClient, type Client, type InValue } from "@libsql/client";

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS circuits (
  circuit_id  TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT,
  country     TEXT,
  lat         REAL,
  lng         REAL,
  url         TEXT
);

CREATE TABLE IF NOT EXISTS constructors (
  constructor_id TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  nationality    TEXT,
  url            TEXT
);

CREATE TABLE IF NOT EXISTS drivers (
  driver_id     TEXT PRIMARY KEY,
  code          TEXT,
  permanent_num REAL,
  given_name    TEXT,
  family_name   TEXT,
  full_name     TEXT NOT NULL,
  dob           TEXT,
  nationality   TEXT,
  url           TEXT
);

CREATE TABLE IF NOT EXISTS races (
  season      INTEGER NOT NULL,
  round       INTEGER NOT NULL,
  race_name   TEXT NOT NULL,
  date        TEXT NOT NULL,
  time        TEXT,
  circuit_id  TEXT REFERENCES circuits(circuit_id),
  url         TEXT,
  PRIMARY KEY (season, round)
);
CREATE INDEX IF NOT EXISTS idx_races_date ON races(date);

CREATE TABLE IF NOT EXISTS race_results (
  season           INTEGER NOT NULL,
  round            INTEGER NOT NULL,
  position         INTEGER,
  position_text    TEXT,
  points           REAL,
  driver_id        TEXT NOT NULL REFERENCES drivers(driver_id),
  driver_code      TEXT,
  driver_number    INTEGER,
  constructor_id   TEXT REFERENCES constructors(constructor_id),
  grid_pos         INTEGER,
  laps             INTEGER,
  status           TEXT,
  time_finished    TEXT,
  fastest_lap_time TEXT,
  fastest_lap_rank INTEGER,
  avg_speed_kph    REAL,
  PRIMARY KEY (season, round, driver_id),
  FOREIGN KEY (season, round) REFERENCES races(season, round)
);
CREATE INDEX IF NOT EXISTS idx_results_season ON race_results(season);
CREATE INDEX IF NOT EXISTS idx_results_driver ON race_results(driver_id);

CREATE TABLE IF NOT EXISTS qualifying (
  season         INTEGER NOT NULL,
  round          INTEGER NOT NULL,
  position       INTEGER,
  driver_id      TEXT NOT NULL REFERENCES drivers(driver_id),
  constructor_id TEXT REFERENCES constructors(constructor_id),
  q1             TEXT,
  q2             TEXT,
  q3             TEXT,
  PRIMARY KEY (season, round, driver_id),
  FOREIGN KEY (season, round) REFERENCES races(season, round)
);

CREATE TABLE IF NOT EXISTS pit_stops (
  season           INTEGER NOT NULL,
  round            INTEGER NOT NULL,
  driver_id        TEXT NOT NULL REFERENCES drivers(driver_id),
  stop             INTEGER NOT NULL,
  lap              INTEGER,
  time             TEXT,
  duration_s       REAL,
  is_red_flag_hold INTEGER,
  PRIMARY KEY (season, round, driver_id, stop),
  FOREIGN KEY (season, round) REFERENCES races(season, round)
);
CREATE INDEX IF NOT EXISTS idx_pits_race ON pit_stops(season, round);

CREATE TABLE IF NOT EXISTS driver_standings (
  season         INTEGER NOT NULL,
  round          INTEGER NOT NULL,
  position       REAL,
  points         REAL,
  wins           INTEGER,
  driver_id      TEXT NOT NULL REFERENCES drivers(driver_id),
  constructor_id TEXT REFERENCES constructors(constructor_id),
  PRIMARY KEY (season, round, driver_id)
);

CREATE TABLE IF NOT EXISTS constructor_standings (
  season         INTEGER NOT NULL,
  round          INTEGER NOT NULL,
  position       INTEGER,
  points         REAL,
  wins           INTEGER,
  constructor_id TEXT NOT NULL REFERENCES constructors(constructor_id),
  PRIMARY KEY (season, round, constructor_id)
);

CREATE TABLE IF NOT EXISTS openf1_sessions (
  session_key   INTEGER PRIMARY KEY,
  meeting_key   INTEGER,
  season        INTEGER NOT NULL,
  round         INTEGER NOT NULL,
  session_type  TEXT,
  session_name  TEXT,
  date_start    TEXT,
  FOREIGN KEY (season, round) REFERENCES races(season, round)
);
CREATE INDEX IF NOT EXISTS idx_of1s_race ON openf1_sessions(season, round);

CREATE TABLE IF NOT EXISTS openf1_drivers (
  session_key   INTEGER NOT NULL REFERENCES openf1_sessions(session_key),
  driver_number INTEGER NOT NULL,
  acronym       TEXT,
  full_name     TEXT,
  team_name     TEXT,
  team_color    TEXT,
  PRIMARY KEY (session_key, driver_number)
);

CREATE TABLE IF NOT EXISTS openf1_laps (
  session_key       INTEGER NOT NULL REFERENCES openf1_sessions(session_key),
  driver_number     INTEGER NOT NULL,
  lap_number        INTEGER NOT NULL,
  lap_duration      REAL,
  duration_sector_1 REAL,
  duration_sector_2 REAL,
  duration_sector_3 REAL,
  date_start        TEXT,
  is_pit_out_lap    INTEGER,
  PRIMARY KEY (session_key, driver_number, lap_number)
);
CREATE INDEX IF NOT EXISTS idx_of1l_lap ON openf1_laps(session_key, lap_number);

CREATE TABLE IF NOT EXISTS openf1_positions (
  session_key   INTEGER NOT NULL REFERENCES openf1_sessions(session_key),
  driver_number INTEGER NOT NULL,
  date          TEXT NOT NULL,
  position      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_of1p_session ON openf1_positions(session_key, date);

CREATE TABLE IF NOT EXISTS openf1_locations (
  session_key   INTEGER NOT NULL REFERENCES openf1_sessions(session_key),
  driver_number INTEGER NOT NULL,
  t_sec         REAL NOT NULL,
  x             INTEGER NOT NULL,
  y             INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_of1loc ON openf1_locations(session_key, driver_number, t_sec);

CREATE TABLE IF NOT EXISTS openf1_car_data (
  session_key   INTEGER NOT NULL REFERENCES openf1_sessions(session_key),
  driver_number INTEGER NOT NULL,
  t_sec         REAL NOT NULL,
  speed         INTEGER,
  throttle      INTEGER,
  brake         INTEGER,
  n_gear        INTEGER,
  drs           INTEGER
);
CREATE INDEX IF NOT EXISTS idx_of1car ON openf1_car_data(session_key, driver_number, t_sec);

CREATE TABLE IF NOT EXISTS openf1_pits (
  session_key   INTEGER NOT NULL REFERENCES openf1_sessions(session_key),
  driver_number INTEGER NOT NULL,
  lap_number    INTEGER,
  pit_duration  REAL,
  date          TEXT
);
CREATE INDEX IF NOT EXISTS idx_of1pit_session ON openf1_pits(session_key);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set. Add it to .env.local for dev or Vercel env vars for prod.");
  }
  _client = createClient({ url, authToken });
  return _client;
}

// Run a SELECT and map each returned row to T using a row-shape mapper. We
// do this manually because libSQL gives untyped { columns, rows } objects.
export async function query<T>(
  sql: string,
  args: InValue[] = [],
  map: (row: Record<string, unknown>) => T = (row) => row as T,
): Promise<T[]> {
  const client = getClient();
  const result = await client.execute({ sql, args });
  const cols = result.columns;
  const out: T[] = new Array(result.rows.length);
  for (let i = 0; i < result.rows.length; i++) {
    const r = result.rows[i];
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < cols.length; c++) obj[cols[c]] = r[c];
    out[i] = map(obj);
  }
  return out;
}

export async function queryOne<T>(
  sql: string,
  args: InValue[] = [],
  map: (row: Record<string, unknown>) => T = (row) => row as T,
): Promise<T | null> {
  const rows = await query<T>(sql, args, map);
  return rows[0] ?? null;
}
