// Maps DB circuit_id (Kaggle dataset convention) → SVG file under
// /public/circuits/. SVGs come from github.com/julesr0y/f1-circuits-svg
// (CC-BY 4.0). The chosen layout is the one used in the 2025 season.

export const CIRCUIT_SVG: Record<string, string> = {
  albert_park: "/circuits/albert_park.svg",
  shanghai: "/circuits/shanghai.svg",
  suzuka: "/circuits/suzuka.svg",
  bahrain: "/circuits/bahrain.svg",
  jeddah: "/circuits/jeddah.svg",
  miami: "/circuits/miami.svg",
  imola: "/circuits/imola.svg",
  monaco: "/circuits/monaco.svg",
  catalunya: "/circuits/catalunya.svg",
  villeneuve: "/circuits/villeneuve.svg",
  red_bull_ring: "/circuits/red_bull_ring.svg",
  silverstone: "/circuits/silverstone.svg",
  spa: "/circuits/spa.svg",
  hungaroring: "/circuits/hungaroring.svg",
  zandvoort: "/circuits/zandvoort.svg",
  monza: "/circuits/monza.svg",
  baku: "/circuits/baku.svg",
  marina_bay: "/circuits/marina_bay.svg",
  americas: "/circuits/americas.svg",
  rodriguez: "/circuits/rodriguez.svg",
  interlagos: "/circuits/interlagos.svg",
  vegas: "/circuits/vegas.svg",
  losail: "/circuits/losail.svg",
  yas_marina: "/circuits/yas_marina.svg",
};

export function svgForCircuit(circuitId: string): string | null {
  return CIRCUIT_SVG[circuitId] ?? null;
}

// Read the circuit SVG file from disk and pull out the racing-line `<path d>`
// plus the viewBox (or width/height) so the client can render it without a
// second network round-trip. SVGs come from julesr0y/f1-circuits-svg and are
// each a single <path> describing the lap.
export async function readCircuitTrack(circuitId: string): Promise<{
  d: string;
  viewBox: string;
} | null> {
  const file = CIRCUIT_SVG[circuitId];
  if (!file) return null;
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const abs = path.join(process.cwd(), "public", file);
  let text: string;
  try {
    text = await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
  const dMatch = text.match(/<path[^>]*\sd="([^"]+)"/);
  if (!dMatch) return null;
  const d = dMatch[1];
  const vbMatch = text.match(/viewBox="([^"]+)"/);
  let viewBox: string;
  if (vbMatch) viewBox = vbMatch[1];
  else {
    const wMatch = text.match(/\bwidth="(\d+)"/);
    const hMatch = text.match(/\bheight="(\d+)"/);
    viewBox = `0 0 ${wMatch?.[1] ?? 500} ${hMatch?.[1] ?? 500}`;
  }
  return { d, viewBox };
}
