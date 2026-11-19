"""Flight track model, resampling and attitude (heading / pitch / bank) estimation.

Flight trackers report *position*, *altitude*, *ground speed* and *track*
(direction of travel). They do not report the aircraft's attitude, so we derive
it from kinematics:

* **Heading ψ** ≈ ground track. (The real nose heading differs by the wind
  crab angle, typically < 5°; see docs/physics.md.)
* **Bank φ** from a coordinated turn: tan φ = v·ω / g, where ω = dψ/dt.
* **Pitch θ** = flight-path angle γ + angle of attack α, with
  γ = atan(vertical speed / ground speed).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone

from . import geodesy as geo

MAX_BANK_DEG = 35.0
DEFAULT_AOA_DEG = 2.5


@dataclass
class TrackPoint:
    t: float  # unix seconds, UTC
    lat: float
    lon: float
    alt_m: float  # above mean sea level
    gs_ms: float | None = None  # ground speed, m/s
    track_deg: float | None = None  # direction of travel, deg true
    vs_ms: float | None = None  # vertical speed, m/s
    # Derived attitude (filled in by Flight.estimate_attitude)
    heading_deg: float | None = None
    pitch_deg: float = 0.0
    bank_deg: float = 0.0

    @property
    def time(self) -> datetime:
        return datetime.fromtimestamp(self.t, tz=timezone.utc)


@dataclass
class Flight:
    points: list[TrackPoint]
    callsign: str | None = None  # ICAO callsign, e.g. HVN82
    origin: str | None = None  # IATA airport code
    destination: str | None = None
    aircraft_type: str | None = None  # ICAO type designator, e.g. A359
    source: str = "unknown"
    meta: dict = field(default_factory=dict)
    flight_number: str | None = None  # IATA flight number, e.g. VN82
    airline: str | None = None
    registration: str | None = None
    aircraft_model: str | None = None  # e.g. Airbus A350-941
    origin_name: str | None = None
    destination_name: str | None = None
    times: dict = field(default_factory=dict)  # STD / ATD / STA / ETA / ATA → ISO strings (UTC)

    def info(self) -> dict:
        """Flight details for the output file (empty values dropped)."""
        keys = ("flight_number", "callsign", "airline", "origin", "origin_name", "destination", "destination_name",
                "aircraft_type", "aircraft_model", "registration")
        out = {k: getattr(self, k) for k in keys if getattr(self, k)}
        if self.times:
            out["times"] = self.times
        return out

    def __post_init__(self) -> None:
        self.points.sort(key=lambda p: p.t)
        # Drop duplicate timestamps
        dedup: list[TrackPoint] = []
        for p in self.points:
            if dedup and abs(p.t - dedup[-1].t) < 1e-6:
                dedup[-1] = p
            else:
                dedup.append(p)
        self.points = dedup

    # ------------------------------------------------------------------ utils
    @property
    def duration_s(self) -> float:
        return self.points[-1].t - self.points[0].t if self.points else 0.0

    def airborne(self, min_alt_agl_m: float = 150.0, min_gs_ms: float = 30.0) -> Flight:
        """Return a copy without ground-roll / taxi points."""
        if not self.points:
            return self
        ground_alt = min(p.alt_m for p in self.points)
        pts = [
            p
            for p in self.points
            if (p.alt_m - ground_alt) >= min_alt_agl_m or (p.gs_ms or 0) >= 2 * min_gs_ms
        ]
        return replace(self, points=pts or self.points)

    # --------------------------------------------------------------- resample
    def resample(self, step_s: float) -> Flight:
        """Uniformly resample the track every step_s seconds."""
        pts = self.points
        if len(pts) < 2:
            return self
        out: list[TrackPoint] = []
        t = pts[0].t
        j = 0
        while t <= pts[-1].t + 1e-6:
            while j < len(pts) - 2 and pts[j + 1].t < t:
                j += 1
            a, b = pts[j], pts[j + 1]
            span = b.t - a.t
            f = 0.0 if span <= 0 else min(1.0, max(0.0, (t - a.t) / span))
            lat, lon = geo.interpolate_great_circle(a.lat, a.lon, b.lat, b.lon, f)
            out.append(
                TrackPoint(
                    t=t,
                    lat=lat,
                    lon=lon,
                    alt_m=a.alt_m + f * (b.alt_m - a.alt_m),
                    gs_ms=_lerp_opt(a.gs_ms, b.gs_ms, f),
                    track_deg=_lerp_angle_opt(a.track_deg, b.track_deg, f),
                    vs_ms=_lerp_opt(a.vs_ms, b.vs_ms, f),
                )
            )
            t += step_s
        return replace(self, points=out)

    # --------------------------------------------------------------- attitude
    def estimate_attitude(
        self,
        aoa_deg: float = DEFAULT_AOA_DEG,
        smooth_window: int = 5,
    ) -> Flight:
        """Fill heading, pitch and bank on every point from the kinematics."""
        pts = [replace(p) for p in self.points]
        n = len(pts)
        if n == 0:
            return self

        # 1. Fill missing ground speed / track / vertical speed by differencing positions
        for i, p in enumerate(pts):
            a = pts[max(0, i - 1)]
            b = pts[min(n - 1, i + 1)]
            dt = b.t - a.t
            if dt <= 0:
                continue
            if p.track_deg is None:
                p.track_deg = geo.initial_bearing(a.lat, a.lon, b.lat, b.lon)
            if p.gs_ms is None:
                p.gs_ms = geo.haversine(a.lat, a.lon, b.lat, b.lon) / dt
            if p.vs_ms is None:
                p.vs_ms = (b.alt_m - a.alt_m) / dt
        for p in pts:
            p.track_deg = p.track_deg if p.track_deg is not None else 0.0
            p.gs_ms = p.gs_ms if p.gs_ms is not None else 0.0
            p.vs_ms = p.vs_ms if p.vs_ms is not None else 0.0

        # 2. Unwrap the heading so the derivative is continuous across 360°/0°
        unwrapped = [pts[0].track_deg]
        for p in pts[1:]:
            d = (p.track_deg - unwrapped[-1] + 180.0) % 360.0 - 180.0
            unwrapped.append(unwrapped[-1] + d)
        unwrapped = _moving_average(unwrapped, smooth_window)

        # 3. Turn rate ω (rad/s) → coordinated-turn bank angle
        banks = []
        for i in range(n):
            a, b = max(0, i - 1), min(n - 1, i + 1)
            dt = pts[b].t - pts[a].t
            omega = math.radians(unwrapped[b] - unwrapped[a]) / dt if dt > 0 else 0.0
            v = pts[i].gs_ms
            bank = math.degrees(math.atan(v * omega / geo.G0))
            banks.append(max(-MAX_BANK_DEG, min(MAX_BANK_DEG, bank)))
        banks = _moving_average(banks, smooth_window)

        # 4. Pitch from flight-path angle + angle of attack (only when airborne)
        for i, p in enumerate(pts):
            p.heading_deg = unwrapped[i] % 360.0
            p.bank_deg = banks[i]
            gamma = math.degrees(math.atan2(p.vs_ms, max(p.gs_ms, 1.0)))
            p.pitch_deg = gamma + (aoa_deg if p.gs_ms > 40 else 0.0)
        return replace(self, points=pts)


def _lerp_opt(a: float | None, b: float | None, f: float) -> float | None:
    if a is None or b is None:
        return a if b is None else b
    return a + f * (b - a)


def _lerp_angle_opt(a: float | None, b: float | None, f: float) -> float | None:
    if a is None or b is None:
        return a if b is None else b
    d = (b - a + 180.0) % 360.0 - 180.0
    return (a + f * d) % 360.0


def _moving_average(xs: list[float], window: int) -> list[float]:
    if window <= 1 or len(xs) < 3:
        return list(xs)
    half = window // 2
    out = []
    for i in range(len(xs)):
        lo, hi = max(0, i - half), min(len(xs), i + half + 1)
        out.append(sum(xs[lo:hi]) / (hi - lo))
    return out
