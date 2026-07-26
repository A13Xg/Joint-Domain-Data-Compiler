# JDDC File Test Corpus

This folder contains manual-import and smoke-test fixtures for every currently supported input family.

## Quick smoke sequence

1. Load `comparison/reference-track.csv` and map `latitude`, `longitude`, `elevation_m`, and `timestamp`.
2. Load `comparison/target-track.csv` with the same mapping.
3. Open **Compare**, **3D**, **Transform**, and **Project**.
4. Run fixed-rate resampling at 2 Hz.
5. Save a complete project, reload the app, and reopen it.

## Valid samples

- `csv/`: mapping, units, DMS coordinates, channels, gaps, and malformed-row behavior.
- `gpx/`: tracks, routes, waypoints, extensions, and multiple segments.
- `geojson/`: LineString, MultiLineString, and point features.
- `kml/`: LineString, points, and `gx:Track`.
- `nmea/`: RMC/GGA/GLL receiver logs.
- `gpb/`: valid compact binary track.

## Negative samples

Files under `invalid/` are intentionally malformed or unsupported. They should fail safely or produce clear warnings without crashing the application.
