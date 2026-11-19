// End-to-end pipeline: flight track + seat → what you see out of the window.
// Port of src/windowseat/analysis.py: produces the same "windowseat/1" JSON.

import { type AircraftProfile, mirrorSeat, overWing, parseSeat, profileFor, type Seat, seatLabel, windowVRange } from "./aircraft";
import * as geo from "./geo";
import { type Landmark, loadBuiltin, visibleFromWindow } from "./landmarks";
import { azElToNed, bodyAngles, dcmBodyToNed, matTVec, matVec, nedToAzEl, windowBoundary, windowRayBody } from "./optics";
import { cast } from "./raycast";
import { lightCondition, solarPosition } from "./sun";
import { FlatTerrain, type Terrain } from "./terrain";
import { airborne, estimateAttitude, type Flight, resample } from "./track";
import { cloudsAt, headingWithWind, nearestSeries, obscuredFraction, type WeatherSeries, windAt } from "./weather";
import type { Result, SightingTuple, Side } from "../types";

export const VERSION = "0.2.0";
const SIDES: Side[] = ["left", "right"];

export interface Options {
  stepS: number;
  visibilityKm: number;
  refractionK: number;
  raysPerEdge: number;
  minCityPopulation: number;
  aoaDeg: number;
  eyeDistanceM: number | null;
}

export interface WeatherInput {
  route: WeatherSeries[]; // points along the route
  landmarks: Map<string, WeatherSeries>; // at the landmarks themselves (optional, more accurate)
}

export const DEFAULT_OPTIONS: Options = {
  stepS: 30, visibilityKm: 150, refractionK: geo.DEFAULT_REFRACTION_K, raysPerEdge: 6,
  minCityPopulation: 300_000, aoaDeg: 2.5, eyeDistanceM: null,
};

const r = (x: number, n = 0) => { const f = 10 ** n; return Math.round(x * f) / f; };

