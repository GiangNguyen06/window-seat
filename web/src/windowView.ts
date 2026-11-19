// Schematic "through the window" render: horizon line from attitude + earth curvature,
// sky colour from sun elevation, the sun disc, and catalogued landmarks at their true angles.
// This is the 2D stepping stone towards a full 3D terrain view.

import {
  azElToNed, bodyAngles, dcmBodyToNed, elevationOf, horizonDip, horizonVOff, matTVec, matVec, windowRayBody,
} from "./core/optics";
import type { LandmarkInfo, Sample, Side, SideSummary } from "./types";

interface Palette { skyTop: string; skyHorizon: string; groundNear: string; groundHaze: string; label: string }

function palette(sunEl: number): Palette {
  if (sunEl > 6) return { skyTop: "#2f6fc9", skyHorizon: "#cfe2f3", groundNear: "#4f6142", groundHaze: "#b7c4cc", label: "#10202e" };
  if (sunEl > -0.8) return { skyTop: "#34508f", skyHorizon: "#f4b46c", groundNear: "#3d3a33", groundHaze: "#c99a7a", label: "#1b1208" };
  if (sunEl > -6) return { skyTop: "#1b2650", skyHorizon: "#c9787a", groundNear: "#1c1d26", groundHaze: "#5b4a5a", label: "#f2e6ff" };
  if (sunEl > -12) return { skyTop: "#0b1230", skyHorizon: "#3b3f6e", groundNear: "#0b0d16", groundHaze: "#20243a", label: "#e8ecff" };
  return { skyTop: "#03050c", skyHorizon: "#101731", groundNear: "#04050a", groundHaze: "#0c1020", label: "#e8ecff" };
}

