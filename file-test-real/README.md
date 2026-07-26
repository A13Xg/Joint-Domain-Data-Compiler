# JDDC Real-Data Test Corpus

These fixtures are derived from the official USGS Magnitude 4.5+ weekly earthquake feed retrieved on 2026-07-26.

Source documentation: https://earthquake.usgs.gov/earthquakes/feed/v1.0/
Original feed: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson

The source is authoritative, public scientific data and contains no credentials, executable content, personal tracking records, or archive payloads.

## Smoke test

1. Import `usgs-m45-week-subset.csv` and map `latitude`, `longitude`, `depth_km`, and `time`.
2. Import `comparison-a.csv` and `comparison-b.csv`, then open Compare.
3. Import the GeoJSON and GPX equivalents.
4. Run fixed-rate resampling.
5. Save and reopen a complete project.
6. Confirm `malformed-usgs.csv` fails safely.

Earthquake depth is positive downward. The GPX version converts depth to negative meters only to populate an altitude-oriented field. These are import fixtures, not flight trajectories.
