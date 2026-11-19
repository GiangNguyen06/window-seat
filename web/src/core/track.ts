// Flight track, resampling and attitude estimation. Port of src/windowseat/track.py.

import * as geo from "./geo";

export const MAX_BANK_DEG = 35;
export const DEFAULT_AOA_DEG = 2.5;

export interface TrackPoint {
  t: number; // unix seconds UTC
  lat: number;
  lon: number;
  altM: number;
  gsMs: number | null;
  trackDeg: number | null;
  vsMs: number | null;
  headingDeg?: number;
  pitchDeg?: number;
  bankDeg?: number;
}

export interface FlightInfo {
  flight_number?: string;
  callsign?: string;
  airline?: string;
  origin?: string;
  origin_name?: string;
  destination?: string;
  destination_name?: string;
  aircraft_type?: string;
  aircraft_model?: string;
  registration?: string;
  times?: Record<string, string>;
}

export interface Flight {
  points: TrackPoint[];
  info: FlightInfo;
  source: string;
  meta: Record<string, string>;
}

export const pt = (t: number, lat: number, lon: number, altM: number, gsMs: number | null = null,
  trackDeg: number | null = null, vsMs: number | null = null): TrackPoint => ({ t, lat, lon, altM, gsMs, trackDeg, vsMs });

export function makeFlight(points: TrackPoint[], info: FlightInfo = {}, source = "unknown", meta: Record<string, string> = {}): Flight {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const dedup: TrackPoint[] = [];
  for (const p of sorted) {
    if (dedup.length && Math.abs(p.t - dedup[dedup.length - 1].t) < 1e-6) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  return { points: dedup, info, source, meta };
}

/** Drop ground-roll / taxi points. */
export function airborne(fl: Flight, minAltAglM = 150, minGsMs = 30): Flight {
  if (!fl.points.length) return fl;
  const ground = Math.min(...fl.points.map((p) => p.altM));
  const pts = fl.points.filter((p) => p.altM - ground >= minAltAglM || (p.gsMs ?? 0) >= 2 * minGsMs);
  return { ...fl, points: pts.length ? pts : fl.points };
}

const lerpOpt = (a: number | null, b: number | null, f: number) => (a === null || b === null ? (a ?? b) : a + f * (b - a));
const lerpAngleOpt = (a: number | null, b: number | null, f: number) => {
  if (a === null || b === null) return a ?? b;
  const d = ((b - a + 180) % 360 + 360) % 360 - 180;
  return ((a + f * d) % 360 + 360) % 360;
};

export function resample(fl: Flight, stepS: number): Flight {
  const pts = fl.points;
  if (pts.length < 2) return fl;
  const out: TrackPoint[] = [];
  let j = 0;
  for (let t = pts[0].t; t <= pts[pts.length - 1].t + 1e-6; t += stepS) {
    while (j < pts.length - 2 && pts[j + 1].t < t) j++;
    const a = pts[j], b = pts[j + 1];
    const span = b.t - a.t;
    const f = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - a.t) / span));
    const [lat, lon] = geo.interpolateGreatCircle(a.lat, a.lon, b.lat, b.lon, f);
    out.push(pt(t, lat, lon, a.altM + f * (b.altM - a.altM), lerpOpt(a.gsMs, b.gsMs, f),
      lerpAngleOpt(a.trackDeg, b.trackDeg, f), lerpOpt(a.vsMs, b.vsMs, f)));
  }
  return { ...fl, points: out };
}

function movingAverage(xs: number[], window: number): number[] {
  if (window <= 1 || xs.length < 3) return [...xs];
  const half = Math.floor(window / 2);
  return xs.map((_, i) => {
    const lo = Math.max(0, i - half), hi = Math.min(xs.length, i + half + 1);
    let s = 0;
    for (let k = lo; k < hi; k++) s += xs[k];
    return s / (hi - lo);
  });
}

/** Heading ≈ track, bank from coordinated turn (tan φ = vω/g), pitch = flight-path angle + AoA. */
export function estimateAttitude(fl: Flight, aoaDeg = DEFAULT_AOA_DEG, smoothWindow = 5): Flight {
  const pts = fl.points.map((p) => ({ ...p }));
  const n = pts.length;
  if (!n) return fl;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], p = pts[i];
    const dt = b.t - a.t;
    if (dt <= 0) continue;
    if (p.trackDeg === null) p.trackDeg = geo.initialBearing(a.lat, a.lon, b.lat, b.lon);
    if (p.gsMs === null) p.gsMs = geo.haversine(a.lat, a.lon, b.lat, b.lon) / dt;
    if (p.vsMs === null) p.vsMs = (b.altM - a.altM) / dt;
  }
  for (const p of pts) { p.trackDeg ??= 0; p.gsMs ??= 0; p.vsMs ??= 0; }

  let unwrapped = [pts[0].trackDeg!];
  for (const p of pts.slice(1)) {
    const prev = unwrapped[unwrapped.length - 1];
    const d = (((p.trackDeg! - prev + 180) % 360) + 360) % 360 - 180;
    unwrapped.push(prev + d);
  }
  unwrapped = movingAverage(unwrapped, smoothWindow);

  let banks = pts.map((p, i) => {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dt = pts[b].t - pts[a].t;
    const omega = dt > 0 ? ((unwrapped[b] - unwrapped[a]) * Math.PI) / 180 / dt : 0;
    const bank = (Math.atan((p.gsMs! * omega) / geo.G0) * 180) / Math.PI;
    return Math.max(-MAX_BANK_DEG, Math.min(MAX_BANK_DEG, bank));
  });
  banks = movingAverage(banks, smoothWindow);

  pts.forEach((p, i) => {
    p.headingDeg = ((unwrapped[i] % 360) + 360) % 360;
    p.bankDeg = banks[i];
    const gamma = (Math.atan2(p.vsMs!, Math.max(p.gsMs!, 1)) * 180) / Math.PI;
    p.pitchDeg = gamma + (p.gsMs! > 40 ? aoaDeg : 0);
  });
  return { ...fl, points: pts };
}
