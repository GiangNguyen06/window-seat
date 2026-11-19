"""Solar position (NOAA / Meeus low-precision algorithm, accurate to ~0.01°)."""

from __future__ import annotations

import math


def solar_position(unix_t: float, lat: float, lon: float) -> tuple[float, float]:
    """Return (azimuth_deg, elevation_deg) of the sun's centre, ignoring refraction."""
    jd = unix_t / 86400.0 + 2440587.5
    jc = (jd - 2451545.0) / 36525.0

    l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360.0  # mean longitude
    m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)  # mean anomaly
    e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)  # orbit eccentricity
    mr = math.radians(m)
    c = (
        math.sin(mr) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
        + math.sin(2 * mr) * (0.019993 - 0.000101 * jc)
        + math.sin(3 * mr) * 0.000289
    )
    true_long = l0 + c
    omega = 125.04 - 1934.136 * jc
    app_long = true_long - 0.00569 - 0.00478 * math.sin(math.radians(omega))
    eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60
    eps = eps0 + 0.00256 * math.cos(math.radians(omega))
    decl = math.asin(math.sin(math.radians(eps)) * math.sin(math.radians(app_long)))

    y = math.tan(math.radians(eps / 2)) ** 2
    l0r = math.radians(l0)
    eq_time = 4 * math.degrees(
        y * math.sin(2 * l0r)
        - 2 * e * math.sin(mr)
        + 4 * e * y * math.sin(mr) * math.cos(2 * l0r)
        - 0.5 * y * y * math.sin(4 * l0r)
        - 1.25 * e * e * math.sin(2 * mr)
    )  # minutes

    minutes_utc = (unix_t % 86400.0) / 60.0
    true_solar = (minutes_utc + eq_time + 4 * lon) % 1440.0
    hour_angle = true_solar / 4 - 180.0
    if hour_angle < -180:
        hour_angle += 360.0

    lat_r, ha_r = math.radians(lat), math.radians(hour_angle)
    cos_zen = math.sin(lat_r) * math.sin(decl) + math.cos(lat_r) * math.cos(decl) * math.cos(ha_r)
    zen = math.acos(max(-1.0, min(1.0, cos_zen)))
    elev = 90.0 - math.degrees(zen)

    az_den = math.cos(lat_r) * math.sin(zen)
    if abs(az_den) > 1e-9:
        cos_az = (math.sin(lat_r) * math.cos(zen) - math.sin(decl)) / az_den
        az = 180.0 - math.degrees(math.acos(max(-1.0, min(1.0, cos_az))))
        if hour_angle > 0:
            az = -az
        az = (az + 360.0) % 360.0
    else:
        az = 180.0 if lat > 0 else 0.0
    return az, elev


def light_condition(sun_elevation_deg: float) -> str:
    if sun_elevation_deg > 6:
        return "day"
    if sun_elevation_deg > -0.833:
        return "golden hour"
    if sun_elevation_deg > -6:
        return "civil twilight"
    if sun_elevation_deg > -12:
        return "nautical twilight"
    if sun_elevation_deg > -18:
        return "astronomical twilight"
    return "night"
