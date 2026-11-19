// The website flow: drop a file → simple left/right result → optional detailed seat settings.
// All calculation happens in a Web Worker on the user's device.

import { GENERIC, groups, parseSeat, PROFILES, profileFor } from "./core/aircraft";
import type { Result } from "./types";
import type { AnalyzeRequest, WorkerMessage } from "./worker";
import { deleteFlight, flightId, getFlight, listFlights, saveFlight, type SavedSettings } from "./store";

type Source = { kind: "demo" } | { kind: "file"; id: string; fileName: string; text: string };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const DEFAULTS: SavedSettings = { mode: "simple", aircraft: "", row: 20, letter: "", eyeCm: null, visibilityKm: 150, terrain: false, weather: true };

let source: Source | null = null;
let settings: SavedSettings = { ...DEFAULTS };
let fileAircraft: { type?: string; model?: string } = {};
let setData: (d: Result) => void = () => {};
let hasData = false;
let ranOnce = false;

/** True once the in-browser calculation has produced a result (it then wins over a pre-made one). */
export const flowHasResult = () => ranOnce;

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let reqId = 0;
const pending = new Map<number, { resolve: (r: { result: Result; notes: string[] }) => void; reject: (e: Error) => void }>();
worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const m = e.data;
  const p = pending.get(m.id);
  if (!p) return;
  if (m.type === "progress") {
    $("busy-text").textContent = `${m.stage}…`;
    $("busy-bar").style.width = `${m.total ? Math.round((100 * m.done) / m.total) : 0}%`;
  } else if (m.type === "result") { pending.delete(m.id); p.resolve(m); }
  else { pending.delete(m.id); p.reject(new Error(m.message)); }
};

function seatSpec(s: SavedSettings): string | null {
  return s.mode === "detailed" && s.letter ? `${s.row}${s.letter}` : null;
}

async function run() {
  if (!source) {
    toast("This result was made by the Python version. To change settings or add weather, open the flight file with ＋ New flight.");
    return;
  }
  const req: AnalyzeRequest = {
    id: ++reqId,
    baseUrl: new URL(".", location.href).href,
    demo: source.kind === "demo",
    file: source.kind === "file" ? { name: source.fileName, text: source.text } : undefined,
    seat: seatSpec(settings),
    aircraft: settings.mode === "detailed" && settings.aircraft ? settings.aircraft : null,
    terrain: settings.terrain,
    weather: settings.weather,
    options: { visibilityKm: settings.visibilityKm, eyeDistanceM: settings.mode === "detailed" && settings.eyeCm ? settings.eyeCm / 100 : null },
  };
  $("busy").hidden = false;
  $("busy-text").textContent = "Reading the flight…";
  $("busy-bar").style.width = "0%";
  try {
    const { result, notes } = await new Promise<{ result: Result; notes: string[] }>((resolve, reject) => {
      pending.set(req.id, { resolve, reject });
      worker.postMessage(req);
    });
    fileAircraft = { type: result.flight.aircraft_type && !req.aircraft ? result.flight.aircraft_type : fileAircraft.type,
      model: result.flight.aircraft_model ?? fileAircraft.model };
    setData(result);
    hasData = true;
    ranOnce = true;
    hideWelcome();
    if (notes.length) alertNote(notes.join(" "));
    if (source.kind === "file") {
      const f = result.flight;
      const title = [f.flight_number ?? f.callsign ?? source.fileName, f.airline].filter(Boolean).join(" · ");
      const route = f.origin || f.destination ? `${f.origin ?? "?"} → ${f.destination ?? "?"}` : "";
      const day = new Date(f.start_t * 1000).toISOString().slice(0, 10);
      await saveFlight({ id: source.id, fileName: source.fileName, text: source.text, addedAt: Date.now(), title,
        subtitle: [route, day, f.aircraft_model ?? f.aircraft_type].filter(Boolean).join(" · "), settings });
    }
    renderSettings();
  } catch (err) {
    showWelcome(err instanceof Error ? err.message : String(err));
  } finally {
    $("busy").hidden = true;
  }
}

function alertNote(text: string) {
  $("v3d-info").textContent = text;
  toast(text);
  console.warn(text);
}

/** A short message at the bottom of the screen that fades away by itself. */
function toast(text: string, ms = 9000) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout((el as HTMLElement & { _t?: number })._t);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => el!.classList.remove("show"), ms);
}

