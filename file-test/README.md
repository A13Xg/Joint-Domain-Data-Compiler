# JDDC Real-Data Test Corpus

These fixtures replace the earlier synthetic corpus. They are derived from the official USGS Magnitude 4.5+ weekly earthquake feed retrieved on 2026-07-26.

Source documentation: https://earthquake.usgs.gov/earthquakes/feed/v1.0/
Original feed: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson

The source is authoritative public scientific data with no credentials, executable content, personal tracking records, or archive payloads.

## Fixture coverage

The same 8-event sequence (`us7000t3eb` … `us7000t3in`) is represented once per supported
import format, each with a matching malformed counterpart under `invalid/`, and is exercised
automatically by `test/parser-fixtures.ts` (`npm test`):

| Format | Valid fixture | Malformed fixture | Malformed behavior exercised |
| --- | --- | --- | --- |
| CSV | `real-usgs.csv` | `invalid/malformed-usgs.csv` | Unterminated quoted field — flagged by the delimiter parser (`papaparse` `MissingQuotes`); the salvaged row is still emitted with corrupted trailing columns (documented gap, see `test/parser-fixtures.ts`). |
| GPX | `real-usgs.gpx` | `invalid/malformed-usgs.gpx` | `trkpt` elements missing `lat`/`lon` — zero points, explanatory warning. |
| KML | `real-usgs.kml` | `invalid/malformed-usgs.kml` | Incomplete/empty `<coordinates>` — zero points, explanatory warning. |
| GeoJSON | `real-usgs.geojson` | `invalid/malformed-usgs.geojson` | Invalid JSON syntax — parser throws. |
| NMEA | `real-usgs.nmea` | `invalid/malformed-usgs.nmea` | All sentence checksums corrupted — sentences dropped, zero points. |
| GPB | `real-usgs.gpb` | `invalid/malformed-usgs.gpb` | Wrong magic header (`BAD1` vs `GPB1`) — parser throws. |

`real-usgs.nmea` synthesizes standard GGA/RMC sentences (with correctly computed checksums)
from the same USGS coordinates/times/depths; the framing is synthetic, but the encoded
positions and timestamps are the authoritative USGS values. `real-usgs.gpb` is generated
directly from the project's own `buildGpb()` writer over the same points, so it is exactly
what the app itself would produce. `real-usgs.kml` uses `<Point>`/`<coordinates>` Placemarks
rather than `gx:Track`: the `gx:Track` code path is real-parser-verified only by manual/browser
testing, because the `linkedom` DOM shim used for Node-based parser tests does not resolve
namespaced element names (e.g. `gx:Track`) the way a browser `DOMParser` does (see
`test/helpers/linkedomShim.ts`).

Earthquake depth is positive downward. The GPX/KML/NMEA/GPB fixtures convert depth to negative
meters only to populate an altitude-oriented field. These are ingestion fixtures, not flight
trajectories.

## Manual smoke test

1. Import `real-usgs.csv` and map `latitude`, `longitude`, `depth_km`, and `time`.
2. Import `comparison-a.csv` and `comparison-b.csv`, then open Compare.
3. Import `real-usgs.geojson`, `real-usgs.gpx`, `real-usgs.kml`, `real-usgs.nmea`, and `real-usgs.gpb`.
4. Run fixed-rate resampling.
5. Save and reopen a complete project.
6. Confirm each `invalid/malformed-usgs.*` fixture fails safely (see table above for the
   expected behavior per format).
