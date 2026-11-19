// Sight line → ground over a curved, refracting earth. Port of src/windowseat/raycast.py.

import * as geo from "./geo";
import { type Terrain } from "./terrain";

export interface RayHit {
  azimuthDeg: number;
  elevationDeg: number;
  hitGround: boolean;
  groundDistM: number;
  lat: number;
  lon: number;
  terrainM: number;
}

export function cast(
  lat: number, lon: number, altM: number, azimuthDeg: number, elevationDeg: number,
  terrain: Terrain, maxRangeM = 150_000, k = geo.DEFAULT_REFRACTION_K,
): RayHit {
  const r = geo.effectiveRadius(k);
  const r1 = r + altM;
  const el = (elevationDeg * Math.PI) / 180;
  const se = Math.sin(el), ce = Math.cos(el);
  const groundArc = (s: number) => r * Math.atan2(s * ce, r1 + s * se);
  const height = (s: number) => Math.sqrt(r1 * r1 + s * s + 2 * r1 * s * se) - r;
  const horizon = geo.horizonDistance(altM, k);
  const limit = altM > 0 ? Math.min(maxRangeM, horizon) : maxRangeM;

  const result = (hit: boolean, g: number, hT = 0): RayHit => {
    g = Math.min(g, limit);
    const [la, lo] = geo.destination(lat, lon, azimuthDeg, g);
    return { azimuthDeg, elevationDeg, hitGround: hit, groundDistM: g, lat: la, lon: lo, terrainM: hT };
  };

  if (terrain.flat) {
    const base = r + terrain.maxElevationM;
    const disc = (r1 * se) ** 2 - (r1 * r1 - base * base);
    if (se < 0 && disc >= 0) {
      const s = -r1 * se - Math.sqrt(disc);
      const g = groundArc(s);
      return result(g <= limit, g, terrain.maxElevationM);
    }
    return result(false, limit);
  }

  let s = 0, prevS = 0;
  const step0 = 250;
  for (;;) {
    const g = groundArc(s);
    if (g > limit) return result(false, limit);
    const a = height(s);
    if (a > terrain.maxElevationM && se >= 0) return result(false, limit);
    const [la, lo] = geo.destination(lat, lon, azimuthDeg, g);
    const t = terrain.elevation(la, lo);
    if (a <= t) {
      let loS = prevS, hiS = s;
      for (let i = 0; i < 12; i++) {
        const mid = 0.5 * (loS + hiS);
        const [lam, lom] = geo.destination(lat, lon, azimuthDeg, groundArc(mid));
        if (height(mid) <= terrain.elevation(lam, lom)) hiS = mid;
        else loS = mid;
      }
      const gh = groundArc(hiS);
      const [lah, loh] = geo.destination(lat, lon, azimuthDeg, gh);
      return result(true, gh, terrain.elevation(lah, loh));
    }
    prevS = s;
    s += Math.max(step0, Math.min(0.02 * s + step0, (a - t) * 0.5 + step0));
  }
}