/** Opened by the local `windowseat` server: recalculate the given flight here (adds weather etc.). */
async function startFromParams(params: URLSearchParams) {
  const seat = params.get("seat")?.toUpperCase() ?? "";
  const m = /^(\d{1,2})([A-Z])$/.exec(seat);
  const ac = params.get("aircraft");
  const base: SavedSettings = { ...DEFAULTS };
  if (m) Object.assign(base, { mode: "detailed", row: Number(m[1]), letter: m[2] });
  if (ac) base.aircraft = profileFor(ac).icaoTypes[0] ?? "";
  if (params.get("demo")) {
    source = { kind: "demo" };
    settings = base;
    return run();
  }
  const url = params.get("flight");
  if (!url) return;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    const text = await r.text();
    const fileName = decodeURIComponent(url.split("/").pop() ?? "flight");
    const id = flightId(fileName, text);
    const saved = await getFlight(id).catch(() => undefined);
    source = { kind: "file", id, fileName, text };
    settings = { ...base, ...(m || ac ? {} : saved?.settings ?? {}) };
    await run();
  } catch (e) {
    toast(`Couldn't reload the flight file for weather (${e instanceof Error ? e.message : e}).`);
  }
}

// ---------------------------------------------------------------- files
async function openFile(file: File) {
  const text = await file.text();
  if (/\.json$/i.test(file.name)) {
    try {
      setData(JSON.parse(text));
      hasData = true;
      hideWelcome();
    } catch { showWelcome("That JSON file isn't a Window Seat analysis."); }
    return;
  }
  const id = flightId(file.name, text);
  const saved = await getFlight(id).catch(() => undefined);
  source = { kind: "file", id, fileName: file.name, text };
  settings = { ...DEFAULTS, ...(saved?.settings ?? {}) };
  fileAircraft = {};
  await run();
}

// ---------------------------------------------------------------- welcome
function showWelcome(error?: string) {
  $("welcome").hidden = false;
  $("welcome-close").hidden = !hasData;
  const card = document.querySelector(".welcome-card")!;
  card.querySelector(".error-box")?.remove();
  if (error) {
    const box = document.createElement("div");
    box.className = "error-box";
    box.textContent = `Couldn't read that flight: ${error}`;
    card.insertBefore(box, $("dropzone"));
  }
  renderRecent();
}
function hideWelcome() { $("welcome").hidden = true; }

