"""Official Flightradar24 API (https://fr24api.flightradar24.com).

This is a separate, credit-based developer subscription — a Silver/Gold app
subscription does not include it. There is a free sandbox for testing.
Put your token in the FR24_API_TOKEN environment variable.

Endpoints used:
* GET /api/flight-summary/light  — find the FR24 flight id for a flight number + date
* GET /api/live/flight-positions/full — find the id of a flight that is airborne now
* GET /api/flight-tracks?flight_id=… — the full position track
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from ..geodesy import FT_TO_M, KT_TO_MS
from ..track import Flight, TrackPoint
from .enrich import enrich

BASE = "https://fr24api.flightradar24.com/api"


class FR24Client:
    def __init__(self, token: str | None = None, base: str = BASE) -> None:
        self.token = token or os.environ.get("FR24_API_TOKEN")
        if not self.token:
            raise RuntimeError("Set FR24_API_TOKEN (get one at fr24api.flightradar24.com).")
        self.base = base

    def _get(self, path: str, **params):
        import requests

        r = requests.get(
            f"{self.base}{path}",
            params={k: v for k, v in params.items() if v is not None},
            headers={"Accept": "application/json", "Accept-Version": "v1", "Authorization": f"Bearer {self.token}"},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()

    def live_flight(self, flight: str) -> dict | None:
        data = self._get("/live/flight-positions/full", flights=flight).get("data", [])
        return data[0] if data else None

    def find_flights(self, flight: str, day: datetime) -> list[dict]:
        start = day.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=day.tzinfo or timezone.utc)
        end = start + timedelta(days=1)
        fmt = "%Y-%m-%dT%H:%M:%S"
        return self._get("/flight-summary/light", flights=flight,
                         flight_datetime_from=start.strftime(fmt), flight_datetime_to=end.strftime(fmt)).get("data", [])

    def track(self, fr24_id: str, aircraft_type: str | None = None, meta: dict | None = None) -> Flight:
        resp = self._get("/flight-tracks", flight_id=fr24_id)
        item = resp[0] if isinstance(resp, list) else resp
        pts = []
        for p in item.get("tracks", []):
            pts.append(TrackPoint(
                datetime.fromisoformat(p["timestamp"].replace("Z", "+00:00")).timestamp(),
                p["lat"], p["lon"], (p.get("alt") or 0) * FT_TO_M,
                (p["gspeed"] * KT_TO_MS) if p.get("gspeed") is not None else None,
                p.get("track"),
                (p["vspeed"] * FT_TO_M / 60) if p.get("vspeed") is not None else None,
            ))
        meta = meta or {}
        callsign = meta.get("callsign") or next((p.get("callsign") for p in item.get("tracks", []) if p.get("callsign")), None)
        return enrich(Flight(
            pts, callsign=callsign, origin=meta.get("orig_iata") or meta.get("orig_icao"),
            destination=meta.get("dest_iata") or meta.get("dest_icao"),
            aircraft_type=aircraft_type or meta.get("type"), source="fr24-api", meta={"fr24_id": fr24_id},
            flight_number=meta.get("flight"), registration=meta.get("reg"),
        ))


def fetch(flight: str, date: str | None = None, aircraft_type: str | None = None, token: str | None = None) -> Flight:
    """Fetch by flight number (e.g. KL1605) for a date (YYYY-MM-DD), or live if no date."""
    c = FR24Client(token)
    if date:
        cands = c.find_flights(flight, datetime.fromisoformat(date).replace(tzinfo=timezone.utc))
        if not cands:
            raise LookupError(f"No FR24 flight {flight} found on {date}")
        meta = cands[0]
    else:
        meta = c.live_flight(flight)
        if not meta:
            raise LookupError(f"{flight} is not airborne right now; pass --date")
    return c.track(meta["fr24_id"], aircraft_type, meta)
