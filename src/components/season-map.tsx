"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { WORLD_PATH_D, WORLD_VIEWBOX } from "@/lib/world-path";

export type SeasonMapRound = {
  round: number;
  raceName: string;
  circuitName: string;
  country: string;
  date: string;
  lat: number;
  lng: number;
  winner: string | null;
  winnerConstructor: string | null;
  color: string;
  hasReplay: boolean;
};

// Equirectangular: matches the projection baked into world-path.ts.
const W = 1000;
const H = 500;
const project = (lat: number, lng: number) => ({
  x: ((lng + 180) / 360) * W,
  y: ((90 - lat) / 180) * H,
});

const MIN_ZOOM = 1;
const MAX_ZOOM = 12;

type View = { x: number; y: number; w: number; h: number };
const INITIAL_VIEW: View = { x: 0, y: 0, w: W, h: H };

type LegendEntry = { name: string; color: string; wins: number };

function buildLegend(rounds: SeasonMapRound[]): LegendEntry[] {
  const byName = new Map<string, LegendEntry>();
  for (const r of rounds) {
    if (!r.winnerConstructor) continue;
    const cur = byName.get(r.winnerConstructor);
    if (cur) cur.wins += 1;
    else byName.set(r.winnerConstructor, { name: r.winnerConstructor, color: r.color, wins: 1 });
  }
  return [...byName.values()].sort((a, b) => b.wins - a.wins);
}

