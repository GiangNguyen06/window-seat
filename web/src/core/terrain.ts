// Terrain elevation. Port of src/windowseat/terrain.py.
//
// In the browser, elevation tiles are fetched up front (async) for the corridor
// around the route, then looked up synchronously during ray casting.

import * as geo from "./geo";

export interface Terrain {
  readonly flat: boolean;
  readonly maxElevationM: number;
  elevation(lat: number, lon: number): number;
}

export class FlatTerrain implements Terrain {
  readonly flat = true;
  constructor(readonly maxElevationM = 0) {}
  elevation(): number { return this.maxElevationM; }
}

export const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

interface Tile { data: Uint8ClampedArray; w: number; h: number }

/** Terrarium tiles: h = R·256 + G + B/256 − 32768 m. Zoom 7 ≈ 1.2 km pixels at the equator. */
export class TerrariumTerrain implements Terrain {
  readonly flat = false;
  readonly maxElevationM = 8_900;
  private tiles = new Map<string, Tile | null>();
  constructor(readonly zoom = 7, readonly url = TERRARIUM_URL) {}

  private tileXY(lat: number, lon: number): [number, number, number, number] {
    const n = 2 ** this.zoom;
    const la = Math.max(-85.0511, Math.min(85.0511, lat));
    const xf = ((lon + 180) / 360) * n;
    const yf = ((1 - Math.asinh(Math.tan((la * Math.PI) / 180)) / Math.PI) / 2) * n;
    return [((Math.floor(xf) % n) + n) % n, Math.min(n - 1, Math.floor(yf)), xf, yf];
  }

  /** Tiles needed to cover every point within `radiusM` of the track. */
  tilesFor(points: { lat: number; lon: number }[], radiusM: number): string[] {
    const keys = new Set<string>();
    const step = Math.max(1, Math.floor(points.length / 400));
    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      for (let b = 0; b < 360; b += 30)
        for (const d of [0, radiusM / 2, radiusM]) {
          const [la, lo] = geo.destination(p.lat, p.lon, b, d);
          const [x, y] = this.tileXY(la, lo);
          keys.add(`${x}/${y}`);
        }
    }
    return [...keys];
  }

  async preload(keys: string[], onProgress?: (done: number, total: number) => void): Promise<number> {
    let done = 0, ok = 0;
    const todo = keys.filter((k) => !this.tiles.has(k));
    const worker = async () => {
      while (todo.length) {
        const key = todo.pop()!;
        const [x, y] = key.split("/").map(Number);
        try {
          const r = await fetch(this.url.replace("{z}", String(this.zoom)).replace("{x}", String(x)).replace("{y}", String(y)));
          if (!r.ok) throw new Error(String(r.status));
          const bmp = await createImageBitmap(await r.blob());
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = c.getContext("2d")!;
          ctx.drawImage(bmp, 0, 0);
          this.tiles.set(key, { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height });
          ok++;
        } catch {
          this.tiles.set(key, null);
        }
        onProgress?.(++done, keys.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return ok;
  }

  elevation(lat: number, lon: number): number {
    const [x, y, xf, yf] = this.tileXY(lat, lon);
    const t = this.tiles.get(`${x}/${y}`);
    if (!t) return 0;
    const ix = Math.min(t.w - 1, Math.floor((xf - Math.floor(xf)) * t.w));
    const iy = Math.min(t.h - 1, Math.floor((yf - Math.floor(yf)) * t.h));
    const i = (iy * t.w + ix) * 4;
    return Math.max(0, t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768);
  }
}
