// Compare the TypeScript port with the Python reference on the same flights.
// Usage: npx tsx scripts/parity.ts <python-output.json> [flight file | demo] [seat] [aircraft]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyze } from "../src/core/analysis";
import { setDataLoader } from "../src/core/data";
import { demoFlight } from "../src/core/demo";
import { readFlightFile } from "../src/core/sources";

setDataLoader(async (name) => readFileSync(join(import.meta.dirname, "../../src/windowseat/data", name), "utf8"));

const [pyPath, input = "demo", seat = "", aircraft = ""] = process.argv.slice(2);
const py = JSON.parse(readFileSync(pyPath, "utf8"));
const flight = input === "demo" ? demoFlight() : await readFlightFile(readFileSync(input, "utf8"), input.split("/").pop()!);
const t0 = performance.now();
const ts = await analyze(flight, seat || null, aircraft || null, null);
const ms = performance.now() - t0;

let worst = 0, fails = 0;
const check = (label: string, a: unknown, b: unknown, tol = 0) => {
  const ok = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= tol : JSON.stringify(a) === JSON.stringify(b);
  if (typeof a === "number" && typeof b === "number") worst = Math.max(worst, Math.abs(a - b));
  if (!ok) { fails++; if (fails <= 15) console.log(`  ✗ ${label}: python=${JSON.stringify(a)} ts=${JSON.stringify(b)}`); }
};
check("samples", py.samples.length, ts.samples.length);
for (let i = 0; i < Math.min(py.samples.length, ts.samples.length); i++) {
  const a = py.samples[i], b = ts.samples[i];
  for (const f of ["lat", "lon", "heading", "pitch", "bank"]) check(`sample ${i} ${f}`, a[f], b[f], 0.02);
  check(`sample ${i} sun.el`, a.sun.el, b.sun.el, 0.02);
  for (const side of ["left", "right"] as const) {
    check(`sample ${i} ${side} landmarks`, [...a.sides[side].landmarks].sort(), [...b.sides[side].landmarks].sort());
    a.sides[side].footprint.forEach((p: number[], j: number) => {
      check(`sample ${i} ${side} fp${j} lon`, p[0], b.sides[side].footprint[j][0], 0.002);
      check(`sample ${i} ${side} fp${j} lat`, p[1], b.sides[side].footprint[j][1], 0.002);
    });
  }
}
for (const side of ["left", "right"] as const) {
  const names = (x: { name: string }[]) => x.map((r) => r.name).join(", ");
  check(`${side} landmark list`, names(py.summary[side].landmarks), names(ts.summary[side].landmarks));
  check(`${side} scenery score`, py.summary[side].scenery_score, ts.summary[side].scenery_score, 0.5);
}
check("recommended side", py.summary.recommended_side, ts.summary.recommended_side);
check("flight info", py.flight.flight_number ?? null, ts.flight.flight_number ?? null);
console.log(`${input}: ${ts.samples.length} samples in ${ms.toFixed(0)} ms · ${fails} mismatches · max numeric diff ${worst.toFixed(4)}`);
process.exit(fails ? 1 : 0);
