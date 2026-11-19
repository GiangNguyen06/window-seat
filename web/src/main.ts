import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import type { Result, Sample, Side } from "./types";
import { drawWindow } from "./windowView";
import { WindowView3D, getToken, setToken } from "./view3d";
import { initFlow } from "./flow";

const SIDES: Side[] = ["left", "right"];
const COLORS: Record<Side, string> = { left: "#4fa3ff", right: "#ff9b42" };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmtTime = (t: number) => new Date(t * 1000).toISOString().slice(11, 16) + " UTC";
const ft = (m: number) => Math.round(m / 0.3048 / 100) * 100;

// ---------------------------------------------------------------- map setup
const map = L.map("map", { preferCanvas: true, zoomControl: true, worldCopyJump: true }).setView([48, 8], 5);
const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 17, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
});
const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 18, attribution: "© OpenStreetMap contributors © CARTO",
});
const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  maxZoom: 17, attribution: "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)",
});
sat.addTo(map);
L.control.layers({ Satellite: sat, Dark: dark, Topographic: topo }, {}, { position: "topleft" }).addTo(map);
L.control.scale({ imperial: false }).addTo(map);

const swathLayer = L.layerGroup().addTo(map);
const trackLayer = L.layerGroup().addTo(map);
const allLmLayer = L.layerGroup().addTo(map);
const liveLayer = L.layerGroup().addTo(map);

let data: Result | null = null;
let idx = 0;
let playing = false;
let wholeTab: Side = "right";
let mode: "map" | "3d" = "map";
let side3d: Side = "left";
let view3d: WindowView3D | null = null;

