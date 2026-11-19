"""Serve the bundled web viewer plus your analysis files, and open the browser."""

from __future__ import annotations

import functools
import http.server
import socket
import threading
import webbrowser
from importlib import resources
from pathlib import Path
from urllib.parse import quote, unquote


def _free_port(preferred: int = 8765) -> int:
    for port in (preferred, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("no free port")


class _Handler(http.server.SimpleHTTPRequestHandler):
    data_dir: Path = Path(".")
    flight_dir: Path | None = None

    def translate_path(self, path: str) -> str:
        clean = unquote(path.split("?", 1)[0].split("#", 1)[0])
        for prefix, base in (("/files/", self.data_dir), ("/flight/", self.flight_dir)):
            if base is not None and clean.startswith(prefix):
                target = (base / clean[len(prefix):]).resolve()
                if base.resolve() in target.parents:
                    return str(target)
        return super().translate_path(path)

    def log_message(self, *args) -> None:  # keep the terminal quiet
        pass


def serve(
    result_file: str | Path | None = None,
    open_browser: bool = True,
    port: int | None = None,
    flight_file: str | Path | None = None,
    seat: str | None = None,
    aircraft: str | None = None,
    demo: bool = False,
) -> None:
    """Open the viewer. With `flight_file`, the page recalculates the flight itself, so the
    website-only features (real weather, the settings panel) work too."""
    viewer = resources.files("windowseat").joinpath("viewer")
    if not viewer.joinpath("index.html").is_file():
        raise SystemExit("The web viewer isn't built. Run: cd web && npm install && npm run build")
    viewer_dir = str(Path(str(viewer)))

    data_dir = Path(result_file).resolve().parent if result_file else Path.cwd()
    flight_dir = Path(flight_file).resolve().parent if flight_file else None
    handler = type("Handler", (_Handler,), {"data_dir": data_dir, "flight_dir": flight_dir})
    port = port or _free_port()
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(handler, directory=viewer_dir))

    url = f"http://127.0.0.1:{port}/"
    params = []
    if result_file:
        params.append(f"data=files/{quote(Path(result_file).name)}")
    if flight_file:
        params.append(f"flight=flight/{quote(Path(flight_file).name)}")
    if demo:
        params.append("demo=1")
    if seat:
        params.append(f"seat={quote(seat)}")
    if aircraft:
        params.append(f"aircraft={quote(aircraft)}")
    if params:
        url += "?" + "&".join(params)
    print(f"\n  Viewer running at {url}\n  (keep this window open; press Ctrl+C to stop)\n")
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("  Stopped.")
    finally:
        httpd.server_close()
