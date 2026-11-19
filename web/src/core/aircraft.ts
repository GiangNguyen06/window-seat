// Cabin layouts and window optics. Port of src/windowseat/aircraft.py.

export const SEAT_PITCH_LATERAL_M = 0.48;
export const WINDOW_EYE_DISTANCE_M = 0.35;

export interface AircraftProfile {
  name: string;
  icaoTypes: string[];
  layout: string; // seat letters grouped by aisle, e.g. "ABC DEF"
  windowW: number;
  windowH: number;
  wingRows: [number, number] | null;
  wingMaskDeg: number;
}

const P = (name: string, icaoTypes: string[], layout: string, w: number, h: number,
  wingRows: [number, number] | null): AircraftProfile => ({ name, icaoTypes, layout, windowW: w, windowH: h, wingRows, wingMaskDeg: 10 });

export const PROFILES: AircraftProfile[] = [
  P("Airbus A320 family", ["A318", "A319", "A320", "A321", "A19N", "A20N", "A21N"], "ABC DEF", 0.23, 0.33, [10, 16]),
  P("Boeing 737", ["B737", "B738", "B739", "B37M", "B38M", "B39M", "B3XM"], "ABC DEF", 0.25, 0.36, [10, 17]),
  P("Embraer E-Jet", ["E170", "E75L", "E75S", "E190", "E195", "E290", "E295"], "AC DF", 0.23, 0.33, [8, 13]),
  P("Airbus A220", ["BCS1", "BCS3"], "AC DEF", 0.28, 0.41, [10, 15]),
  P("Airbus A330", ["A332", "A333", "A338", "A339"], "AC DEFG HK", 0.23, 0.33, [18, 28]),
  P("Airbus A350", ["A359", "A35K"], "ABC DEF HJK", 0.28, 0.4, [24, 34]),
  P("Boeing 777", ["B772", "B773", "B77L", "B77W", "B778", "B779"], "ABC DEFG HJK", 0.25, 0.38, [18, 32]),
  P("Boeing 787", ["B788", "B789", "B78X"], "ABC DEF HJK", 0.27, 0.47, [18, 28]),
  P("Airbus A380", ["A388"], "ABC DEFG HJK", 0.24, 0.35, [40, 60]),
];
export const GENERIC = P("Generic narrowbody", [], "ABC DEF", 0.24, 0.34, null);

export const groups = (p: AircraftProfile) => p.layout.split(" ");

export function profileFor(typeCode?: string | null): AircraftProfile {
  if (!typeCode) return GENERIC;
  const code = typeCode.trim().toUpperCase();
  for (const p of PROFILES) if (p.icaoTypes.includes(code)) return p;
  for (const p of PROFILES)
    for (const t of p.icaoTypes) if (code.includes(t.slice(1, 3)) || code.replace(/-/g, "").startsWith(t)) return p;
  return GENERIC;
}

export interface Seat {
  row: number;
  letter: string;
  side: "left" | "right";
  seatsFromWindow: number;
  profile: AircraftProfile;
  eyeDistanceM: number;
  hHalfFovDeg: number;
  vHalfFovDeg: number;
}

export const seatLabel = (s: Seat) => `${s.row}${s.letter}`;
export const overWing = (s: Seat) => !!(s.profile.wingRows && s.profile.wingRows[0] <= s.row && s.row <= s.profile.wingRows[1]);

export function parseSeat(seat: string, profile: AircraftProfile = GENERIC, eyeDistanceM: number | null = null): Seat {
  let s = seat.trim().toUpperCase();
  const gs = groups(profile);
  if (s === "L" || s === "LEFT") s = `20${gs[0][0]}`;
  else if (s === "R" || s === "RIGHT") s = `20${gs[gs.length - 1].slice(-1)}`;
  const m = /^(\d{1,3})([A-Z])$/.exec(s);
  if (!m) throw new Error(`Can't read seat "${seat}". Use e.g. 23A.`);
  const row = Number(m[1]), letter = m[2];
  const left = gs[0], right = gs[gs.length - 1];
  let side: "left" | "right", idx: number;
  if (left.includes(letter)) { side = "left"; idx = left.indexOf(letter); }
  else if (right.includes(letter)) { side = "right"; idx = right.length - 1 - right.indexOf(letter); }
  else {
    const all = gs.join("");
    if (!all.includes(letter)) throw new Error(`Seat letter ${letter} doesn't exist on the ${profile.name} (${profile.layout}).`);
    side = all.indexOf(letter) < all.length / 2 ? "left" : "right";
    idx = (side === "left" ? left.length : right.length) + 1;
  }
  const d = eyeDistanceM ?? WINDOW_EYE_DISTANCE_M + idx * SEAT_PITCH_LATERAL_M;
  return {
    row, letter, side, seatsFromWindow: idx, profile, eyeDistanceM: d,
    hHalfFovDeg: (Math.atan(profile.windowW / 2 / d) * 180) / Math.PI,
    vHalfFovDeg: (Math.atan(profile.windowH / 2 / d) * 180) / Math.PI,
  };
}

export function mirrorSeat(seat: Seat): Seat {
  const gs = groups(seat.profile);
  let letter: string;
  if (seat.side === "left") {
    const block = gs[gs.length - 1];
    letter = block[Math.max(0, block.length - 1 - Math.min(seat.seatsFromWindow, block.length - 1))];
  } else {
    const block = gs[0];
    letter = block[Math.min(seat.seatsFromWindow, block.length - 1)];
  }
  return parseSeat(`${seat.row}${letter}`, seat.profile, seat.eyeDistanceM);
}

export function windowVRange(seat: Seat): [number, number] {
  let low = -seat.vHalfFovDeg;
  if (overWing(seat)) low = Math.max(low, -seat.profile.wingMaskDeg);
  return [low, seat.vHalfFovDeg];
}
