"""Landmark catalogue and the "can I see it from my window?" test.

A landmark is visible from a window when all of these hold:

1. **Range** — it is within the atmospheric visibility limit and within the
   combined horizon distance √(2R'h_obs) + √(2R'h_target) (tall peaks poke up
   above the horizon from further away).
2. **Curvature** — the straight sight line on the effective earth never dips
   below the surface (see geodesy.line_of_sight).
3. **Window** — rotated into the aircraft body frame, the direction falls inside
   the window's angular aperture (and not into the wing, for over-wing seats).
4. **Terrain** — with a DEM, a ray-march towards it reaches it unobstructed.

Ground targets (cities, lakes) use the plain visibility distance. Mountain
summits stick up out of the haze, so for them we integrate the extinction along
the actual sight line instead (see atmosphere.py). We also check whether the
summit is lit: a peak 8 km up sees the sun before the valleys do (alpenglow).
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from importlib import resources
from pathlib import Path

from . import atmosphere, optics
from . import geodesy as geo
from .raycast import cast
from .sun import solar_position
from .terrain import FlatTerrain, Terrain


@dataclass(frozen=True)
class Landmark:
    id: str
    name: str
    kind: str  # city | peak | volcano | lake | ...
    lat: float
    lon: float
    elevation_m: float = 0.0
    weight: float = 1.0  # how interesting it is (used for ranking)
    population: int | None = None
    country: str | None = None
    region: str | None = None

    @property
    def is_summit(self) -> bool:
        return self.kind in ("peak", "volcano") and self.elevation_m >= 1000


def _data_file(name: str):
    return resources.files("windowseat").joinpath("data", name)


def load_builtin(min_city_population: int = 300_000) -> list[Landmark]:
    out: list[Landmark] = []
    with _data_file("features.csv").open(encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f)):
            out.append(
                Landmark(f"f{i}", r["name"], r["kind"], float(r["lat"]), float(r["lon"]),
                         float(r["elevation_m"]), float(r["prominence"]))
            )
    with _data_file("peaks.csv").open(encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f)):
            out.append(
                Landmark(f"p{i}", r["name"], r["kind"], float(r["lat"]), float(r["lon"]),
                         float(r["elevation_m"]), float(r["prominence"]), region=r.get("range"))
            )
    with _data_file("cities.csv").open(encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f)):
            pop = int(r["population"])
            if pop < min_city_population:
                continue
            # log-scaled interest: 300k → ~4, 10M → ~9
            weight = max(1.0, 1.6 * math.log10(pop) - 4.8)
            out.append(Landmark(f"c{i}", r["name"], "city", float(r["lat"]), float(r["lon"]), 0.0,
                                round(weight, 2), pop, r["country"]))
    return out


def load_csv(path: str | Path) -> list[Landmark]:
    """User landmarks: CSV with name,lat,lon[,kind,elevation_m,weight]."""
    out = []
    with open(path, encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f)):
            out.append(Landmark(f"u{i}", r["name"], r.get("kind") or "custom", float(r["lat"]), float(r["lon"]),
                                float(r.get("elevation_m") or 0), float(r.get("weight") or 5)))
    return out


@dataclass
class Sighting:
    landmark: Landmark
    distance_m: float
    azimuth_deg: float
    elevation_deg: float
    h_off_deg: float  # + = towards the nose (look forward), − = look back
    v_off_deg: float
    light: str = "day"  # sunlit | alpenglow | twilight | dark (for the target itself)
    optical_depth: float | None = None


def target_light(t: float, lm: Landmark, k: float = geo.DEFAULT_REFRACTION_K) -> str:
    """Is the target itself in sunlight? A summit sees past the horizon dip at its height."""
    _, sun_el = solar_position(t, lm.lat, lm.lon)
    # 0.83° = refraction at the horizon (0.57°) + the sun's semi-diameter (0.27°)
    margin = sun_el + geo.horizon_dip_deg(lm.elevation_m, k) + 0.83
    if margin > 4:
        return "sunlit"
    if margin > 0:
        return "alpenglow" if lm.is_summit else "sunlit"
    if sun_el > -12:
        return "twilight"
    return "dark"


def visible_from_window(
    landmarks: list[Landmark],
    lat: float,
    lon: float,
    alt_m: float,
    dcm: optics.Mat,
    side: str,
    h_half: float,
    v_low: float,
    v_high: float,
    max_range_m: float,
    terrain: Terrain | None = None,
    k: float = geo.DEFAULT_REFRACTION_K,
    margin_deg: float = 0.0,
    t: float | None = None,
) -> list[Sighting]:
    terrain = terrain or FlatTerrain()
    out: list[Sighting] = []
    hz_obs = geo.horizon_distance(alt_m, k)
    tau_max = atmosphere.max_optical_depth(atmosphere.SNOW_PEAK_CONTRAST)
    # quick reject box (degrees) — 1° lat ≈ 111 km; an 8.8 km summit adds ~360 km of horizon
    box = (hz_obs + 400_000) / 111_000 + 0.5
    coslat = max(0.05, math.cos(math.radians(lat)))
    for lm in landmarks:
        if abs(lm.lat - lat) > box or abs(((lm.lon - lon + 540) % 360) - 180) * coslat > box:
            continue
        d = geo.haversine(lat, lon, lm.lat, lm.lon)
        if d > hz_obs + geo.horizon_distance(lm.elevation_m, k) or d < 1_000:
            continue
        if not lm.is_summit and d > max_range_m:
            continue
        elev, clear = geo.line_of_sight(alt_m, lm.elevation_m, d, k)
        if not clear:
            continue
        tau = None
        if lm.is_summit:
            tau = atmosphere.optical_depth(alt_m, lm.elevation_m, d, max_range_m, k)
            if tau > tau_max:
                continue
        az = geo.initial_bearing(lat, lon, lm.lat, lm.lon)
        v_body = optics.mat_t_vec(dcm, optics.az_el_to_ned(az, elev))
        h_off, v_off = optics.body_angles(side, v_body)
        if abs(h_off) > h_half + margin_deg or not (v_low - margin_deg <= v_off <= v_high + margin_deg):
            continue
        if not isinstance(terrain, FlatTerrain):
            hit = cast(lat, lon, alt_m, az, elev, terrain, max_range_m=d + 2_000, k=k)
            if hit.hit_ground and hit.ground_dist_m < d - 3_000:
                continue  # a ridge is in the way
        light = target_light(t, lm, k) if t is not None else "day"
        out.append(Sighting(lm, d, az, elev, h_off, v_off, light, tau))
    return out
