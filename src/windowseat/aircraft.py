"""Cabin layouts and window optics.

The field of view through a cabin window is set by simple geometry: a window
of width w and height h seen from an eye at distance d subtends a horizontal
half-angle atan(w / 2d) and a vertical half-angle atan(h / 2d). Window seats
sit ~0.35 m from the pane; each seat further in adds roughly one seat width.

All dimensions below are approximate public figures and vary by airline
configuration; override them in your own profile if you know better.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

SEAT_PITCH_LATERAL_M = 0.48  # seat width incl. armrest
WINDOW_EYE_DISTANCE_M = 0.35  # window seat, sitting upright


@dataclass(frozen=True)
class AircraftProfile:
    name: str
    icao_types: tuple[str, ...]
    layout: str  # seat letters grouped by aisle, e.g. "ABC DEF"
    window_w_m: float
    window_h_m: float
    wing_rows: tuple[int, int] | None = None  # rows whose lower view the wing blocks
    wing_mask_deg: float = 10.0  # rays steeper than this below the window centre hit the wing

    @property
    def groups(self) -> list[str]:
        return self.layout.split()


PROFILES: list[AircraftProfile] = [
    AircraftProfile("Airbus A320 family", ("A318", "A319", "A320", "A321", "A19N", "A20N", "A21N"),
                    "ABC DEF", 0.23, 0.33, (10, 16)),
    AircraftProfile("Boeing 737", ("B737", "B738", "B739", "B37M", "B38M", "B39M", "B3XM"),
                    "ABC DEF", 0.25, 0.36, (10, 17)),
    AircraftProfile("Embraer E-Jet", ("E170", "E75L", "E75S", "E190", "E195", "E290", "E295"),
                    "AC DF", 0.23, 0.33, (8, 13)),
    AircraftProfile("Airbus A220", ("BCS1", "BCS3"), "AC DEF", 0.28, 0.41, (10, 15)),
    AircraftProfile("Airbus A330", ("A332", "A333", "A338", "A339"), "AC DEFG HK", 0.23, 0.33, (18, 28)),
    AircraftProfile("Airbus A350", ("A359", "A35K"), "ABC DEF HJK", 0.28, 0.40, (24, 34)),
    AircraftProfile("Boeing 777", ("B772", "B773", "B77L", "B77W", "B778", "B779"),
                    "ABC DEFG HJK", 0.25, 0.38, (18, 32)),
    AircraftProfile("Boeing 787", ("B788", "B789", "B78X"), "ABC DEF HJK", 0.27, 0.47, (18, 28)),
    AircraftProfile("Airbus A380", ("A388",), "ABC DEFG HJK", 0.24, 0.35, (40, 60)),
]

GENERIC = AircraftProfile("Generic narrowbody", (), "ABC DEF", 0.24, 0.34, None)


def profile_for(type_code: str | None) -> AircraftProfile:
    if not type_code:
        return GENERIC
    code = type_code.strip().upper()
    for p in PROFILES:
        if code in p.icao_types:
            return p
    # Loose matching: "A320-200", "737-800", "787"
    for p in PROFILES:
        for t in p.icao_types:
            if t[1:3] in code or code.replace("-", "").startswith(t):
                return p
    return GENERIC


@dataclass(frozen=True)
class Seat:
    row: int
    letter: str
    side: str  # "left" | "right"
    seats_from_window: int  # 0 = window seat
    profile: AircraftProfile
    eye_distance_m: float
    h_half_fov_deg: float
    v_half_fov_deg: float

    @property
    def label(self) -> str:
        return f"{self.row}{self.letter}"

    @property
    def over_wing(self) -> bool:
        wr = self.profile.wing_rows
        return bool(wr and wr[0] <= self.row <= wr[1])


def parse_seat(seat: str, profile: AircraftProfile = GENERIC, eye_distance_m: float | None = None) -> Seat:
    """Parse a seat like '23A' (or 'left'/'right' for a generic window seat)."""
    s = seat.strip().upper()
    if s in ("L", "LEFT"):
        s = f"20{profile.groups[0][0]}"
    elif s in ("R", "RIGHT"):
        s = f"20{profile.groups[-1][-1]}"
    m = re.fullmatch(r"(\d{1,3})([A-Z])", s)
    if not m:
        raise ValueError(f"Can't parse seat '{seat}'. Use e.g. 23A, 'left' or 'right'.")
    row, letter = int(m.group(1)), m.group(2)
    groups = profile.groups
    left, right = groups[0], groups[-1]
    if letter in left:
        side, idx = "left", left.index(letter)
    elif letter in right:
        side, idx = "right", len(right) - 1 - right.index(letter)
    else:
        # A centre-block seat: you look across the aisle and the outer block
        all_letters = "".join(groups)
        if letter not in all_letters:
            raise ValueError(f"Seat letter {letter} not in layout '{profile.layout}' ({profile.name}).")
        pos = all_letters.index(letter)
        side = "left" if pos < len(all_letters) / 2 else "right"
        idx = (len(left) + 1) if side == "left" else (len(right) + 1)  # +1 for the aisle
    d = eye_distance_m if eye_distance_m is not None else WINDOW_EYE_DISTANCE_M + idx * SEAT_PITCH_LATERAL_M
    h_half = math.degrees(math.atan(profile.window_w_m / 2 / d))
    v_half = math.degrees(math.atan(profile.window_h_m / 2 / d))
    return Seat(row, letter, side, idx, profile, d, h_half, v_half)
