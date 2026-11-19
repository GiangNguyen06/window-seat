import math
from datetime import datetime, timezone

import pytest

from windowseat import geodesy as geo
from windowseat import optics
from windowseat.aircraft import parse_seat, profile_for
from windowseat.analysis import analyze
from windowseat.raycast import cast
from windowseat.sources.demo import demo_flight
from windowseat.sun import solar_position
from windowseat.track import Flight, TrackPoint


def test_horizon_matches_sqrt_2rh():
    h = 10_000
    assert geo.horizon_distance(h, k=0) == pytest.approx(math.sqrt(2 * geo.EARTH_RADIUS_M * h), rel=1e-3)
    # refraction pushes the horizon further away (~ 1/sqrt(1-k))
    assert geo.horizon_distance(h) / geo.horizon_distance(h, k=0) == pytest.approx(1 / math.sqrt(1 - 0.13), rel=1e-3)


def test_great_circle_roundtrip():
    lat, lon = geo.destination(52.0, 4.0, 135.0, 500_000)
    assert geo.haversine(52.0, 4.0, lat, lon) == pytest.approx(500_000, rel=1e-6)
    assert geo.initial_bearing(52.0, 4.0, lat, lon) == pytest.approx(135.0, abs=1e-6)


def test_ecef_enu_up():
    x, y, z = geo.geodetic_to_ecef(45.0, 7.0, 1000.0)
    e, n, u = geo.ecef_to_enu(x, y, z, 45.0, 7.0, 0.0)
    assert (e, n, u) == pytest.approx((0, 0, 1000.0), abs=1e-6)


def test_dcm_right_bank_points_right_window_down():
    level = optics.dcm_body_to_ned(0, 0, 0)
    ray = optics.window_ray_body("right", 0, 0)
    assert optics.ned_to_az_el(optics.mat_vec(level, ray)) == pytest.approx((90.0, 0.0), abs=1e-9)
    banked = optics.dcm_body_to_ned(0, 0, 20)
    _, el = optics.ned_to_az_el(optics.mat_vec(banked, ray))
    assert el == pytest.approx(-20.0, abs=1e-9)
    # ...and the left window towards the sky
    _, el_left = optics.ned_to_az_el(optics.mat_vec(banked, optics.window_ray_body("left", 0, 0)))
    assert el_left == pytest.approx(20.0, abs=1e-9)


def test_body_angles_inverse():
    for side in ("left", "right"):
        v = optics.window_ray_body(side, 12.0, -7.0)
        assert optics.body_angles(side, v) == pytest.approx((12.0, -7.0), abs=1e-9)


def test_straight_down_ray_hits_below():
    hit = cast(46.0, 7.0, 10_000, 0.0, -90.0)
    assert hit.hit_ground and hit.ground_dist_m == pytest.approx(0, abs=1)


def test_ray_at_45deg_hits_about_h_away():
    hit = cast(46.0, 7.0, 10_000, 90.0, -45.0, k=0.0)
    assert hit.hit_ground and hit.ground_dist_m == pytest.approx(10_000, rel=0.01)


def test_horizontal_ray_misses_ground():
    hit = cast(46.0, 7.0, 10_000, 90.0, 0.0, max_range_m=1e7)
    assert not hit.hit_ground
    assert hit.ground_dist_m == pytest.approx(geo.horizon_distance(10_000), rel=1e-6)


def test_line_of_sight_hidden_behind_curve():
    # A sea-level point 500 km away is below the horizon from 10 km altitude (~357-380 km)
    _, visible = geo.line_of_sight(10_000, 0, 500_000)
    assert not visible
    # ...but Mont Blanc's 4.8 km summit pokes above it from the same distance
    _, visible_peak = geo.line_of_sight(10_000, 4_808, 500_000)
    assert visible_peak


def test_sun_position_amsterdam_solstice_noon():
    t = datetime(2024, 6, 21, 11, 40, tzinfo=timezone.utc).timestamp()
    az, el = solar_position(t, 52.37, 4.90)
    assert el == pytest.approx(90 - 52.37 + 23.44, abs=0.5)
    assert az == pytest.approx(180, abs=3)


