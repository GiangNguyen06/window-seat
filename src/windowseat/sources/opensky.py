"""OpenSky Network (free for research / non-commercial use).

Anonymous access works for live state vectors with tight daily limits. For
tracks, create API client credentials on opensky-network.org and set
OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET.
"""

from __future__ import annotations

import os

from ..track import Flight, TrackPoint
from .enrich import enrich

API = "https://opensky-network.org/api"
TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"


def _headers() -> dict:
    import requests

    cid, secret = os.environ.get("OPENSKY_CLIENT_ID"), os.environ.get("OPENSKY_CLIENT_SECRET")
    if not (cid and secret):
        return {}
    r = requests.post(TOKEN_URL, data={"grant_type": "client_credentials", "client_id": cid, "client_secret": secret},
                      timeout=30)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def find_icao24(callsign: str) -> str:
    """Look up the transponder address of a flight that is airborne now."""
    import requests

    r = requests.get(f"{API}/states/all", headers=_headers(), timeout=60)
    r.raise_for_status()
    cs = callsign.strip().upper()
    for s in r.json().get("states") or []:
        if (s[1] or "").strip().upper() == cs:
            return s[0]
    raise LookupError(f"{callsign} not found in OpenSky live data (is it airborne and using an ICAO callsign like KLM1605?)")


def fetch(callsign: str | None = None, icao24: str | None = None, time: int = 0,
          aircraft_type: str | None = None) -> Flight:
    import requests

    icao24 = icao24 or find_icao24(callsign or "")
    r = requests.get(f"{API}/tracks/all", params={"icao24": icao24.lower(), "time": time}, headers=_headers(), timeout=60)
    r.raise_for_status()
    j = r.json()
    # path: [time, lat, lon, baro_altitude_m, true_track, on_ground]
    pts = [TrackPoint(float(p[0]), p[1], p[2], float(p[3] or 0), None, p[4]) for p in j.get("path", []) if p[1] is not None]
    return enrich(Flight(pts, callsign=(j.get("callsign") or callsign or "").strip() or None,
                  aircraft_type=aircraft_type, source="opensky", meta={"icao24": icao24}))
