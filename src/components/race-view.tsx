"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RaceReplay } from "@/lib/race-data";

// "Lando NORRIS" -> "Lando Norris" (OpenF1 ALL-CAPS family names look shouty).
function toTitle(name: string): string {
  return name.split(" ").map((part) => {
    if (part.length === 0) return part;
    if (part === part.toUpperCase()) return part[0] + part.slice(1).toLowerCase();
    return part;
  }).join(" ");
}

// Surname only, for compact running-order display.
function surnameOf(fullName: string): string {
  const parts = fullName.split(" ");
  return toTitle(parts[parts.length - 1] ?? fullName);
}

// True if the driver's status indicates they completed the race or were
// classified (e.g. "Finished", "+1 Lap"). Anything else is a retirement.
function isClassified(status: string | null): boolean {
  if (!status) return true; // unknown → assume finisher rather than over-flag
  if (status === "Finished") return true;
  if (/^\+\d/.test(status)) return true; // "+1 Lap", "+2 Laps", ...
  return false;
}

type Props = {
  replay: RaceReplay;
  prev: { round: number; name: string } | null;
  next: { round: number; name: string } | null;
};

// Trace plot dimensions (logical units; scaled by container).
const TRACE_W = 1000;
const TRACE_H = 360;
const TRACE_PAD = { top: 16, right: 24, bottom: 28, left: 48 };

// Track panel dimensions.
const TRACK_W = 600;
const TRACK_H = 400;

