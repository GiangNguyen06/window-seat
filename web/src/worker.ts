// Runs the analysis off the main thread so the page stays responsive.

import { analyze, type Options } from "./core/analysis";
import { setDataLoader } from "./core/data";
import { demoFlight } from "./core/demo";
import { readFlightFile } from "./core/sources";
import { TerrariumTerrain, type Terrain } from "./core/terrain";

export interface AnalyzeRequest {
  id: number;
  baseUrl: string;
  file?: { name: string; text: string };
  demo?: boolean;
  seat: string | null;
  aircraft: string | null;
  terrain: boolean;
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
    const result = await analyze(flight, req.seat, req.aircraft, terrain, req.options, (i, n) => {
      if (i % 25 === 0) post({ id: req.id, type: "progress", stage: "Calculating the view", done: i, total: n });
    });
    post({ id: req.id, type: "result", result, notes });
  } catch (err) {
    post({ id: req.id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
