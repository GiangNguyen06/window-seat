// Read Flightradar24 CSV / KML downloads (in the browser or a worker: no DOM needed).
// Port of src/windowseat/sources/fr24_file.py + enrich.py.

import { parseCsv } from "./data";
import { FT_TO_M, KT_TO_MS } from "./geo";
import * as ref from "./reference";
import { type Flight, type FlightInfo, makeFlight, pt, type TrackPoint } from "./track";

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

function parseTime(v: string): number {
  const s = v.trim();
  if (/^\d{9,11}(\.\d+)?$/.test(s)) return Number(s);
  const t = Date.parse(s.includes("T") || s.endsWith("Z") ? s : s.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) throw new Error(`Unreadable time "${v}"`);
  return t / 1000;
}

export function parseFr24Csv(text: string, fileName = "flight.csv"): Flight {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("The CSV file is empty.");
  const keys = Object.keys(rows[0]);
  const col = (...names: string[]) => keys.find((k) => names.includes(norm(k)));
  const cT = col("timestamp"), cU = col("utc"), cPos = col("position"), cLat = col("latitude", "lat"), cLon = col("longitude", "lon");
  const cAlt = col("altitude", "alt"), cSpd = col("speed", "groundspeed"), cDir = col("direction", "track", "heading"), cCs = col("callsign");
  if (!cPos && !(cLat && cLon)) throw new Error("This CSV has no Position (or Latitude/Longitude) column. Is it a Flightradar24 export?");
  const pts: TrackPoint[] = [];
  let callsign: string | undefined;
  for (const r of rows) {
    const t = cT && r[cT] ? parseTime(r[cT]) : parseTime(r[cU!]);
    let lat: number, lon: number;
    if (cPos && r[cPos]) [lat, lon] = r[cPos].split(",").map(Number);
    else { lat = Number(r[cLat!]); lon = Number(r[cLon!]); }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const alt = Number((cAlt && r[cAlt]) || 0) * FT_TO_M;
    const spd = cSpd && r[cSpd] !== "" ? Number(r[cSpd]) * KT_TO_MS : null;
    const dir = cDir && r[cDir] !== "" ? Number(r[cDir]) : null;
    callsign ||= (cCs && r[cCs]) || undefined;
    pts.push(pt(t, lat, lon, alt, spd, dir));
  }
  if (!pts.length) throw new Error("No track points found in this CSV.");
  return makeFlight(pts, callsign ? { callsign } : {}, `fr24-csv:${fileName}`);
}

const unescapeHtml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const cdata = (s: string) => unescapeHtml(s.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, ""));

/** Flight details from the HTML info box Flightradar24 puts at the top of its KML. */
export function parseKmlHeader(descHtml: string, docName: string | null): FlightInfo {
  const info: FlightInfo = { times: {} };
  if (docName && docName.includes("/")) {
    const [num, cs] = docName.split("/", 2).map((x) => x.trim());
    if (num) info.flight_number = num;
    if (cs) info.callsign = cs;
  }
  const h = descHtml;
  let m = /\/\s*([A-Z0-9]{3,8})\s*<br\s*\/?>\s*([^<]+?)\s*<\/div>/.exec(h);
  if (m) { info.callsign ??= m[1]; info.airline = m[2].trim(); }
  const apRe = /title="([^"]*)"\s+href="[^"]*\/airport\/([a-z0-9]{3})\/(departures|arrivals)"[^>]*>\s*<h3[^>]*>\s*([A-Z0-9]{3})\s*<\/h3>\s*([^<]*)<\/a>/gi;
  for (const a of h.matchAll(apRe)) {
    const name = a[5].trim() || a[1].replace(" Airport", "").trim();
    if (a[3].toLowerCase() === "departures") { info.origin = a[4].toUpperCase(); info.origin_name = name; }
    else { info.destination = a[4].toUpperCase(); info.destination_name = name; }
  }
  for (const t of h.matchAll(/>\s*(STD|ATD|STA|ETA|ATA)\s*<\/span>\s*<span title="(\d{4}-\d\d-\d\d \d\d:\d\d)"/g))
    info.times![t[1]] = t[2].replace(" ", "T") + ":00Z";
  m = /Aircraft\s*<span[^>]*>\s*\(([A-Z0-9]{2,4})\)\s*<\/span>\s*<br\s*\/?>\s*<span[^>]*>\s*([^<]+)<\/span>/.exec(h);
  if (m) { info.aircraft_type = m[1]; info.aircraft_model = m[2].trim(); }
  m = /Registration\s*<br\s*\/?>\s*<span[^>]*>\s*(?:<a[^>]*>)?\s*([A-Z0-9-]{3,10})\s*</.exec(h);
  if (m) info.registration = m[1];
  if (!Object.keys(info.times!).length) delete info.times;
  return info;
}

