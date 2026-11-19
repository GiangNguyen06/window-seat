"""Geodesy helpers: WGS-84, spherical earth with refraction, great-circle maths.

Conventions
-----------
* Angles in degrees at the API boundary, radians internally.
* Altitudes in metres above mean sea level.
* Azimuth/bearing: 0° = true north, clockwise positive.
* Elevation angle: 0° = local horizontal, negative = below the horizon.
"""

from __future__ import annotations

import math

# WGS-84 ellipsoid
WGS84_A = 6_378_137.0
WGS84_F = 1 / 298.257223563
WGS84_E2 = WGS84_F * (2 - WGS84_F)

# Mean earth radius (IUGG) used for the spherical model
EARTH_RADIUS_M = 6_371_008.8

# Standard atmospheric refraction coefficient (light bends towards the earth).
# Geodesists use k ≈ 0.13; it is equivalent to a larger, "effective" earth.
DEFAULT_REFRACTION_K = 0.13

G0 = 9.80665  # standard gravity, m/s²

FT_TO_M = 0.3048
KT_TO_MS = 0.514444


def effective_radius(k: float = DEFAULT_REFRACTION_K, radius: float = EARTH_RADIUS_M) -> float:
    """Radius of the 'effective earth' on which light rays travel in straight lines.

    A ray with curvature k/R over a sphere of radius R behaves like a straight
    ray over a sphere of radius R / (1 - k).
    """
    return radius / (1.0 - k)


def horizon_distance(h_m: float, k: float = DEFAULT_REFRACTION_K) -> float:
    """Distance along the ground to the visible horizon from height h (m).

    Geometric: d = R·acos(R / (R + h)) ≈ √(2Rh). Refraction enlarges R.
    """
    if h_m <= 0:
        return 0.0
    r = effective_radius(k)
    return r * math.acos(r / (r + h_m))


def horizon_dip_deg(h_m: float, k: float = DEFAULT_REFRACTION_K) -> float:
    """Angle (degrees, positive) by which the horizon lies below the horizontal."""
    if h_m <= 0:
        return 0.0
    r = effective_radius(k)
    return math.degrees(math.acos(r / (r + h_m)))


def geodetic_to_ecef(lat: float, lon: float, h: float = 0.0) -> tuple[float, float, float]:
    """WGS-84 geodetic (deg, deg, m) → ECEF (m)."""
    phi, lam = math.radians(lat), math.radians(lon)
    s = math.sin(phi)
    n = WGS84_A / math.sqrt(1 - WGS84_E2 * s * s)
    x = (n + h) * math.cos(phi) * math.cos(lam)
    y = (n + h) * math.cos(phi) * math.sin(lam)
    z = (n * (1 - WGS84_E2) + h) * s
    return x, y, z


def ecef_to_enu(
    x: float, y: float, z: float, lat0: float, lon0: float, h0: float = 0.0
) -> tuple[float, float, float]:
    """ECEF point → local East-North-Up relative to a reference geodetic point."""
    x0, y0, z0 = geodetic_to_ecef(lat0, lon0, h0)
    dx, dy, dz = x - x0, y - y0, z - z0
    phi, lam = math.radians(lat0), math.radians(lon0)
    sp, cp, sl, cl = math.sin(phi), math.cos(phi), math.sin(lam), math.cos(lam)
    e = -sl * dx + cl * dy
    n = -sp * cl * dx - sp * sl * dy + cp * dz
    u = cp * cl * dx + cp * sl * dy + sp * dz
    return e, n, u


def haversine(lat1: float, lon1: float, lat2: float, lon2: float, radius: float = EARTH_RADIUS_M) -> float:
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def initial_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from point 1 to point 2, degrees [0, 360)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def destination(lat: float, lon: float, bearing_deg: float, dist_m: float, radius: float = EARTH_RADIUS_M) -> tuple[float, float]:
    """Point reached travelling dist_m along a great circle at an initial bearing."""
    d = dist_m / radius
    b = math.radians(bearing_deg)
    p1, l1 = math.radians(lat), math.radians(lon)
    sp2 = math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b)
    p2 = math.asin(max(-1.0, min(1.0, sp2)))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * sp2)
    return math.degrees(p2), (math.degrees(l2) + 540.0) % 360.0 - 180.0


def interpolate_great_circle(lat1: float, lon1: float, lat2: float, lon2: float, f: float) -> tuple[float, float]:
    """Point at fraction f (0..1) along the great circle between two points."""
    p1, l1, p2, l2 = map(math.radians, (lat1, lon1, lat2, lon2))
    d = haversine(lat1, lon1, lat2, lon2, 1.0)
    if d < 1e-12:
        return lat1, lon1
    a = math.sin((1 - f) * d) / math.sin(d)
    b = math.sin(f * d) / math.sin(d)
    x = a * math.cos(p1) * math.cos(l1) + b * math.cos(p2) * math.cos(l2)
    y = a * math.cos(p1) * math.sin(l1) + b * math.cos(p2) * math.sin(l2)
    z = a * math.sin(p1) + b * math.sin(p2)
    return math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))


def line_of_sight(
    h_observer: float,
    h_target: float,
    ground_dist_m: float,
    k: float = DEFAULT_REFRACTION_K,
) -> tuple[float, bool]:
    """Apparent elevation angle of a target and whether the earth's bulge blocks it.

    Works in the plane containing the earth's centre, observer and target on the
    effective (refraction-corrected) sphere.

    Returns (elevation_deg, visible_over_curvature).
    """
    r = effective_radius(k)
    # The effective-earth transform preserves arc length and heights, so the
    # central angle on the effective sphere is ground distance / R_eff.
    gamma = ground_dist_m / r
    r1, r2 = r + h_observer, r + h_target
    # Target position relative to observer in the local (horizontal, up) frame
    dx = r2 * math.sin(gamma)
    dz = r2 * math.cos(gamma) - r1
    elev = math.degrees(math.atan2(dz, dx))
    # Minimum distance of the chord observer→target from the earth's centre
    chord = math.hypot(dx, dz)
    if chord < 1e-6:
        return elev, True
    # Projection parameter of the foot of the perpendicular from the centre
    # Observer at (0, r1), target at (dx, r1 + dz) in a centre-origin frame
    t = -(0 * dx + r1 * dz) / (chord * chord)
    if t <= 0 or t >= 1:
        return elev, True
    px, pz = t * dx, r1 + t * dz
    return elev, math.hypot(px, pz) >= r
