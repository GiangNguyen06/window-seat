from windowseat.sources.fr24_file import read_fr24_csv, read_kml

CSV = """Timestamp,UTC,Callsign,Position,Altitude,Speed,Direction
1718438400,2024-06-15T08:00:00Z,KLM1605,"52.30,4.76",0,14,240
1718438460,2024-06-15T08:01:00Z,KLM1605,"52.28,4.70",2500,160,238
1718438520,2024-06-15T08:02:00Z,KLM1605,"52.25,4.62",5000,220,236
"""

KML = """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><TimeStamp><when>2024-06-15T08:00:00Z</when></TimeStamp><Point><coordinates>4.76,52.30,0</coordinates></Point></Placemark>
<Placemark><TimeStamp><when>2024-06-15T08:01:00Z</when></TimeStamp><Point><coordinates>4.70,52.28,762</coordinates></Point></Placemark>
</Document></kml>"""


def test_fr24_csv(tmp_path):
    p = tmp_path / "flight.csv"
    p.write_text(CSV)
    fl = read_fr24_csv(p)
    assert fl.callsign == "KLM1605"
    assert len(fl.points) == 3
    assert fl.points[1].alt_m == 2500 * 0.3048
    assert abs(fl.points[1].gs_ms - 160 * 0.514444) < 1e-6


def test_kml(tmp_path):
    p = tmp_path / "flight.kml"
    p.write_text(KML)
    fl = read_kml(p)
    assert len(fl.points) == 2 and fl.points[1].alt_m == 762


FR24_KML = """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>VN82/HVN82</name>
<description><![CDATA[<div><span><a href="https://www.flightradar24.com/flight/vn82">VN82</a></span> / HVN82<br/>Vietnam Airlines</div>
<a style="x" title="Amsterdam Airport" href="https://www.flightradar24.com/airport/ams/departures"><h3 style="y">AMS</h3>Amsterdam</a>
<a style="x" title="Hanoi Airport" href="https://www.flightradar24.com/airport/han/arrivals"><h3 style="y">HAN</h3>Hanoi</a>
<div><span style="c" title="Scheduled Time of Departure">STD </span>
<span title="2026-11-03 15:00">15:00</span> <span title="Coordinated Universal Time">UTC</span></div>
<td>Aircraft<span style="float: right;">(A359)</span><br>
<span style="b">Airbus A350-941</span></td>
<td>Registration<br>
<span style="b"><a href="https://www.flightradar24.com/reg/vn-a889">VN-A889</a></span></td>]]></description>
<Folder><name>Route</name>
<Placemark><description><![CDATA[<b>Speed:</b> 540 kt]]></description><TimeStamp><when>2026-11-03T19:27:38+00:00</when></TimeStamp>
<Style><IconStyle><heading>93</heading></IconStyle></Style><Point><altitudeMode>absolute</altitudeMode><coordinates>43.187489,40.867847,11887.2</coordinates></Point></Placemark>
<Placemark><TimeStamp><when>2026-11-03T19:28:38+00:00</when></TimeStamp><Point><coordinates>43.3,40.86,11887.2</coordinates></Point></Placemark>
</Folder></Document></kml>"""


def test_fr24_kml_header_and_points(tmp_path):
    from windowseat.sources.fr24_file import read_file

    p = tmp_path / "VN82_426a5696.kml"
    p.write_text(FR24_KML, encoding="utf-8")
    fl = read_file(p)
    assert (fl.flight_number, fl.callsign, fl.airline) == ("VN82", "HVN82", "Vietnam Airlines")
    assert (fl.origin, fl.origin_name, fl.destination, fl.destination_name) == ("AMS", "Amsterdam", "HAN", "Hanoi")
    assert (fl.aircraft_type, fl.aircraft_model, fl.registration) == ("A359", "Airbus A350-941", "VN-A889")
    assert fl.times["STD"] == "2026-11-03T15:00:00Z"
    assert fl.points[0].track_deg == 93 and abs(fl.points[0].gs_ms - 540 * 0.514444) < 1e-6
    assert fl.points[0].alt_m == 11887.2  # KML altitude is already in metres


def test_csv_gets_details_from_callsign_filename_and_airports(tmp_path):
    from windowseat.sources.fr24_file import read_file

    p = tmp_path / "KL1605_3a1b2c3d.csv"
    p.write_text(CSV)
    fl = read_file(p)
    assert fl.flight_number == "KL1605" and fl.airline == "KLM Royal Dutch Airlines"
    assert fl.origin == "AMS"  # first point is on the Schiphol runway
    assert fl.meta["fr24_id"] == "3a1b2c3d"
