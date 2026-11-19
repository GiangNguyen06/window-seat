// Airport and airline lookups. Port of src/windowseat/reference.py.

import { table } from "./data";
import * as geo from "./geo";

export interface Airport { iata: string; icao: string; name: string; city: string; country: string; lat: number; lon: number }
export interface Airline { icao: string; iata: string; name: string }

let airportsP: Promise<Map<string, Airport>> | null = null;
let airlinesP: Promise<Map<string, Airline>> | null = null;

export function airports(): Promise<Map<string, Airport>> {
  airportsP ??= table("airports.csv").then((rows) => new Map(rows.map((r) => [r.iata,
    { iata: r.iata, icao: r.icao, name: r.name, city: r.city, country: r.country, lat: +r.lat, lon: +r.lon }])));
  return airportsP;
}

export function airlines(): Promise<Map<string, Airline>> {
  airlinesP ??= table("airlines.csv").then((rows) => new Map(rows.map((r) => [r.icao, { icao: r.icao, iata: r.iata, name: r.name }])));
  return airlinesP;
}

export async function airlineByIata(code: string): Promise<Airline | undefined> {
  for (const a of (await airlines()).values()) if (a.iata === code.toUpperCase()) return a;
  return undefined;
}

export async function nearestAirport(lat: number, lon: number, maxKm = 8): Promise<Airport | null> {
  let best: Airport | null = null, bestD = maxKm * 1000;
  const coslat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  for (const ap of (await airports()).values()) {
    if (Math.abs(ap.lat - lat) > 0.2 || Math.abs(ap.lon - lon) * coslat > 0.2) continue;
    const d = geo.haversine(lat, lon, ap.lat, ap.lon);
    if (d < bestD) { best = ap; bestD = d; }
  }
  return best;
}

/** 'HVN82' → [Vietnam Airlines, 'VN82'] (numeric callsigns only). */
export async function parseCallsign(callsign?: string | null): Promise<[Airline | null, string | null]> {
  if (!callsign) return [null, null];
  const m = /^([A-Z]{3})(\d{1,4}[A-Z]?)$/.exec(callsign.trim().toUpperCase());
  if (!m) return [null, null];
  const al = (await airlines()).get(m[1]);
  if (!al) return [null, null];
  return [al, `${al.iata}${m[2].replace(/^0+/, "") || "0"}`];
}

/** FR24 downloads are named like 'VN82_426a5696' → [flight number, FR24 flight id]. */
export function parseFr24Filename(stem: string): [string | null, string | null] {
  const m = /^([A-Z0-9]{2}\d{1,4}[A-Z]?)_([0-9a-f]{6,10})/i.exec(stem);
  return m ? [m[1].toUpperCase(), m[2].toLowerCase()] : [null, null];
}
