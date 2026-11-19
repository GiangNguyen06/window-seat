# Put your flight files here

1. Go to flightradar24.com and log in.
2. Search for your flight number (for example KL1605) and open its history page.
3. Next to the flight you took, click **KML** (recommended) or **CSV**. This needs a paid plan.
4. Save the file into this `flights` folder.
5. Double-click `start.bat` (Windows) or run `./start.sh` (Mac/Linux). Your file will appear in the menu.

**KML or CSV?** Both contain the same flight path. The KML also includes the flight number, airline,
route, departure/arrival times, aircraft type and registration, so everything fills in automatically.
From a CSV, the flight number, airline and airports are worked out from the callsign, the file name and
where the track starts and ends. You'd have to enter the aircraft type yourself (only needed for seat-specific results).
If both files of the same flight are here, the KML is used.

You can also drag a file straight onto `start.bat`.

Files here are private to your computer. They are ignored by git, so they won't be uploaded to GitHub.