export function RaceView({ replay, prev, next }: Props) {
  const { meta, drivers, laps, positions, pits, traces, telemetry, trackBounds, durationSec } = replay;

  // Build per-driver trace series: array of {lap, gap}. Sorted by lap. We
  // memoize once.
  const series = useMemo(() => {
    const m = new Map<number, { lap: number; gap: number; lapEndSec: number }[]>();
    for (const l of laps) {
      const arr = m.get(l.driverNumber) ?? [];
      arr.push({ lap: l.lap, gap: l.gapSec, lapEndSec: l.lapEndSec });
      m.set(l.driverNumber, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.lap - b.lap);
    return m;
  }, [laps]);

  const driversByNumber = useMemo(() => {
    const m = new Map<number, (typeof drivers)[number]>();
    for (const d of drivers) m.set(d.driverNumber, d);
    return m;
  }, [drivers]);

  // Per-driver lap timeline: each entry has a start time, end time, and
  // duration. Used to figure out which lap a driver is on at time t and how
  // far through it (track progress 0..1).
  const driverLaps = useMemo(() => {
    type Entry = { lap: number; startSec: number; endSec: number; duration: number };
    const m = new Map<number, Entry[]>();
    for (const l of laps) {
      const arr = m.get(l.driverNumber) ?? [];
      arr.push({
        lap: l.lap,
        startSec: l.lapEndSec - (l.lapDuration ?? 90),
        endSec: l.lapEndSec,
        duration: l.lapDuration ?? 90,
      });
      m.set(l.driverNumber, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.lap - b.lap);
    return m;
  }, [laps]);

  // Sorted position events per driver, used to look up "where is the car now"
  // at any playback time.
  const posByDriver = useMemo(() => {
    const m = new Map<number, { tSec: number; position: number }[]>();
    for (const p of positions) {
      const arr = m.get(p.driverNumber) ?? [];
      arr.push({ tSec: p.tSec, position: p.position });
      m.set(p.driverNumber, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.tSec - b.tSec);
    return m;
  }, [positions]);

  const totalLaps = meta.totalLaps;

  // Domains for the trace plot.
  const maxGap = useMemo(() => {
    let m = 0;
    for (const l of laps) if (l.gapSec > m) m = l.gapSec;
    return m;
  }, [laps]);

  // Playback state. We expose a "current lap" derived from the clock so the
  // trace can render only completed laps.
  const [playing, setPlaying] = useState(false);
  const [tSec, setTSec] = useState(0);
  const [speed, setSpeed] = useState(10); // 10x = 1 race-min per 6 real-seconds
  const [hoverDriver, setHoverDriver] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  // Live clock that the car-update loop reads — updated at 60fps so the dots
  // stay smooth, while React state (tSec) is only updated occasionally so
  // the trace and running-order don't re-render every frame.
  const clockRef = useRef(0);
  const carRefs = useRef<Map<number, SVGGElement | null>>(new Map());
  // Parent <g> for car dots — used to imperatively reorder children so the
  // current race leader is painted on top of trailing cars when they overlap.
  const carsGroupRef = useRef<SVGGElement | null>(null);
  // Tracks last applied paint order so we don't re-append every frame.
  const lastPaintOrderRef = useRef<string>("");
  // Start-lights overlay refs.
  const lightsContainerRef = useRef<HTMLDivElement | null>(null);
  const lightRefs = useRef<(HTMLDivElement | null)[]>([null, null, null, null, null]);
  // Top-speed badge: updated via React state (~10Hz) so we don't fight with
  // imperative DOM writes that proved fragile.
  const [topSpeedDriver, setTopSpeedDriverState] = useState<{ num: number; speed: number } | null>(null);
  // Hover card refs.
  const hoverCardSpeedRef = useRef<HTMLSpanElement | null>(null);
  const hoverCardGearRef = useRef<HTMLSpanElement | null>(null);
  const hoverCardThrottleRef = useRef<HTMLDivElement | null>(null);
  const hoverCardBrakeRef = useRef<HTMLDivElement | null>(null);
  const hoverCardDrsRef = useRef<HTMLSpanElement | null>(null);
  const hoverDriverRef = useRef<number | null>(null);

  useEffect(() => {
    clockRef.current = tSec;
  }, [tSec]);

  useEffect(() => {
    hoverDriverRef.current = hoverDriver;
  }, [hoverDriver]);

  useEffect(() => {
    if (!playing) {
      lastTickRef.current = null;
      return;
    }
    let lastReactSync = 0;
    const loop = (now: number) => {
      const last = lastTickRef.current ?? now;
      const dt = (now - last) / 1000;
      lastTickRef.current = now;
      clockRef.current = Math.min(durationSec, clockRef.current + dt * speed);
      // Sync React state ~10x per second so the trace and order panel update
      // without thrashing.
      if (now - lastReactSync > 100) {
        setTSec(clockRef.current);
        lastReactSync = now;
      }
      if (clockRef.current >= durationSec) {
        setTSec(durationSec);
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, speed, durationSec]);

  // Per-driver location traces converted to typed arrays for fast lookup.
  const traceByDriver = useMemo(() => {
    const m = new Map<number, { t: Float64Array; x: Int16Array; y: Int16Array }>();
    for (const tr of traces) {
      m.set(tr.driverNumber, {
        t: Float64Array.from(tr.t),
        x: Int16Array.from(tr.x),
        y: Int16Array.from(tr.y),
      });
    }
    return m;
  }, [traces]);

  // Per-driver position events as typed arrays for fast lookup in the per-
  // frame loop (used for reordering car z-order so leader paints on top).
  const posTimelineByDriver = useMemo(() => {
    const m = new Map<number, { t: Float64Array; pos: Int8Array }>();
    for (const [num, evs] of posByDriver) {
      const t = new Float64Array(evs.length);
      const pos = new Int8Array(evs.length);
      for (let i = 0; i < evs.length; i++) { t[i] = evs[i].tSec; pos[i] = evs[i].position; }
      m.set(num, { t, pos });
    }
    return m;
  }, [posByDriver]);

  // Per-driver telemetry: speed (km/h), throttle/brake (0..100), gear, drs.
  const telByDriver = useMemo(() => {
    type Tel = {
      t: Float64Array; speed: Int16Array; throttle: Int8Array;
      brake: Int8Array; gear: Int8Array; drs: Int8Array;
    };
    const m = new Map<number, Tel>();
    for (const tr of telemetry) {
      m.set(tr.driverNumber, {
        t: Float64Array.from(tr.t),
        speed: Int16Array.from(tr.speed),
        throttle: Int8Array.from(tr.throttle),
        brake: Int8Array.from(tr.brake),
        gear: Int8Array.from(tr.gear),
        drs: Int8Array.from(tr.drs),
      });
    }
    return m;
  }, [telemetry]);

  // Track viewBox derived from real coordinate bounds with a margin. We
  // render y inverted because OpenF1's y axis points "up" but SVG's points
  // "down".
  const trackView = useMemo(() => {
    if (!trackBounds) return null;
    const pad = 800;
    const x0 = trackBounds.minX - pad;
    const y0 = trackBounds.minY - pad;
    const w = (trackBounds.maxX - trackBounds.minX) + 2 * pad;
    const h = (trackBounds.maxY - trackBounds.minY) + 2 * pad;
    return { x0, y0, w, h };
  }, [trackBounds]);

  // Pre-compute a faded outline of the racing line by sampling the leader's
  // trace (driver who completed lap 1 fastest). Cheaper than rendering 20
  // overlapping traces and gives a clean track silhouette.
  const trackOutline = useMemo(() => {
    if (traces.length === 0) return "";
    // Pick the driver with the most location samples — they survived longest
    // and have the cleanest racing line.
    let best: typeof traces[number] | null = null;
    for (const t of traces) if (!best || t.t.length > best.t.length) best = t;
    if (!best) return "";

    // Skip pre-grid samples; then walk forward from the start until the
    // path returns near where it started — that's one complete lap, the
    // ideal outline. Falls back to a fixed window if the close-the-loop
    // detection doesn't trigger (very long laps, partial data).
    const startIdx = (() => {
      const i = best.t.findIndex((v) => v >= 0);
      return i === -1 ? 0 : i;
    })();
    const x0 = best.x[startIdx];
    const y0 = best.y[startIdx];
    const closeDist = 800; // coord units — same scale as our pad
    let endIdx = best.t.length;
    // Walk past the first ~30 seconds (so we don't immediately match the
    // start point) then look for the next sample within `closeDist` of the
    // origin.
    const minOffset = best.t.findIndex((v, idx) => idx > startIdx && v >= best.t[startIdx] + 30);
    const searchFrom = minOffset === -1 ? startIdx + 50 : minOffset;
    for (let i = searchFrom; i < best.t.length; i++) {
      const dx = best.x[i] - x0;
      const dy = best.y[i] - y0;
      if (dx * dx + dy * dy < closeDist * closeDist) { endIdx = i + 1; break; }
    }

    let d = "";
    for (let i = startIdx; i < endIdx; i += 2) {
      d += (i === startIdx ? "M" : "L") + best.x[i] + " " + best.y[i];
    }
    // Close the loop explicitly: the lap-end sample is near but not on the
    // start point, leaving a visible gap. Add a final line back to the
    // first sample.
    if (endIdx > startIdx) d += "L" + best.x[startIdx] + " " + best.y[startIdx];
    return d;
  }, [traces]);

  // Start/finish line: position + heading at the leader's first
  // post-grid sample. We average the next ~5 samples for a stable tangent.
  const startLine = useMemo(() => {
    if (traces.length === 0) return null;
    let best: typeof traces[number] | null = null;
    for (const t of traces) if (!best || t.t.length > best.t.length) best = t;
    if (!best) return null;
    const startIdx = Math.max(0, best.t.findIndex((v) => v >= 0));
    if (best.x.length < startIdx + 6) return null;
    // Tangent: average direction over next ~5 samples.
    let sx = 0, sy = 0;
    for (let i = startIdx; i < startIdx + 5; i++) {
      sx += best.x[i + 1] - best.x[i];
      sy += best.y[i + 1] - best.y[i];
    }
    const len = Math.hypot(sx, sy) || 1;
    return {
      x: best.x[startIdx],
      y: best.y[startIdx],
      // Unit tangent (along direction of travel).
      tx: sx / len,
      ty: sy / len,
    };
  }, [traces]);

  // Imperative per-frame update: positions, top-speed badge, hover card.
  // All driven by the live clock ref so we don't trigger React re-renders
  // 60 times per second.
  useEffect(() => {
    if (traceByDriver.size === 0) return;
    let raf: number;

    // Find the lower-bound index in a sorted typed array such that
    // arr[i] <= t < arr[i+1]. Returns -1 if t is before arr[0].
    const lowerBound = (arr: Float64Array, t: number): number => {
      if (arr.length === 0 || t < arr[0]) return -1;
      let lo = 0, hi = arr.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (arr[mid] <= t) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };

    let lastTopSpeedSync = 0;
    let lastZOrderSync = 0;
    const tick = () => {
      const t = clockRef.current;
      let topSpeedVal = -1;
      let topSpeedDriverNum: number | null = null;

      for (const d of drivers) {
        const node = carRefs.current.get(d.driverNumber);
        if (!node) continue;

        // Lap-0 retirees and drivers without trace data: hide entirely.
        if (d.classifiedLaps !== null && d.classifiedLaps === 0) {
          node.setAttribute("opacity", "0");
          continue;
        }
        const tr = traceByDriver.get(d.driverNumber);
        if (!tr || tr.t.length === 0) {
          node.setAttribute("opacity", "0");
          continue;
        }

        const ts = tr.t;
        const lastT = ts[ts.length - 1];
        const finished = isClassified(d.finishStatus);
        let onTrack = true;

        // For retirees, use the end of their last *racing* lap as the
        // cutoff (matches the sidebar OUT panel). The GPS stream typically
        // continues a bit longer as they cruise back to the garage.
        const lapsArr = driverLaps.get(d.driverNumber);
        const lastLap = lapsArr && lapsArr.length ? lapsArr[lapsArr.length - 1] : null;
        const retireCutoff = !finished && lastLap ? lastLap.endSec : Infinity;

        if (!finished && t > retireCutoff) {
          // Retired — pull off the track entirely.
          node.setAttribute("opacity", "0");
          onTrack = false;
        } else if (t > lastT + 1) {
          // Past end of GPS stream. Finishers park at the last sample dimmed.
          const i = ts.length - 1;
          node.setAttribute("transform", `translate(${tr.x[i]} ${tr.y[i]})`);
          node.setAttribute("opacity", finished ? "0.7" : "0");
          onTrack = false;
        } else if (t < ts[0]) {
          node.setAttribute("opacity", "0");
          onTrack = false;
        } else {
          let lo = 0, hi = ts.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (ts[mid] <= t) lo = mid + 1;
            else hi = mid;
          }
          const i = Math.max(0, lo - 1);
          const j = Math.min(ts.length - 1, i + 1);
          const t0 = ts[i], t1 = ts[j];
          const span = Math.max(0.001, t1 - t0);
          const f = (t - t0) / span;
          const x = tr.x[i] + (tr.x[j] - tr.x[i]) * f;
          const y = tr.y[i] + (tr.y[j] - tr.y[i]) * f;
          node.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
          node.setAttribute("opacity", "1");
        }

        // Telemetry — current speed at time t. Used for top-speed badge and
        // hover card. Skip retired drivers but include cars on the grid.
        if (!onTrack) continue;
        const tel = telByDriver.get(d.driverNumber);
        if (!tel || tel.t.length === 0) continue;
        let idx = lowerBound(tel.t, t);
        if (idx < 0) idx = 0;
        const speed = tel.speed[idx];
        if (speed > topSpeedVal) {
          topSpeedVal = speed;
          topSpeedDriverNum = d.driverNumber;
        }
      }

      // Top-speed badge — update React state at ~10Hz.
      const nowMs = performance.now();
      if (nowMs - lastTopSpeedSync > 100) {
        lastTopSpeedSync = nowMs;
        if (topSpeedDriverNum !== null) {
          setTopSpeedDriverState({ num: topSpeedDriverNum, speed: Math.max(0, topSpeedVal) });
        }
      }

      // Z-order: re-append car nodes so the current race leader paints on
      // top of trailers when their dots overlap. Throttled to ~10Hz.
      if (carsGroupRef.current && nowMs - lastZOrderSync > 100) {
        lastZOrderSync = nowMs;
        const order: { num: number; pos: number }[] = [];
        for (const d of drivers) {
          const tl = posTimelineByDriver.get(d.driverNumber);
          if (!tl || tl.t.length === 0) continue;
          // Find the latest position event ≤ t. If t is before any event,
          // use the first (initial grid position from OpenF1).
          let pi = -1;
          if (t < tl.t[0]) pi = 0;
          else {
            let lo = 0, hi = tl.t.length - 1;
            while (lo < hi) {
              const mid = (lo + hi + 1) >> 1;
              if (tl.t[mid] <= t) lo = mid;
              else hi = mid - 1;
            }
            pi = lo;
          }
          order.push({ num: d.driverNumber, pos: tl.pos[pi] });
        }
        // Sort descending so P1 ends last in DOM (painted on top).
        order.sort((a, b) => b.pos - a.pos);
        const key = order.map((o) => o.num).join(",");
        if (key !== lastPaintOrderRef.current) {
          lastPaintOrderRef.current = key;
          for (const o of order) {
            const node = carRefs.current.get(o.num);
            if (node && node.parentNode === carsGroupRef.current) {
              carsGroupRef.current.appendChild(node);
            }
          }
        }
      }

      // Start lights — proper F1 sequence:
      //   t in [-5,-4): light 1 on
      //   t in [-4,-3): lights 1-2 on
      //   t in [-3,-2): lights 1-3 on
      //   t in [-2,-1): lights 1-4 on
      //   t in [-1, 0): all 5 lights on (hold)
      //   t >=  0    : lights out — all off, race goes
      if (lightsContainerRef.current) {
        const showLights = t >= -5.5 && t < 1.0;
        lightsContainerRef.current.style.opacity = showLights ? "1" : "0";
        if (showLights) {
          let lit: number;
          if (t < -5) lit = 0;
          else if (t < 0) lit = Math.min(5, Math.floor(5 + t) + 1);
          else lit = 0;
          for (let i = 0; i < 5; i++) {
            const node = lightRefs.current[i];
            if (!node) continue;
            const on = i < lit;
            node.style.background = on ? "#ff1a1a" : "#1a0606";
            node.style.boxShadow = on
              ? "0 0 14px 4px rgba(255,40,40,0.65), inset 0 0 6px rgba(255,200,200,0.6)"
              : "inset 0 0 4px rgba(255,255,255,0.05)";
          }
        }
      }

      // Hover card: live readout for the hovered driver.
      const hoveredNum = hoverDriverRef.current;
      if (hoveredNum !== null) {
        const tel = telByDriver.get(hoveredNum);
        if (tel && tel.t.length > 0) {
          const idx = lowerBound(tel.t, t);
          if (idx >= 0) {
            const sp = tel.speed[idx];
            const th = tel.throttle[idx];
            const br = tel.brake[idx];
            const ge = tel.gear[idx];
            const dr = tel.drs[idx];
            if (hoverCardSpeedRef.current) hoverCardSpeedRef.current.textContent = `${sp}`;
            if (hoverCardGearRef.current) hoverCardGearRef.current.textContent = ge > 0 ? `${ge}` : "—";
            if (hoverCardThrottleRef.current) hoverCardThrottleRef.current.style.width = `${Math.max(0, Math.min(100, th))}%`;
            if (hoverCardBrakeRef.current) hoverCardBrakeRef.current.style.width = `${Math.max(0, Math.min(100, br))}%`;
            // OpenF1 drs values: 10/12 = off, 14 = enabled (eligible/armed),
            // 10/12/14 mapping varies. Treat anything > 9 with throttle high
            // as "available", >= 12 as "active". A simpler heuristic: drs in
            // {10, 12, 14} represent available; only some races report 14
            // when actually open. We surface the raw "open" flag when drs is
            // exactly 14 (open) or 12 (allowed and active depending on year).
            if (hoverCardDrsRef.current) {
              const open = dr === 14 || dr === 12 || dr === 10;
              hoverCardDrsRef.current.textContent = open && (dr === 14 || dr === 12) ? "DRS" : "";
            }
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [traceByDriver, telByDriver, drivers, driverLaps, posTimelineByDriver]);

  // Current "lap" (fractional) — for axis scrubbing on the trace plot. We use
  // the leader's progress: count laps where leader's lapEndSec ≤ tSec, plus
  // the fraction within the current lap.
  const leaderEnds = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of laps) {
      const cur = m.get(l.lap);
      if (cur === undefined || l.lapEndSec < cur) m.set(l.lap, l.lapEndSec);
    }
    const out: number[] = [];
    for (let i = 1; i <= totalLaps; i++) out.push(m.get(i) ?? out[out.length - 1] ?? 0);
    return out;
  }, [laps, totalLaps]);

  const currentLap = useMemo(() => {
    let lap = 0;
    for (let i = 0; i < leaderEnds.length; i++) {
      if (tSec >= leaderEnds[i]) lap = i + 1;
      else {
        const prev = i === 0 ? 0 : leaderEnds[i - 1];
        const span = leaderEnds[i] - prev;
        if (span > 0) lap = i + Math.max(0, (tSec - prev) / span);
        else lap = i + 1;
        break;
      }
    }
    return lap;
  }, [tSec, leaderEnds]);

  // Live running order at the current playback time. Drivers whose last
  // recorded lap is in the past *and* who didn't classify are moved to a
  // separate "out" list so the on-track order stays meaningful.
  const { running, out } = useMemo(() => {
    type Row = { driverNumber: number; position: number; lap: number };
    const running: Row[] = [];
    const out: Row[] = [];
    for (const d of drivers) {
      const evs = posByDriver.get(d.driverNumber) ?? [];
      let pos = evs[0]?.position ?? 99;
      for (const e of evs) {
        if (e.tSec <= tSec) pos = e.position;
        else break;
      }
      const arr = driverLaps.get(d.driverNumber);
      const last = arr && arr.length ? arr[arr.length - 1] : null;
      const finished = isClassified(d.finishStatus);
      // DNS / lap-0 retirees: never on the track, always in Out.
      const dns = d.classifiedLaps !== null && d.classifiedLaps === 0;
      const isOut =
        dns ||
        !arr || arr.length === 0 ||
        (last !== null && tSec > last.endSec && !finished);
      const lapNum = dns ? 0 : (last?.lap ?? 0);
      (isOut ? out : running).push({ driverNumber: d.driverNumber, position: pos, lap: lapNum });
    }
    running.sort((a, b) => a.position - b.position);
    out.sort((a, b) => b.lap - a.lap); // retired most recently first
    return { running, out };
  }, [drivers, posByDriver, driverLaps, tSec]);

  // Trace plot scales.
  const xScale = (lap: number) => {
    const w = TRACE_W - TRACE_PAD.left - TRACE_PAD.right;
    return TRACE_PAD.left + (totalLaps > 1 ? (lap - 1) / (totalLaps - 1) : 0) * w;
  };
  const yScale = (gap: number) => {
    const h = TRACE_H - TRACE_PAD.top - TRACE_PAD.bottom;
    const cap = Math.max(maxGap, 1);
    return TRACE_PAD.top + (gap / cap) * h;
  };

  // Build the polyline path for each driver up to currentLap (so the trace
  // grows as playback proceeds).
  const tracePaths = useMemo(() => {
    const paths: { num: number; d: string; faded: boolean }[] = [];
    for (const d of drivers) {
      const arr = series.get(d.driverNumber) ?? [];
      let path = "";
      for (const pt of arr) {
        if (pt.lap > currentLap) break;
        const x = xScale(pt.lap);
        const y = yScale(pt.gap);
        path += (path === "" ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
      }
      if (path) paths.push({ num: d.driverNumber, d: path, faded: hoverDriver !== null && hoverDriver !== d.driverNumber });
    }
    return paths;
  }, [drivers, series, currentLap, hoverDriver, totalLaps, maxGap]);

  // Pit markers: one tick per pit on the corresponding driver's line at the
  // pit lap.
  const pitMarkers = useMemo(() => {
    const out: { num: number; cx: number; cy: number }[] = [];
    for (const p of pits) {
      if (p.lap > currentLap) continue;
      const arr = series.get(p.driverNumber);
      if (!arr) continue;
      const point = arr.find((s) => s.lap === p.lap);
      if (!point) continue;
      out.push({ num: p.driverNumber, cx: xScale(point.lap), cy: yScale(point.gap) });
    }
    return out;
  }, [pits, series, currentLap]);

  function colorFor(num: number) {
    const d = driversByNumber.get(num);
    return d?.teamColor ? `#${d.teamColor}` : "#888";
  }

  function fmtTime(s: number) {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${ss}`;
  }

  return (
    <div className="mx-auto max-w-7xl px-6 pt-10 pb-32">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">
            2025 · round {meta.round}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl">{meta.raceName}</h1>
            <div className="flex items-center gap-2">
              {prev && (
                <Link
                  href={`/race/${prev.round}`}
                  aria-label={`Previous race: ${prev.name}`}
                  className="rounded border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 hover:text-white"
                >
                  ← {prev.name}
                </Link>
              )}
              {next && (
                <Link
                  href={`/race/${next.round}`}
                  aria-label={`Next race: ${next.name}`}
                  className="rounded border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 hover:text-white"
                >
                  {next.name} →
                </Link>
              )}
            </div>
          </div>
          <div className="mt-1 text-sm text-white/40">
            {meta.circuitName} · {meta.country} · {meta.date}
          </div>
        </div>
        <div className="text-right text-xs text-white/50">
          <div>lap {Math.min(totalLaps, Math.ceil(currentLap)).toString().padStart(2, "0")} / {totalLaps}</div>
          <div className="tabular-nums">{fmtTime(tSec)} / {fmtTime(durationSec)}</div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Track panel — real coordinates from OpenF1 /location */}
          <section className="rounded border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {/* Start lights, positioned in the header. */}
                <div
                  ref={lightsContainerRef}
                  className="transition-opacity duration-300"
                  style={{ opacity: 0 }}
                  aria-hidden="true"
                >
                  <div className="flex items-baseline gap-2 rounded border border-white/10 bg-black/30 px-3 py-1.5 backdrop-blur-md">
                    <span className="text-sm tabular-nums opacity-0 select-none" aria-hidden="true">·</span>
                    <div className="flex items-center gap-1.5">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          ref={(el) => { lightRefs.current[i] = el; }}
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: "#1a0606", boxShadow: "inset 0 0 4px rgba(255,255,255,0.05)" }}
                        />
                      ))}
                    </div>
                    <span className="text-sm tabular-nums opacity-0 select-none" aria-hidden="true">·</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-baseline gap-2 rounded border border-white/10 bg-black/30 px-3 py-1.5">
                  <span className="text-[9px] uppercase tracking-[0.25em] text-white/40">Top</span>
                  {topSpeedDriver ? (
                    <>
                      <span
                        className="text-xs font-bold tabular-nums"
                        style={{ color: driversByNumber.get(topSpeedDriver.num)?.teamColor ? `#${driversByNumber.get(topSpeedDriver.num)!.teamColor}` : undefined }}
                      >
                        {driversByNumber.get(topSpeedDriver.num)?.acronym ?? ""}
                      </span>
                      <span className="text-sm tabular-nums text-white/90">{topSpeedDriver.speed} km/h</span>
                    </>
                  ) : (
                    <span className="text-sm tabular-nums text-white/90">—</span>
                  )}
                </div>
              </div>
            </div>
            <div className="relative flex aspect-[5/4] w-full items-center justify-center">
              {trackView ? (
                <svg
                  viewBox={`${trackView.x0} ${trackView.y0} ${trackView.w} ${trackView.h}`}
                  className="h-full w-full"
                >
                  {/* Flip Y: OpenF1 +Y is "up", SVG +Y is "down". */}
                  <g
                    transform={`translate(0 ${2 * trackView.y0 + trackView.h}) scale(1 -1)`}
                  >
                    {trackOutline && (() => {
                      const trackWidth = Math.max(80, trackView.w / 60);
                      return (
                        <path
                          d={trackOutline}
                          fill="none"
                          stroke="#ffffff"
                          strokeOpacity={0.22}
                          strokeWidth={trackWidth}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      );
                    })()}
                    {startLine && (() => {
                      const trackWidth = Math.max(80, trackView.w / 60);
                      // Span well past the track edges so it reads as a flag.
                      const lineLen = trackWidth * 2.0;
                      // Bigger cells so the squares are visible at panel scale.
                      const cellSize = trackWidth / 3;
                      const cols = Math.max(8, Math.round(lineLen / cellSize));
                      const rows = 3;
                      // Perpendicular unit vector to the tangent.
                      const px = -startLine.ty;
                      const py = startLine.tx;
                      // Anchor to the *start* of the track (one row back along
                      // the direction of travel) so the cars appear to cross
                      // it as they leave the grid.
                      const ax = startLine.x - startLine.tx * cellSize * (rows / 2);
                      const ay = startLine.y - startLine.ty * cellSize * (rows / 2);
                      const cells: React.ReactElement[] = [];
                      for (let r = 0; r < rows; r++) {
                        for (let c = 0; c < cols; c++) {
                          // Origin of this cell relative to anchor.
                          const u = (c - cols / 2) * cellSize;
                          const v = r * cellSize;
                          const cx0 = ax + px * u + startLine.tx * v;
                          const cy0 = ay + py * u + startLine.ty * v;
                          // Build a quad by extending in tangent (depth) and
                          // perpendicular (width) directions by cellSize.
                          const corners = [
                            [cx0, cy0],
                            [cx0 + px * cellSize, cy0 + py * cellSize],
                            [cx0 + px * cellSize + startLine.tx * cellSize, cy0 + py * cellSize + startLine.ty * cellSize],
                            [cx0 + startLine.tx * cellSize, cy0 + startLine.ty * cellSize],
                          ];
                          const fill = (r + c) % 2 === 0 ? "#ffffff" : "#0a0a0a";
                          cells.push(
                            <polygon
                              key={`s-${r}-${c}`}
                              points={corners.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
                              fill={fill}
                            />
                          );
                        }
                      }
                      return <g opacity={0.95}>{cells}</g>;
                    })()}
                    <g ref={carsGroupRef}>
                      {drivers.map((d) => {
                        const isHover = hoverDriver === d.driverNumber;
                        const dim = hoverDriver !== null && !isHover;
                        // Sized so dots are visible regardless of track scale.
                        const r = (isHover ? 1.6 : 1.2) * Math.max(80, trackView.w / 70);
                        const fontSize = r * 1.0;
                        return (
                          <g
                            key={d.driverNumber}
                            ref={(el) => { carRefs.current.set(d.driverNumber, el); }}
                            opacity={0}
                            onMouseEnter={() => setHoverDriver(d.driverNumber)}
                            onMouseLeave={() => setHoverDriver(null)}
                            style={{ cursor: "pointer" }}
                          >
                            <circle
                              r={r}
                              fill={d.teamColor ? `#${d.teamColor}` : "#888"}
                              stroke="#000"
                              strokeWidth={r * 0.18}
                              opacity={dim ? 0.35 : 1}
                            />
                            {/* Counter-flip the label so text isn't mirrored. */}
                            <g transform="scale(1 -1)">
                              <text
                                y={fontSize * 0.35}
                                textAnchor="middle"
                                fontSize={fontSize}
                                fontWeight={700}
                                fill="#000"
                                opacity={dim ? 0.4 : 1}
                                pointerEvents="none"
                              >
                                {d.acronym}
                              </text>
                            </g>
                          </g>
                        );
                      })}
                    </g>
                  </g>
                </svg>
              ) : (
                <div className="text-xs text-white/30">No location data for this race.</div>
              )}

            </div>
            {/* Playback bar lives below the SVG (in normal flow) so it
                doesn't overlap the track. */}
            <div className="mt-3 flex items-center gap-3">
                <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 py-1.5 backdrop-blur-md">
                  <button
                    type="button"
                    onClick={() => {
                      if (playing) { setPlaying(false); return; }
                      if (tSec >= durationSec - 0.001 || tSec < 0.001) {
                        clockRef.current = -5;
                        setTSec(-5);
                      }
                      setPlaying(true);
                    }}
                    aria-label={playing ? "Pause" : tSec >= durationSec - 0.001 ? "Replay" : "Play"}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-white/90 hover:bg-white/10"
                  >
                    {playing ? (
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                        <rect x="2" y="2" width="3" height="8" fill="currentColor" />
                        <rect x="7" y="2" width="3" height="8" fill="currentColor" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M3 2 L3 10 L10 6 Z" fill="currentColor" />
                      </svg>
                    )}
                  </button>
                  <select
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    aria-label="Playback speed"
                    className="rounded border border-white/15 bg-black/60 px-2 py-1 text-[11px] text-white/80"
                  >
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={5}>5×</option>
                    <option value={10}>10×</option>
                    <option value={30}>30×</option>
                    <option value={60}>60×</option>
                    <option value={120}>120×</option>
                  </select>
                </div>
                <div className="pointer-events-auto flex flex-1 items-center gap-3 rounded-full border border-white/15 bg-black/70 px-4 py-1.5 backdrop-blur-md">
                  <input
                    type="range"
                    min={-5}
                    max={Math.ceil(durationSec)}
                    step={1}
                    value={Math.floor(tSec)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      clockRef.current = v;
                      setTSec(v);
                      setPlaying(false);
                    }}
                    aria-label="Race time scrubber"
                    className="flex-1 accent-white"
                  />
                  <span className="text-[11px] tabular-nums text-white/60 min-w-[80px] text-right">
                    {fmtTime(Math.max(0, tSec))} / {fmtTime(durationSec)}
                  </span>
                </div>
            </div>
          </section>

          {/* Trace plot */}
          <section className="rounded border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">
                Race trace · gap to leader (s)
              </div>
              <div className="text-[10px] text-white/30">hover a name to highlight</div>
            </div>
            <svg
              viewBox={`0 0 ${TRACE_W} ${TRACE_H}`}
              className="w-full"
              style={{ height: "auto" }}
            >
              {/* X grid: every 10 laps */}
              {Array.from({ length: Math.floor(totalLaps / 10) + 1 }, (_, i) => i * 10).map((lap) => (
                <g key={`xg-${lap}`}>
                  <line
                    x1={xScale(Math.max(1, lap))} x2={xScale(Math.max(1, lap))}
                    y1={TRACE_PAD.top} y2={TRACE_H - TRACE_PAD.bottom}
                    stroke="#fff" strokeOpacity={0.06}
                  />
                  <text
                    x={xScale(Math.max(1, lap))} y={TRACE_H - 8}
                    fill="#fff" fillOpacity={0.4}
                    fontSize={10} textAnchor="middle"
                  >
                    {lap === 0 ? 1 : lap}
                  </text>
                </g>
              ))}
              {/* Y axis ticks: 4 evenly spaced */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => {
                const gap = maxGap * f;
                return (
                  <g key={`yg-${f}`}>
                    <line
                      x1={TRACE_PAD.left} x2={TRACE_W - TRACE_PAD.right}
                      y1={yScale(gap)} y2={yScale(gap)}
                      stroke="#fff" strokeOpacity={0.06}
                    />
                    <text
                      x={TRACE_PAD.left - 6} y={yScale(gap) + 3}
                      fill="#fff" fillOpacity={0.4}
                      fontSize={10} textAnchor="end"
                    >
                      {f === 0 ? "0" : `+${Math.round(gap)}`}
                    </text>
                  </g>
                );
              })}

              {/* Playback time cursor */}
              <line
                x1={xScale(currentLap)} x2={xScale(currentLap)}
                y1={TRACE_PAD.top} y2={TRACE_H - TRACE_PAD.bottom}
                stroke="#fff" strokeOpacity={0.25} strokeDasharray="3 3"
              />

              {/* Driver lines */}
              {tracePaths.map((p) => (
                <path
                  key={p.num}
                  d={p.d}
                  fill="none"
                  stroke={colorFor(p.num)}
                  strokeWidth={hoverDriver === p.num ? 2.5 : 1.5}
                  strokeOpacity={p.faded ? 0.15 : 0.95}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}

              {/* Pit markers */}
              {pitMarkers.map((m, i) => (
                <circle
                  key={i}
                  cx={m.cx} cy={m.cy} r={3}
                  fill={colorFor(m.num)}
                  stroke="#000" strokeWidth={1}
                  opacity={hoverDriver === null || hoverDriver === m.num ? 1 : 0.2}
                />
              ))}
            </svg>

            {/* Scrubber */}
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (playing) { setPlaying(false); return; }
                  // Replay from start if we're at the end.
                  if (tSec >= durationSec - 0.001) {
                    clockRef.current = 0;
                    setTSec(0);
                  }
                  setPlaying(true);
                }}
                className="rounded border border-white/15 px-3 py-1 text-xs hover:bg-white/10"
              >
                {playing ? "pause" : tSec >= durationSec - 0.001 ? "replay" : "play"}
              </button>
              <input
                type="range"
                min={-5}
                max={Math.ceil(durationSec)}
                step={1}
                value={Math.floor(tSec)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  clockRef.current = v;
                  setTSec(v);
                  setPlaying(false);
                }}
                className="flex-1 accent-white"
              />
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="rounded border border-white/15 bg-black px-2 py-1 text-xs"
              >
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={5}>5×</option>
                <option value={10}>10×</option>
                <option value={30}>30×</option>
                <option value={60}>60×</option>
                <option value={120}>120×</option>
              </select>
            </div>
          </section>
        </div>

        {/* Live running order */}
        <aside className="relative rounded border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-3 text-[10px] uppercase tracking-[0.3em] text-white/40">Running order</div>
          <ol className="space-y-1">
            {running.map((r, i) => {
              const d = driversByNumber.get(r.driverNumber);
              if (!d) return null;
              const active = hoverDriver === r.driverNumber;
              return (
                <li
                  key={r.driverNumber}
                  onMouseEnter={() => setHoverDriver(r.driverNumber)}
                  onMouseLeave={() => setHoverDriver(null)}
                  className={`relative flex items-center gap-2 rounded px-2 py-1 text-sm transition ${
                    active ? "bg-white/10" : "hover:bg-white/5"
                  }`}
                >
                  <span className="w-5 text-right tabular-nums text-white/40">{i + 1}</span>
                  <span
                    className="h-3 w-1 rounded-sm shrink-0"
                    style={{ background: colorFor(r.driverNumber) }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white/90">{surnameOf(d.fullName)}</div>
                    <div className="truncate text-[11px] text-white/40">{d.team}</div>
                  </div>
                  {active && (
                    <DriverHoverCard
                      driver={d}
                      color={colorFor(d.driverNumber)}
                      speedRef={hoverCardSpeedRef}
                      gearRef={hoverCardGearRef}
                      throttleRef={hoverCardThrottleRef}
                      brakeRef={hoverCardBrakeRef}
                      drsRef={hoverCardDrsRef}
                    />
                  )}
                </li>
              );
            })}
          </ol>

          {out.length > 0 && (
            <>
              <div className="mt-5 mb-2 text-[10px] uppercase tracking-[0.3em] text-white/30">Out</div>
              <ol className="space-y-1">
                {out.map((r) => {
                  const d = driversByNumber.get(r.driverNumber);
                  if (!d) return null;
                  const active = hoverDriver === r.driverNumber;
                  const note = r.lap === 0 ? "DNS" : `Lap ${r.lap}`;
                  return (
                    <li
                      key={r.driverNumber}
                      onMouseEnter={() => setHoverDriver(r.driverNumber)}
                      onMouseLeave={() => setHoverDriver(null)}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-sm transition opacity-60 ${
                        active ? "bg-white/10 opacity-100" : "hover:bg-white/5"
                      }`}
                    >
                      <span className="w-5 text-right tabular-nums text-white/30">·</span>
                      <span
                        className="h-3 w-1 rounded-sm shrink-0"
                        style={{ background: colorFor(r.driverNumber) }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-white/70">{surnameOf(d.fullName)}</div>
                        <div className="truncate text-[11px] text-white/40">{d.team} · {note}</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function DriverHoverCard({
  driver, color, speedRef, gearRef, throttleRef, brakeRef, drsRef,
}: {
  driver: { fullName: string; team: string; driverNumber: number };
  color: string;
  speedRef: React.RefObject<HTMLSpanElement | null>;
  gearRef: React.RefObject<HTMLSpanElement | null>;
  throttleRef: React.RefObject<HTMLDivElement | null>;
  brakeRef: React.RefObject<HTMLDivElement | null>;
  drsRef: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div
      className="pointer-events-none absolute right-full top-0 z-20 mr-3 w-56 rounded border border-white/15 bg-black/90 p-3 backdrop-blur-md shadow-xl"
      role="status"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="h-3 w-1 rounded-sm shrink-0" style={{ background: color }} />
          <span className="truncate text-sm text-white/90">{driver.fullName.split(" ").map((p) => p === p.toUpperCase() ? p[0] + p.slice(1).toLowerCase() : p).join(" ")}</span>
        </div>
        <span ref={drsRef} className="text-[10px] font-bold tracking-wider text-emerald-300" />
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-[0.25em] text-white/40">Speed</div>
          <div className="flex items-baseline gap-1">
            <span ref={speedRef} className="text-2xl tabular-nums text-white">0</span>
            <span className="text-[10px] text-white/40">km/h</span>
          </div>
        </div>
        <div className="ml-auto">
          <div className="text-[9px] uppercase tracking-[0.25em] text-white/40">Gear</div>
          <span ref={gearRef} className="text-xl tabular-nums text-white">—</span>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <div>
          <div className="mb-0.5 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.25em] text-white/40">Throttle</span>
          </div>
          <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
            <div ref={throttleRef} className="h-full bg-emerald-400" style={{ width: "0%" }} />
          </div>
        </div>
        <div>
          <div className="mb-0.5 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.25em] text-white/40">Brake</span>
          </div>
          <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
            <div ref={brakeRef} className="h-full bg-red-400" style={{ width: "0%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