async function renderRecent() {
  let flights: Awaited<ReturnType<typeof listFlights>> = [];
  try { flights = await listFlights(); } catch { /* storage unavailable (private mode) */ }
  $("recent").hidden = !flights.length;
  const ul = $("recent-list");
  ul.innerHTML = "";
  for (const f of flights) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="t"><b></b><small></small></div><button class="del" title="Remove">×</button>`;
    li.querySelector("b")!.textContent = f.title;
    li.querySelector("small")!.textContent = f.subtitle;
    li.querySelector(".t")!.addEventListener("click", async () => {
      source = { kind: "file", id: f.id, fileName: f.fileName, text: f.text };
      settings = { ...DEFAULTS, ...(f.settings ?? {}) };
      fileAircraft = {};
      await run();
    });
    li.querySelector(".del")!.addEventListener("click", async () => { await deleteFlight(f.id); renderRecent(); });
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------- settings panel
function currentProfile() {
  return profileFor(settings.aircraft || fileAircraft.type) ?? GENERIC;
}

function renderSettings() {
  document.querySelectorAll<HTMLButtonElement>("#set-mode button").forEach((b) =>
    b.classList.toggle("active", b.dataset.m === settings.mode));
  $("set-detailed").hidden = settings.mode !== "detailed";
  $("set-simple-note").hidden = settings.mode === "detailed";

  const sel = $<HTMLSelectElement>("set-aircraft");
  const opts: string[] = [];
  if (fileAircraft.type)
    opts.push(`<option value="">${fileAircraft.model ?? profileFor(fileAircraft.type).name} (from the flight data)</option>`);
  else opts.push(`<option value="">Not sure (generic narrowbody)</option>`);
  for (const p of PROFILES) opts.push(`<option value="${p.icaoTypes[0]}">${p.name}</option>`);
  sel.innerHTML = opts.join("");
  sel.value = settings.aircraft;

  const prof = currentProfile();
  const gs = groups(prof);
  if (!settings.letter || !gs.join("").includes(settings.letter)) settings.letter = gs[0][0];
  $<HTMLInputElement>("set-row").value = String(settings.row);
  const letters = $("set-letters");
  letters.innerHTML = "";
  gs.forEach((g, gi) => {
    if (gi) letters.insertAdjacentHTML("beforeend", `<span class="aisle"></span>`);
    for (const ch of g) {
      const b = document.createElement("button");
      b.textContent = ch;
      const isWin = (gi === 0 && ch === g[0]) || (gi === gs.length - 1 && ch === g[g.length - 1]);
      b.className = `${isWin ? "win" : ""} ${ch === settings.letter ? "active" : ""}`;
      b.title = isWin ? "window seat" : "";
      b.addEventListener("click", () => { settings.letter = ch; renderSettings(); });
      letters.appendChild(b);
    }
  });

  const note = $("seat-note");
  try {
    const seat = parseSeat(`${settings.row}${settings.letter}`, prof, settings.eyeCm ? settings.eyeCm / 100 : null);
    const where = seat.seatsFromWindow === 0 ? "window seat"
      : seat.seatsFromWindow === 1 ? "one seat from the window"
      : seat.seatsFromWindow <= gs[0].length - 1 ? "aisle seat, looking past your neighbours"
      : "centre section, looking across the aisle";
    const wing = prof.wingRows && prof.wingRows[0] <= seat.row && seat.row <= prof.wingRows[1] ? " · over the wing (approx.)" : "";
    note.textContent = `${seat.side} side · ${where}${wing}`;
    note.classList.remove("err");
    const auto = Math.round(seat.eyeDistanceM * 100);
    const lean = $<HTMLInputElement>("set-lean");
    if (!settings.eyeCm) lean.value = String(Math.min(60, auto));
    $("set-lean-v").textContent = `${settings.eyeCm ?? auto} cm${settings.eyeCm ? "" : " (auto)"}`;
  } catch (e) {
    note.textContent = e instanceof Error ? e.message : String(e);
    note.classList.add("err");
  }
  $<HTMLSelectElement>("set-haze").value = String(settings.visibilityKm);
  $<HTMLInputElement>("set-terrain").checked = settings.terrain;
  $<HTMLInputElement>("set-weather").checked = settings.weather;
}

export function initFlow(onData: (d: Result) => void, opts: { showWelcome: boolean }) {
  setData = onData;

  document.querySelectorAll<HTMLButtonElement>("#set-mode button").forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.m as SavedSettings["mode"];
    if (m === settings.mode) return;
    settings.mode = m;
    renderSettings();
    if (m === "simple" && source) run();
  }));
  $<HTMLSelectElement>("set-aircraft").addEventListener("change", (e) => {
    settings.aircraft = (e.target as HTMLSelectElement).value;
    renderSettings();
  });
  $<HTMLInputElement>("set-row").addEventListener("input", (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (v >= 1 && v <= 99) { settings.row = v; renderSettings(); }
  });
  $<HTMLInputElement>("set-lean").addEventListener("input", (e) => {
    settings.eyeCm = Number((e.target as HTMLInputElement).value);
    renderSettings();
  });
  $("set-lean-v").addEventListener("click", () => { settings.eyeCm = null; renderSettings(); });
  $<HTMLSelectElement>("set-haze").addEventListener("change", (e) => { settings.visibilityKm = Number((e.target as HTMLSelectElement).value); });
  $<HTMLInputElement>("set-terrain").addEventListener("change", (e) => { settings.terrain = (e.target as HTMLInputElement).checked; });
  $<HTMLInputElement>("set-weather").addEventListener("change", (e) => { settings.weather = (e.target as HTMLInputElement).checked; });
  $("set-apply").addEventListener("click", () => run());

  $("new-flight").addEventListener("click", () => showWelcome());
  $("welcome-close").addEventListener("click", hideWelcome);
  $("try-demo").addEventListener("click", () => { source = { kind: "demo" }; settings = { ...DEFAULTS }; fileAircraft = {}; run(); });
  $<HTMLInputElement>("file").addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) openFile(f);
    (e.target as HTMLInputElement).value = "";
  });
  const dz = $("dropzone");
  dz.addEventListener("dragover", () => dz.classList.add("over"));
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));

  const drop = $("drop");
  window.addEventListener("dragover", (e) => { e.preventDefault(); if ($("welcome").hidden) drop.classList.add("show"); });
  window.addEventListener("dragleave", (e) => { if (e.target === drop) drop.classList.remove("show"); });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("show");
    dz.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (f) openFile(f);
  });

  renderSettings();
  const params = new URLSearchParams(location.search);
  if (params.get("flight") || params.get("demo")) {
    hideWelcome();
    startFromParams(params);
  } else if (opts.showWelcome) showWelcome();
  else { hideWelcome(); hasData = true; }
}
