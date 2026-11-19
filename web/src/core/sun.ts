// Solar position (NOAA / Meeus). Port of src/windowseat/sun.py.

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function solarPosition(unixT: number, lat: number, lon: number): [number, number] {
  const jd = unixT / 86400 + 2440587.5;
  const jc = (jd - 2451545) / 36525;
  const l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const mr = rad(m);
  const c = Math.sin(mr) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
    + Math.sin(2 * mr) * (0.019993 - 0.000101 * jc) + Math.sin(3 * mr) * 0.000289;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(appLong)));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const l0r = rad(l0);
  const eqTime = 4 * deg(y * Math.sin(2 * l0r) - 2 * e * Math.sin(mr) + 4 * e * y * Math.sin(mr) * Math.cos(2 * l0r)
    - 0.5 * y * y * Math.sin(4 * l0r) - 1.25 * e * e * Math.sin(2 * mr));
  const minutesUtc = (((unixT % 86400) + 86400) % 86400) / 60;
  const trueSolar = (((minutesUtc + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  let hourAngle = trueSolar / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;
  const latR = rad(lat), haR = rad(hourAngle);
  const cosZen = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(haR);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const elev = 90 - deg(zen);
  const azDen = Math.cos(latR) * Math.sin(zen);
  let az: number;
  if (Math.abs(azDen) > 1e-9) {
    const cosAz = (Math.sin(latR) * Math.cos(zen) - Math.sin(decl)) / azDen;
    az = 180 - deg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
    if (hourAngle > 0) az = -az;
    az = ((az % 360) + 360) % 360;
  } else az = lat > 0 ? 180 : 0;
  return [az, elev];
}

export function lightCondition(sunEl: number): string {
  if (sunEl > 6) return "day";
  if (sunEl > -0.833) return "golden hour";
  if (sunEl > -6) return "civil twilight";
  if (sunEl > -12) return "nautical twilight";
  if (sunEl > -18) return "astronomical twilight";
  return "night";
}
