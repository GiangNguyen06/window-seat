"""Terrain elevation providers.

* ``FlatTerrain`` — sea-level sphere. No downloads, works offline.
* ``TerrariumTerrain`` — global elevation from the free AWS Terrain Tiles open
  dataset (Terrarium-encoded PNG, SRTM/GMTED/ETOPO derived). Tiles are cached on disk.
  Requires Pillow (``pip install window-seat[terrain]``).
"""

from __future__ import annotations

import io
import math
import os
from functools import lru_cache
from pathlib import Path
from typing import Protocol


class Terrain(Protocol):
    max_elevation_m: float

    def elevation(self, lat: float, lon: float) -> float: ...


class FlatTerrain:
    max_elevation_m = 0.0

    def __init__(self, elevation_m: float = 0.0) -> None:
        self._h = elevation_m
        self.max_elevation_m = elevation_m

    def elevation(self, lat: float, lon: float) -> float:
        return self._h


TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


class TerrariumTerrain:
    """Elevation from Terrarium tiles: h = R·256 + G + B/256 − 32768 (metres)."""

    max_elevation_m = 8_900.0

    def __init__(self, zoom: int = 8, cache_dir: str | os.PathLike | None = None, url: str = TERRARIUM_URL) -> None:
        try:
            from PIL import Image  # noqa: F401
        except ImportError as e:  # pragma: no cover
            raise ImportError("TerrariumTerrain needs Pillow: pip install 'window-seat[terrain]'") from e
        self.zoom = zoom
        self.url = url
        self.cache_dir = Path(cache_dir or Path.home() / ".cache" / "windowseat" / "terrarium")
        self._tile = lru_cache(maxsize=512)(self._load_tile)

    def _load_tile(self, x: int, y: int):
        from PIL import Image

        z = self.zoom
        path = self.cache_dir / str(z) / str(x) / f"{y}.png"
        if not path.exists():
            import requests

            path.parent.mkdir(parents=True, exist_ok=True)
            r = requests.get(self.url.format(z=z, x=x, y=y), timeout=30)
            r.raise_for_status()
            path.write_bytes(r.content)
        img = Image.open(io.BytesIO(path.read_bytes())).convert("RGB")
        return img.load(), img.size

    def check(self) -> bool:
        """Try to load one tile (Mont Blanc area) so we fail early, not halfway through a flight."""
        try:
            return self.elevation(45.83, 6.86) > 1000
        except Exception:  # noqa: BLE001 — any network/decoding failure means "not available"
            return False

    def elevation(self, lat: float, lon: float) -> float:
        n = 2 ** self.zoom
        lat = max(-85.0511, min(85.0511, lat))
        xf = (lon + 180.0) / 360.0 * n
        lat_r = math.radians(lat)
        yf = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
        x, y = int(xf) % n, min(n - 1, int(yf))
        px, (w, h) = self._tile(x, y)
        ix = min(w - 1, int((xf - int(xf)) * w))
        iy = min(h - 1, int((yf - int(yf)) * h))
        r, g, b = px[ix, iy]
        return max(0.0, r * 256 + g + b / 256 - 32768)  # clamp sea/bathymetry to 0


def make_terrain(real: bool):
    """TerrariumTerrain if requested and reachable, else FlatTerrain (with a warning)."""
    if not real:
        return FlatTerrain()
    t = TerrariumTerrain()
    if t.check():
        return t
    print("  ! Couldn't download elevation data (offline?). Continuing with a smooth earth.")
    return FlatTerrain()