export function SeasonMap({ rounds }: { rounds: SeasonMapRound[] }) {
  const [hoverRound, setHoverRound] = useState<number | null>(null);
  const hovered = rounds.find((r) => r.round === hoverRound) ?? null;
  const legend = buildLegend(rounds);

  const [view, setView] = useState<View>(INITIAL_VIEW);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  // Zoom level relative to the full map (1 = fully zoomed out).
  const zoom = W / view.w;
  // Counter-scale visual elements so dots/strokes stay the same size on screen.
  const k = 1 / zoom;

  // Convert a client (x,y) inside the SVG to viewBox coordinates.
  const clientToViewBox = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    return { x: view.x + fx * view.w, y: view.y + fy * view.h };
  }, [view]);

  const clampView = (v: View): View => {
    const w = Math.min(Math.max(v.w, W / MAX_ZOOM), W / MIN_ZOOM);
    const h = w * (H / W);
    const x = Math.min(Math.max(v.x, 0), W - w);
    const y = Math.min(Math.max(v.y, 0), H - h);
    return { x, y, w, h };
  };

  // Wheel zoom toward cursor. Listener is attached non-passively so we can
  // preventDefault — React's onWheel is passive in newer versions.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0015);
      setView((cur) => {
        const newW = cur.w * factor;
        const clampedW = Math.min(Math.max(newW, W / MAX_ZOOM), W / MIN_ZOOM);
        if (clampedW === cur.w) return cur;
        const realFactor = clampedW / cur.w;
        const rect = svg.getBoundingClientRect();
        const fx = (e.clientX - rect.left) / rect.width;
        const fy = (e.clientY - rect.top) / rect.height;
        const cx = cur.x + fx * cur.w;
        const cy = cur.y + fy * cur.h;
        const newH = clampedW * (H / W);
        return clampView({
          x: cx - fx * clampedW,
          y: cy - fy * newH,
          w: clampedW,
          h: newH,
        });
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, view, moved: false };
    setIsPanning(true);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - drag.x) / rect.width) * drag.view.w;
    const dy = ((e.clientY - drag.y) / rect.height) * drag.view.h;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) {
      drag.moved = true;
    }
    setView(clampView({ ...drag.view, x: drag.view.x - dx, y: drag.view.y - dy }));
  };

  const endPan = () => {
    setIsPanning(false);
    // Defer clearing dragRef so the click handler on dots can read .moved.
    requestAnimationFrame(() => {
      dragRef.current = null;
    });
  };

  const reset = () => setView(INITIAL_VIEW);

  return (
    <div className="space-y-3">
      {legend.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-white/10 bg-black/60 px-3 py-2 text-[11px] text-white/70">
          <span className="text-[10px] uppercase tracking-[0.25em] text-white/40">Winners</span>
          {legend.map((e) => (
            <div key={e.name} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: e.color }}
              />
              <span>{e.name}</span>
              <span className="tabular-nums text-white/40">×{e.wins}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="relative w-full overflow-hidden rounded border border-white/10 bg-black">
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="block w-full h-auto select-none"
        style={{ cursor: isPanning ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onPointerLeave={endPan}
      >
        <path d={WORLD_PATH_D} fill="#141414" fillRule="evenodd" />

        {rounds.map((r) => {
          const { x, y } = project(r.lat, r.lng);
          const isHover = hoverRound === r.round;
          const haloR = (isHover ? 12 : 8) * k;
          const dotR = (isHover ? 5.5 : 4.5) * k;
          const hitR = 14 * k;
          const stroke = 0.8 * k;
          return (
            <g key={r.round}>
              <circle
                cx={x}
                cy={y}
                r={haloR}
                fill={r.color}
                opacity={isHover ? 0.25 : 0}
                style={{ transition: "opacity 120ms" }}
              />
              <circle
                cx={x}
                cy={y}
                r={dotR}
                fill={r.color}
                stroke="#000"
                strokeWidth={stroke}
              />
              <Link
                href={r.hasReplay ? `/race/${r.round}` : "#"}
                aria-label={r.raceName}
                onClick={(e) => {
                  if (dragRef.current?.moved) e.preventDefault();
                }}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={hitR}
                  fill="transparent"
                  onPointerEnter={() => setHoverRound(r.round)}
                  onPointerLeave={() => setHoverRound((cur) => (cur === r.round ? null : cur))}
                  style={{ cursor: r.hasReplay ? "pointer" : "default" }}
                />
              </Link>
            </g>
          );
        })}
      </svg>

      {/* Zoom controls */}
      <div className="absolute right-3 top-3 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setView((v) => clampView({ ...v, w: v.w * 0.7, h: v.h * 0.7, x: v.x + v.w * 0.15, y: v.y + v.h * 0.15 }))}
          className="h-7 w-7 rounded border border-white/15 bg-black/70 text-sm text-white/70 backdrop-blur hover:bg-white/10"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setView((v) => clampView({ ...v, w: v.w / 0.7, h: v.h / 0.7, x: v.x - v.w * 0.15 / 0.7, y: v.y - v.h * 0.15 / 0.7 }))}
          className="h-7 w-7 rounded border border-white/15 bg-black/70 text-sm text-white/70 backdrop-blur hover:bg-white/10"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={reset}
          className="h-7 w-7 rounded border border-white/15 bg-black/70 text-[9px] uppercase tracking-wider text-white/60 backdrop-blur hover:bg-white/10"
          aria-label="Reset zoom"
          title="Reset"
        >
          ⤾
        </button>
      </div>

      {/* Floating info card for the hovered round, anchored bottom-left */}
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex justify-between gap-3 text-xs">
        {hovered ? (
          <div className="rounded border border-white/15 bg-black/85 px-3 py-2 backdrop-blur">
            <div className="text-[10px] uppercase tracking-[0.25em] text-white/40">
              Round {hovered.round.toString().padStart(2, "0")} · {hovered.date}
            </div>
            <div className="mt-1 text-sm text-white">{hovered.raceName}</div>
            <div className="text-[11px] text-white/50">
              {hovered.circuitName} · {hovered.country}
            </div>
            {hovered.winner ? (
              <div className="mt-1.5 flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: hovered.color }}
                />
                <span className="text-white/80">{hovered.winner}</span>
                <span className="text-white/40">· {hovered.winnerConstructor}</span>
              </div>
            ) : (
              <div className="mt-1.5 text-white/30">No result yet</div>
            )}
            {hovered.hasReplay ? (
              <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/40">
                click to open replay →
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded border border-white/10 bg-black/60 px-3 py-2 text-[10px] uppercase tracking-[0.25em] text-white/40 backdrop-blur">
            Scroll to zoom · drag to pan
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
