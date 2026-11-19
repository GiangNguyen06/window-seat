// Synthetic Amsterdam → Rome flight across the Alps. Port of src/windowseat/sources/demo.py.

import * as geo from "./geo";
import { type Flight, makeFlight, pt, type TrackPoint } from "./track";

const ROUTE: [string, number, number][] = [
  ["AMS", 52.3105, 4.7683], ["RW24", 52.22, 4.55], ["NIK", 51.17, 4.19], ["LUX", 49.62, 6.2],
  ["BSL", 47.59, 7.53], ["SIO", 46.22, 7.33], ["MXP", 45.63, 8.72], ["ELB", 42.78, 10.4],
  ["TAQ", 42.2, 11.73], ["FCO", 41.8003, 12.2389],
];

function profile(fracDist: number, totalM: number): [number, number] {
  const d = fracDist * totalM, remain = totalM - d;
  const cruiseAlt = 11_280, cruiseGs = 230, climbDist = 190_000, descDist = 210_000;
  if (d < climbDist) {
    const f = d / climbDist;
    return [cruiseAlt * (1 - (1 - f) ** 1.7), 80 + (cruiseGs - 80) * Math.min(1, f * 1.4)];
  }
  if (remain < descDist) {
    const f = remain / descDist;
    return [cruiseAlt * f ** 1.15, 75 + (cruiseGs - 75) * Math.min(1, f * 1.3)];
  }
  return [cruiseAlt, cruiseGs];
}

export function demoFlight(departure = Date.UTC(2026, 5, 15, 7, 30) / 1000, stepS = 10): Flight {
  const legs = ROUTE.slice(1).map((b, i) => {
    const a = ROUTE[i];
    return [a[1], a[2], b[1], b[2], geo.haversine(a[1], a[2], b[1], b[2])] as const;
  });
  const total = legs.reduce((s, l) => s + l[4], 0);
  let pts: TrackPoint[] = [];
  let t = departure, flown = 0;
  while (flown < total) {
    let acc = 0, leg = legs[legs.length - 1];
    for (const lg of legs) {
      if (acc + lg[4] >= flown) { leg = lg; break; }
      acc += lg[4];
    }
    const [la1, lo1, la2, lo2, ln] = leg;
    const f = ln ? (flown - acc) / ln : 0;
    const [lat, lon] = geo.interpolateGreatCircle(la1, lo1, la2, lo2, f);
    const [alt, gs] = profile(flown / total, total);
    pts.push(pt(t, lat, lon, alt, gs, null));
    flown += gs * stepS;
    t += stepS;
  }
  // fly-by turns instead of instant heading changes
  const half = 4;
  pts = pts.map((p, i) => {
    if (i < half || i >= pts.length - half) return p;
    let la = 0, lo = 0;
    for (let k = i - half; k <= i + half; k++) { la += pts[k].lat; lo += pts[k].lon; }
    return pt(p.t, la / (2 * half + 1), lo / (2 * half + 1), p.altM, p.gsMs, null);
  });
  return makeFlight(pts, {
    flight_number: "KL1605", callsign: "KLM1605", airline: "KLM Royal Dutch Airlines (demo)",
    origin: "AMS", origin_name: "Amsterdam", destination: "FCO", destination_name: "Rome", aircraft_type: "B738",
  }, "demo");
}
