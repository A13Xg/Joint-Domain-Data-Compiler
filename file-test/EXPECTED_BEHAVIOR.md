# Expected behaviors

| Sample | Expected result |
|---|---|
| `comparison/reference-track.csv` + `target-track.csv` | Compare tab produces aligned relative metrics. |
| `csv/feet-and-epoch.csv` | Map altitude as feet and time as epoch seconds. |
| `csv/dms-coordinates.csv` | DMS coordinates parse to decimal degrees. |
| `csv/gaps-and-invalid.csv` | Invalid coordinate row is skipped; invalid time warns; gap remains visible. |
| `csv/antimeridian.csv` | Longitude handling should not jump through zero. |
| `csv/duplicates.csv` | Dedupe transform should remove repeated points. |
| `csv/out-of-order-time.csv` | Sort-by-time should restore chronological order. |
| `csv/large-gap.csv` | Gap-aware resampling should omit the long interval when max-gap is enabled. |
| `csv/elevation-spikes.csv` | Elevation outlier filter should suppress obvious spikes. |
| `nmea/bad-checksum.nmea` | Sentences are dropped with a checksum warning. |
| `invalid/*` | Clear error or warning; no application crash. |
