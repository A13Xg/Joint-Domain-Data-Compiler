# JDDC Test Fixture Corpus

Everything here is safe to publish: public-domain scientific data and generated files.
No operational recordings, credentials, executable content, or personal tracking data.

## USGS import-format corpus

These fixtures are derived from the official USGS Magnitude 4.5+ weekly earthquake feed retrieved on 2026-07-26.

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

## EAG range fixtures

`20250506_RANGE_SYNTH.txt` and `06MAY25_RANGE_SYNTH.txt` hold the same synthetic
eight-point range track under the two filename date encodings `parseEag` supports
(`YYYYMMDD` and `DDMMMYY`), so neither branch of its mission-date extraction goes
uncovered. Their ECEF triples were generated from known geodetic waypoints spread across the
western United States using an independent WGS-84 implementation, and the waypoints
are recorded in `eag-expected.json`.

`test/eag-geographic.ts` asserts the parser recovers each waypoint to within 3e-5 degrees
and 2 m. That reference is deliberately not produced by `src/core/geodesy.ts` — checking a
conversion against its own inverse would prove nothing about its correctness.

These replace a test corpus that was retired before this repository was made public.

## Demo flight fixtures (user guide screenshots)

`demo-flight-a.csv` and `demo-flight-b.csv` are the tracks every screenshot in
`public/user-guide.html` is taken against, produced by `scripts/generate-demo-flight.mjs`.

They are synthetic by necessity, not convenience. The guide's screenshots are committed to a
public repository *and* packaged inside every release binary, so they cannot be shot against
recorded telemetry. Regenerate with `npm run fixtures:demo-flight`; the generator uses no
randomness, so the output is byte-identical every run and a screenshot re-run reproduces the
same pictures.

Positions are **integrated from a commanded heading/speed/vertical-rate profile**, not drawn as
a shape, so derived kinematics, turn rates, and the Track Health checks all see a physically
consistent flight: a 10-minute sortie from a 20 m field, climbing through the 1000 ft altitude
floor to ~1730 m, two opposed 3°/s racetrack turns at a 33.7° bank, then a descent back below
the floor to the field. Phase transitions are smoothed over a 25-second window because an
airframe rolls and pitches into a change over seconds — stepping the commanded profile at a
phase boundary puts a real discontinuity into the path, which the outlier detector then flags
correctly, making a healthy fixture look defective.

Both tracks score **100/100** on all seven Track Health checks. `hdop`/`sat` vary with bank angle
(a banked airframe masks part of the sky) without ever crossing the fix-quality thresholds, so
that check reports real data rather than "not applicable". `demo-flight-b.csv` is the same
sortie 400 m abeam and two seconds in trail, so the Compare tab aligns 600 of 601 samples at a
~458 m mean separation.

## Synthetic quality fixtures

`outlier-spikes.csv` is a generated 40-sample eastbound leg at 1 Hz with three ~200 m lateral
position spikes, used by `test/e2e/track-health-repair.spec.ts`. It is synthetic on purpose:
Track Health's remediation button only appears when the outlier check *fails*, which requires more
than `maxFlaggedFraction` (5%) of evaluated points to be flagged, and none of the real-capture
fixtures above trips that. Every sample is timed, so the repair exercises the reconstruct-in-place
path rather than the untimed-track deletion fallback.

## Manual smoke test

1. Import `real-usgs.csv` and map `latitude`, `longitude`, `depth_km`, and `time`.
2. Import `comparison-a.csv` and `comparison-b.csv`, then open Compare.
3. Import `real-usgs.geojson`, `real-usgs.gpx`, `real-usgs.kml`, `real-usgs.nmea`, and `real-usgs.gpb`.
4. Run fixed-rate resampling.
5. Save and reopen a complete project.
6. Confirm each `invalid/malformed-usgs.*` fixture fails safely (see table above for the
   expected behavior per format).
