// Geodesy: spherical earth with refraction, great circles, horizon and line of sight.
// TypeScript port of src/windowseat/geodesy.py: keep the two in sync.

export const EARTH_RADIUS_M = 6_371_008.8;
export const DEFAULT_REFRACTION_K = 0.13;
export const G0 = 9.80665;
export const FT_TO_M = 0.3048;
export const KT_TO_MS = 0.514444;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

export function effectiveRadius(k = DEFAULT_REFRACTION_K, radius = EARTH_RADIUS_M): number {
  return radius / (1 - k);
}

export function horizonDistance(hM: number, k = DEFAULT_REFRACTION_K): number {
  if (hM <= 0) return 0;
  const r = effectiveRadius(k);
  return r * Math.acos(r / (r + hM));
}

export function horizonDipDeg(hM: number, k = DEFAULT_REFRACTION_K): number {
  if (hM <= 0) return 0;
  const r = effectiveRadius(k);
  return deg(Math.acos(r / (r + hM)));
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number, radius = EARTH_RADIUS_M): number {
  const p1 = rad(lat1), p2 = rad(lat2);
  const dp = p2 - p1, dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function destination(lat: number, lon: number, bearingDeg: number, distM: number, radius = EARTH_RADIUS_M): [number, number] {
  const d = distM / radius, b = rad(bearingDeg);
  const p1 = rad(lat), l1 = rad(lon);
  const sp2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b);
  const p2 = Math.asin(clamp1(sp2));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * sp2);
  return [deg(p2), ((deg(l2) + 540) % 360) - 180];
}

export function interpolateGreatCircle(lat1: number, lon1: number, lat2: number, lon2: number, f: number): [number, number] {
  const p1 = rad(lat1), l1 = rad(lon1), p2 = rad(lat2), l2 = rad(lon2);
  const d = haversine(lat1, lon1, lat2, lon2, 1);
  if (d < 1e-12) return [lat1, lon1];
  const a = Math.sin((1 - f) * d) / Math.sin(d);
  const b = Math.sin(f * d) / Math.sin(d);
  const x = a * Math.cos(p1) * Math.cos(l1) + b * Math.cos(p2) * Math.cos(l2);
  const y = a * Math.cos(p1) * Math.sin(l1) + b * Math.cos(p2) * Math.sin(l2);
  const z = a * Math.sin(p1) + b * Math.sin(p2);
  return [deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))];
}

/** Apparent elevation of a target and whether the earth's bulge blocks it (effective-earth model). */
export function lineOfSight(hObserver: number, hTarget: number, groundDistM: number, k = DEFAULT_REFRACTION_K): [number, boolean] {
  const r = effectiveRadius(k);
  const gamma = groundDistM / r;
  const r1 = r + hObserver, r2 = r + hTarget;
  const dx = r2 * Math.sin(gamma);
  const dz = r2 * Math.cos(gamma) - r1;
  const elev = deg(Math.atan2(dz, dx));
  const chord = Math.hypot(dx, dz);
  if (chord < 1e-6) return [elev, true];
  const t = -(r1 * dz) / (chord * chord);
  if (t <= 0 || t >= 1) return [elev, true];
  return [elev, Math.hypot(t * dx, r1 + t * dz) >= r];
}
