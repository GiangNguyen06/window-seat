# ✈️ Window Seat

**What could you see from your airplane window? Drop in a flight from Flightradar24 and find out.**

👉 **Try it: [giangnguyen06.github.io/window-seat](https://giangnguyen06.github.io/window-seat/)**. Nothing to install, and your files never leave your browser.

Window Seat replays a real flight and works out, moment by moment, what each window looked out on:

- **Cities, mountains, lakes and volcanoes** that passed through your window, with time and distance. The catalogue covers about 6,000 cities and 130 peaks worldwide, including all 14 eight-thousanders.
- **Which side to sit on** for the better view, and when the sun was on your side or in your eyes.
- **Clouds and wind on that day** (real weather): whether the ground was hidden under a cloud deck, and which peaks stood above it.
- **A 3D view out of your actual window**: a globe with real terrain, satellite imagery, atmosphere and the sun in the right place.

It does this with real physics, not guesswork. It estimates the aircraft's tilt in turns from the flight track, traces sight lines over a curved earth (light bends slightly in the atmosphere), models haze and summit lighting, and corrects for the wind pushing the plane sideways.

## How to use it

1. Get your flight from **[flightradar24.com](https://www.flightradar24.com)**: search the flight number (e.g. `KL1605`), open its history page, and click **KML** next to the flight you took. **CSV** works too. Downloads need a paid plan; Silver keeps 90 days of history.
2. Open the website and drop the file in.
3. You immediately see the **left and right windows** compared. Open **My seat** to set the aircraft (filled in from a KML), your row and seat letter, how close you lean to the window, haze, real terrain and weather.
4. Play the flight back or drag the timeline. Switch to **Window view 3D** to look outside. In 3D, drag to look around and scroll to lean in.

**KML or CSV?** Both contain the same flight path. The KML also includes the flight number, airline, route, times, aircraft type and registration, so nothing needs to be typed in. From a CSV, the flight number, airline and airports are worked out automatically; only the aircraft type is missing, and it only matters for seat-specific results.

Your flights are saved in your browser and listed on the start screen next time.

## How it works

The full derivation is in **[docs/physics.md](docs/physics.md)**. In short:

1. **Attitude from the track.** Bank angle comes from the coordinated-turn equation *tan φ = v·ω/g*. Pitch is the climb angle plus the angle of attack. With weather on, the wind at cruise height gives the **crab angle**: the nose points slightly into the wind.
2. **Window optics.** What a window shows is set by its size and your eye's distance from it: *2·atan(w/2d)* wide and *2·atan(h/2d)* tall. Middle and aisle seats see less, and over-wing rows lose the lower part.
3. **Rotation.** Window rays are rotated from the aircraft frame to North-East-Down with the yaw-pitch-roll rotation matrix.
4. **Curved earth and refraction.** Sight lines are traced on an "effective earth" *R' = R/(1−k)*, with k = 0.13. From 37,000 ft the horizon is 406 km away and 3.2° below level.
5. **Seeing a landmark.** It must be within range, above the earth's curve, inside your window, not behind terrain, and not lost in haze. High summits are tested against clean air at altitude, which is why an 8,000 m peak can be seen from 400+ km.
6. **Light and clouds.** The sun's position comes from the NOAA algorithm. Summits catch the first light before the valleys (alpenglow). Cloud layers count only when they're between you and the target.

## Run it on your own computer

**Website** (Node.js 20+):
```bash
cd web
npm install
npm run dev          # → http://localhost:5173
```

**Python version** (Python 3.10+). This is the original implementation and the reference the website is checked against. On Windows, double-click **`start.bat`**; on Mac or Linux, run `./start.sh`. A menu asks for a flight from the `flights/` folder and your seat, then opens the website with it.

<details><summary>Command line</summary>

```bash
pip install -e .
windowseat                                   # interactive menu
windowseat analyze flights/MY_FLIGHT.kml --seat 23A --open
windowseat demo --open
windowseat horizon 37000 --ft                # horizon distance and dip for an altitude
```

| Flag | Meaning |
|---|---|
| `--seat 23A` / `left` / `right` | Your seat. The letter picks the side; seats further from the window see less |
| `--aircraft A359` | ICAO type (A320, B738, A359, B789, …): cabin layout, window size, over-wing rows |
| `--terrain` | Real elevation data, so mountains can block the view |
| `--visibility 150` | Haze: visibility near the ground, in km |
| `--landmarks my.csv` | Extra places of interest (`name,lat,lon[,kind,elevation_m,weight]`) |
| `--geojson out.geojson` | Also export the track, views and landmarks for QGIS or geojson.io |
| `--fr24 FLIGHT --date YYYY-MM-DD` | Fetch from the paid Flightradar24 API (`FR24_API_TOKEN`) |
| `--opensky CALLSIGN` | Fetch a live or recent flight from the free OpenSky Network |
</details>

**Two implementations, one answer.** The physics exists in Python (`src/windowseat/`) and in TypeScript for the website (`web/src/core/`). `npm run parity` runs both on the same flight and compares every sample. CI fails if they ever disagree. Weather is currently website-only.

## Project layout

```
web/                 the website: Vite + TypeScript + Leaflet + CesiumJS
  src/core/          the physics in TypeScript (runs in a background worker)
  src/flow.ts        drop a file → simple result → seat settings
  src/view3d.ts      the 3D window view
src/windowseat/      the Python version (reference implementation + command line)
  data/              catalogues: cities, peaks, lakes, airports, airlines
  viewer/            the built website, served by the Python version
docs/physics.md      the maths
flights/             your own flight files (not uploaded to GitHub)
```

## Roadmap

- [x] Map with view footprints, landmarks, sun side and seat recommendation
- [x] Window views: schematic 2D and 3D (terrain, imagery, sun)
- [x] Clean-air visibility for high peaks, and alpenglow
- [x] Real weather: clouds, wind and crab angle
- [ ] Clouds in the 3D window view
- [ ] Per-airline seat maps
- [ ] "Plan my seat": pick the best side before you book, from a scheduled route

## Data & credits

- Flight data: [Flightradar24](https://www.flightradar24.com) downloads (and optionally the FR24 API or [OpenSky Network](https://opensky-network.org)). Respect each provider's terms of use. This project doesn't scrape any website.
- Weather: [Open-Meteo](https://open-meteo.com) (CC BY 4.0)
- Cities: © [GeoNames](https://www.geonames.org/) (CC BY 4.0), via `geonamescache`
- Airports: [airportsdata](https://github.com/mborsetti/airportsdata) (MIT)
- Elevation: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
- 3D globe: [CesiumJS](https://cesium.com/platform/cesiumjs/), terrain and imagery from Cesium ion
- Map tiles: Esri World Imagery, CARTO, OpenTopoMap

MIT licensed.
