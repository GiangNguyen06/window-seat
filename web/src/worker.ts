// Runs the analysis off the main thread so the page stays responsive.

import { analyze, type Options, type WeatherInput } from "./core/analysis";
import { setDataLoader } from "./core/data";
import { demoFlight } from "./core/demo";
import { readFlightFile } from "./core/sources";
import { TerrariumTerrain, type Terrain } from "./core/terrain";
import { airborne } from "./core/track";
import { fetchSeries, routeSamples } from "./core/weather";

export interface AnalyzeRequest {
  id: number;
  baseUrl: string;
  file?: { name: string; text: string };
  demo?: boolean;
  seat: string | null;
  aircraft: string | null;
  terrain: boolean;
  weather: boolean;
  options: Partial<Options>;
}

export type WorkerMessage =
  | { id: number; type: "progress"; stage: string; done: number; total: number }
  | { id: number; type: "result"; result: import("./types").Result; notes: string[] }
  | { id: number; type: "error"; message: string };

const post = (m: WorkerMessage) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<AnalyzeRequest>) => {
  const req = e.data;
  const notes: string[] = [];
  try {
    setDataLoader(async (name) => {
      const r = await fetch(new URL(`data/${name}`, req.baseUrl));
      if (!r.ok) throw new Error(`Couldn't load data/${name}`);
      return r.text();
    });
    post({ id: req.id, type: "progress", stage: "Reading the flight", done: 0, total: 1 });
    const flight = req.demo ? demoFlight() : await readFlightFile(req.file!.text, req.file!.name);

    let terrain: Terrain | null = null;
    if (req.terrain) {
      const t = new TerrariumTerrain(7);
      const keys = t.tilesFor(flight.points, 450_000);
      const ok = await t.preload(keys, (done, total) =>
        post({ id: req.id, type: "progress", stage: "Downloading terrain", done, total }));
      if (ok === 0) notes.push("Couldn't download terrain data, so the calculation used a smooth earth.");
      else terrain = t;
    }
    const progress = (i: number, n: number) => {
      if (i % 25 === 0) post({ id: req.id, type: "progress", stage: "Calculating the view", done: i, total: n });
    };

    let weather: WeatherInput | null = null;
    if (req.weather && !req.demo) {
      try {
        post({ id: req.id, type: "progress", stage: "Fetching weather along the route", done: 0, total: 1 });
        const pts = airborne(flight).points;
        const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
        const route = await fetchSeries(routeSamples(pts, 100_000), t0, t1);
        weather = { route, landmarks: new Map() };
        // First pass tells us which landmarks were in view; then fetch the weather at those places too
        const first = await analyze(flight, req.seat, req.aircraft, terrain, req.options, progress, weather);
        const ids = Object.keys(first.landmarks);
        if (ids.length) {
          post({ id: req.id, type: "progress", stage: "Fetching weather at the landmarks", done: 0, total: 1 });
          const locs = ids.map((id) => first.landmarks[id]);
          const series = await fetchSeries(locs, t0, t1);
          ids.forEach((id, i) => weather!.landmarks.set(id, series[i]));
        }
      } catch (err) {
        notes.push(`Couldn't load weather data (${err instanceof Error ? err.message : err}), so clouds and wind are not included.`);
        weather = null;
      }
    }
    const result = await analyze(flight, req.seat, req.aircraft, terrain, req.options, progress, weather);
    post({ id: req.id, type: "result", result, notes });
  } catch (err) {
    post({ id: req.id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
