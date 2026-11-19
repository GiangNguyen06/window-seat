# ✈️ Window Seat

**Work out what you can see from your airplane window, using real flight-tracking data and some physics.**

Give it a flight track (Flightradar24 export, FR24 API, or OpenSky) and a seat number. It then:

- estimates the aircraft's **attitude** (heading, pitch, bank in turns) from the track
- casts sight lines through the **window aperture** of your seat over a **curved, refracting earth**, and optionally real **terrain**
- maps the patch of ground you can see at every moment (your *view footprint*)
- lists the **cities, mountain peaks (130, including all 14 eight-thousanders), lakes and volcanoes** that pass through your window, with time, distance and whether the summit was sunlit
- tracks the **sun**: which side it's on, and when it shines straight into your window
- tells you **which side to sit on** for the best view

A website (no install, nothing uploaded) plays the flight back on a map. It shows both window views side by side, the live footprints and what's in view. Switch to **Window view 3D** to look out of your actual window: a CesiumJS globe with real terrain, satellite imagery, atmosphere and the sun at the right place for that moment. Drag to look around, and scroll to lean in towards the glass.

```
$ windowseat demo
✈  KLM1605  AMS→FCO   (Boeing 737, data: demo)

── LEFT side, seat 20A
   window FOV ≈ 39.3° × 54.4°
   daylight 117.0 min · sun on this side 117.0 min · sun in window 0.0 min
   • Eiger                    peak     08:27–08:34 UTC, closest 47 km
   • Jungfrau                 peak     08:27–08:34 UTC, closest 45 km
   • Lake Garda               lake     08:42–08:48 UTC, closest 141 km
   ...
── RIGHT side, seat 20F ← your seat
   • Turin                    city     08:35–08:44 UTC, closest 95 km
   • Mont Blanc               peak     08:31–08:32 UTC, closest 58 km
   • Lake Geneva              lake     08:28–08:30 UTC, closest 64 km
```

## Quick start

### The website (nothing to install)
Open the site, drop in a Flightradar24 **KML** or **CSV** file, and you get the result right away.
Everything is calculated in your browser, and your files never leave your computer.

- **Simple** (default): compares the left and right windows.
- **My seat**: pick the aircraft (filled in from a KML), your row and seat letter on a small cabin map,
  how close you lean to the window, haze, and optionally real terrain.
- Your flights are saved in your browser and are listed on the start screen next time.

To run it on your own computer:

```bash
cd web
npm install
npm run dev          # → http://localhost:5173
```

### The Python version (command line / scripting)
The original Python implementation is the reference the website is checked against. It's handy for
batch work and experiments.

**Windows:** double-click **`start.bat`**. **Mac/Linux:** run `./start.sh`. A menu asks for the flight
(from the `flights/` folder) and your seat, then opens the same viewer.

<details><summary>Command line</summary>

```bash
pip install -e .
windowseat                     # interactive menu
windowseat analyze flights/VN82_426a5696.kml --seat 23A --open
windowseat demo --open
```
</details>

### Two implementations, one answer
The physics exists twice: in Python (`src/windowseat/`) and in TypeScript for the website (`web/src/core/`).
`npm run parity` runs both on the same flight and compares every sample: positions, attitude, sun,
footprint corners and visible landmarks. CI fails if they drift apart. On the VN82 Amsterdam → Hanoi
flight (1,292 samples) they agree exactly, to rounding.

