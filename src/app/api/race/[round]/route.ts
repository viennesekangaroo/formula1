import { loadRaceReplay } from "@/lib/race-data";
import { queryOne } from "@/lib/db";

// Race replay data is immutable once a race is over. We let Vercel's edge
// cache hold the response forever after first generation; the upstream
// browser cache is one day so we have a way to roll out a fix without
// busting CDN caches.
export const revalidate = 31536000;

const CACHE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=86400",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ round: string }> },
) {
  const { round: roundParam } = await params;
  const round = Number(roundParam);
  if (!Number.isFinite(round) || round < 1) {
    return Response.json({ error: "bad round" }, { status: 400 });
  }

  // Fast path: serve precomputed JSON straight from the replay_cache table.
  // Single small query, no reshape work — typically <500ms even on a cold
  // edge.
  const cached = await queryOne<{ json: string }>(
    `SELECT json FROM replay_cache WHERE season=? AND round=?`,
    [2025, round],
    (r) => ({ json: r.json as string }),
  );
  if (cached) {
    return new Response(cached.json, { headers: CACHE_HEADERS });
  }

  // Fallback: build live (slow) when the cache hasn't been built yet for
  // this race. Subsequent precompute runs will populate replay_cache.
  const replay = await loadRaceReplay(2025, round);
  if (!replay) {
    return Response.json({ error: "no data" }, { status: 404 });
  }
  return new Response(JSON.stringify(replay), { headers: CACHE_HEADERS });
}
