// Landmark catalogue and the "can I see it from my window?" test. Port of src/windowseat/landmarks.py.

import * as atmosphere from "./atmosphere";
import { table } from "./data";
import * as geo from "./geo";
import { azElToNed, bodyAngles, matTVec, type Mat3 } from "./optics";
import { cast } from "./raycast";
import { solarPosition } from "./sun";
import { type Terrain } from "./terrain";

export interface Landmark {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  elevationM: number;
  weight: number;
  population: number | null;
  country: string | null;
  region: string | null;
}

export const isSummit = (lm: Landmark) => (lm.kind === "peak" || lm.kind === "volcano") && lm.elevationM >= 1000;

export async function loadBuiltin(minCityPopulation = 300_000): Promise<Landmark[]> {
  const [features, peaks, cities] = await Promise.all([table("features.csv"), table("peaks.csv"), table("cities.csv")]);
  const out: Landmark[] = [];
  features.forEach((r, i) => out.push({ id: `f${i}`, name: r.name, kind: r.kind, lat: +r.lat, lon: +r.lon,
    elevationM: +r.elevation_m, weight: +r.prominence, population: null, country: null, region: null }));
  peaks.forEach((r, i) => out.push({ id: `p${i}`, name: r.name, kind: r.kind, lat: +r.lat, lon: +r.lon,
    elevationM: +r.elevation_m, weight: +r.prominence, population: null, country: null, region: r.range || null }));
  cities.forEach((r, i) => {
    const pop = Number(r.population);
    if (pop < minCityPopulation) return;
    const weight = Math.max(1, 1.6 * Math.log10(pop) - 4.8);
    out.push({ id: `c${i}`, name: r.name, kind: "city", lat: +r.lat, lon: +r.lon, elevationM: 0,
      weight: Math.round(weight * 100) / 100, population: pop, country: r.country, region: null });
  });
  return out;
}

export type Light = "day" | "sunlit" | "alpenglow" | "twilight" | "dark";

export interface Sighting {
  landmark: Landmark;
  distanceM: number;
  azimuthDeg: number;
  elevationDeg: number;
  hOffDeg: number;
  vOffDeg: number;
  light: Light;
  opticalDepth: number | null;
}

export function targetLight(t: number, lm: Landmark, k = geo.DEFAULT_REFRACTION_K): Light {
  const [, sunEl] = solarPosition(t, lm.lat, lm.lon);
  const margin = sunEl + geo.horizonDipDeg(lm.elevationM, k) + 0.83;
  if (margin > 4) return "sunlit";
  if (margin > 0) return isSummit(lm) ? "alpenglow" : "sunlit";
  if (sunEl > -12) return "twilight";
  return "dark";
}

export function visibleFromWindow(
  landmarks: Landmark[], lat: number, lon: number, altM: number, dcm: Mat3, side: "left" | "right",
  hHalf: number, vLow: number, vHigh: number, maxRangeM: number, terrain: Terrain,
  k = geo.DEFAULT_REFRACTION_K, t: number | null = null,
): Sighting[] {
  const out: Sighting[] = [];
  const hzObs = geo.horizonDistance(altM, k);
  const tauMax = atmosphere.maxOpticalDepth(atmosphere.SNOW_PEAK_CONTRAST);
  const box = (hzObs + 400_000) / 111_000 + 0.5;
  const coslat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  for (const lm of landmarks) {
    if (Math.abs(lm.lat - lat) > box || Math.abs((((lm.lon - lon + 540) % 360) + 360) % 360 - 180) * coslat > box) continue;
    const d = geo.haversine(lat, lon, lm.lat, lm.lon);
    if (d > hzObs + geo.horizonDistance(lm.elevationM, k) || d < 1_000) continue;
    const summit = isSummit(lm);
    if (!summit && d > maxRangeM) continue;
    const [elev, clear] = geo.lineOfSight(altM, lm.elevationM, d, k);
    if (!clear) continue;
    let tau: number | null = null;
    if (summit) {
      tau = atmosphere.opticalDepth(altM, lm.elevationM, d, maxRangeM, k);
      if (tau > tauMax) continue;
    }
    const az = geo.initialBearing(lat, lon, lm.lat, lm.lon);
    const [hOff, vOff] = bodyAngles(side, matTVec(dcm, azElToNed(az, elev)));
    if (Math.abs(hOff) > hHalf || !(vLow <= vOff && vOff <= vHigh)) continue;
    if (!terrain.flat) {
      const hit = cast(lat, lon, altM, az, elev, terrain, d + 2_000, k);
      if (hit.hitGround && hit.groundDistM < d - 3_000) continue;
    }
    out.push({ landmark: lm, distanceM: d, azimuthDeg: az, elevationDeg: elev, hOffDeg: hOff, vOffDeg: vOff,
      light: t !== null ? targetLight(t, lm, k) : "day", opticalDepth: tau });
  }
  return out;
}
