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

    def translate_path(self, path: str) -> str:
        clean = unquote(path.split("?", 1)[0].split("#", 1)[0])
        if clean.startswith("/files/"):
            target = (self.data_dir / clean[len("/files/"):]).resolve()
            if self.data_dir.resolve() in target.parents:
                return str(target)
        return super().translate_path(path)

    def log_message(self, *args) -> None:  # keep the terminal quiet
        pass


def serve(result_file: str | Path | None = None, open_browser: bool = True, port: int | None = None) -> None:
    viewer = resources.files("windowseat").joinpath("viewer")
    if not viewer.joinpath("index.html").is_file():
        raise SystemExit("The web viewer isn't built. Run: cd web && npm install && npm run build")
    viewer_dir = str(Path(str(viewer)))

    data_dir = Path(result_file).resolve().parent if result_file else Path.cwd()
    handler = type("Handler", (_Handler,), {"data_dir": data_dir})
    port = port or _free_port()
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(handler, directory=viewer_dir))

    url = f"http://127.0.0.1:{port}/"
    if result_file:
        url += f"?data=files/{quote(Path(result_file).name)}"
    print(f"\n  Viewer running at {url}\n  (keep this window open; press Ctrl+C to stop)\n")
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("  Stopped.")
    finally:
        httpd.server_close()