export function parseKml(text: string, fileName = "flight.kml"): Flight {
  const pts: TrackPoint[] = [];
  // 1) gx:Track
  for (const trk of text.matchAll(/<gx:Track>([\s\S]*?)<\/gx:Track>/g)) {
    const whens = [...trk[1].matchAll(/<when>([^<]+)<\/when>/g)].map((m) => m[1]);
    const coords = [...trk[1].matchAll(/<gx:coord>([^<]+)<\/gx:coord>/g)].map((m) => m[1]);
    whens.forEach((w, i) => {
      if (!coords[i]) return;
      const [lon, lat, alt] = coords[i].trim().split(/\s+/).map(Number);
      pts.push(pt(parseTime(w), lat, lon, alt || 0));
    });
  }
  // 2) Placemark per point (the Flightradar24 layout)
  if (!pts.length) {
    for (const pm of text.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
      const body = pm[1];
      const when = /<when>([^<]+)<\/when>/.exec(body)?.[1];
      const coord = /<coordinates>\s*([^<]+?)\s*<\/coordinates>/.exec(body)?.[1];
      if (!when || !coord || /\s/.test(coord)) continue;
      const [lon, lat, alt] = coord.split(",").map(Number);
      const heading = /<heading>([^<]*)<\/heading>/.exec(body)?.[1];
      const desc = /<description>([\s\S]*?)<\/description>/.exec(body)?.[1] ?? "";
      const spd = /Speed:\D*?([\d,]+)\s*kt/.exec(cdata(desc).replace(/<[^>]+>/g, " "));
      pts.push(pt(parseTime(when), lat, lon, alt || 0,
        spd ? Number(spd[1].replace(/,/g, "")) * KT_TO_MS : null,
        heading !== undefined && heading !== "" ? Number(heading) : null));
    }
  }
  if (!pts.length) throw new Error("No timestamped points found in this KML. Try the CSV export instead.");
  const head = text.slice(0, Math.max(0, text.search(/<(Folder|Placemark)>/)) || 200_000);
  const docName = /<name>([^<]*)<\/name>/.exec(head)?.[1] ?? null;
  const desc = /<description>([\s\S]*?)<\/description>/.exec(head)?.[1];
  const info = desc ? parseKmlHeader(cdata(desc), docName) : {};
  return makeFlight(pts, info, `fr24-kml:${fileName}`);
}

/** Fill in what a source didn't provide, from the file name, callsign and track ends. */
export async function enrich(fl: Flight, fileName?: string): Promise<Flight> {
  const info = fl.info;
  if (fileName) {
    const [num, id] = ref.parseFr24Filename(fileName.replace(/\.[^.]+$/, ""));
    info.flight_number ||= num ?? undefined;
    if (id) fl.meta.fr24_id ??= id;
  }
  const [airline, num] = await ref.parseCallsign(info.callsign);
  if (airline) info.airline ||= airline.name;
  info.flight_number ||= num ?? undefined;
  if (!info.airline && info.flight_number) info.airline = (await ref.airlineByIata(info.flight_number.slice(0, 2)))?.name;
  const pts = fl.points;
  if (pts.length) {
    const ground = Math.min(...pts.map((p) => p.altM));
    if (!info.origin && pts[0].altM - ground < 600) {
      const ap = await ref.nearestAirport(pts[0].lat, pts[0].lon);
      if (ap) { info.origin = ap.iata; info.origin_name ||= ap.city || ap.name; }
    }
    const last = pts[pts.length - 1];
    if (!info.destination && last.altM - ground < 600) {
      const ap = await ref.nearestAirport(last.lat, last.lon);
      if (ap) { info.destination = ap.iata; info.destination_name ||= ap.city || ap.name; }
    }
  }
  const aps = await ref.airports();
  if (info.origin && !info.origin_name) { const ap = aps.get(info.origin); if (ap) info.origin_name = ap.city || ap.name; }
  if (info.destination && !info.destination_name) { const ap = aps.get(info.destination); if (ap) info.destination_name = ap.city || ap.name; }
  for (const k of Object.keys(info) as (keyof FlightInfo)[]) if (info[k] === undefined || info[k] === "") delete info[k];
  return fl;
}

export async function readFlightFile(text: string, fileName: string): Promise<Flight> {
  const isKml = /\.kml$/i.test(fileName) || /^\s*(<\?xml|<kml)/.test(text);
  const fl = isKml ? parseKml(text, fileName) : parseFr24Csv(text, fileName);
  return enrich(fl, fileName);
}