### The 3D window view
The **Window view 3D** button loads [CesiumJS](https://cesium.com/platform/cesiumjs/) from a CDN, so it needs internet. Terrain and imagery come from Cesium ion. It works out of the box with Cesium's built-in demo token. For reliable use, create a free account at [ion.cesium.com](https://ion.cesium.com), copy your default access token, and paste it via **Cesium token…** in the viewer. The token is stored only in your browser. If terrain or imagery can't load, the view falls back to a plain globe and says so.

The camera is placed exactly like the maths in `docs/physics.md`:
- **Position:** the aircraft's position.
- **Direction:** the window normal, rotated by heading, pitch and bank.
- **Field of view:** 2·atan(window size / 2·eye distance).

Scrolling changes the eye distance, so leaning in widens the view just like it does in the real cabin.

## Using your own flights

### 1. Flightradar24 KML / CSV download (works with a website subscription)
1. Log in on [flightradar24.com](https://www.flightradar24.com) and search your flight number, e.g. `VN82`.
2. Open the flight's history page (`flightradar24.com/data/flights/vn82`). Each past flight has **KML** and **CSV** download buttons. The history goes back 90 days on Silver.
3. Save the file into the `flights/` folder and run `start.bat`.

**KML is recommended.** It includes the flight number, airline, route, times, aircraft type and registration, so nothing has to be typed in. With a CSV, the flight number, airline and airports are derived automatically, but the aircraft type isn't available.

**Simple or detailed:** press Enter at the seat question to compare the left and right windows. Or type your seat number (e.g. `34A`) for results specific to that seat: window size, middle and aisle seats, and the wing blocking the view. The aircraft type matters only in detailed mode.

Or from the command line: `windowseat analyze flights/KL1605_3a1b2c3d.csv --seat 23A --aircraft B738 --open`.

### 2. Official Flightradar24 API
The [FR24 API](https://fr24api.flightradar24.com) is a **separate, credit-based subscription** from the Silver/Gold app plans. It has a free sandbox.

```bash
export FR24_API_TOKEN=...
windowseat analyze --fr24 KL1605 --date 2026-11-12 --seat 23A
```

### 3. OpenSky Network (free, non-commercial)
```bash
export OPENSKY_CLIENT_ID=... OPENSKY_CLIENT_SECRET=...   # optional, raises limits
windowseat analyze --opensky KLM1605 --seat 23A            # flight must be airborne / recent
```

### Options
| Flag | Meaning |
|---|---|
| `--seat 23A` / `left` / `right` | Seat. The letter picks the side, and the distance from the window shrinks your field of view |
| `--aircraft A359` | ICAO type (A320, B738, A359, B789, …). Sets the cabin layout, window size and over-wing rows. The menu remembers it per flight file |
| `--terrain` | Use real elevation (AWS Terrain Tiles, cached in `~/.cache/windowseat`) so mountains block the view |
| `--visibility 150` | Atmospheric visibility in km |
| `--step 30` | Seconds between samples |
| `--landmarks my.csv` | Extra points of interest (`name,lat,lon[,kind,elevation_m,weight]`) |
| `--geojson out.geojson` | Also export footprints, track and landmarks for QGIS / geojson.io |

`windowseat horizon 37000 --ft` prints the horizon distance and dip for any altitude.

## How it works

The full derivation is in **[docs/physics.md](docs/physics.md)**. In short:

1. **Attitude from kinematics.** Bank comes from the coordinated-turn equation *tan φ = v·ω/g*. Pitch is the flight-path angle plus the angle of attack.
2. **Window optics.** The aperture is *atan(w/2d)* × *atan(h/2d)*, from the window size and the eye-to-window distance.
3. **Rotation.** Window rays are rotated from the body frame to North-East-Down using the yaw-pitch-roll direction-cosine matrix.
4. **Curvature and refraction.** Rays are traced on an effective earth *R' = R/(1−k)*, with k = 0.13. The horizon from FL370 is 406 km away and 3.2° below horizontal.
5. **Ray casting.** Each ray uses a closed-form ray–sphere intersection, or a DEM ray-march with bisection when `--terrain` is on.
6. **Landmark visibility.** A landmark must pass four checks: within range, above the curvature, inside the window aperture, and not hidden by terrain.
7. **Sun.** Solar position uses the NOAA algorithm, compared against the horizon dip at altitude.

## Project layout

```
src/windowseat/
  geodesy.py     WGS-84, great circles, horizon, refraction, line of sight
  track.py       flight model, resampling, attitude estimation
  aircraft.py    cabin layouts, seat parsing, window field of view
  optics.py      body ⇄ NED rotations, window rays
  raycast.py     sight line → ground intersection (sphere or DEM)
  terrain.py     flat earth / AWS Terrarium elevation tiles
  landmarks.py   catalogue + visibility test
  sun.py         solar position
  analysis.py    the pipeline → JSON
  sources/       fr24_file (CSV/KML), fr24_api, opensky, demo
web/             the website: Vite + TypeScript + Leaflet + CesiumJS
  src/core/      TypeScript port of the physics (runs in a Web Worker)
  src/flow.ts    upload → simple result → detailed seat settings
  scripts/       copy-data (shared CSVs → website), parity check vs Python
flights/         put your Flightradar24 CSV/KML downloads here
start.bat / start.sh   one-click launchers
docs/physics.md  the maths
tests/           pytest suite
```

## Roadmap

- [x] 2D map: footprints, landmarks, sun side, seat recommendation
- [x] Schematic window view (horizon line, sun, landmarks at their true angles)
- [x] 3D window view with CesiumJS terrain, imagery, atmosphere and sun lighting
- [ ] Crab angle from wind-at-altitude data
- [x] Clean-air visibility model for high peaks + alpenglow (summit lighting)
- [ ] Clouds and visibility from weather data
- [ ] Per-airline seat maps
- [ ] "Plan my seat" mode: pick the best side before you book, from a scheduled route

## Data & credits

- City data © [GeoNames](https://www.geonames.org/) (CC BY 4.0), via `geonamescache`
- Airports: [airportsdata](https://github.com/mborsetti/airportsdata) (MIT)
- Elevation: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (SRTM, GMTED, ETOPO1 and others)
- Flight data: [Flightradar24](https://www.flightradar24.com) and [The OpenSky Network](https://opensky-network.org). Respect each provider's terms of use. This project doesn't scrape any website.
- Map tiles: Esri World Imagery, CARTO, OpenTopoMap

MIT licensed.
