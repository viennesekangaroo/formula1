// Spinning basketball loading indicator. Reused across every page so the
// loading affordance is consistent — only the color shifts to match each
// page's theme.

const SEAM_DARK = "#1a1a1a";

export function BallLoader({
  color = "#e87e24",
  label = "loading",
  size = 52,
}: {
  /** Ball fill color. */
  color?: string;
  /** Small label below the ball; pass empty string to hide. */
  label?: string;
  /** SVG width/height in px. */
  size?: number;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
      <style>{`
        @keyframes ball-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        style={{ animation: "ball-spin 1.2s linear infinite" }}
        aria-hidden="true"
      >
        <circle cx="50" cy="50" r="48" fill={color} />
        <circle cx="50" cy="50" r="48" fill="none" stroke={shade(color, -0.18)} strokeWidth="2" />
        <path d="M2 50 C25 35, 75 65, 98 50" fill="none" stroke={SEAM_DARK} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M50 2 C35 25, 65 75, 50 98" fill="none" stroke={SEAM_DARK} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M10 22 C22 32, 22 42, 14 56" fill="none" stroke={SEAM_DARK} strokeWidth="2" strokeLinecap="round" />
        <path d="M90 78 C78 68, 78 58, 86 44" fill="none" stroke={SEAM_DARK} strokeWidth="2" strokeLinecap="round" />
      </svg>
      {label && (
        <span className="text-white/30 text-xs uppercase tracking-[0.4em]">{label}</span>
      )}
    </div>
  );
}

// Lightly darken (or lighten with positive amount) a hex color for the rim
// stroke. Keeps the ball looking like a sphere without per-page tuning.
function shade(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = clamp(Math.round(parseInt(h.slice(0, 2), 16) * (1 + amount)));
  const g = clamp(Math.round(parseInt(h.slice(2, 4), 16) * (1 + amount)));
  const b = clamp(Math.round(parseInt(h.slice(4, 6), 16) * (1 + amount)));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
function clamp(n: number) { return Math.max(0, Math.min(255, n)); }