export async function analyze(
  flight: Flight, seatSpec: string | null, aircraftType: string | null, terrain: Terrain | null,
  options: Partial<Options> = {}, progress?: (i: number, n: number) => void,
  weather: WeatherInput | null = null,
): Promise<Result> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const ter = terrain ?? new FlatTerrain();
  const simple = !seatSpec || ["left", "right", "l", "r", ""].includes(seatSpec.trim().toLowerCase());
  const spec = seatSpec || "left";
  const profile: AircraftProfile = profileFor(aircraftType || flight.info.aircraft_type);
  const seat = parseSeat(spec, profile, opts.eyeDistanceM);
  const seats: Record<Side, Seat> = seat.side === "left"
    ? { left: seat, right: mirrorSeat(seat) } : { right: seat, left: mirrorSeat(seat) };

  const fl = estimateAttitude(resample(airborne(flight), opts.stepS), opts.aoaDeg);
  const hasWx = !!weather && weather.route.length > 0;
  // Wind correction: the nose points into the wind (crab angle), so the windows face slightly differently
  const wx = fl.points.map((p) => {
    if (!hasWx) return null;
    const ws = nearestSeries(weather!.route, p.lat, p.lon)!;
    const [wSpeed, wFrom] = windAt(ws, p.t, p.altM);
    let crab = 0;
    if (p.altM > 1_500 && (p.gsMs ?? 0) > 60) {
      crab = headingWithWind(p.trackDeg ?? 0, p.gsMs ?? 0, wSpeed, wFrom) - (p.trackDeg ?? 0);
      p.headingDeg = (((p.headingDeg ?? 0) + crab) % 360 + 360) % 360;
    }
    return { clouds: cloudsAt(ws, p.t), wSpeed, wFrom, crab };
  });
  const landmarks: Landmark[] = await loadBuiltin(opts.minCityPopulation);
  const lmById = new Map(landmarks.map((l) => [l.id, l]));
  const maxRange = opts.visibilityKm * 1000;
  const k = opts.refractionK;

  type Rec = { id: string; side: Side; first_t: number; last_t: number; min_dist_km: number; closest_t: number;
    samples: number; light: Record<string, number>; first_lit_t: number | null; wsum: number; cloudy: number };
  const seen = new Map<string, Rec>();
  const totals = { left: { day: 0, win: 0, side: 0 }, right: { day: 0, win: 0, side: 0 } };
  const samples: Result["samples"] = [];

  fl.points.forEach((p, i) => {
    progress?.(i, fl.points.length);
    const w = wx[i];
    const dcm = dcmBodyToNed(p.headingDeg ?? 0, p.pitchDeg ?? 0, p.bankDeg ?? 0);
    const [sunAz, sunEl] = solarPosition(p.t, p.lat, p.lon);
    const dip = geo.horizonDipDeg(p.altM, k);
    const sunBody = matTVec(dcm, azElToNed(sunAz, sunEl));
    const sunVisible = sunEl > -dip;
    const sample: Result["samples"][number] = {
      t: r(p.t, 1), lat: r(p.lat, 5), lon: r(p.lon, 5), alt_m: r(p.altM, 1), gs_ms: r(p.gsMs ?? 0, 1),
      heading: r(p.headingDeg ?? 0, 2), pitch: r(p.pitchDeg ?? 0, 2), bank: r(p.bankDeg ?? 0, 2),
      sun: { az: r(sunAz, 2), el: r(sunEl, 2), visible: sunVisible, light: lightCondition(sunEl) },
      horizon_km: r(geo.horizonDistance(p.altM, k) / 1000, 1),
      sides: {} as Result["samples"][number]["sides"],
    };
    if (w) {
      sample.weather = {
        low: r(w.clouds.low, 2), mid: r(w.clouds.mid, 2), high: r(w.clouds.high, 2),
        below: r(obscuredFraction(w.clouds, p.altM, 0), 2),
        wind_ms: r(w.wSpeed, 1), wind_from: r(w.wFrom), crab: r(w.crab, 1),
      };
    }
    for (const side of SIDES) {
      const st = seats[side];
      const [vLo, vHi] = windowVRange(st);
      const boundary = windowBoundary(st.hHalfFovDeg, vHi, opts.raysPerEdge).map(([h, v]) => [h, v < 0 ? Math.max(v, vLo) : v]);
      let groundHits = 0;
      const ring = boundary.map(([h, v]) => {
        const [az, el] = nedToAzEl(matVec(dcm, windowRayBody(side, h, v)));
        const hit = cast(p.lat, p.lon, p.altM, az, el, ter, maxRange, k);
        if (hit.hitGround) groundHits++;
        return [r(hit.lon, 5), r(hit.lat, 5)] as [number, number];
      });
      const [cAz, cEl] = nedToAzEl(matVec(dcm, windowRayBody(side, 0, 0)));
      const cHit = cast(p.lat, p.lon, p.altM, cAz, cEl, ter, maxRange, k);
      const [hSun, vSun] = bodyAngles(side, sunBody);
      const sunLateral = side === "right" ? sunBody[1] : -sunBody[1];
      const sunInWindow = sunVisible && Math.abs(hSun) <= st.hHalfFovDeg + 5 && vLo - 5 <= vSun && vSun <= vHi + 5;
      const sights = visibleFromWindow(landmarks, p.lat, p.lon, p.altM, dcm, side, st.hHalfFovDeg, vLo, vHi, maxRange, ter, k, p.t)
        .sort((a, b) => b.landmark.weight - a.landmark.weight);
      // Chance a cloud layer sits between you and the landmark (weather at the landmark if we have it)
      const hidden = sights.map((s) => {
        if (!hasWx) return null;
        const ws = weather!.landmarks.get(s.landmark.id) ?? nearestSeries(weather!.route, s.landmark.lat, s.landmark.lon)!;
        return obscuredFraction(cloudsAt(ws, p.t), p.altM, s.landmark.elevationM);
      });
      sights.forEach((s, si) => {
        const key = `${side}:${s.landmark.id}`;
        let rec = seen.get(key);
        if (!rec) {
          rec = { id: s.landmark.id, side, first_t: p.t, last_t: p.t, min_dist_km: s.distanceM / 1000, closest_t: p.t,
            samples: 0, light: {}, first_lit_t: null, wsum: 0, cloudy: 0 };
          seen.set(key, rec);
        }
        const isLit = s.light === "sunlit" || s.light === "alpenglow" || s.light === "day";
        const ph = hidden[si] ?? 0;
        rec.wsum += (isLit ? 1 : s.landmark.kind === "city" ? 0.5 : 0.15) * (1 - ph);
        if (ph > 0.6) rec.cloudy++;
        rec.last_t = p.t;
        if (s.distanceM / 1000 < rec.min_dist_km) { rec.min_dist_km = s.distanceM / 1000; rec.closest_t = p.t; }
        rec.samples++;
        rec.light[s.light] = (rec.light[s.light] ?? 0) + 1;
        if ((s.light === "sunlit" || s.light === "alpenglow") && rec.first_lit_t === null) rec.first_lit_t = p.t;
      });
      if (sunVisible && sunEl > -6) totals[side].day += opts.stepS;
      if (sunInWindow) totals[side].win += opts.stepS;
      if (sunLateral > 0 && sunVisible) totals[side].side += opts.stepS;
      sample.sides[side] = {
        footprint: ring,
        ground_fraction: r(groundHits / Math.max(1, ring.length), 2),
        look_az: r(cAz, 2), look_el: r(cEl, 2),
        look_point: [r(cHit.lon, 5), r(cHit.lat, 5)],
        sun_in_window: sunInWindow,
        sun_on_this_side: sunLateral > 0 && sunVisible,
        landmarks: sights.map((s) => s.landmark.id),
        sightings: Object.fromEntries(sights.map((s, si) => [s.landmark.id,
          [r(s.distanceM / 1000, 1), r(s.azimuthDeg, 1), r(s.elevationDeg, 2), r(s.hOffDeg, 1), r(s.vOffDeg, 1), s.light,
            ...(hidden[si] === null ? [] : [r(hidden[si]!, 2)])] as SightingTuple])),
      };
    }
    samples.push(sample);
  });

  const usedIds = [...new Set([...seen.values()].map((x) => x.id))].sort();
  const lmOut: Result["landmarks"] = Object.fromEntries(usedIds.map((id) => {
    const lm = lmById.get(id)!;
    return [id, { name: lm.name, kind: lm.kind, lat: lm.lat, lon: lm.lon, elevation_m: lm.elevationM, weight: lm.weight,
      region: lm.region, population: lm.population, country: lm.country }];
  }));

  const summary = {} as Result["summary"];
  for (const side of SIDES) {
    const recs = [...seen.values()].filter((x) => x.side === side).map((x) => {
      const lm = lmById.get(x.id)!;
      const { wsum, ...rest } = x;
      return { ...rest, duration_s: x.samples * opts.stepS, name: lm.name, kind: lm.kind, min_dist_km: r(x.min_dist_km, 1),
        score: r(lm.weight * Math.sqrt(wsum), 2) };
    }).sort((a, b) => b.score - a.score);
    const st = seats[side];
    summary[side] = {
      seat: seatLabel(st), seats_from_window: st.seatsFromWindow,
      fov_deg: [r(2 * st.hHalfFovDeg, 1), r(2 * st.vHalfFovDeg, 1)],
      v_range_deg: windowVRange(st).map((v) => r(v, 1)) as [number, number],
      window_m: [st.profile.windowW, st.profile.windowH], eye_distance_m: r(st.eyeDistanceM, 2),
      over_wing: overWing(st), landmarks: recs,
      scenery_score: r(recs.reduce((s, x) => s + x.score, 0), 1),
      daylight_min: r(totals[side].day / 60, 1), sun_in_window_min: r(totals[side].win / 60, 1),
      sun_on_side_min: r(totals[side].side / 60, 1),
    };
  }
  const L = summary.left, R = summary.right;
  summary.recommended_side = L.scenery_score - 0.3 * L.sun_in_window_min > R.scenery_score - 0.3 * R.sun_in_window_min ? "left" : "right";

  const info = flight.info;
  return {
    schema: "windowseat/1",
    generator: `window-seat web ${VERSION}`,
    flight: {
      ...info,
      callsign: info.callsign ?? null, origin: info.origin ?? null, destination: info.destination ?? null,
      aircraft_type: aircraftType || info.aircraft_type || null, aircraft_profile: profile.name,
      source: flight.source, start_t: fl.points[0]?.t ?? 0, end_t: fl.points[fl.points.length - 1]?.t ?? 0,
    },
    seat: { requested: spec, label: seatLabel(seat), side: seat.side, simple },
    options: { step_s: opts.stepS, visibility_km: opts.visibilityKm, refraction_k: k, terrain: ter.flat ? "FlatTerrain" : "TerrariumTerrain",
      weather: hasWx ? "open-meteo" : null },
    track: flight.points.map((p) => [r(p.lon, 5), r(p.lat, 5), r(p.altM)] as [number, number, number]),
    samples,
    landmarks: lmOut,
    summary,
  };
}
