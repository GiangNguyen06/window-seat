"""Cast a sight line from the aircraft to the ground, over a curved, refracting earth.

We work on the *effective earth* of radius R' = R / (1 − k): on it, refracted
light rays become straight lines. In the vertical plane containing the ray, with
the earth's centre at the origin and the observer at height h:

    observer  P0 = (0, R' + h)
    direction d  = (cos ε, sin ε)            ε = elevation angle of the ray
    point     P(s) = P0 + s·d

    height above ground   a(s) = |P(s)| − R'
    ground (arc) distance g(s) = R' · atan2(s cos ε, R' + h + s sin ε)

Over flat (sea-level) terrain the hit is the closed-form ray–sphere
intersection. With a DEM we march along s until a(s) ≤ terrain(g(s)).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from . import geodesy as geo
from .terrain import FlatTerrain, Terrain


@dataclass
class RayHit:
    azimuth_deg: float
    elevation_deg: float
    hit_ground: bool  # False → ray goes to the sky; point is the horizon/visibility limit
    ground_dist_m: float
    lat: float
    lon: float
    terrain_m: float = 0.0


def cast(
    lat: float,
    lon: float,
    alt_m: float,
    azimuth_deg: float,
    elevation_deg: float,
    terrain: Terrain | None = None,
    max_range_m: float = 150_000.0,
    k: float = geo.DEFAULT_REFRACTION_K,
) -> RayHit:
    terrain = terrain or FlatTerrain()
    r = geo.effective_radius(k)
    r1 = r + alt_m
    el = math.radians(elevation_deg)
    se, ce = math.sin(el), math.cos(el)

    def ground_arc(s: float) -> float:
        return r * math.atan2(s * ce, r1 + s * se)

    def height(s: float) -> float:
        return math.sqrt(r1 * r1 + s * s + 2 * r1 * s * se) - r

    horizon = geo.horizon_distance(alt_m, k)
    limit = min(max_range_m, horizon) if alt_m > 0 else max_range_m

    def result(hit: bool, g: float, h_t: float = 0.0) -> RayHit:
        g = min(g, limit)
        la, lo = geo.destination(lat, lon, azimuth_deg, g)
        return RayHit(azimuth_deg, elevation_deg, hit, g, la, lo, h_t)

    if isinstance(terrain, FlatTerrain):
        base = r + terrain.max_elevation_m
        disc = (r1 * se) ** 2 - (r1 * r1 - base * base)
        if se < 0 and disc >= 0:
            s = -r1 * se - math.sqrt(disc)
            g = ground_arc(s)
            return result(g <= limit, g, terrain.max_elevation_m)
        return result(False, limit)

    # ---- DEM ray-march --------------------------------------------------
    s, prev_s = 0.0, 0.0
    step0 = 250.0
    while True:
        g = ground_arc(s)
        if g > limit:
            return result(False, limit)
        a = height(s)
        if a > terrain.max_elevation_m and se >= 0:
            return result(False, limit)  # climbing above all terrain → sky
        la, lo = geo.destination(lat, lon, azimuth_deg, g)
        t = terrain.elevation(la, lo)
        if a <= t:
            # refine with bisection between prev_s and s
            lo_s, hi_s = prev_s, s
            for _ in range(12):
                mid = 0.5 * (lo_s + hi_s)
                gm = ground_arc(mid)
                lam, lom = geo.destination(lat, lon, azimuth_deg, gm)
                if height(mid) <= terrain.elevation(lam, lom):
                    hi_s = mid
                else:
                    lo_s = mid
            g = ground_arc(hi_s)
            la, lo = geo.destination(lat, lon, azimuth_deg, g)
            return result(True, g, terrain.elevation(la, lo))
        prev_s = s
        # step grows with distance (resolution of the DEM matters less far away),
        # but never larger than the clearance above terrain allows
        s += max(step0, min(0.02 * s + step0, (a - t) * 0.5 + step0))
