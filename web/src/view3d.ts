// Realistic 3D view out of the window with CesiumJS: a WGS-84 globe with real terrain,
// satellite imagery, atmosphere/fog and sun lighting for the exact date and time.
//
// The camera sits at the aircraft's position. It looks along the window ray
// (rotated by heading / pitch / bank exactly as in the Python core) with the
// window's own field of view: FOV = 2·atan(window size / 2·eye distance).
//
// CesiumJS (~25 MB) is loaded from a CDN only when you open this view, so the
// project itself stays small. Override with ?cesium=<base url> to self-host.

import type * as CesiumNS from "cesium";
import { dcmBodyToNed, matVec, windowRayBody, type Vec3 } from "./core/optics";
import type { Result, Sample, Side } from "./types";

type C = typeof CesiumNS;
declare global {
  interface Window { Cesium?: C; CESIUM_BASE_URL?: string }
}

const CESIUM_VERSION = "1.147.0";
const DEFAULT_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;
const TOKEN_KEY = "windowseat.cesiumIonToken";

let loading: Promise<C> | null = null;
function loadCesium(): Promise<C> {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (loading) return loading;
  const base = new URLSearchParams(location.search).get("cesium") ?? DEFAULT_BASE;
  window.CESIUM_BASE_URL = base;
  loading = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = base + "Widgets/widgets.css";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = base + "Cesium.js";
    s.onload = () => resolve(window.Cesium!);
    s.onerror = () => reject(new Error(`Could not load CesiumJS from ${base}. Are you online?`));
    document.head.appendChild(s);
  });
  return loading;
}

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null): void {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

const norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const nedToEnu = (v: Vec3): [number, number, number] => [v[1], v[0], -v[2]];

export class WindowView3D {
  private Cesium!: C;
  private viewer!: CesiumNS.Viewer;
  private entities = new Map<string, CesiumNS.Entity>();
  private data: Result | null = null;
  private last: { s: Sample; side: Side } | null = null;
  /** look-around offsets (deg) and eye-to-window distance (m), driven by mouse */
  lookH = 0;
  lookV = 0;
  eye: number | null = null;
  ready: Promise<void>;
  onInfo: (text: string) => void = () => {};
  private terrainNote = "";

  constructor(private container: HTMLElement, private porthole: HTMLElement) {
    this.ready = this.init();
    this.bindInput();
  }

  private async init() {
    const Cesium = (this.Cesium = await loadCesium());
    const token = new URLSearchParams(location.search).get("token") ?? getToken();
    if (token) Cesium.Ion.defaultAccessToken = token;

    // Real terrain from Cesium ion; if it can't be loaded, fall back to a smooth globe
    // so the view never stays black. ?terrain=none forces the smooth globe.
    const wantTerrain = new URLSearchParams(location.search).get("terrain") !== "none";
    const smooth = () => new Cesium.Terrain(Promise.resolve(new Cesium.EllipsoidTerrainProvider()));
    const terrain = wantTerrain ? Cesium.Terrain.fromWorldTerrain() : smooth();
    const viewer = (this.viewer = new Cesium.Viewer(this.container, {
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false,
      selectionIndicator: false, shouldAnimate: false, terrain,
      ...(new URLSearchParams(location.search).get("imagery") === "none" ? { baseLayer: false as const } : {}),
    }));
    (window as unknown as { __viewer: unknown }).__viewer = viewer; // handy for debugging in the console
    terrain.errorEvent.addEventListener(() => {
      viewer.scene.setTerrain(smooth());
      this.terrainNote = " · terrain unavailable, showing a smooth globe";
      if (this.last) this.update(this.last.s, this.last.side);
    });
    // If the satellite imagery can't be loaded, drop it so the plain globe still renders
    const base = viewer.imageryLayers.length ? viewer.imageryLayers.get(0) : null;
    base?.errorEvent.addEventListener(() => {
      viewer.imageryLayers.remove(base);
      this.terrainNote += " · imagery unavailable";
      if (this.last) this.update(this.last.s, this.last.side);
    });
    const scene = viewer.scene;
    scene.globe.baseColor = Cesium.Color.fromCssColorString("#2b3a4a");
    scene.globe.enableLighting = true; // day/night from the real sun position
    scene.globe.dynamicAtmosphereLighting = true;
    scene.globe.dynamicAtmosphereLightingFromSun = true;
    scene.globe.showGroundAtmosphere = true;
    scene.fog.enabled = true;
    scene.globe.depthTestAgainstTerrain = true;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
    scene.screenSpaceCameraController.enableInputs = false; // we drive the camera
    viewer.clock.shouldAnimate = false;
    if (this.data) this.setData(this.data);
    if (this.last) this.update(this.last.s, this.last.side);
  }

  setData(d: Result) {
    this.data = d;
    this.eye = null;
    if (!this.viewer) return;
    const Cesium = this.Cesium;
    this.viewer.entities.removeAll();
    this.entities.clear();
    for (const [id, lm] of Object.entries(d.landmarks)) {
      const summit = lm.kind === "peak" || lm.kind === "volcano";
      const e = this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lm.lon, lm.lat, lm.elevation_m + (summit ? 60 : 300)),
        point: {
          pixelSize: summit ? 6 : 5,
          color: summit ? Cesium.Color.fromCssColorString("#ffd1dc") : Cesium.Color.fromCssColorString("#ffe08a"),
          outlineColor: Cesium.Color.BLACK, outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: summit ? `${lm.name}\n${Math.round(lm.elevation_m).toLocaleString()} m` : lm.name,
          font: "600 13px Inter, system-ui, sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString("#0b1020"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          showBackground: false,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        show: false,
      });
      this.entities.set(id, e);
    }
  }

  /** Point the camera out of the chosen window at this moment of the flight. */
  update(s: Sample, side: Side) {
    this.last = { s, side };
    if (!this.viewer || !this.data) return;
    const Cesium = this.Cesium;
    const sum = this.data.summary[side];
    const [ww, wh] = sum.window_m ?? [0.25, 0.36];
    const eye = this.eye ?? sum.eye_distance_m ?? 0.35;
    const hHalf = Math.atan(ww / 2 / eye), vHalf = Math.atan(wh / 2 / eye);

    // camera axes in the body frame → NED → ENU → Earth-fixed
    const dcm = dcmBodyToNed(s.heading, s.pitch, s.bank);
    const dBody = windowRayBody(side, this.lookH, this.lookV);
    const upRef: Vec3 = [0, 0, -1]; // cabin "up"
    const dot = dBody[0] * upRef[0] + dBody[1] * upRef[1] + dBody[2] * upRef[2];
    const uBody = norm([upRef[0] - dot * dBody[0], upRef[1] - dot * dBody[1], upRef[2] - dot * dBody[2]]);
    // Flight-tracker altitude is above sea level; keep the camera above the rendered ground
    const ground = this.viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(s.lon, s.lat)) ?? 0;
    const pos = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, Math.max(s.alt_m, ground + 5));
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(pos);
    const toFixed = (v: Vec3) => Cesium.Cartesian3.normalize(
      Cesium.Matrix4.multiplyByPointAsVector(enu, new Cesium.Cartesian3(...nedToEnu(matVec(dcm, v))), new Cesium.Cartesian3()),
      new Cesium.Cartesian3());

    const cam = this.viewer.camera;
    cam.setView({ destination: pos, orientation: { direction: toFixed(dBody), up: toFixed(uBody) } });
    const frustum = cam.frustum as CesiumNS.PerspectiveFrustum;
    const aspect = ww / wh;
    frustum.fov = aspect >= 1 ? 2 * hHalf : 2 * vHalf;
    this.porthole.style.aspectRatio = `${aspect}`;
    this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(s.t * 1000));

    const visible = new Set(s.sides[side].landmarks);
    for (const [id, e] of this.entities) e.show = visible.has(id);

    const deg = (r: number) => Math.round((r * 180) / Math.PI);
    this.onInfo(`FOV ${deg(2 * hHalf)}° × ${deg(2 * vHalf)}° · eye ${Math.round(eye * 100)} cm from window`
      + (this.lookH || this.lookV ? ` · looking ${Math.abs(Math.round(this.lookH))}° ${this.lookH >= 0 ? "forward" : "back"}, ${Math.round(this.lookV)}° ${this.lookV >= 0 ? "up" : "down"}` : "") + this.terrainNote);
    this.viewer.scene.requestRender();
  }

  resize() { this.viewer?.resize(); }

  private bindInput() {
    let drag: { x: number; y: number } | null = null;
    const el = this.porthole;
    el.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointerup", () => (drag = null));
    el.addEventListener("pointermove", (e) => {
      if (!drag || !this.last) return;
      const side = this.last.side;
      const k = 60 / el.clientHeight; // ~60° per window height
      // Looking right, moving the mouse left turns you towards the nose
      this.lookH = Math.max(-70, Math.min(70, this.lookH + (side === "right" ? -1 : 1) * (e.clientX - drag.x) * k));
      this.lookV = Math.max(-60, Math.min(45, this.lookV - (e.clientY - drag.y) * k));
      drag = { x: e.clientX, y: e.clientY };
      this.update(this.last.s, side);
    });
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (!this.last || !this.data) return;
      const base = this.eye ?? this.data.summary[this.last.side].eye_distance_m ?? 0.35;
      this.eye = Math.max(0.1, Math.min(1.5, base * (1 + e.deltaY * 0.001)));
      this.update(this.last.s, this.last.side);
    }, { passive: false });
    el.addEventListener("dblclick", () => {
      this.lookH = this.lookV = 0;
      this.eye = null;
      if (this.last) this.update(this.last.s, this.last.side);
    });
  }
}