const planeIcon = (heading: number) =>
  L.divIcon({
    className: "plane-icon",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<svg viewBox="0 0 24 24" width="30" height="30" style="transform:rotate(${heading}deg)">
      <path fill="#fff" stroke="#0b1020" stroke-width=".8" d="M12 1.5c.8 0 1.4 1 1.4 2.4v5.3l8.1 4.7v2l-8.1-2.4v4.6l2.3 1.8v1.6L12 20.6l-3.7.9v-1.6l2.3-1.8v-4.6l-8.1 2.4v-2l8.1-4.7V3.9c0-1.4.6-2.4 1.4-2.4z"/></svg>`,
  });
let plane: L.Marker | null = null;
const footprint: Record<Side, L.Polygon | null> = { left: null, right: null };
const lookLine: Record<Side, L.Polyline | null> = { left: null, right: null };

// ---------------------------------------------------------------- loading
async function loadUrl(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  setData(await r.json());
}

function setData(d: Result) {
  if (d.schema !== "windowseat/1") alert("This file doesn't look like a windowseat analysis (schema windowseat/1).");
  // Re-running the same flight with new settings keeps the current moment on the timeline
  const sameFlight = data && data.samples.length === d.samples.length && data.flight.start_t === d.flight.start_t;
  data = d;
  if (!sameFlight) idx = 0;
  swathLayer.clearLayers(); trackLayer.clearLayers(); allLmLayer.clearLayers(); liveLayer.clearLayers();
  plane = null; footprint.left = footprint.right = null; lookLine.left = lookLine.right = null;

  const f = d.flight;
  const title = [f.flight_number ?? f.callsign ?? "Flight", f.airline].filter(Boolean).join(" · ");
  const place = (code: string | null, name?: string) => (code ? `${code}${name ? ` ${name}` : ""}` : "?");
  const route = f.origin || f.destination ? ` &nbsp;${place(f.origin, f.origin_name)} → ${place(f.destination, f.destination_name)}` : "";
  const aircraft = f.aircraft_model ?? (f.aircraft_type ? f.aircraft_profile : "");
  const details = [
    new Date(f.start_t * 1000).toISOString().slice(0, 10),
    aircraft + (f.registration ? ` (${f.registration})` : ""),
    `data: ${f.source.split(":")[0]}`,
  ].filter(Boolean).join(" · ");
  $("flight-title").innerHTML = `${title}${route}<small>${details}</small>`;
  for (const s of SIDES) {
    const sm = d.summary[s];
    $(`seat-${s}`).innerHTML = d.seat.simple ? "window" : `seat <b>${sm.seat}</b>${d.seat.side === s ? " · yours" : ""}`;
  }
  wholeTab = d.seat.side;
  side3d = d.seat.side;
  view3d?.setData(d);

  // swath: all footprints, faint
  const step = Math.max(1, Math.round(120 / d.options.step_s));
  d.samples.forEach((s, i) => {
    if (i % step) return;
    for (const side of SIDES) {
      const ring = s.sides[side].footprint.map(([lo, la]) => [la, lo] as [number, number]);
      L.polygon(ring, { color: COLORS[side], weight: 0, fillOpacity: 0.05, interactive: false }).addTo(swathLayer);
    }
  });
  const line = d.track.map(([lo, la]) => [la, lo] as [number, number]);
  L.polyline(line, { color: "#000", weight: 5, opacity: 0.4 }).addTo(trackLayer);
  L.polyline(line, { color: "#7cf0c5", weight: 2.2 }).addTo(trackLayer);
  if (!sameFlight) map.fitBounds(L.latLngBounds(line).pad(0.15));

  for (const side of SIDES) {
    for (const r of d.summary[side].landmarks) {
      const lm = d.landmarks[r.id];
      L.circleMarker([lm.lat, lm.lon], { radius: 3, color: COLORS[side], weight: 1, fillOpacity: 0.7 })
        .bindTooltip(`${lm.name} — seen from the ${side} for ~${Math.round(r.duration_s / 60)} min`)
        .on("click", () => jumpTo(r.first_t))
        .addTo(allLmLayer);
    }
  }

  const slider = $<HTMLInputElement>("slider");
  slider.max = String(d.samples.length - 1);
  drawProfile(d);
  renderVerdict(d);
  renderWhole();
  render();
}

function jumpTo(t: number) {
  if (!data) return;
  let best = 0;
  data.samples.forEach((s, i) => { if (Math.abs(s.t - t) < Math.abs(data!.samples[best].t - t)) best = i; });
  idx = best;
  render();
}

// ---------------------------------------------------------------- rendering
function render() {
  if (!data) return;
  const s = data.samples[idx];
  $<HTMLInputElement>("slider").value = String(idx);
  $("clock").textContent = fmtTime(s.t);

  const pos: [number, number] = [s.lat, s.lon];
  if (!plane) plane = L.marker(pos, { icon: planeIcon(s.heading), zIndexOffset: 1000 }).addTo(liveLayer);
  else { plane.setLatLng(pos); plane.setIcon(planeIcon(s.heading)); }

  for (const side of SIDES) {
    const v = s.sides[side];
    const ring = v.footprint.map(([lo, la]) => [la, lo] as [number, number]);
    if (!footprint[side]) {
      footprint[side] = L.polygon(ring, { color: COLORS[side], weight: 2, fillOpacity: 0.3 }).addTo(liveLayer);
    } else footprint[side]!.setLatLngs(ring);
    // centre-of-window sight line to where it meets the ground (or the horizon)
    const ll: [number, number][] = [pos, [v.look_point[1], v.look_point[0]]];
    if (!lookLine[side]) lookLine[side] = L.polyline(ll, { color: COLORS[side], weight: 1, dashArray: "4 4" }).addTo(liveLayer);
    else lookLine[side]!.setLatLngs(ll);
  }

  // live landmark labels
  liveLayer.eachLayer((l) => { if ((l as any)._lm) liveLayer.removeLayer(l); });
  for (const side of SIDES) {
    for (const id of s.sides[side].landmarks.slice(0, 6)) {
      const lm = data.landmarks[id];
      const m = L.circleMarker([lm.lat, lm.lon], { radius: 6, color: COLORS[side], weight: 2, fillOpacity: 0.9 })
        .bindTooltip(lm.name, { permanent: true, direction: "right", className: `lm-label ${side}`, offset: [8, 0] });
      (m as any)._lm = true;
      m.addTo(liveLayer);
    }
  }

  renderStats(s);
  renderNow(s);
  for (const side of SIDES) drawWindow($<HTMLCanvasElement>(`win-${side}`), s, side, data.summary[side], data.landmarks);
  if (mode === "3d") {
    document.querySelectorAll<HTMLButtonElement>("#v3d-side button").forEach((b) => b.classList.toggle("active", b.dataset.side === side3d));
    view3d?.update(s, side3d);
  }
}

function setMode(m: "map" | "3d") {
  mode = m;
  document.querySelectorAll<HTMLButtonElement>("#mode button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  $("map").style.visibility = m === "map" ? "visible" : "hidden";
  $("view3d").hidden = m !== "3d";
  if (m === "3d" && !view3d) {
    view3d = new WindowView3D($("cesium"), $("porthole"));
    view3d.onInfo = (t) => ($("v3d-info").textContent = t);
    view3d.ready.then(() => { if (data) { view3d!.setData(data); render(); } })
      .catch((e) => ($("v3d-info").textContent = String(e.message ?? e)));
  }
  if (m === "map") map.invalidateSize();
  render();
  view3d?.resize();
}
document.querySelectorAll<HTMLButtonElement>("#mode button").forEach((b) =>
  b.addEventListener("click", () => setMode(b.dataset.mode as "map" | "3d")));
document.querySelectorAll<HTMLButtonElement>("#v3d-side button").forEach((b) =>
  b.addEventListener("click", () => { side3d = b.dataset.side as Side; if (view3d) view3d.lookH = view3d.lookV = 0; render(); }));
$("v3d-token").addEventListener("click", () => {
  const t = prompt(
    "Optional: paste a free Cesium ion access token (cesium.com/ion → Access Tokens).\n" +
    "Without one, the built-in demo token is used, which may be rate-limited.\nLeave empty to remove.",
    getToken() ?? "");
  if (t === null) return;
  setToken(t.trim() || null);
  location.reload();
});

function renderStats(s: Sample) {
  const stat = (k: string, v: string) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const sunSide = s.sides.left.sun_on_this_side ? "left" : s.sides.right.sun_on_this_side ? "right" : s.sun.visible ? "ahead/behind" : "—";
  $("stats").innerHTML =
    stat("Altitude", `${ft(s.alt_m).toLocaleString()}<small> ft</small>`) +
    stat("Ground speed", `${Math.round(s.gs_ms / 0.514444)}<small> kt</small>`) +
    stat("Horizon", `${Math.round(s.horizon_km)}<small> km</small>`) +
    stat("Heading", `${Math.round(s.heading)}°`) +
    stat("Bank / pitch", `${s.bank.toFixed(1)}° <small>/ ${s.pitch.toFixed(1)}°</small>`) +
    stat("Sun", `${s.sun.el.toFixed(0)}° <small>${s.sun.light} · ${sunSide}</small>`);
}

function renderNow(s: Sample) {
  for (const side of SIDES) {
    const ul = $(`now-${side}`);
    const ids = s.sides[side].landmarks;
    ul.innerHTML = ids.length
      ? ids.slice(0, 7).map((id) => {
          const t = s.sides[side].sightings[id];
          const dir = t[3] > 8 ? "ahead" : t[3] < -8 ? "behind" : "abeam";
          const lm = data!.landmarks[id];
          const light = lm.kind === "city" ? "" : t[5] === "alpenglow" ? " · 🌄" : t[5] === "twilight" ? " · dim" : t[5] === "dark" ? " · dark" : "";
          const elev = lm.kind === "peak" || lm.kind === "volcano" ? `<small class="sub">${Math.round(lm.elevation_m).toLocaleString()} m</small>` : "";
          return `<li><span>${lm.name}${elev}</span><span class="d">${Math.round(t[0])} km · ${dir}${light}</span></li>`;
        }).join("")
      : `<li class="empty">${s.sides[side].ground_fraction < 0.3 ? "mostly sky" : "open ground"}</li>`;
  }
}

function renderVerdict(d: Result) {
  const best = d.summary.recommended_side;
  const b = d.summary[best];
  const top = b.landmarks.slice(0, 3).map((r) => r.name).join(", ");
  const max = Math.max(d.summary.left.scenery_score, d.summary.right.scenery_score, 1);
  const bar = (side: Side) => `
    <span>${side}</span><div class="bar"><i style="width:${(100 * d.summary[side].scenery_score) / max}%;background:${COLORS[side]}"></i></div>
    <span>${d.summary[side].scenery_score.toFixed(0)}</span>`;
  const sunMin = (side: Side) => d.summary[side].sun_on_side_min;
  $("verdict").innerHTML = `
    <h3>Best side for this flight</h3>
    Sit on the <b class="${best}">${best.toUpperCase()}</b>${d.seat.simple ? "" : ` (${b.seat})`}${top ? ` for ${top}` : ""}.
    The sun is on the left for ${sunMin("left").toFixed(0)} min and on the right for ${sunMin("right").toFixed(0)} min.
    <div class="bars">${bar("left")}${bar("right")}</div>`;
}

function renderWhole() {
  if (!data) return;
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === wholeTab));
  const list = data.summary[wholeTab].landmarks;
  $("whole-list").innerHTML = list.length
    ? list.map((r) => {
        const lit = r.kind === "city" || !r.light || r.first_lit_t === undefined ? ""
          : r.first_lit_t === null ? " · not sunlit" : r.first_lit_t > r.first_t ? ` · lit ${fmtTime(r.first_lit_t)}` : "";
        return `<li data-t="${r.first_lit_t ?? r.first_t}">${r.name} <span class="meta">${r.kind} · ${fmtTime(r.first_t)} · ${Math.round(r.min_dist_km)} km${lit}</span></li>`;
      }).join("")
    : `<li>No catalogued landmarks on this side.</li>`;
  $("whole-list").querySelectorAll<HTMLLIElement>("li[data-t]").forEach((li) =>
    li.addEventListener("click", () => jumpTo(Number(li.dataset.t))));
}

function drawProfile(d: Result) {
  const svg = $("profile") as unknown as SVGSVGElement;
  const n = d.samples.length;
  const maxAlt = Math.max(...d.samples.map((s) => s.alt_m), 1);
  svg.setAttribute("viewBox", `0 0 ${n} 100`);
  const pts = d.samples.map((s, i) => `${i},${96 - (s.alt_m / maxAlt) * 80}`).join(" ");
  // landmark ticks per side
  const ticks = SIDES.map((side) => d.samples.map((s, i) => s.sides[side].landmarks.length
    ? `<rect x="${i}" y="${side === "left" ? 0 : 6}" width="1" height="5" fill="${COLORS[side]}" opacity=".8"/>` : "").join("")).join("");
  const night = d.samples.map((s, i) => s.sun.el < -6 ? `<rect x="${i}" y="0" width="1" height="100" fill="#000" opacity=".35"/>` : "").join("");
  svg.innerHTML = `${night}<polygon points="0,100 ${pts} ${n - 1},100" fill="#7cf0c5" opacity=".12"/>
    <polyline points="${pts}" fill="none" stroke="#7cf0c5" stroke-width="1.2" vector-effect="non-scaling-stroke" opacity=".7"/>${ticks}`;
}

// ---------------------------------------------------------------- controls
$<HTMLInputElement>("slider").addEventListener("input", (e) => { idx = Number((e.target as HTMLInputElement).value); render(); });
document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) =>
  b.addEventListener("click", () => { wholeTab = b.dataset.tab as Side; renderWhole(); }));

let last = 0, acc = 0;
function tick(ts: number) {
  if (!playing || !data) return;
  const dt = last ? (ts - last) / 1000 : 0;
  last = ts;
  acc += dt * Number($<HTMLSelectElement>("speed").value);
  const step = data.options.step_s;
  if (acc >= step) {
    idx = Math.min(data.samples.length - 1, idx + Math.floor(acc / step));
    acc %= step;
    render();
    if (idx === data.samples.length - 1) setPlaying(false);
  }
  requestAnimationFrame(tick);
}
function setPlaying(p: boolean) {
  playing = p;
  $("play").textContent = p ? "❚❚" : "▶";
  last = 0;
  if (p) {
    if (data && idx >= data.samples.length - 1) idx = 0;
    requestAnimationFrame(tick);
  }
}
$("play").addEventListener("click", () => setPlaying(!playing));
document.addEventListener("keydown", (e) => {
  if (!data || (e.target as HTMLElement).tagName === "INPUT" && e.key !== " ") return;
  if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
  if (e.key === "ArrowRight") { idx = Math.min(data.samples.length - 1, idx + 1); render(); }
  if (e.key === "ArrowLeft") { idx = Math.max(0, idx - 1); render(); }
});

window.addEventListener("resize", () => render());

// ?data=url.json opens a ready-made analysis (used by `windowseat view`); otherwise show the welcome screen
const param = new URLSearchParams(location.search).get("data");
initFlow(setData, { showWelcome: !param });
if (param) loadUrl(param).catch((e) => console.error(e));
