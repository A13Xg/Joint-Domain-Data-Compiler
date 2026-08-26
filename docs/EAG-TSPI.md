# EAG TSPI Format Reference

## Overview

EAG (European Air Group) TSPI (Time-Space-Position-Information) is a tab-delimited plaintext telemetry format used by NATO and European air-force range instrumentation. Coordinates are encoded as ECEF (Earth-Centered-Earth-Fixed) in meters using the WGS84 datum.

## Format Specification

### Header Line (7 tab-separated fields)

| Field | Type | Value | Description |
|-------|------|-------|-------------|
| 0 | char | 'A' (typical) | Platform type (A=Aircraft) |
| 1 | int | '1' (constant) | Record version |
| 2 | int | 0+ | Exercise ID |
| 3 | int | 0+ | Mission ID |
| 4 | int | '25' (typical) | Observed constant across all platforms; likely year code or schema marker |
| 5 | int | '1' (constant) | Reserved field |
| 6 | string | Aircraft name | Platform name or aircraft type (e.g., "F35", "BT02") |

### Data Row (11 tab-separated fields)

| Field | Type | Description |
|-------|------|-------------|
| 0 | int | Milliseconds since multi-day epoch; modulo 86400000 gives time-of-day |
| 1 | int | Record version (cross-check vs header) |
| 2 | int | Exercise ID (cross-check vs header) |
| 3 | int | Mission ID (cross-check vs header) |
| 4 | float | ECEF X-coordinate (meters) |
| 5 | float | ECEF Y-coordinate (meters) |
| 6 | float | ECEF Z-coordinate (meters) |
| 7 | float | Attitude field 7 (semantics unconfirmed) |
| 8 | float | Attitude field 8 (semantics unconfirmed) |
| 9 | float | Heading (degrees, 0–360) |
| 10 | string | Time of day (HH:MM:SS.cc) |

## Coordinate System

- **Reference frame**: WGS84 Earth-Centered-Earth-Fixed (ECEF)
- **Units**: Meters
- **Valid range**: Distance from Earth's center ~6.371–6.381 million meters (Earth's radius ±elevation)
- **Conversion**: ECEF → geodetic (lat/lon/height) via standard WGS84 ellipsoid

## Time Handling

### Date Extraction from Filename

JDDC recognizes two filename date patterns:

- **YYYYMMDD**: `20250506_RANGE_SYNTH.txt` → 2025-05-06
- **DDMMMYY**: `06MAY25_RANGE_SYNTH.txt` → 2025-05-06

If no date is found in the filename, time fields are not populated and a warning is emitted.

### Timestamp Reconstruction

Per-row timestamps are reconstructed from:
1. **Mission date** (extracted from filename)
2. **Time-of-day string** (field 10: HH:MM:SS.cc in UTC)
3. **Day offset detection** (if timeCounterMs goes down from previous row, a midnight has passed)

UTC time = `Date.UTC(year, month, date + dayOffset, hours, minutes, seconds, centiseconds*10)`

## Known Limitations

- **Field 7 and 8 semantics**: Unknown; retained as neutral extension channels `eag_field7` and `eag_field8`
- **Field 4 constant**: Always '25' across all observed platforms; purpose unclear (possibly year or schema version)
- **Day boundary detection**: Relies on timeCounterMs rollover detection; files spanning multiple calendar days are supported
- **Attitude/heading**: Field 9 (heading) is relatively well-understood; fields 7–8 are retained for round-tripping but not interpreted

## Export Options

When exporting to EAG format, the following header fields can be customized:

- `platformType`: Default 'A' (Aircraft)
- `exerciseId`: Default '0'
- `missionId`: Default '0'
- `eagField4`: Default '25' (observed constant)
- `platformName`: Defaults to the dataset name

ECEF coordinates are computed from geodetic (lat/lon/height) using WGS84 transformations. Attitude/heading fields are preserved from extension channels or default to zero if absent.

## Test Coverage

- **parser-fixtures.ts**: Valid and malformed EAG parsing with header cross-checks and channel preservation
- **eag-geographic.ts**: Geographic sanity checks on 6 real NATO range files (99.3% of 145.7K points in Nevada/West-Coast region) and synthetic midnight-crossing scenarios

## References

- ECEF/WGS84 conversion: `src/core/geodesy.ts`
- Import parser: `src/core/parsers/eag.ts`
- Export builder: `src/core/exporters/eag.ts`
- Format detection: `src/core/parsers/contentSignature.ts` (header shape sniffing)
