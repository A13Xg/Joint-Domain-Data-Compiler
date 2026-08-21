# JDDC Roadmap

This document outlines the planned development direction for Joint Domain Data Compiler. Features are organized by phase and priority.

**Current Release:** v0.2.0 (in development)  
**Latest Stable:** v0.1.1

---

## Phase 1: Visualization & UI Polish (Current)

### Visualization Enhancements
- [ ] **Multi-pane chart layouts** — Allow side-by-side axis scales and custom channel grouping
- [ ] **Statistical plot types** — Histograms, probability plots, Lissajous curves for trajectory analysis
- [ ] **Chart image export** — High-quality PNG/SVG export with annotations preserved
- [ ] **3D Performance validation** — Benchmark multi-track rendering and optimize geometry construction
- [ ] **Playback controls refinement** — Timestamp-accurate scrubbing with linked cursor in all views

### Comparison Module
- [ ] **Drift estimation** — Automatic clock-skew detection and correction workflows
- [ ] **Multi-track comparison visualization** — Side-by-side trajectory divergence heatmaps
- [ ] **Richer comparison reports** — Statistical tables, divergence histograms in HTML export

### Transform Workflows
- [ ] **Recipe UI** — Named, reusable transform sequences with parameter templates
- [ ] **Advanced filters** — Kalman smoothing, spline interpolation, cross-track error analysis
- [ ] **Memory-efficient undo** — Compress operation snapshots instead of storing full datasets

---

## Phase 2: Mobile & Accessibility

### Responsive Design
- [ ] **Tablet layouts** — Touch-optimized interface for iPad and Android tablets
- [ ] **Mobile-first MVP** — Essential import, map view, and basic export on phones
- [ ] **Offline-first sync** — Local data persistence with optional cloud backup

### Accessibility
- [ ] **WCAG 2.1 AA compliance** — Full keyboard navigation, screen reader support
- [ ] **Color-blind modes** — Alternative palettes for protanopia, deuteranopia, tritanopia
- [ ] **High-contrast themes** — Explicit dark/light modes with adjustable text size

---

## Phase 3: Collaboration & Cloud

### Multi-User Features
- [ ] **Shared workspaces** — Real-time collaborative analysis with Operational Transformation or CRDTs
- [ ] **Comment annotations** — Bookmark points of interest with discussions
- [ ] **Activity history** — Audit trail with per-user attribution

### Cloud Integration
- [ ] **S3/Azure Blob storage** — Optional cloud backup for large datasets
- [ ] **Dataset versioning** — Git-like history for data provenance and rollback
- [ ] **API & webhooks** — Programmatic access for data ingest and analysis pipelines

---

## Phase 4: Advanced Analysis

### Specialized Workflows
- [ ] **Sensor fusion recipes** — Multi-source alignment templates (GPS + INS + radar)
- [ ] **Uncertainty quantification** — Monte Carlo analysis of coordinate/timestamp confidence
- [ ] **Anomaly detection** — Automated event flagging for unusual behavior patterns
- [ ] **Trajectory classification** — ML-based maneuver recognition (climb, turn, descent, etc.)

### Export & Integration
- [ ] **NetCDF format** — Support for scientific data interchange
- [ ] **PostGIS vector tiles** — Direct database integration for large datasets
- [ ] **REST API** — Headless JDDC instance for batch processing

---

## Known Limitations & Future Improvements

### Visualization
- **Constraint:** No per-chart-type rendering fork (scatter/area types render as line chart)
  - **Timeline:** Phase 1 follow-up
  - **Impact:** Chart validator provides clear feedback; users see expected vs. actual
  
- **Constraint:** ExportPanel GPX preview runs synchronously
  - **Timeline:** Phase 1 (after multi-pane layout)
  - **Impact:** Large datasets may briefly block UI; async worker refactor needed

- **Constraint:** 3D renderer is 2D canvas-based, not WebGL
  - **Timeline:** Phase 2+ (performance assessment first)
  - **Impact:** Keeps dependencies lean; performance limits ~100k points with optimizations

### Data Handling
- **Constraint:** DOM parser capped at 100k points (memory limit)
  - **Timeline:** Stable; larger datasets use GPB or chunked export
  - **Impact:** CSV mapping UI respects limit; clear error messaging

- **Constraint:** Map visual budget ~4,000 points (display only)
  - **Timeline:** Stable; full data preserved for export
  - **Impact:** Deterministic downsampling preserves statistical correctness

