"""Airport and airline lookups, used to fill in flight details automatically.

* Airports: ~8 000 airports with an IATA code, from the `airportsdata` project (MIT).
* Airlines: a curated table of ~130 airlines (ICAO callsign prefix → IATA code, name).
"""

from __future__ import annotations

import csv
import math
import re
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources

from . import geodesy as geo


@dataclass(frozen=True)
class Airport:
    iata: str
    icao: str
    name: str
    city: str
    country: str
    lat: float
    lon: float


@dataclass(frozen=True)
class Airline:
    icao: str
    iata: str
    name: str


def _open(name: str):
    return resources.files("windowseat").joinpath("data", name).open(encoding="utf-8")


@lru_cache(maxsize=1)
def airports() -> dict[str, Airport]:
    with _open("airports.csv") as f:
        return {r["iata"]: Airport(r["iata"], r["icao"], r["name"], r["city"], r["country"],
                                   float(r["lat"]), float(r["lon"])) for r in csv.DictReader(f)}


@lru_cache(maxsize=1)
def airlines() -> dict[str, Airline]:
    with _open("airlines.csv") as f:
        return {r["icao"]: Airline(r["icao"], r["iata"], r["name"]) for r in csv.DictReader(f)}


def airline_by_iata(code: str) -> Airline | None:
    return next((a for a in airlines().values() if a.iata == code.upper()), None)


def nearest_airport(lat: float, lon: float, max_km: float = 8.0) -> Airport | None:
    """The airport closest to a point (e.g. where the track starts on the runway)."""
    best, best_d = None, max_km * 1000
    coslat = max(0.05, math.cos(math.radians(lat)))
    for ap in airports().values():
        if abs(ap.lat - lat) > 0.2 or abs(ap.lon - lon) * coslat > 0.2:
            continue
        d = geo.haversine(lat, lon, ap.lat, ap.lon)
        if d < best_d:
            best, best_d = ap, d
    return best


def parse_callsign(callsign: str | None) -> tuple[Airline | None, str | None]:
    """'HVN82' → (Vietnam Airlines, 'VN82'). Only works for numeric callsigns."""
    if not callsign:
        return None, None
    m = re.fullmatch(r"([A-Z]{3})(\d{1,4}[A-Z]?)", callsign.strip().upper())
    if not m:
        return None, None
    al = airlines().get(m.group(1))
    if not al:
        return None, None
    return al, f"{al.iata}{m.group(2).lstrip('0') or '0'}"


def parse_fr24_filename(stem: str) -> tuple[str | None, str | None]:
    """FR24 downloads are named like 'VN82_426a5696' → (flight number, FR24 flight id)."""
    m = re.match(r"^([A-Z0-9]{2}\d{1,4}[A-Z]?)_([0-9a-f]{6,10})", stem, re.IGNORECASE)
    return (m.group(1).upper(), m.group(2).lower()) if m else (None, None)
