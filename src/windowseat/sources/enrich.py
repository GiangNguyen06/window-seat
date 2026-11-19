"""Fill in flight details that a source didn't provide, from the track itself."""

from __future__ import annotations

from pathlib import Path

from .. import reference as ref
from ..track import Flight


def enrich(flight: Flight, filename: str | Path | None = None) -> Flight:
    """Fill in missing details from the filename, the callsign and the start/end of the track.

    Values that are already set (e.g. read from a KML header) are never overwritten.
    """
    if filename:
        num, fr24_id = ref.parse_fr24_filename(Path(filename).stem)
        flight.flight_number = flight.flight_number or num
        if fr24_id:
            flight.meta.setdefault("fr24_id", fr24_id)

    airline, num = ref.parse_callsign(flight.callsign)
    if airline:
        flight.airline = flight.airline or airline.name
    flight.flight_number = flight.flight_number or num
    if not flight.airline and flight.flight_number:
        al = ref.airline_by_iata(flight.flight_number[:2])
        flight.airline = al.name if al else None

    pts = flight.points
    if pts:
        ground = min(p.alt_m for p in pts)
        # Only trust the first/last point if the aircraft was on or near the ground there
        if not flight.origin and pts[0].alt_m - ground < 600:
            ap = ref.nearest_airport(pts[0].lat, pts[0].lon)
            if ap:
                flight.origin, flight.origin_name = ap.iata, flight.origin_name or ap.city or ap.name
        if not flight.destination and pts[-1].alt_m - ground < 600:
            ap = ref.nearest_airport(pts[-1].lat, pts[-1].lon)
            if ap:
                flight.destination, flight.destination_name = ap.iata, flight.destination_name or ap.city or ap.name
    for code, attr in ((flight.origin, "origin_name"), (flight.destination, "destination_name")):
        if code and not getattr(flight, attr):
            ap = ref.airports().get(code)
            if ap:
                setattr(flight, attr, ap.city or ap.name)
    return flight
