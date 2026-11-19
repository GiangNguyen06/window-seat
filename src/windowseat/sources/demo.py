"""A synthetic but realistic Amsterdam → Rome flight across the Alps, so the project runs offline."""

from __future__ import annotations

import itertools
from datetime import datetime, timezone

from .. import geodesy as geo
from ..track import Flight, TrackPoint

# Waypoints roughly following a typical AMS–FCO routing
ROUTE = [
    ("AMS", 52.3105, 4.7683),
    ("RW24", 52.22, 4.55),      # runway 24 departure, then a left turn south
    ("NIK", 51.17, 4.19),
    ("LUX", 49.62, 6.20),
    ("BSL", 47.59, 7.53),
    ("SIO", 46.22, 7.33),       # over the Valais: Matterhorn & Mont Blanc to the right
    ("MXP", 45.63, 8.72),
    ("ELB", 42.78, 10.40),
    ("TAQ", 42.20, 11.73),
    ("FCO", 41.8003, 12.2389),
]


def _profile(frac_dist: float, total_m: float) -> tuple[float, float]:
    """Altitude (m) and ground speed (m/s) as a function of distance flown."""
    d = frac_dist * total_m
    remain = total_m - d
    cruise_alt, cruise_gs = 11_280.0, 230.0  # FL370, ~450 kt
    climb_dist, desc_dist = 190_000.0, 210_000.0
    if d < climb_dist:
        f = d / climb_dist
        alt = cruise_alt * (1 - (1 - f) ** 1.7)
        gs = 80 + (cruise_gs - 80) * min(1.0, f * 1.4)
    elif remain < desc_dist:
        f = remain / desc_dist
        alt = cruise_alt * f ** 1.15
        gs = 75 + (cruise_gs - 75) * min(1.0, f * 1.3)
    else:
        alt, gs = cruise_alt, cruise_gs
    return alt, gs


def demo_flight(departure: datetime | None = None, step_s: float = 10.0) -> Flight:
    dep = departure or datetime(2026, 6, 15, 7, 30, tzinfo=timezone.utc)
    legs = []
    for (_, la1, lo1), (_, la2, lo2) in itertools.pairwise(ROUTE):
        legs.append((la1, lo1, la2, lo2, geo.haversine(la1, lo1, la2, lo2)))
    total = sum(leg[4] for leg in legs)

    pts: list[TrackPoint] = []
    t, flown = dep.timestamp(), 0.0
    while flown < total:
        acc, leg = 0.0, legs[-1]
        for lg in legs:
            if acc + lg[4] >= flown:
                leg = lg
                break
            acc += lg[4]
        la1, lo1, la2, lo2, ln = leg
        f = (flown - acc) / ln if ln else 0
        lat, lon = geo.interpolate_great_circle(la1, lo1, la2, lo2, f)
        alt, gs = _profile(flown / total, total)
        pts.append(TrackPoint(t, lat, lon, alt + 0.0, gs, None))
        flown += gs * step_s
        t += step_s
    # Smooth the corners: real aircraft fly fly-by turns, not instant heading changes
    pts = _round_corners(pts, window=9)
    return Flight(pts, callsign="KLM1605", origin="AMS", destination="FCO", aircraft_type="B738", source="demo",
                  flight_number="KL1605", airline="KLM Royal Dutch Airlines (demo)",
                  origin_name="Amsterdam", destination_name="Rome")


def _round_corners(pts: list[TrackPoint], window: int) -> list[TrackPoint]:
    half = window // 2
    out = []
    for i, p in enumerate(pts):
        lo, hi = max(0, i - half), min(len(pts), i + half + 1)
        if i < half or i >= len(pts) - half:
            out.append(p)
            continue
        lat = sum(q.lat for q in pts[lo:hi]) / (hi - lo)
        lon = sum(q.lon for q in pts[lo:hi]) / (hi - lo)
        out.append(TrackPoint(p.t, lat, lon, p.alt_m, p.gs_ms, None))
    return out

