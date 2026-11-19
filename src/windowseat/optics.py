"""Window rays: body frame ⇄ local North-East-Down frame.

Body frame (aerospace convention): x forward (nose), y right wing, z down.
A right-side window looks along +y, a left-side window along −y.

The rotation body → NED is the standard 3-2-1 (yaw ψ, pitch θ, roll φ)
direction-cosine matrix. Positive roll = right wing down, so a right bank tilts
the right-hand windows towards the ground and the left-hand ones at the sky.
"""

from __future__ import annotations

import math

Vec = tuple[float, float, float]
Mat = tuple[Vec, Vec, Vec]


def dcm_body_to_ned(heading_deg: float, pitch_deg: float, bank_deg: float) -> Mat:
    psi, th, ph = map(math.radians, (heading_deg, pitch_deg, bank_deg))
    cps, sps = math.cos(psi), math.sin(psi)
    cth, sth = math.cos(th), math.sin(th)
    cph, sph = math.cos(ph), math.sin(ph)
    return (
        (cth * cps, sph * sth * cps - cph * sps, cph * sth * cps + sph * sps),
        (cth * sps, sph * sth * sps + cph * cps, cph * sth * sps - sph * cps),
        (-sth, sph * cth, cph * cth),
    )


def mat_vec(m: Mat, v: Vec) -> Vec:
    return (
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    )


def mat_t_vec(m: Mat, v: Vec) -> Vec:
    """Transpose(m) · v — i.e. NED → body for a rotation matrix."""
    return (
        m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
        m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
        m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
    )


def window_ray_body(side: str, h_off_deg: float, v_off_deg: float) -> Vec:
    """Unit ray in the body frame through a window.

    h_off: horizontal offset from the window normal, positive towards the nose.
    v_off: vertical offset, positive upwards (towards the cabin ceiling).
    """
    a, b = math.radians(h_off_deg), math.radians(v_off_deg)
    y = math.cos(a) * math.cos(b)
    return (math.sin(a) * math.cos(b), y if side == "right" else -y, -math.sin(b))


def body_angles(side: str, v_body: Vec) -> tuple[float, float]:
    """Inverse of window_ray_body: body vector → (h_off, v_off) in degrees."""
    x, y, z = v_body
    lateral = y if side == "right" else -y
    v_off = math.degrees(math.asin(max(-1.0, min(1.0, -z))))
    h_off = math.degrees(math.atan2(x, lateral))
    return h_off, v_off


def ned_to_az_el(v: Vec) -> tuple[float, float]:
    n, e, d = v
    az = (math.degrees(math.atan2(e, n)) + 360.0) % 360.0
    el = math.degrees(math.asin(max(-1.0, min(1.0, -d))))
    return az, el


def az_el_to_ned(az_deg: float, el_deg: float) -> Vec:
    az, el = math.radians(az_deg), math.radians(el_deg)
    return (math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), -math.sin(el))


def window_boundary(h_half: float, v_half: float, n_per_edge: int = 8) -> list[tuple[float, float]]:
    """(h_off, v_off) samples around the window edge, counter-clockwise from the bottom-aft corner."""
    pts: list[tuple[float, float]] = []
    lin = [i / n_per_edge for i in range(n_per_edge)]
    for f in lin:  # bottom edge, aft → forward
        pts.append((-h_half + 2 * h_half * f, -v_half))
    for f in lin:  # forward edge, bottom → top
        pts.append((h_half, -v_half + 2 * v_half * f))
    for f in lin:  # top edge, forward → aft
        pts.append((h_half - 2 * h_half * f, v_half))
    for f in lin:  # aft edge, top → bottom
        pts.append((-h_half, v_half - 2 * v_half * f))
    return pts
