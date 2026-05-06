// Fallback constructor colors for races where OpenF1 hasn't been ingested yet
// (the 2025 cars). OpenF1's per-session team_color is preferred when present.
// Hex values are the team's official 2025 livery accent.
const FALLBACK: Record<string, string> = {
  ferrari: "ED1C24",
  mclaren: "FF8000",
  mercedes: "27F4D2",
  red_bull: "3671C6",
  williams: "64C4FF",
  aston_martin: "229971",
  alpine: "FF87BC",
  haas: "B6BABD",
  rb: "6692FF",
  kick_sauber: "52E252",
  sauber: "52E252",
};

export function teamColor(constructorId: string | null, openF1Color: string | null): string {
  if (openF1Color) return `#${openF1Color}`;
  if (constructorId && FALLBACK[constructorId]) return `#${FALLBACK[constructorId]}`;
  return "#888";
}
