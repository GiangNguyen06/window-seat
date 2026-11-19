"""End-to-end pipeline: flight track + seat → what you see out of the window."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from . import __version__, optics
from . import geodesy as geo
from .aircraft import AircraftProfile, Seat, parse_seat, profile_for
from .landmarks import Landmark, load_builtin, visible_from_window
from .raycast import cast
from .sun import light_condition, solar_position
from .terrain import FlatTerrain, Terrain
from .track import Flight

SIDES = ("left", "right")


@dataclass
class Options:
    step_s: float = 30.0
    visibility_km: float = 150.0
    refraction_k: float = geo.DEFAULT_REFRACTION_K
    rays_per_edge: int = 6
    min_city_population: int = 300_000
    aoa_deg: float = 2.5
    eye_distance_m: float | None = None
    extra_landmarks: list[Landmark] = field(default_factory=list)


def mirror_seat(seat: Seat) -> Seat:
    """Equivalent seat on the other side of the same row."""
    groups = seat.profile.groups
    if seat.side == "left":
        block = groups[-1]
        idx = max(0, len(block) - 1 - min(seat.seats_from_window, len(block) - 1))
    else:
        block = groups[0]
        idx = min(seat.seats_from_window, len(block) - 1)
    return parse_seat(f"{seat.row}{block[idx]}", seat.profile, seat.eye_distance_m)


def window_v_range(seat: Seat) -> tuple[float, float]:
    """Vertical aperture (low, high) in degrees, clipped by the wing for over-wing rows."""
    low = -seat.v_half_fov_deg
    if seat.over_wing:
        low = max(low, -seat.profile.wing_mask_deg)
    return low, seat.v_half_fov_deg


def analyze(
    flight: Flight,
    seat_spec: str | None = None,
    aircraft_type: str | None = None,
    terrain: Terrain | None = None,
    options: Options | None = None,
    progress=None,
) -> dict:
    opts = options or Options()
    terrain = terrain or FlatTerrain()
    simple = not seat_spec or seat_spec.strip().lower() in ("left", "right", "l", "r", "")
    seat_spec = seat_spec or "left"
    profile: AircraftProfile = profile_for(aircraft_type or flight.aircraft_type)
    seat = parse_seat(seat_spec, profile, opts.eye_distance_m)
    seats = {seat.side: seat, ("right" if seat.side == "left" else "left"): mirror_seat(seat)}

    fl = flight.airborne().resample(opts.step_s).estimate_attitude(aoa_deg=opts.aoa_deg)
    landmarks = load_builtin(opts.min_city_population) + list(opts.extra_landmarks)
    max_range = opts.visibility_km * 1000.0
    k = opts.refraction_k

    samples = []
    seen: dict[str, dict] = {}
    totals = {s: {"daylight_s": 0.0, "sun_in_window_s": 0.0, "sun_side_s": 0.0} for s in SIDES}

    for i, p in enumerate(fl.points):
        if progress:
            progress(i, len(fl.points))
        dcm = optics.dcm_body_to_ned(p.heading_deg or 0.0, p.pitch_deg, p.bank_deg)
        sun_az, sun_el = solar_position(p.t, p.lat, p.lon)
        # The sun's elevation seen from altitude: the horizon dips, so sunset is later up high
        dip = geo.horizon_dip_deg(p.alt_m, k)
        sun_body = optics.mat_t_vec(dcm, optics.az_el_to_ned(sun_az, sun_el))
        ground_light = light_condition(sun_el)
        sample = {
            "t": round(p.t, 1),
            "lat": round(p.lat, 5),
            "lon": round(p.lon, 5),
            "alt_m": round(p.alt_m, 1),
            "gs_ms": round(p.gs_ms or 0, 1),
            "heading": round(p.heading_deg or 0, 2),
            "pitch": round(p.pitch_deg, 2),
            "bank": round(p.bank_deg, 2),
            "sun": {"az": round(sun_az, 2), "el": round(sun_el, 2), "visible": sun_el > -dip, "light": ground_light},
            "horizon_km": round(geo.horizon_distance(p.alt_m, k) / 1000, 1),
            "sides": {},
        }
        for side in SIDES:
            st = seats[side]
            v_lo, v_hi = window_v_range(st)
            boundary = optics.window_boundary(st.h_half_fov_deg, v_hi, opts.rays_per_edge)
            boundary = [(h, max(v, v_lo) if v < 0 else v) for h, v in boundary]
            ring = []
            ground_hits = 0
            for h_off, v_off in boundary:
                ned = optics.mat_vec(dcm, optics.window_ray_body(side, h_off, v_off))
                az, el = optics.ned_to_az_el(ned)
                hit = cast(p.lat, p.lon, p.alt_m, az, el, terrain, max_range, k)
                ground_hits += hit.hit_ground
                ring.append([round(hit.lon, 5), round(hit.lat, 5)])
            centre = optics.mat_vec(dcm, optics.window_ray_body(side, 0.0, 0.0))
            c_az, c_el = optics.ned_to_az_el(centre)
            c_hit = cast(p.lat, p.lon, p.alt_m, c_az, c_el, terrain, max_range, k)
            h_sun, v_sun = optics.body_angles(side, sun_body)
            sun_lateral = sun_body[1] if side == "right" else -sun_body[1]
            sun_in_window = (
                sample["sun"]["visible"]
                and abs(h_sun) <= st.h_half_fov_deg + 5
                and v_lo - 5 <= v_sun <= v_hi + 5
            )
            sights = visible_from_window(
                landmarks, p.lat, p.lon, p.alt_m, dcm, side, st.h_half_fov_deg, v_lo, v_hi, max_range, terrain, k,
                t=p.t,
            )
            ids = []
            for s in sorted(sights, key=lambda s: -s.landmark.weight):
                lm = s.landmark
                ids.append(lm.id)
                rec = seen.setdefault(f"{side}:{lm.id}", {
                    "id": lm.id, "side": side, "first_t": p.t, "last_t": p.t,
                    "min_dist_km": s.distance_m / 1000, "closest_t": p.t, "samples": 0,
                    "light": {}, "first_lit_t": None,
                })
                rec["last_t"] = p.t
                if s.distance_m / 1000 < rec["min_dist_km"]:
                    rec["min_dist_km"], rec["closest_t"] = s.distance_m / 1000, p.t
                rec["samples"] += 1
                rec["light"][s.light] = rec["light"].get(s.light, 0) + 1
                if s.light in ("sunlit", "alpenglow") and rec["first_lit_t"] is None:
                    rec["first_lit_t"] = p.t
            if sample["sun"]["visible"] and sun_el > -6:
                totals[side]["daylight_s"] += opts.step_s
            if sun_in_window:
                totals[side]["sun_in_window_s"] += opts.step_s
            if sun_lateral > 0 and sample["sun"]["visible"]:
                totals[side]["sun_side_s"] += opts.step_s
            sample["sides"][side] = {
                "footprint": ring,
                "ground_fraction": round(ground_hits / max(1, len(ring)), 2),
                "look_az": round(c_az, 2),
                "look_el": round(c_el, 2),
                "look_point": [round(c_hit.lon, 5), round(c_hit.lat, 5)],
                "sun_in_window": bool(sun_in_window),
                "sun_on_this_side": bool(sun_lateral > 0 and sample["sun"]["visible"]),
                "landmarks": ids,
                "sightings": {s.landmark.id: [round(s.distance_m / 1000, 1), round(s.azimuth_deg, 1),
                                              round(s.elevation_deg, 2), round(s.h_off_deg, 1),
                                              round(s.v_off_deg, 1), s.light] for s in sights},
            }
        samples.append(sample)

    lm_by_id = {lm.id: lm for lm in landmarks}
    used_ids = {r["id"] for r in seen.values()}
    lm_out = {
        i: {"name": lm_by_id[i].name, "kind": lm_by_id[i].kind, "lat": lm_by_id[i].lat, "lon": lm_by_id[i].lon,
            "elevation_m": lm_by_id[i].elevation_m, "weight": lm_by_id[i].weight, "region": lm_by_id[i].region,
            "population": lm_by_id[i].population, "country": lm_by_id[i].country}
        for i in sorted(used_ids)
    }

    summary = {}
    for side in SIDES:
        recs = [r for r in seen.values() if r["side"] == side]
        for r in recs:
            r["duration_s"] = r["samples"] * opts.step_s
            r["name"] = lm_by_id[r["id"]].name
            r["kind"] = lm_by_id[r["id"]].kind
            r["min_dist_km"] = round(r["min_dist_km"], 1)
            # Sightings in the dark count less (cities still shine at night, peaks don't)
            lm = lm_by_id[r["id"]]
            lit = r["light"].get("sunlit", 0) + r["light"].get("alpenglow", 0) + r["light"].get("day", 0)
            dim = r["samples"] - lit
            dark_factor = 0.5 if lm.kind == "city" else 0.15
            r["score"] = round(lm.weight * math.sqrt(lit + dark_factor * dim), 2)
        recs.sort(key=lambda r: -r["score"])
        summary[side] = {
            "seat": seats[side].label,
            "seats_from_window": seats[side].seats_from_window,
            "fov_deg": [round(2 * seats[side].h_half_fov_deg, 1), round(2 * seats[side].v_half_fov_deg, 1)],
            "v_range_deg": [round(v, 1) for v in window_v_range(seats[side])],
            "window_m": [seats[side].profile.window_w_m, seats[side].profile.window_h_m],
            "eye_distance_m": round(seats[side].eye_distance_m, 2),
            "over_wing": seats[side].over_wing,
            "landmarks": recs,
            "scenery_score": round(sum(r["score"] for r in recs), 1),
            **{key: round(v / 60, 1) for key, v in
               (("daylight_min", totals[side]["daylight_s"]),
                ("sun_in_window_min", totals[side]["sun_in_window_s"]),
                ("sun_on_side_min", totals[side]["sun_side_s"]))},
        }
    l, r = summary["left"], summary["right"]
    best = "left" if (l["scenery_score"] - 0.3 * l["sun_in_window_min"]) > (r["scenery_score"] - 0.3 * r["sun_in_window_min"]) else "right"

    return {
        "schema": "windowseat/1",
        "generator": f"window-seat {__version__}",
        "flight": {
            **flight.info(),
            "callsign": flight.callsign, "origin": flight.origin, "destination": flight.destination,
            "aircraft_type": aircraft_type or flight.aircraft_type, "aircraft_profile": profile.name,
            "source": flight.source, "start_t": fl.points[0].t if fl.points else None,
            "end_t": fl.points[-1].t if fl.points else None,
        },
        "seat": {"requested": seat_spec, "label": seat.label, "side": seat.side, "simple": simple},
        "options": {"step_s": opts.step_s, "visibility_km": opts.visibility_km, "refraction_k": k,
                    "terrain": type(terrain).__name__},
        "track": [[round(p.lon, 5), round(p.lat, 5), round(p.alt_m)] for p in flight.points],
        "samples": samples,
        "landmarks": lm_out,
        "summary": {**summary, "recommended_side": best},
    }
