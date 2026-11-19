"""`windowseat start`: an interactive menu so nobody has to remember command-line flags."""

from __future__ import annotations

import json
import os
from pathlib import Path

FLIGHT_DIR = Path("flights")
OUTPUT_DIR = Path("outputs")
MEMORY = FLIGHT_DIR / ".windowseat-settings.json"


def _recall(key: str) -> dict:
    try:
        return json.loads(MEMORY.read_text(encoding="utf-8")).get(key, {})
    except (OSError, ValueError):
        return {}


def _remember(key: str, values: dict) -> None:
    try:
        allv = json.loads(MEMORY.read_text(encoding="utf-8")) if MEMORY.exists() else {}
    except (OSError, ValueError):
        allv = {}
    allv[key] = values
    try:
        MEMORY.write_text(json.dumps(allv, indent=1), encoding="utf-8")
    except OSError:
        pass


def _ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        ans = input(f"  {prompt}{suffix}: ").strip()
    except EOFError:
        ans = ""
    return ans or default


def _choose_flight():
    FLIGHT_DIR.mkdir(exist_ok=True)
    found = [p for p in FLIGHT_DIR.iterdir() if p.suffix.lower() in (".csv", ".kml")]
    # If both a CSV and a KML of the same flight exist, use the KML (it has the flight details)
    by_stem: dict[str, Path] = {}
    for p in found:
        if p.stem not in by_stem or p.suffix.lower() == ".kml":
            by_stem[p.stem] = p
    files = sorted(by_stem.values(), key=lambda p: p.stat().st_mtime, reverse=True)
    options: list[tuple[str, object]] = [
        (f"{p.stem}  ({'KML, full flight details' if p.suffix.lower() == '.kml' else 'CSV'})", p) for p in files]
    options.append(("Demo flight: Amsterdam → Rome over the Alps", "demo"))
    if os.environ.get("FR24_API_TOKEN"):
        options.append(("Fetch from the Flightradar24 API (flight number + date)", "fr24"))
    options.append(("Fetch a flight that's airborne now from OpenSky (free)", "opensky"))

    print("\n  Which flight?")
    if not files:
        print(f"  (Tip: download a flight's KML or CSV from flightradar24.com and put it in the '{FLIGHT_DIR}' folder.)")
    for i, (label, _) in enumerate(options, 1):
        print(f"   {i}. {label}")
    while True:
        pick = _ask("Number", "1")
        if pick.isdigit() and 1 <= int(pick) <= len(options):
            return options[int(pick) - 1][1]
        print("  Please type one of the numbers above.")


def _describe(flight) -> None:
    title = " ".join(x for x in (flight.flight_number or flight.callsign, flight.airline) if x) or "Flight"
    route = ""
    if flight.origin or flight.destination:
        route = f"  {flight.origin or '?'} ({flight.origin_name or '?'}) → {flight.destination or '?'} ({flight.destination_name or '?'})"
    day = flight.points[0].time.strftime("%d %b %Y") if flight.points else ""
    plane = ""
    if flight.aircraft_type:
        plane = f"  · {flight.aircraft_model or flight.aircraft_type}" + (f" {flight.registration}" if flight.registration else "")
    print(f"\n  ✈  {title}{route}  · {day}{plane}")


def run() -> None:
    from .analysis import Options, analyze
    from .export import dump, text_report
    from .server import serve

    print("\n  ✈  Window Seat: what can you see from your airplane window?\n")
    choice = _choose_flight()

    if choice == "demo":
        from .sources.demo import demo_flight

        flight, name = demo_flight(), "demo"
    elif choice == "fr24":
        from .sources import fr24_api

        num = _ask("Flight number (e.g. KL1605)")
        date = _ask("Date (YYYY-MM-DD, empty = airborne now)")
        flight, name = fr24_api.fetch(num, date or None), f"{num}_{date or 'live'}"
    elif choice == "opensky":
        from .sources import opensky

        cs = _ask("ICAO callsign (e.g. KLM1605, not KL1605)")
        flight, name = opensky.fetch(callsign=cs), cs
    else:
        from .sources.fr24_file import read_file

        flight, name = read_file(choice), Path(choice).stem

    _describe(flight)
    mem = _recall(name)
    print("\n  Simple: just compare the left and right windows (press Enter).")
    print("  Detailed: enter your seat number for seat-specific results (window size, aisle, wing).")
    if mem.get("seat"):
        print(f"  (last time you used seat {mem['seat']} for this flight)")
    seat = _ask("Seat number").strip()
    simple = seat.lower() in ("", "-", "simple", "left", "right", "l", "r")
    aircraft = flight.aircraft_type
    use_terrain = False
    if simple:
        seat = ""
    else:
        if flight.aircraft_type:
            print(f"  Aircraft: {flight.aircraft_model or flight.aircraft_type} ({flight.aircraft_type}), from the flight file")
        else:
            aircraft = _ask("Aircraft type (e.g. A320, B738, A359, B789)", mem.get("aircraft") or "unknown")
            aircraft = None if aircraft.lower() == "unknown" else aircraft
        use_terrain = _ask("Use real mountain/terrain data? Slower, needs internet (y/n)", "n").lower().startswith("y")
    _remember(name, {"seat": seat, "aircraft": (aircraft or "") if not flight.aircraft_type else ""})

    from .terrain import make_terrain

    terrain = make_terrain(use_terrain)

    print("\n  Calculating the view…")
    result = analyze(flight, seat or None, aircraft, terrain, Options())
    OUTPUT_DIR.mkdir(exist_ok=True)
    out = OUTPUT_DIR / f"{name}_{seat or 'left-right'}.windowseat.json"
    dump(result, str(out))
    print()
    print("\n".join("  " + line for line in text_report(result).splitlines()))
    print(f"\n  Saved {out}")
    serve(out)
