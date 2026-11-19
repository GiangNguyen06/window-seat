// Window rays: body frame ⇄ North-East-Down. Port of src/windowseat/optics.py.
// Conventions:
// body frame x forward, y right, z down; NED world frame; angles in degrees.

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export const EARTH_R = 6_371_008.8;

export function dcmBodyToNed(heading: number, pitch: number, bank: number): Mat3 {
  const [ps, th, ph] = [rad(heading), rad(pitch), rad(bank)];
  const [cps, sps, cth, sth, cph, sph] = [Math.cos(ps), Math.sin(ps), Math.cos(th), Math.sin(th), Math.cos(ph), Math.sin(ph)];
  return [
    [cth * cps, sph * sth * cps - cph * sps, cph * sth * cps + sph * sps],
    [cth * sps, sph * sth * sps + cph * cps, cph * sth * sps - sph * cps],
    [-sth, sph * cth, cph * cth],
  ];
}

export function matVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function matTVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
  ];
}

export function windowRayBody(side: "left" | "right", hOff: number, vOff: number): Vec3 {
  const [a, b] = [rad(hOff), rad(vOff)];
  const y = Math.cos(a) * Math.cos(b);
  return [Math.sin(a) * Math.cos(b), side === "right" ? y : -y, -Math.sin(b)];
}

export function bodyAngles(side: "left" | "right", v: Vec3): [number, number] {
  const lateral = side === "right" ? v[1] : -v[1];
  return [deg(Math.atan2(v[0], lateral)), deg(Math.asin(Math.max(-1, Math.min(1, -v[2]))))];
}

export function azElToNed(az: number, el: number): Vec3 {
  return [Math.cos(rad(el)) * Math.cos(rad(az)), Math.cos(rad(el)) * Math.sin(rad(az)), -Math.sin(rad(el))];
}

export function elevationOf(v: Vec3): number {
  return deg(Math.asin(Math.max(-1, Math.min(1, -v[2]))));
}

/** Angle by which the horizon lies below horizontal, on the refraction-corrected earth. */
export function horizonDip(altM: number, k = 0.13): number {
  if (altM <= 0) return 0;
  const r = EARTH_R / (1 - k);
  return deg(Math.acos(r / (r + altM)));
}

/** v_off (window-vertical angle) at which the horizon crosses window column hOff, or null if not in [-89, 89]. */
export function horizonVOff(dcm: Mat3, side: "left" | "right", hOff: number, dip: number): number | null {
  const f = (v: number) => elevationOf(matVec(dcm, windowRayBody(side, hOff, v))) + dip;
  let lo = -89, hi = 89;
  let flo = f(lo), fhi = f(hi);
  if (flo > 0 || fhi < 0) {
    // elevation might decrease with v when banked steeply; handle the other monotonic order
    if (flo < 0 || fhi > 0) return null;
    [lo, hi] = [hi, lo];
    [flo, fhi] = [fhi, flo];
  }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function nedToAzEl(v: Vec3): [number, number] {
  const az = ((Math.atan2(v[1], v[0]) * 180) / Math.PI + 360) % 360;
  return [az, elevationOf(v)];
}

/** (h_off, v_off) samples around the window edge, counter-clockwise from the bottom-aft corner. */
export function windowBoundary(hHalf: number, vHalf: number, nPerEdge = 8): [number, number][] {
  const pts: [number, number][] = [];
  const lin = Array.from({ length: nPerEdge }, (_, i) => i / nPerEdge);
  for (const f of lin) pts.push([-hHalf + 2 * hHalf * f, -vHalf]);
  for (const f of lin) pts.push([hHalf, -vHalf + 2 * vHalf * f]);
  for (const f of lin) pts.push([hHalf - 2 * hHalf * f, vHalf]);
  for (const f of lin) pts.push([-hHalf, vHalf - 2 * vHalf * f]);
  return pts;
}
