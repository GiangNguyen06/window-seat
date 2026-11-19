"""Read the CSV / KML files you can download from a past flight on flightradar24.com.

The KML is the richer of the two: besides the track it carries the flight
number, airline, route, scheduled/actual times, aircraft type and registration.
From a CSV we derive what we can (see sources/enrich.py).

On the flight's playback / history page there are "CSV" and "KML" buttons for
subscribers. The CSV looks like::

    Timestamp,UTC,Callsign,Position,Altitude,Speed,Direction
    1718438400,2024-06-15T08:00:00Z,KLM1605,"52.30,4.76",0,14,240

Altitude is in feet, speed in knots, direction in degrees true.
"""

from __future__ import annotations

import csv
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

from ..geodesy import FT_TO_M, KT_TO_MS
from ..track import Flight, TrackPoint


def _norm(h: str) -> str:
    return re.sub(r"[^a-z]", "", h.lower())


def _parse_time(v: str) -> float:
    v = v.strip()
    if re.fullmatch(r"\d{9,11}(\.\d+)?", v):
        return float(v)
    return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()


def read_fr24_csv(path: str | Path, aircraft_type: str | None = None) -> Flight:
    path = Path(path)
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [_norm(h) for h in next(reader)]
        col = {h: i for i, h in enumerate(header)}

        def get(row, *names):
            for n in names:
                if n in col and col[n] < len(row) and row[col[n]].strip() != "":
                    return row[col[n]]
            return None

        pts, callsign = [], None
        for row in reader:
            if not row:
                continue
            t = get(row, "timestamp")
            t = _parse_time(t) if t else _parse_time(get(row, "utc"))
            pos = get(row, "position")
            if pos:
                lat, lon = (float(x) for x in pos.split(","))
            else:
                lat, lon = float(get(row, "latitude", "lat")), float(get(row, "longitude", "lon"))
            alt = float(get(row, "altitude", "alt") or 0) * FT_TO_M
            spd = get(row, "speed", "groundspeed")
            dirn = get(row, "direction", "track", "heading")
            callsign = callsign or get(row, "callsign")
            pts.append(TrackPoint(t, lat, lon, alt,
                                  float(spd) * KT_TO_MS if spd else None,
                                  float(dirn) if dirn else None))
    if not pts:
        raise ValueError(f"No track points found in {path}")
    return Flight(pts, callsign=callsign, aircraft_type=aircraft_type, source=f"fr24-csv:{path.name}")


def _kml_header(desc_html: str, doc_name: str | None) -> dict:
    """Pull flight details out of the HTML info box Flightradar24 puts at the top of its KML."""
    import html as htmlmod

    info: dict = {"times": {}}
    if doc_name and "/" in doc_name:  # "VN82/HVN82"
        num, cs = (x.strip() for x in doc_name.split("/", 1))
        info["flight_number"], info["callsign"] = num or None, cs or None
    h = htmlmod.unescape(desc_html)
    m = re.search(r"/\s*([A-Z0-9]{3,8})\s*<br\s*/?>\s*([^<]+?)\s*</div>", h)
    if m:
        info["callsign"] = info.get("callsign") or m.group(1)
        info["airline"] = m.group(2).strip()
    airports = re.findall(r'title="([^"]*)"\s+href="[^"]*/airport/([a-z0-9]{3})/(departures|arrivals)"[^>]*>'
                          r"\s*<h3[^>]*>\s*([A-Z0-9]{3})\s*</h3>\s*([^<]*)</a>", h, re.IGNORECASE)
    for title, _, kind, code, city in airports:
        key = "origin" if kind.lower() == "departures" else "destination"
        info[key], info[f"{key}_name"] = code.upper(), (city.strip() or title.replace(" Airport", "").strip())
    for label, stamp in re.findall(r">\s*(STD|ATD|STA|ETA|ATA)\s*</span>\s*<span title=\"(\d{4}-\d\d-\d\d \d\d:\d\d)\"", h):
        info["times"][label] = stamp.replace(" ", "T") + ":00Z"
    m = re.search(r"Aircraft\s*<span[^>]*>\s*\(([A-Z0-9]{2,4})\)\s*</span>\s*<br\s*/?>\s*<span[^>]*>\s*([^<]+)</span>", h)
    if m:
        info["aircraft_type"], info["aircraft_model"] = m.group(1), m.group(2).strip()
    m = re.search(r"Registration\s*<br\s*/?>\s*<span[^>]*>\s*(?:<a[^>]*>)?\s*([A-Z0-9-]{3,10})\s*<", h)
    if m:
        info["registration"] = m.group(1)
    return info