export function drawWindow(
  canvas: HTMLCanvasElement,
  s: Sample,
  side: Side,
  sum: SideSummary,
  landmarks: Record<string, LandmarkInfo>,
): void {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const hh = sum.fov_deg[0] / 2, vh = sum.fov_deg[1] / 2;
  const sx = side === "right" ? -1 : 1; // looking right, the nose is on your left
  const toX = (h: number) => W / 2 + (sx * h / hh) * (W / 2);
  const toY = (v: number) => H / 2 - (v / vh) * (H / 2);

  const dcm = dcmBodyToNed(s.heading, s.pitch, s.bank);
  const dip = horizonDip(s.alt_m);
  const pal = palette(s.sun.el);
  const night = s.sun.el < -6;

  // --- window aperture (rounded "pill")
  const r = Math.min(W, H) * 0.32;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(4, 4, W - 8, H - 8, r);
  ctx.clip();

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, pal.skyTop);
  sky.addColorStop(1, pal.skyHorizon);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // ground, below the curved-earth horizon line
  const cols = 24;
  const pts: [number, number][] = [];
  for (let i = 0; i <= cols; i++) {
    const h = -hh * 1.2 + (2.4 * hh * i) / cols;
    const v = horizonVOff(dcm, side, h, dip);
    // No crossing: the whole column is ground (horizon above the frame) or sky
    const groundAll = elevationOf(matVec(dcm, windowRayBody(side, h, 0))) < -dip;
    pts.push([toX(h), v === null ? (groundAll ? -1e4 : 1e4) : toY(v)]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const yMid = pts[Math.floor(pts.length / 2)][1];
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.lineTo(W + 50, H + 50);
  ctx.lineTo(-50, H + 50);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, Math.max(0, Math.min(H, yMid)), 0, H);
  g.addColorStop(0, pal.groundHaze);
  g.addColorStop(1, pal.groundNear);
  ctx.fillStyle = g;
  ctx.fill();

  // cloud deck below: a white layer over the ground, as thick as the chance the ground is hidden
  if (s.weather && s.weather.below > 0.05) {
    const a = Math.min(0.92, s.weather.below);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(W + 50, H + 50);
    ctx.lineTo(-50, H + 50);
    ctx.closePath();
    ctx.clip();
    // clouds are lit by the sun at the aircraft's level: white by day, pink-grey at dawn/dusk, dark at night
    // at night: a faint moonlit grey, a little brighter than the dark ground so the deck stays readable
    const top = night ? "rgba(118,128,156," : s.sun.el > 2 ? "rgba(245,247,252," : "rgba(196,176,190,";
    const cg = ctx.createLinearGradient(0, Math.max(0, Math.min(H, yMid)), 0, H);
    cg.addColorStop(0, `${top}${a})`);
    cg.addColorStop(1, `${top}${a * 0.8})`);
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, W, H);
    // a few soft cloud puffs for texture
    ctx.globalAlpha = a * 0.35;
    for (let i = 0; i < 18; i++) {
      const x = ((i * 97 + Math.round(s.t / 60) * 13) % (W + 60)) - 30;
      const y = yMid + 6 + ((i * 53) % Math.max(10, H - yMid));
      const rr = 6 + ((i * 31) % 18) * (y - yMid) / H * 2;
      ctx.fillStyle = night ? "#a7b0c8" : s.sun.el > 2 ? "#ffffff" : "#e6cfd8";
      ctx.beginPath(); ctx.ellipse(x, y, rr * 2.2, rr, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // haze band along the horizon
  ctx.strokeStyle = night ? "rgba(120,140,200,0.25)" : "rgba(255,255,255,0.35)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();

  // sun
  if (s.sun.visible) {
    const [hs, vs] = bodyAngles(side, matTVec(dcm, azElToNed(s.sun.az, s.sun.el)));
    const lateral = matTVec(dcm, azElToNed(s.sun.az, s.sun.el))[1] * (side === "right" ? 1 : -1);
    if (lateral > 0 && Math.abs(hs) < hh * 1.6 && Math.abs(vs) < vh * 1.6) {
      const x = toX(hs), y = toY(vs);
      const glow = ctx.createRadialGradient(x, y, 2, x, y, W * 0.6);
      glow.addColorStop(0, "rgba(255,250,230,1)");
      glow.addColorStop(0.08, "rgba(255,240,200,0.9)");
      glow.addColorStop(1, "rgba(255,230,180,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // wing for over-wing rows
  if (sum.over_wing) {
    const yw = toY(sum.v_range_deg[0]);
    ctx.fillStyle = "#9aa3ad";
    ctx.beginPath();
    ctx.moveTo(sx > 0 ? -10 : W + 10, yw - 4);
    ctx.lineTo(sx > 0 ? W + 10 : -10, yw + 18);
    ctx.lineTo(sx > 0 ? W + 10 : -10, H + 10);
    ctx.lineTo(sx > 0 ? -10 : W + 10, H + 10);
    ctx.closePath();
    ctx.fill();
  }

  // landmarks: draw markers first, then labels stacked so they don't overlap
  const sights = s.sides[side].sightings;
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  const labels: { x: number; y: number; text: string }[] = [];
  for (const id of s.sides[side].landmarks.slice(0, 6)) {
    const lm = landmarks[id];
    const t = sights[id];
    if (!lm || !t) continue;
    const x = toX(t[3]), y = toY(t[4]);
    const inCloud = (t[6] ?? 0) > 0.6;
    ctx.globalAlpha = inCloud ? 0.35 : 1;
    if (lm.kind === "city") {
      ctx.fillStyle = night ? "rgba(255,210,120,0.95)" : "rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(x, y, night ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
    } else if (lm.kind === "peak" || lm.kind === "volcano") {
      const light = t[5];
      ctx.fillStyle = light === "alpenglow" ? "rgba(255,150,170,0.98)"
        : light === "twilight" ? "rgba(150,160,190,0.85)"
        : light === "dark" ? "rgba(80,90,110,0.8)" : "rgba(255,255,255,0.95)";
      ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x - 7, y + 3); ctx.lineTo(x + 7, y + 3); ctx.closePath(); ctx.fill();
    } else {
      ctx.strokeStyle = "rgba(160,220,255,0.95)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const tag = inCloud ? " · in cloud" : t[5] === "alpenglow" ? " · first light" : t[5] === "twilight" && lm.kind !== "city" ? " · dim" : "";
    labels.push({ x, y, text: `${lm.name} · ${Math.round(t[0])} km${tag}` });
  }
  const placed: { x0: number; x1: number; y: number }[] = [];
  for (const l of labels) {
    if (ctx.measureText(l.text).width + 28 > W) l.text = l.text.replace(/ · \d+ km/, "");
    const w = ctx.measureText(l.text).width + 8;
    const x = Math.max(w / 2 + 10, Math.min(W - w / 2 - 10, l.x));
    let y = l.y - 13;
    while (placed.some((p) => Math.abs(p.y - y) < 16 && x - w / 2 < p.x1 && x + w / 2 > p.x0)) y -= 16;
    placed.push({ x0: x - w / 2, x1: x + w / 2, y });
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(l.x, l.y - 6); ctx.lineTo(x, y + 3); ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - w / 2, y - 11, w, 15);
    ctx.fillStyle = "#fff";
    ctx.fillText(l.text, x, y);
  }
  ctx.restore();

  // frame
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#d9dde3";
  ctx.beginPath(); ctx.roundRect(4, 4, W - 8, H - 8, r); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.roundRect(8, 8, W - 16, H - 16, r * 0.9); ctx.stroke();

  // weather badge: the cloud cover below, readable day or night
  if (s.weather) {
    const pct = Math.round(s.weather.below * 100);
    const text = pct >= 10 ? `☁ ${pct}% cloud below` : "clear below";
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    const tw = ctx.measureText(text).width + 14;
    const bx = W / 2 - tw / 2, by = H - 64;
    ctx.fillStyle = "rgba(8,12,26,0.62)";
    ctx.beginPath(); ctx.roundRect(bx, by, tw, 18, 9); ctx.fill();
    ctx.fillStyle = pct >= 60 ? "#ffffff" : "#d6e2f5";
    ctx.textAlign = "center";
    ctx.fillText(text, W / 2, by + 13);
  }

  // nose arrow
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.textAlign = sx > 0 ? "right" : "left";
  ctx.fillText(sx > 0 ? "nose →" : "← nose", sx > 0 ? W - r * 0.6 : r * 0.6, H - 24);
}
