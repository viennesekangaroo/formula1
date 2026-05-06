// Idempotent: ensure replay_cache table exists on Turso.
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error("TURSO env vars required");
  const turso = createClient({ url, authToken });
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS replay_cache (
      season    INTEGER NOT NULL,
      round     INTEGER NOT NULL,
      json      TEXT NOT NULL,
      built_at  TEXT NOT NULL,
      PRIMARY KEY (season, round)
    )
  `);
  console.log("replay_cache: ready");
}
main().catch((e) => { console.error(e); process.exit(1); });