def read_kml(path: str | Path, aircraft_type: str | None = None) -> Flight:
    """Flightradar24 KML: per-point Placemarks (time, position, altitude in metres, heading, speed)
    plus a header with flight number, airline, route, times, aircraft type and registration.
    Generic KML with a <gx:Track> also works."""
    path = Path(path)
    root = ET.parse(path).getroot()

    def local(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    def child(el, name):
        return next((e for e in el if local(e.tag) == name), None)

    pts: list[TrackPoint] = []
    # 1) gx:Track — parallel <when> and <gx:coord> lists
    for trk in root.iter():
        if local(trk.tag) != "Track":
            continue
        whens = [e.text for e in trk if local(e.tag) == "when"]
        coords = [e.text for e in trk if local(e.tag) == "coord"]
        for w, c in zip(whens, coords):
            lon, lat, *alt = (float(x) for x in c.split())
            pts.append(TrackPoint(_parse_time(w), lat, lon, alt[0] if alt else 0.0))
    # 2) Placemark with TimeStamp/when + Point/coordinates (the Flightradar24 layout)
    if not pts:
        for pm in root.iter():
            if local(pm.tag) != "Placemark":
                continue
            when = next((e.text for e in pm.iter() if local(e.tag) == "when"), None)
            coord = next((e.text for e in pm.iter() if local(e.tag) == "coordinates"), None)
            if not when or not coord or len(coord.split()) != 1:
                continue
            lon, lat, *alt = (float(x) for x in coord.strip().split(","))
            heading = next((e.text for e in pm.iter() if local(e.tag) == "heading"), None)
            desc = next((e.text or "" for e in pm.iter() if local(e.tag) == "description"), "")
            spd = re.search(r"Speed:\D*?([\d,]+)\s*kt", re.sub(r"<[^>]+>", " ", desc))
            pts.append(TrackPoint(
                _parse_time(when), lat, lon, alt[0] if alt else 0.0,
                float(spd.group(1).replace(",", "")) * KT_TO_MS if spd else None,
                float(heading) if heading not in (None, "") else None,
            ))
    if not pts:
        raise ValueError(f"No timestamped points found in {path}. Try the CSV export instead.")

    info: dict = {}
    doc = next((e for e in root.iter() if local(e.tag) == "Document"), None)
    if doc is not None:
        name_el, desc_el = child(doc, "name"), child(doc, "description")
        if desc_el is not None and desc_el.text:
            info = _kml_header(desc_el.text, name_el.text if name_el is not None else None)
    times = info.pop("times", {})
    return Flight(pts, aircraft_type=aircraft_type or info.pop("aircraft_type", None),
                  source=f"fr24-kml:{path.name}", times=times,
                  **{k: v for k, v in info.items() if k != "aircraft_type"})


def read_file(path: str | Path, aircraft_type: str | None = None) -> Flight:
    """Read a Flightradar24 CSV or KML download and fill in whatever details can be derived."""
    from .enrich import enrich

    p = Path(path)
    flight = read_kml(p, aircraft_type) if p.suffix.lower() == ".kml" else read_fr24_csv(p, aircraft_type)
    return enrich(flight, p)