def test_seat_parsing_and_fov():
    a320 = profile_for("A320")
    w = parse_seat("12A", a320)
    m = parse_seat("12E", a320)
    assert (w.side, w.seats_from_window) == ("left", 0)
    assert (m.side, m.seats_from_window) == ("right", 1)
    assert w.h_half_fov_deg > m.h_half_fov_deg  # window seat sees more
    assert w.over_wing and not parse_seat("30A", a320).over_wing


def test_bank_from_turn():
    # 3°/s standard-rate turn at 120 m/s → tan φ = v ω / g ≈ 0.64 → φ ≈ 32.6° (clipped at 35)
    pts = []
    for i in range(60):
        hdg = i * 3.0
        lat, lon = geo.destination(50, 5, hdg, 0)
        pts.append(TrackPoint(i, lat, lon, 3000, 120.0, hdg % 360, 0.0))
    fl = Flight(pts).estimate_attitude(smooth_window=1)
    mid = fl.points[30]
    assert mid.bank_deg == pytest.approx(math.degrees(math.atan(120 * math.radians(3) / geo.G0)), abs=0.5)


def test_demo_end_to_end():
    res = analyze(demo_flight(), "20F", "B738")
    assert res["samples"]
    names_right = {r["name"] for r in res["summary"]["right"]["landmarks"]}
    assert "Mont Blanc" in names_right
    assert res["summary"]["recommended_side"] in ("left", "right")


class GaussianMountain:
    """Synthetic DEM: a 4 km mountain 50 km east of (46, 7)."""

    max_elevation_m = 4_000.0

    def __init__(self):
        self.lat, self.lon = geo.destination(46.0, 7.0, 90.0, 50_000)

    def elevation(self, lat, lon):
        d = geo.haversine(lat, lon, self.lat, self.lon)
        return 4_000.0 * math.exp(-((d / 5_000) ** 2))


def test_dem_raymarch_hits_mountain():
    t = GaussianMountain()
    # Over flat ground a -3° ray from 6 km would land ~140 km out; the mountain stops it at ~45-50 km
    hit = cast(46.0, 7.0, 6_000, 90.0, -3.0, terrain=t)
    assert hit.hit_ground
    assert 40_000 < hit.ground_dist_m < 52_000
    assert hit.terrain_m > 1_000


def test_haze_layer_lets_high_peaks_be_seen_far():
    from windowseat import atmosphere

    tau_max = atmosphere.max_optical_depth(atmosphere.SNOW_PEAK_CONTRAST)
    # an 8.8 km summit 400 km away from 12.5 km altitude: thin, clean air → visible
    assert atmosphere.optical_depth(12_500, 8_849, 400_000, 150_000) < tau_max
    # the same distance to a sea-level point drags the sight line through the haze → not visible
    assert atmosphere.optical_depth(12_500, 0, 400_000, 150_000) > tau_max


def test_summit_sees_sun_before_valley():
    from windowseat.landmarks import Landmark, target_light

    # Everest, 4 Nov 2026 00:15 UTC (06:00 Nepal): sun ~3° below the sea-level horizon
    t = datetime(2026, 11, 4, 0, 15, tzinfo=timezone.utc).timestamp()
    summit = Landmark("e", "Everest", "peak", 27.9881, 86.9250, 8849)
    valley = Landmark("v", "Valley", "town", 27.9881, 86.9250, 0)
    assert target_light(t, summit) == "alpenglow"
    assert target_light(t, valley) == "twilight"


def test_vn82_style_everest_geometry():
    # From 41,000 ft, Everest 394 km away pokes ~1.3° above the horizon
    el, visible = geo.line_of_sight(12_497, 8_849, 394_000)
    assert visible
    assert el + geo.horizon_dip_deg(12_497) == pytest.approx(1.28, abs=0.05)
