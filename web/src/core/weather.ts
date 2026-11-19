// Weather along the route from Open-Meteo (free, no key): cloud layers and wind at flight level.
//
// We fetch hourly data for a set of locations (points along the route, and later the
// landmarks you could see) and interpolate to the moment that matters.
//
// Cloud layers follow Open-Meteo's definitions: low 0–2 km, mid 2–6 km, high above 6 km.
// Upper-air wind comes from pressure levels, mapped to height with the standard atmosphere.

import * as geo from "./geo";

export const OPEN_METEO = "https://historical-forecast-api.open-meteo.com/v1/forecast";

/** Pressure level (hPa) → approximate height (m), ICAO standard atmosphere. */
export const LEVELS: [number, number][] = [
  [850, 1457], [700, 3012], [500, 5574], [400, 7185], [300, 9164], [250, 10363], [200, 11784], [150, 13608],
];

/** Layer extents (m) and how much a full layer blocks the view (thin cirrus lets a lot through). */
export const CLOUD_LAYERS = [
  { key: "low", base: 0, top: 2_000, opacity: 1.0 },
  { key: "mid", base: 2_000, top: 6_000, opacity: 0.9 },
  { key: "high", base: 6_000, top: 11_000, opacity: 0.4 },
] as const;

export interface WeatherSeries {
  lat: number;
  lon: number;
  t: number[]; // unix seconds
  low: number[]; // cloud cover %, 0–100
  mid: number[];
  high: number[];
  wind: { hM: number; speed: number[]; from: number[] }[]; // m/s, degrees the wind blows FROM
}

export interface WeatherNow {
  low: number; mid: number; high: number; // 0–1
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** Hourly weather for many locations, in a few batched requests. */
export async function fetchSeries(
  locs: { lat: number; lon: number }[], startT: number, endT: number, fetchFn: Fetch = fetch,
  chunk = 40,
): Promise<WeatherSeries[]> {
  const hourly = ["cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
    ...LEVELS.flatMap(([p]) => [`wind_speed_${p}hPa`, `wind_direction_${p}hPa`])].join(",");
  const out: WeatherSeries[] = [];
  for (let i = 0; i < locs.length; i += chunk) {
    const part = locs.slice(i, i + chunk);
    const url = `${OPEN_METEO}?latitude=${part.map((l) => l.lat.toFixed(2)).join(",")}`
      + `&longitude=${part.map((l) => l.lon.toFixed(2)).join(",")}`
      + `&start_date=${day(startT - 3600)}&end_date=${day(endT + 3600)}`
      + `&hourly=${hourly}&wind_speed_unit=ms&timeformat=unixtime`;
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`weather service answered ${r.status}`);
    const data = await r.json();
    const list = (Array.isArray(data) ? data : [data]) as { hourly: Record<string, (number | null)[]> }[];
    list.forEach((d, k) => {
      const h = d.hourly;
      const num = (a: (number | null)[] | undefined) => (a ?? []).map((x) => x ?? NaN);
      out.push({
        lat: part[k].lat, lon: part[k].lon, t: num(h.time),
        low: num(h.cloud_cover_low), mid: num(h.cloud_cover_mid), high: num(h.cloud_cover_high),
        wind: LEVELS.map(([p, hM]) => ({ hM, speed: num(h[`wind_speed_${p}hPa`]), from: num(h[`wind_direction_${p}hPa`]) })),
      });
    });
  }
  return out;
}

/** Linear interpolation of an hourly array at time t (NaN-safe). */
function at(series: WeatherSeries, arr: number[], t: number): number {
  const ts = series.t;
  if (!ts.length) return NaN;
  if (t <= ts[0]) return arr[0];
  if (t >= ts[ts.length - 1]) return arr[arr.length - 1];
  let j = Math.min(ts.length - 2, Math.max(0, Math.floor((t - ts[0]) / 3600)));
  while (j > 0 && ts[j] > t) j--;
  while (j < ts.length - 2 && ts[j + 1] < t) j++;
  const f = (t - ts[j]) / (ts[j + 1] - ts[j]);
  const a = arr[j], b = arr[j + 1];
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a + f * (b - a);
}

export function cloudsAt(s: WeatherSeries, t: number): WeatherNow {
  const c = (arr: number[]) => { const v = at(s, arr, t); return Number.isNaN(v) ? 0 : Math.max(0, Math.min(1, v / 100)); };
  return { low: c(s.low), mid: c(s.mid), high: c(s.high) };
}

/** Wind vector at height (interpolated between pressure levels, as a vector). Returns [speed m/s, from°]. */
export function windAt(s: WeatherSeries, t: number, altM: number): [number, number] {
  const vec = (i: number): [number, number] => {
    const w = s.wind[i];
    const sp = at(s, w.speed, t), dir = (at(s, w.from, t) * Math.PI) / 180;
    if (Number.isNaN(sp) || Number.isNaN(dir)) return [0, 0];
    return [-sp * Math.cos(dir), -sp * Math.sin(dir)]; // [north, east] the air moves towards
  };
  const hs = s.wind.map((w) => w.hM);
  let n: number, e: number;
  if (altM <= hs[0]) [n, e] = vec(0);
  else if (altM >= hs[hs.length - 1]) [n, e] = vec(hs.length - 1);
  else {
    const i = hs.findIndex((h) => h > altM) - 1;
    const f = (altM - hs[i]) / (hs[i + 1] - hs[i]);
    const a = vec(i), b = vec(i + 1);
    [n, e] = [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
  }
  const speed = Math.hypot(n, e);
  const from = ((Math.atan2(-e, -n) * 180) / Math.PI + 360) % 360;
  return [speed, from];
}

export function nearestSeries(list: WeatherSeries[], lat: number, lon: number): WeatherSeries | null {
  let best: WeatherSeries | null = null, bd = Infinity;
  for (const s of list) {
    const d = geo.haversine(lat, lon, s.lat, s.lon);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/** Chance the sight line to something at `targetM` is blocked by a cloud layer, seen from `observerM`.
 *  Layers count if they lie between the two heights; cover combines as independent layers. */
export function obscuredFraction(c: WeatherNow, observerM: number, targetM = 0): number {
  let clear = 1;
  for (const L of CLOUD_LAYERS) {
    const between = targetM < L.top && observerM > L.base + 300;
    if (between) clear *= 1 - L.opacity * c[L.key];
  }
  return 1 - clear;
}

/** Nose heading needed to fly `trackDeg` over the ground with this wind (the crab angle). */
export function headingWithWind(trackDeg: number, groundSpeed: number, windSpeed: number, windFrom: number): number {
  const tr = (trackDeg * Math.PI) / 180, wf = (windFrom * Math.PI) / 180;
  const vn = groundSpeed * Math.cos(tr) + windSpeed * Math.cos(wf); // air velocity = ground − wind(to)
  const ve = groundSpeed * Math.sin(tr) + windSpeed * Math.sin(wf);
  const hdg = ((Math.atan2(ve, vn) * 180) / Math.PI + 360) % 360;
  const crab = ((hdg - trackDeg + 540) % 360) - 180;
  return trackDeg + Math.max(-25, Math.min(25, crab));
}

/** Pick route points roughly every `spacingM` metres. */
export function routeSamples(points: { lat: number; lon: number }[], spacingM = 100_000): { lat: number; lon: number }[] {
  if (!points.length) return [];
  const out = [points[0]];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += geo.haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    if (acc >= spacingM) { out.push(points[i]); acc = 0; }
  }
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
