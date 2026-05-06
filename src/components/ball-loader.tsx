// Loading indicator: a small F1 car drives from left to right while a track
// behind it fills with the team color. Loops forever; used wherever we
// don't track real progress. Component name kept as BallLoader for
// historical reasons (callsites already imported it).

export function BallLoader({
  color = "#e80020",
  label = "loading",
  width = 360,
}: {
  /** Track fill color (also colors the car body). */
  color?: string;
  /** Small label below the bar; pass empty string to hide. */
  label?: string;
  /** Bar width in px. */
  width?: number;
}) {
  // ViewBox lets the SVG scale to whatever width prop is given.
  const VB_W = 360;
  const VB_H = 60;
  // Car nose travel: from x=0 to x=VB_W. We translate the whole car group.

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
      <style>{`
        @keyframes f1-drive {
          0%   { transform: translateX(0); }
          100% { transform: translateX(${VB_W - 70}px); }
        }
        @keyframes f1-fill {
          0%   { width: 0%; }
          100% { width: 100%; }
        }
        @keyframes f1-wheel {
          from { transform: rotate(0deg); }
          to   { transform: rotate(-360deg); }
        }
      `}</style>

      {/* Track + fill bar */}
      <div
        className="relative h-1.5 rounded-full bg-white/10 overflow-hidden"
        style={{ width: `${width}px` }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            background: color,
            opacity: 0.85,
            animation: "f1-fill 2.5s linear infinite",
          }}
        />
      </div>

      {/* The car drives across, on top of the track */}
      <div className="relative -mt-7" style={{ width: `${width}px`, height: 28 }}>
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          width={width}
          height={56}
          className="absolute inset-0"
          aria-hidden="true"
        >
          <g style={{ animation: "f1-drive 2.5s linear infinite" }}>
            {/* Bottom plank */}
            <rect x="6" y="36" width="58" height="3" rx="1.5" fill={color} opacity="0.9" />
            {/* Sidepod / body */}
            <path
              d="M8 36 L14 26 L40 24 L58 28 L62 36 Z"
              fill={color}
            />
            {/* Cockpit halo */}
            <path
              d="M28 24 L28 18 L42 18 L42 24"
              fill="none"
              stroke="#0a0a0a"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {/* Front wing */}
            <rect x="56" y="33" width="10" height="2" fill="#1a1a1a" />
            <rect x="58" y="29" width="6" height="2" fill="#1a1a1a" />
            {/* Rear wing */}
            <rect x="2" y="22" width="2" height="14" fill="#1a1a1a" />
            <rect x="0" y="22" width="6" height="3" fill="#1a1a1a" />
            {/* Wheels */}
            <g style={{ transformOrigin: "16px 38px", animation: "f1-wheel 0.25s linear infinite" }}>
              <circle cx="16" cy="38" r="6" fill="#0a0a0a" />
              <circle cx="16" cy="38" r="2.5" fill="#3a3a3a" />
            </g>
            <g style={{ transformOrigin: "52px 38px", animation: "f1-wheel 0.25s linear infinite" }}>
              <circle cx="52" cy="38" r="6" fill="#0a0a0a" />
              <circle cx="52" cy="38" r="2.5" fill="#3a3a3a" />
            </g>
          </g>
        </svg>
      </div>

      {label && (
        <span className="text-white/30 text-xs uppercase tracking-[0.4em]">{label}</span>
      )}
    </div>
  );
}