### Architecture
- **Constraint:** No mobile/tablet responsive design in current scope
  - **Timeline:** Phase 2
  - **Impact:** Desktop-first; web/Electron parity maintained

- **Constraint:** Operation history not yet recipe-safe for deterministic replay
  - **Timeline:** Phase 1 follow-up
  - **Impact:** Undo/redo works via snapshots; export history visible in reports

---

## Bug Tracker & Issue Triage

Issues are tracked in GitHub with these labels:

- **`bug`** — Incorrect behavior, regressions, or data corruption
- **`enhancement`** — Feature requests or UX improvements
- **`performance`** — Latency, memory, or rendering bottlenecks
- **`security`** — Potential vulnerabilities or unsafe patterns
- **`documentation`** — Docs gaps, inaccurate guides, API clarity
- **`type/*`** — Component area (parser, transform, ui, electron, etc.)

---

## Dependency & Platform Evolution

### Node.js & Runtimes
- **Current minimum:** Node 22 (required by Vite 8, File/Blob/Web Crypto APIs)
- **Electron:** Follows 6-month major-version cadence with security patches
- **Timeline:** Quarterly minor-version bumps; major versions with full test suite

### Format Support
- **CSV/TSV/NMEA 0183** — Core formats, mature parsing (Phase 1 focus: DMS handling edge cases)
- **GPX/GeoJSON** — Full support; Phase 1 focus: schema edge cases and performance
- **KML** — Google `gx:Track` support; Phase 2: network-link handling
- **EAG TSPI** — NATO range instrumentation support (stable; Phase 3: precision improvements)
- **GPB** — JDDC binary format (compact, lossless for coordinates/channels; phase 4: archive schema v2)
- **Future candidates** — NetCDF, HDF5, proprietary military formats (Phase 4)

---

## Release Cadence

- **Patch releases (X.Y.Z+)** — Bug fixes, security patches (every 2-4 weeks as needed)
- **Minor releases (X.Y+)** — New features, UI polish, format support (every 8-12 weeks)
- **Major releases (X+)** — Architecture changes, breaking API changes (annual or less frequently)

Each release includes:
- Full test harness pass (62+ deterministic checks)
- Native platform smoke tests (Linux/Windows/macOS)
- CycloneDX SBOMs and SHA-256 checksums
- GitHub/Sigstore provenance attestations
- Benchmark comparison against baseline (material regressions investigated)

---

## Performance Baselines

Deterministic benchmarks run on synthetic spiral-climb datasets:
- **100k points** — ~200ms build time, <50ms render
- **500k points** — ~1.2s build time, <150ms render (with downsampling)
- **1M points** — ~2.5s build time (baseline; larger datasets route through GPB or chunked export)

Results are recorded and compared at release time; material regressions must be investigated before publication.

---

## Architecture Debt & Tech Debt

### Low Priority (Stable, No Immediate Risk)
- **3D renderer is canvas-based, not WebGL** — Works well for current perf targets; WebGL upgrade deferred pending performance assessment
- **No per-chart-type rendering fork** — Chart validator works around this; minor usability limitation
- **Operation history not yet recipe-safe** — Undo/redo works via snapshots; deterministic replay roadmapped for Phase 1 follow-up

### Medium Priority (Plan Refactor)
- **ExportPanel GPX preview runs synchronously** — Brief UI block on large datasets; async refactor planned for Phase 1
- **Memory-efficient undo** — Compress snapshots instead of storing full datasets; Phase 1 follow-up

### High Priority (Track Carefully)
- **No mobile/tablet responsive design** — Planned Phase 2; test coverage gap until then
- **Cloud infrastructure absent** — Phase 3 milestone; impacts collaboration roadmap

---

## How to Contribute

1. **Report bugs** — Open an issue with reproduction steps and expected vs. actual behavior
2. **Request features** — Describe the workflow, constraints, and why it matters
3. **Optimize performance** — Benchmark before/after, link to baseline data
4. **Improve docs** — PRs for clarity, examples, and API documentation welcome
5. **Write tests** — Unit tests, integration tests, and e2e cases in `test/`

See `ONBOARDING.md` for developer workflow, branch strategy, and CI/CD practices.

---

## Version History

| Version | Release Date | Highlights |
|---------|--------------|-----------|
| 0.1.0   | 2026-08-14   | Initial local-first baseline: import, linked visualization, transforms, project save/export |
| 0.2.0   | TBD          | HTML analysis reports, Electron packaging, SBOMs, build-provenance attestations |
| 1.0.0   | TBD          | Production-ready: mobile support, multi-user collaboration, advanced analysis |
