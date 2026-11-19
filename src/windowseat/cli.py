"""Command line: `windowseat demo`, `windowseat analyze`, `windowseat horizon`."""

from __future__ import annotations

import argparse
import sys

from . import geodesy as geo
from .analysis import Options, analyze
from .export import dump, text_report, to_geojson


def _common(p: argparse.ArgumentParser) -> None:
    p.add_argument("--seat", default="right", help="seat like 23A, or 'left' / 'right' (default: right)")
    p.add_argument("--aircraft", help="ICAO type, e.g. A320, B738, B789 (sets cabin layout & window size)")
    p.add_argument("--terrain", action="store_true", help="use real elevation data (downloads & caches DEM tiles)")
    p.add_argument("--step", type=float, default=30.0, help="seconds between samples (default 30)")
    p.add_argument("--visibility", type=float, default=150.0, help="atmospheric visibility in km (default 150)")
    p.add_argument("--refraction", type=float, default=geo.DEFAULT_REFRACTION_K, help="refraction coefficient k")
    p.add_argument("--min-city", type=int, default=300_000, help="smallest city population to list")
    p.add_argument("--landmarks", help="extra landmarks CSV: name,lat,lon[,kind,elevation_m,weight]")
    p.add_argument("-o", "--out", default="view.windowseat.json", help="output JSON for the web viewer")
    p.add_argument("--geojson", help="also write a GeoJSON file")
    p.add_argument("--open", action="store_true", help="open the result in the web viewer afterwards")


def _run(flight, args) -> None:
    from .landmarks import load_csv
    from .terrain import make_terrain

    terrain = make_terrain(args.terrain)
    opts = Options(step_s=args.step, visibility_km=args.visibility, refraction_k=args.refraction,
                   min_city_population=args.min_city,
                   extra_landmarks=load_csv(args.landmarks) if args.landmarks else [])

    def progress(i, n):
        if sys.stderr.isatty() and (i % 10 == 0 or i == n - 1):
            print(f"\r  computing view {i + 1}/{n}", end="", file=sys.stderr, flush=True)

    result = analyze(flight, args.seat, args.aircraft, terrain, opts, progress)
    if sys.stderr.isatty():
        print(file=sys.stderr)
    dump(result, args.out)
    if args.geojson:
        dump(to_geojson(result), args.geojson)
    print(text_report(result))
    print(f"\nWrote {args.out}" + (f" and {args.geojson}" if args.geojson else ""))
    if args.open:
        from .server import serve

        serve(args.out)
    else:
        print("Tip: add --open to view it in your browser, or run `windowseat view " + args.out + "`.")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="windowseat", description="What can you see from your airplane window?")
    sub = ap.add_subparsers(dest="cmd")

    sub.add_parser("start", help="interactive menu: pick a flight and seat, then open the viewer (default)")
    v = sub.add_parser("view", help="open the web viewer (optionally with a .windowseat.json file)")
    v.add_argument("file", nargs="?", help="analysis JSON to open")
    v.add_argument("--port", type=int)

    d = sub.add_parser("demo", help="run on the built-in Amsterdam → Rome demo flight")
    _common(d)

    a = sub.add_parser("analyze", help="analyse a real flight")
    src = a.add_mutually_exclusive_group(required=True)
    src.add_argument("file", nargs="?", help="Flightradar24 CSV or KML export")
    src.add_argument("--fr24", metavar="FLIGHT", help="fetch via the official FR24 API (needs FR24_API_TOKEN)")
    src.add_argument("--opensky", metavar="CALLSIGN", help="fetch a live/recent track from OpenSky, e.g. KLM1605")
    a.add_argument("--date", help="flight date YYYY-MM-DD (FR24 API)")
    _common(a)

    h = sub.add_parser("horizon", help="print horizon distance / dip for an altitude")
    h.add_argument("altitude", type=float, help="altitude")
    h.add_argument("--ft", action="store_true", help="altitude is in feet")

    args = ap.parse_args(argv)

    if args.cmd in (None, "start"):
        from .wizard import run

        run()
        return
    if args.cmd == "view":
        from .server import serve

        serve(args.file, port=args.port)
        return
    if args.cmd == "horizon":
        alt = args.altitude * (geo.FT_TO_M if args.ft else 1.0)
        geo_d = geo.horizon_distance(alt, 0.0) / 1000
        ref_d = geo.horizon_distance(alt) / 1000
        print(f"Altitude {alt:,.0f} m")
        print(f"  geometric horizon : {geo_d:,.1f} km   (√(2Rh) ≈ {((2 * geo.EARTH_RADIUS_M * alt) ** 0.5) / 1000:,.1f} km)")
        print(f"  with refraction   : {ref_d:,.1f} km   (k = {geo.DEFAULT_REFRACTION_K})")
        print(f"  horizon dip       : {geo.horizon_dip_deg(alt):.2f}° below horizontal")
        return

    if args.cmd == "demo":
        from .sources.demo import demo_flight

        flight = demo_flight()
        args.aircraft = args.aircraft or flight.aircraft_type
        if args.seat == "right":
            args.seat = "20F"
    elif args.fr24:
        from .sources import fr24_api

        flight = fr24_api.fetch(args.fr24, args.date, args.aircraft)
    elif args.opensky:
        from .sources import opensky

        flight = opensky.fetch(callsign=args.opensky, aircraft_type=args.aircraft)
    else:
        from .sources.fr24_file import read_file

        flight = read_file(args.file, args.aircraft)
    _run(flight, args)


if __name__ == "__main__":
    main()
