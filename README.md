# Joint Domain Data Compiler

Baseline scaffolding for a local-first data conversion UI focused on universal CSV ingestion and GPX export.

## What Is Implemented

- Modern React + TypeScript + Vite web UI
- Electron-ready runtime entry points for future standalone packaging
- Large-file-aware CSV analysis using a Web Worker (streamed chunk parsing)
- Header/value auto-analysis with confidence suggestions for field mapping
- Estimated column type inference with confidence and pattern signatures
- Manual mapping controls for GPS-relevant fields
- Live map visualizer that updates as lat/lon field selections change
- Mapping diagnostics with lat/lon swap recommendation
- Map display modes (path only, points only, both)
- Unit and format normalization:
  - Elevation: meters or feet
  - Timestamp: ISO-8601, epoch seconds, epoch milliseconds, Excel serial
- GPX 1.1 export optimized for broad compatibility
- Export report with row quality metrics (skipped/used counts)

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Desktop (Electron) Development

```bash
npm run dev:desktop
```

This starts Vite and then launches Electron against the local web app.

## Build

```bash
npm run build
```

`npm run build:desktop` currently runs the web build and leaves a packaging hook message. You can integrate electron-builder or electron-forge next.

## Converter Workflow

1. Upload a CSV file.
2. The worker samples rows in chunks (without loading the entire file into React state).
3. Auto-detected column candidates are shown with confidence values.
4. Estimated data types and signatures are shown per column.
5. Map source columns to latitude/longitude and optional GPX fields.
6. Preview results immediately on the live map as mappings change.
7. Review mapping diagnostics and swap lat/lon if recommended.
8. Pick source units for elevation and time format.
9. Export a GPX file and review conversion quality stats.

## Technical Notes For Large Files

- CSV structure analysis runs in `src/workers/csvAnalyzer.worker.ts`.
- Analysis stops after a configurable sample limit to keep UI responsive.
- Preview map points are derived from sampled rows and downsampled when needed to keep rendering smooth.
- Conversion uses chunked parsing in `src/lib/gpx.ts` so rows are processed incrementally.
- Rows with invalid lat/lon are skipped, improving output robustness.

## Key Files

- `src/App.tsx`: Main CSV-to-GPX UI workflow
- `src/workers/csvAnalyzer.worker.ts`: Background schema/intelligence pass
- `src/lib/gpx.ts`: Streaming CSV to GPX conversion and normalization
- `src/types/converter.ts`: Shared types
- `electron/main.cjs`: Electron app window entry
- `electron/preload.cjs`: Preload bridge stub

## Current Scope And Next Extensions

Current baseline targets CSV to GPX. Logical next features:

- Additional input formats (JSON, KML, NMEA, XLSX)
- Profiles/presets for known vendor schemas
- Validation report and anomaly diagnostics
- Multi-track GPX grouping and richer extension tags
