// Local SQLite access used only by ingest / migration scripts.
// The runtime app reads from Turso via src/lib/db.ts.

import path from "node:path";
import fs from "node:fs";
import Database, { type Database as DB } from "better-sqlite3";
import { SCHEMA } from "./db";

const DB_PATH = path.join(process.cwd(), "data", "f1.db");

export function openDb(targetPath: string = DB_PATH, opts: { create?: boolean } = {}): DB {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const db = new Database(targetPath);
  if (opts.create !== false) db.exec(SCHEMA);
  return db;
}

export const DB_FILE = DB_PATH;
