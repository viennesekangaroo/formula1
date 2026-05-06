// Read pre-built season metadata from public/api/season-{year}.json. Used
// by server components so /race/[round] and the season index don't have
// to hit Turso at request time. Falls back to a Turso query for rounds /
// seasons not yet baked into a static file.

import path from "node:path";
import fs from "node:fs/promises";

export type StaticRaceMeta = {
  season: number;
  round: number;
  raceName: string;
  date: string;
  circuitId: string | null;
  circuitName: string | null;
  country: string | null;
  hasReplay: boolean;
  winnerName: string | null;
  winnerConstructor: string | null;
  winnerConstructorId: string | null;
  winnerTeamColor: string | null;
  lat: number | null;
  lng: number | null;
};

export type StaticSeason = {
  season: number;
  generatedAt: string;
  races: StaticRaceMeta[];
};

const cache = new Map<number, StaticSeason | null>();

export async function loadStaticSeason(season: number): Promise<StaticSeason | null> {
  if (cache.has(season)) return cache.get(season) ?? null;
  const file = path.join(process.cwd(), "public", "api", `season-${season}.json`);
  try {
    const text = await fs.readFile(file, "utf8");
    const data = JSON.parse(text) as StaticSeason;
    cache.set(season, data);
    return data;
  } catch {
    cache.set(season, null);
    return null;
  }
}
