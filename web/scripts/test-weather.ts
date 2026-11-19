// Unit tests for the weather module (run: npm test). Uses a fake fetch shaped like Open-Meteo's real answer.
import assert from "node:assert/strict";
import { cloudsAt, fetchSeries, headingWithWind, LEVELS, obscuredFraction, routeSamples, windAt } from "../src/core/weather";

const close = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// --- crab angle: flying east with wind from the north → nose turns left (into the wind)
{
  const hdg = headingWithWind(90, 250, 50, 0); // 250 m/s ground speed, 50 m/s from the north
  close(hdg, 90 - (Math.atan2(50, 250) * 180) / Math.PI, 0.01, "crab angle into a crosswind");
  close(headingWithWind(90, 250, 50, 270), 90, 1e-9, "pure tailwind: no crab");
}

// --- cloud layers between observer and target
{
  const c = { low: 1, mid: 0, high: 0 };
  close(obscuredFraction(c, 12_000, 0), 1, 1e-9, "full low deck hides the ground");
  close(obscuredFraction(c, 12_000, 8_849), 0, 1e-9, "a low deck doesn't hide Everest's summit");
  close(obscuredFraction({ low: 0, mid: 0, high: 1 }, 12_000, 8_849), 0.4, 1e-9, "thin high cloud partly hides it");
  close(obscuredFraction({ low: 0.5, mid: 0.5, high: 0 }, 12_000, 0), 1 - 0.5 * (1 - 0.45), 1e-9, "layers combine");
  close(obscuredFraction({ low: 1, mid: 1, high: 1 }, 250, 0), 0, 1e-9, "below the cloud base you see the ground");
  close(obscuredFraction({ low: 0, mid: 1, high: 0 }, 1_500, 0), 0, 1e-9, "clouds above you don't hide the ground");
}

// --- fetch: batching + parsing a response in Open-Meteo's real layout
{
  const urls: string[] = [];
  const hours = [0, 3600, 7200].map((h) => 1793750400 + h);
  const fakeFetch = async (url: string) => {
    urls.push(url);
    const n = new URL(url).searchParams.get("latitude")!.split(",").length;
    const one = (k: number) => ({
      latitude: 0, longitude: 0, generationtime_ms: 1, utc_offset_seconds: 0, timezone: "GMT", timezone_abbreviation: "GMT", elevation: 0,
      hourly_units: {},
      hourly: {
        time: hours, cloud_cover_low: [0, 50, 100], cloud_cover_mid: [10, 10, null], cloud_cover_high: [27, 27, 27],
        ...Object.fromEntries(LEVELS.flatMap(([p]) => [[`wind_speed_${p}hPa`, [10 + k, 20, 30]], [`wind_direction_${p}hPa`, [270, 270, 270]]])),
      },
    });
    const body = n === 1 ? one(0) : Array.from({ length: n }, (_, k) => one(k));
    return { ok: true, status: 200, json: async () => body };
  };
  const locs = Array.from({ length: 45 }, (_, i) => ({ lat: 20 + i * 0.1, lon: 80 }));
  const series = await fetchSeries(locs, hours[0], hours[2], fakeFetch);
  assert.equal(urls.length, 2, "45 locations → 2 requests of up to 40");
  assert.equal(series.length, 45);
  assert.ok(urls[0].includes("wind_speed_250hPa") && urls[0].includes("timeformat=unixtime") && urls[0].includes("wind_speed_unit=ms"));
  const c = cloudsAt(series[0], hours[0] + 1800);
  close(c.low, 0.25, 1e-9, "interpolates between hours");
  close(c.mid, 0.1, 1e-9, "missing values (null) fall back to the neighbour");
  const [sp, from] = windAt(series[0], hours[1], 10_363);
  close(sp, 20, 1e-6, "wind speed at the 250 hPa height");
  close(from, 270, 1e-6, "wind direction");
}

// --- route sampling
{
  const pts = Array.from({ length: 101 }, (_, i) => ({ lat: 0, lon: i * 0.1 })); // ~1,113 km
  const s = routeSamples(pts, 100_000);
  assert.ok(s.length >= 11 && s.length <= 13, `about every 100 km (${s.length})`);
  assert.equal(s[s.length - 1], pts[pts.length - 1]);
}

console.log("weather tests passed");
