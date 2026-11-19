"""How far you can see: extinction in a layered atmosphere (Koschmieder's law).

Light from a distant object is scattered out of the line of sight. After an
optical depth τ, the object's contrast against the sky drops by e^(−τ). The
eye stops seeing it below a contrast of about ε = 2 %, so it stays visible while

    C0 · e^(−τ) ≥ ε     ⇔     τ ≤ ln(C0 / ε)

For a black object (C0 = 1) this gives the classic meteorological visibility
V = 3.912 / β.

The extinction coefficient β falls off with height in two layers:

* **Rayleigh** (air molecules): β_R(h) = 0.0116 km⁻¹ · e^(−h / 8.4 km)  at 550 nm
* **Aerosol haze** (dust, smog, humidity), mostly in the lowest kilometres:
  β_A(h) = β_A0 · e^(−h / 1.5 km). β_A0 comes from the ground-level visibility
  you pass in: β_A0 = 3.912 / V − β_R0.

This is why a city 150 km away is lost in the haze, while a snow-covered
8000 m summit can be seen across 400+ km of thin, clean air.
"""

from __future__ import annotations

import math

from . import geodesy as geo

BETA_RAYLEIGH_0 = 0.0116e-3  # per metre, sea level, 550 nm
H_RAYLEIGH = 8_400.0
H_AEROSOL = 1_500.0
CONTRAST_THRESHOLD = 0.02
SNOW_PEAK_CONTRAST = 0.6  # sunlit snow/rock vs. sky background


def aerosol_beta0(ground_visibility_m: float) -> float:
    return max(0.0, 3.912 / ground_visibility_m - BETA_RAYLEIGH_0)


def beta(h_m: float, beta_a0: float) -> float:
    h = max(0.0, h_m)
    return BETA_RAYLEIGH_0 * math.exp(-h / H_RAYLEIGH) + beta_a0 * math.exp(-h / H_AEROSOL)


def optical_depth(
    h_observer: float,
    h_target: float,
    ground_dist_m: float,
    ground_visibility_m: float,
    k: float = geo.DEFAULT_REFRACTION_K,
    n: int = 64,
) -> float:
    """τ along the straight sight line (on the effective earth) between two points."""
    r = geo.effective_radius(k)
    g = ground_dist_m / r
    x1, z1 = 0.0, r + h_observer
    x2, z2 = (r + h_target) * math.sin(g), (r + h_target) * math.cos(g)
    length = math.hypot(x2 - x1, z2 - z1)
    ba0 = aerosol_beta0(ground_visibility_m)
    tau = 0.0
    for i in range(n):  # midpoint rule
        t = (i + 0.5) / n
        h = math.hypot(x1 + t * (x2 - x1), z1 + t * (z2 - z1)) - r
        tau += beta(h, ba0)
    return tau * length / n


def max_optical_depth(inherent_contrast: float) -> float:
    return math.log(inherent_contrast / CONTRAST_THRESHOLD)
