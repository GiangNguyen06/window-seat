// Koschmieder extinction in a two-layer atmosphere. Port of src/windowseat/atmosphere.py.

import * as geo from "./geo";

export const BETA_RAYLEIGH_0 = 0.0116e-3;
export const H_RAYLEIGH = 8_400;
export const H_AEROSOL = 1_500;
export const CONTRAST_THRESHOLD = 0.02;
export const SNOW_PEAK_CONTRAST = 0.6;

export const aerosolBeta0 = (groundVisibilityM: number) => Math.max(0, 3.912 / groundVisibilityM - BETA_RAYLEIGH_0);

export function beta(hM: number, betaA0: number): number {
  const h = Math.max(0, hM);
  return BETA_RAYLEIGH_0 * Math.exp(-h / H_RAYLEIGH) + betaA0 * Math.exp(-h / H_AEROSOL);
}

export function opticalDepth(hObserver: number, hTarget: number, groundDistM: number, groundVisibilityM: number,
  k = geo.DEFAULT_REFRACTION_K, n = 64): number {
  const r = geo.effectiveRadius(k);
  const g = groundDistM / r;
  const x1 = 0, z1 = r + hObserver;
  const x2 = (r + hTarget) * Math.sin(g), z2 = (r + hTarget) * Math.cos(g);
  const length = Math.hypot(x2 - x1, z2 - z1);
  const ba0 = aerosolBeta0(groundVisibilityM);
  let tau = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    tau += beta(Math.hypot(x1 + t * (x2 - x1), z1 + t * (z2 - z1)) - r, ba0);
  }
  return (tau * length) / n;
}

export const maxOpticalDepth = (inherentContrast: number) => Math.log(inherentContrast / CONTRAST_THRESHOLD);
