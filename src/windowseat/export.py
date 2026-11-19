"""Exporters: GeoJSON for GIS tools, and a human-readable text report."""

from __future__ import annotations

import json
from datetime import datetime, timezone


def to_geojson(result: dict, every_n: int = 1) -> dict:
    feats = [{
        "type": "Feature",
        "properties": {"kind": "track", **{k: v for k, v in result["flight"].items() if v is not None}},
        "geometry": {"type": "LineString", "coordinates": result["track"]},
    }]
    for i, s in enumerate(result["samples"]):
        if i % every_n:
            continue
        for side, v in s["sides"].items():
            ring = v["footprint"] + [v["footprint"][0]]
            feats.append({
                "type": "Feature",
                "properties": {"kind": "footprint", "side": side, "t": s["t"],
                               "time": _iso(s["t"]), "landmarks": len(v["landmarks"])},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            })
    for side in ("left", "right"):
        for r in result["summary"][side]["landmarks"]:
            lm = result["landmarks"][r["id"]]
            feats.append({
                "type": "Feature",
                "properties": {"kind": "landmark", "side": side, "name": lm["name"], "type": lm["kind"],
                               "first_seen": _iso(r["first_t"]), "min_dist_km": r["min_dist_km"]},
                "geometry": {"type": "Point", "coordinates": [lm["lon"], lm["lat"]]},
            })
    return {"type": "FeatureCollection", "features": feats}


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _hm(t: float) -> str:
    return datetime.fromtimestamp(t, tz=timezone.utc).strftime("%H:%M")


def text_report(result: dict, top: int = 12) -> str:
    f, sm = result["flight"], result["summary"]
    simple = result["seat"].get("simple", False)
    title = " ".join(x for x in (f.get("flight_number") or f.get("callsign") or "Flight", f.get("airline")) if x)
    route = ""
    if f.get("origin") or f.get("destination"):
        route = (f"{f.get('origin') or '?'} {f.get('origin_name') or ''} → "
                 f"{f.get('destination') or '?'} {f.get('destination_name') or ''}").replace("  ", " ")
    plane = f.get("aircraft_model") or (f["aircraft_profile"] if f.get("aircraft_type") else "aircraft type unknown")
    if f.get("registration"):
        plane += f" ({f['registration']})"
    lines = [
        f"✈  {title}   {route}",
        f"   {plane} · data: {f['source']}",
        (f"   {_iso(f['start_t'])} → {_iso(f['end_t'])}   step {result['options']['step_s']:.0f}s,"
        f" visibility {result['options']['visibility_km']:.0f} km, terrain: {result['options']['terrain']}"),
        "",
    ]
    for side in ("left", "right"):
        s = sm[side]
        if simple:
            lines.append(f"── {side.upper()} window")
        else:
            mine = " ← your seat" if result["seat"]["side"] == side else ""
            lines.append(f"── {side.upper()} side, seat {s['seat']}{mine}")
        lines.append(f"   window FOV ≈ {s['fov_deg'][0]}° × {s['fov_deg'][1]}°"
                     f"{'  (over the wing: lower view partly blocked)' if s['over_wing'] else ''}")
        lines.append(f"   daylight {s['daylight_min']} min · sun on this side {s['sun_on_side_min']} min ·"
                     f" sun in window {s['sun_in_window_min']} min")
        if not s["landmarks"]:
            lines.append("   no catalogued landmarks in view")
        for r in s["landmarks"][:top]:
            lines.append(f"   • {r['name']:<24} {r['kind']:<8} {_hm(r['first_t'])}–{_hm(r['last_t'])} UTC,"
                         f" closest {r['min_dist_km']:.0f} km{_light_note(r)}")
        lines.append("")
    best = sm["recommended_side"]
    seat_hint = "" if simple else f" ({sm[best]['seat']})"
    lines.append(f"Recommendation: sit on the {best.upper()}{seat_hint} for the better view.")
    return "\n".join(lines)


def _light_note(r: dict) -> str:
    light = r.get("light") or {}
    if not light or set(light) <= {"day", "sunlit"}:
        return ""
    if r.get("first_lit_t") is None:
        return "  (in darkness/twilight the whole time)" if r["kind"] != "city" else "  (at night: city lights)"
    if r["first_lit_t"] > r["first_t"]:
        return f"  (dark at first, sunlit from {_hm(r['first_lit_t'])})"
    return ""


def dump(obj: dict, path: str) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, separators=(",", ":"), ensure_ascii=False)
