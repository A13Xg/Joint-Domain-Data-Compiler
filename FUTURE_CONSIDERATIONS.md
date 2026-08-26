# JDDC: Future Considerations & Strategic Planning

This document captures strategic decisions, architectural trade-offs, and long-term considerations for the Joint Domain Data Compiler project.

---

## Design Philosophy

### Single-User, Not Multi-User (for now)

**Decision:** JDDC is optimized as a single-user, always-visible workbench. Multi-user collaboration is Phase 3+.

**Rationale:**
- **Precision over consumption** — Dense, expert-focused UI trades off casual accessibility for power-user control
- **Data integrity** — Single-user context simplifies undo/redo, real-time sync, and audit trails
- **Performance** — No need for conflict-resolution complexity; deterministic snapshots sufficient
- **Scope clarity** — Defers operational challenges (user authentication, session management, network sync) to a future phase

**Implications:**
- Project archives are single-writer (cooperative, not concurrent)
- Selection state is per-session, not persisted across users
- No built-in comment/annotation system yet (Phase 3+)
- Desktop Electron app is single-instance (one workbench per machine)

**Future pivot:** Phase 3 roadmap includes CRDT-based collaborative editing and cloud sync; architecture designed with this in mind.

---

## Technology Choices & Trade-offs

### React 19 + TypeScript (Frontend)

**Decision:** Use React 19 with TypeScript for type safety and component model.

**Why React?**
- Declarative UI rendering aligns with data-driven updates
- Rich ecosystem for charts (SVG) and maps (Leaflet)
- Server-side rendering not needed; client-only architecture keeps deployment simple

**Why TypeScript?**
- Catch type errors at build time (especially important for coordinate/timestamp handling)
- Clear contracts for data models (Dataset, TrackPoint, Transform, etc.)
- Enables confident refactoring

**Trade-off:** No framework-level routing (intentional). All tabs render inline in `App.tsx`, following "always-visible workbench" principle. This keeps state management simple but limits future modularization.

**Future consideration:** If mobile UI (Phase 2) needs separate views, consider conditional inline-rendering or light routing library (not full React Router).

---

### No WebGL for 3D (Canvas instead)

**Decision:** Implement 3D trajectory renderer as custom 2D canvas with perspective matrix, not WebGL.

**Why?**
- **Dependencies:** Avoid three.js, Babylon.js, or WebGL complexity; keep build footprint lean
- **Control:** Hand-rolled perspective math is well-understood and auditable
- **Performance:** Acceptable for ~100k points; can optimize spatial partitioning before upgrading to WebGL
- **Fail-safe:** Canvas fallback exists; WebGL errors don't break app

**Trade-off:** Performance ceiling. Beyond ~100k points, canvas-based rendering slows noticeably.

**Future consideration:** Phase 2+ performance assessment may justify WebGL upgrade. If so:
1. Benchmark canvas vs. WebGL at 100k, 500k, 1M points
2. Implement WebGL renderer alongside existing canvas
3. Auto-select based on dataset size and device capability
4. Maintain canvas as fallback for older devices

---

### No Bundler Plugins (Vite + Native Modules)

**Decision:** Use Vite for fast dev rebuilds; ship native modules (File, Blob, Web Crypto) directly without polyfills.

**Why?**
- **Bundle size:** No crypto polyfills; Web Crypto API is available in Node 22+
- **Security:** Native implementation is audited and maintained by runtime provider
- **Simplicity:** No tool config for compatibility layers

**Constraint:** Requires Node 22+. This is acceptable for a developer tool; relaxing version constraint demands polyfill burden.

**Future consideration:** If Node 22 LTS support ends (April 2027), evaluate upgrading to Node 24+ LTS or backfilling polyfills.

---

### Electron + IPC Security

**Decision:** Sandbox Electron renderer; expose only a small, explicit set of IPC operations (see `electron/security.cjs`'s `IPC_CHANNELS`, tested for drift in `test/electron-integration.ts`).

**IPC Operations:**
1. `kml-library:list` — List persisted KML/KMZ library entries (read-only)
2. `kml-library:save` — Import a KML/KMZ file into the library (with path validation)
3. `kml-library:read-text` — Read a library entry's text (KMZ is unzipped in-process)
4. `kml-library:remove` — Delete a library entry
5. `kml-library:reseed` — Restore missing bundled seed files
6. `kml-library:reveal` — Open the library folder in the OS file manager
7. `file-archive:save` — Write a duplicate copy of an imported/exported file into a bounded local archive
8. `file-archive:reveal` — Open the archive folder in the OS file manager
9. `diagnostics:save` — Save a diagnostic bundle via a native save dialog

**Security model:**
- Renderer has no Node integration; all file I/O goes through main process
- IPC payloads are type-checked and size-limited (50 MB max for KML/KMZ library files, 512 MB max for archived import/export copies, 5 MB max for diagnostic bundles)
- Paths are resolved relative to the app's userData directory; no traversal allowed
- Preload script is minimal and audited

**Fuse V1 policy:**
- `ASAR` integrity enforcement (Windows/macOS; Linux disables due to electron-builder limitation)
- Cookie encryption enabled
- No `ELECTRON_RUN_AS_NODE` or `NODE_OPTIONS` env var override
- Context isolation enabled

**Future consideration:** If collaborative features (Phase 3+) require real-time IPC, add:
- Message signing/verification for untrusted peers
- Rate limiting on broadcast operations
- Encrypted channel for sensitive data

---

### CSV Mapping & Type Inference

**Decision:** Interactive CSV header analysis with field mapping before import (no auto-magic).

**Why?**
- **User control:** Ambiguous columns (e.g., "lat" vs. "latitude") are disambiguated by user
- **Auditable:** Every field mapping is visible and can be reviewed before import
- **Safe:** No silent data misinterpretation (e.g., timestamp in Unix seconds vs. ISO 8601)

**Trade-off:** Requires user interaction (good for precision, slower for batch workflows).

**Future consideration:** Phase 4 may add:
- Template library (save/reuse mappings for recurring datasources)
- Regex field patterns (auto-detect columns by name pattern)
- Batch import via CLI or API (headless mode for non-interactive workflows)

---

## Performance & Scaling

### Dataset Size Budgets

**Constraint:** Map visual budget is ~4,000 points. Chart rendering is ~10,000 points per channel.

**Rationale:**
- **Memory:** Larger datasets overflow browser tab memory limits
- **UI responsiveness:** DOM updates slow down with >10k DOM nodes
- **Determinism:** Preserve statistical accuracy via downsampling (not filtering)

**Strategy:**
- Full dataset always kept in memory; downsampling happens at render time
- Downsampling preserves extrema and first/last points (no data falsification)
- Export always uses full dataset (not downsampled)
- GPB format for large datasets (compressed, chunked I/O)

**Future consideration:** Phase 2+ may add:
- Streaming import (chunked Worker processing)
- Adaptive downsampling based on display DPI and zoom level
- Indexed storage (IndexedDB) for browser persistence of large datasets
- Cloud dataset proxy (Phase 3+)

---

### Parser Performance

**Constraint:** DOM parser (GPX, KML) capped at 100k points; larger datasets route through Worker or GPB.

**Rationale:**
- **Memory spikes:** DOM parsing allocates intermediate objects; limit prevents OOM
- **UI blocking:** Synchronous parsing blocks main thread; Workers provide async alternative
- **Format design:** GPB binary format designed for large datasets (no XML bloat)

**Strategy:**
1. Validate dataset size before parsing
2. If >100k points: route through chunked Worker or suggest GPB format
3. Clear error message guides user to appropriate format

**Future consideration:**
- Streaming XML parser (XMLStream) for Phase 2+ (avoids DOM intermediate objects)
- Format auto-selection logic (suggest GPB for >500k points)

---

## Data Integrity & Audit Trails

### Operation History & Reproducibility

**Decision:** Undo/redo uses dataset snapshots (fast, simple); operation history is separately stored for audit.

**Model:**
- **Interactive undo/redo:** Snapshots; state reverts instantly
- **Validated operation replay:** Sequence of transforms recorded; can be deterministically re-applied to original dataset
- **Project archive:** Embeds both snapshots and operation history (belt-and-suspenders approach)

**Why?**
- **Speed:** Snapshot undo is O(1); replay undo is O(n) for n transforms
- **Safety:** Two independent audit trails catch data inconsistencies
- **Auditability:** Operation history visible in reports; shows "what happened"

**Constraint:** Operation history is currently snapshot-based, not truly deterministic (Phase 1 follow-up).

**Future consideration:** Phase 1 follow-up may add:
- Recipe UI (save/load named transform sequences)
- Deterministic replay verification (re-run operations on original, compare checksum)
- Time-travel UI (jump to any point in history)

---

### Quality Event Detection

**Decision:** Quality events (gaps, duplicates, jumps, elevation spikes) are detected once per dataset and shared across all views.

**Why?**
- **Performance:** Single O(n) pass, not rediscovered per-panel
- **Consistency:** All views show same events (no disagreement)
- **Auditability:** Quality flags are stored with dataset provenance

**Events detected:**
- Timestamp gaps (missing data)
- Duplicate timestamps (likely data error)
- Coordinate jumps (>X meters between points)
- Elevation spikes (>Y meters per sample)
- Elevation flatlines (no variation, potential sensor failure)
- Invalid coordinates (lat/lon out of range)

**Future consideration:** Phase 3+ may add:
- User-configurable thresholds (gap tolerance, jump distance)
- Anomaly detection (ML-based outlier flagging)
- Automatic correction workflows (gap filling, outlier removal)

---

## Electron Desktop vs. Web Browser

### Feature Parity

**Decision:** Same React codebase runs in browser and Electron; shared build output.

**Desktop-only features:**
- Persistent KML/KMZ overlay library (stored on disk)
- `.jddc-project` file save/open (filesystem access via Preload IPC)
- Native packaged installers (NSIS/DMG/AppImage)
- Native file dialogs (faster than `<input type="file">`)

**Browser features:**
- URL-based project sharing (if cloudless Phase 2+)
- No installation required
- Works on any OS with Chromium

**Rationale:**
- **Code reuse:** One codebase, one test suite for both targets
- **Deployment:** Browser is zero-install; Electron adds native installer convenience
- **Security:** Renderer sandboxed in both cases; IPC contract is same

**Future consideration:** Phase 2 may add:
- PWA offline support (Service Workers, IndexedDB)
- Separate native mobile apps (iOS/Android, not web-based)

---

## Dependency Management & Supply Chain

### Zero High/Critical Vulnerabilities (Runtime Only)

**Decision:** Runtime production dependencies audited with zero-tolerance for high/critical findings.

**Dev dependencies:** Tracked but do not block CI (build-time only, not shipped).

**Strategy:**
- Weekly `npm audit` runs in CI
- Immediate patch release for high/critical runtime vulns
- Major version updates on deliberate schedule (quarterly review)
- All GitHub Actions pinned to immutable commit SHA (enforced by `test/release-integrity.ts`)

**Rationale:**
- **User safety:** Runtime deps directly affect shipped app; strict audit justified
- **Build stability:** Dev deps don't reach end-users; can tolerate lower standards
- **Supply chain:** Immutable pins prevent GitHub Actions account compromise

**Future consideration:**
- SBOMs (already implemented) enable downstream vulnerability correlation
- Phase 3+ may add Software Heritage archival for reproducible builds

---

## Testing Strategy & Coverage

### Deterministic Unit Tests (62+ Harnesses)

**Decision:** TypeScript regression harnesses cover analytics, transforms, parsers, and data structures. No mocking; all tests use real data.

**Coverage includes:**
- Parser correctness (GPX, KML, CSV, NMEA, GeoJSON, GPB, EAG TSPI)
- Transform accuracy (smooth, decimate, resample, filters)
- Kinematic derivation (speed, heading, turn rate)
- Quality event detection (gaps, duplicates, jumps)
- Coordinate geometry (ENU transforms, 3D trajectory rendering)
- Project archive round-trip (compression, schema migration)
- Export formats (schema validation against XSD)

**Why no mocks?**
- Real parsing catches format edge cases
- Real transforms catch numerical errors
- Real archives catch compression/recovery issues

**Trade-off:** Tests are slower (~30s full suite) but catch integration bugs early.

**Future consideration:**
- Phase 2 may add visual snapshot tests (e.g., Storybook + Percy)
- Phase 3 may add fuzz testing for parsers and transforms

---

### E2E Workflow Testing

**Decision:** Chromium smoke test covers primary workflow (import → linked views → transform → save → export).

**Coverage:**
- GPX import with multi-channel data
- Linked selection across Table/Chart/Map/3D
- Transform (smooth, resample) with undo/redo
- Project save/open with settings preservation
- HTML report generation
- GPX re-export with schema validation

**Rationale:**
- Catches UI integration issues
- Validates data round-trip fidelity
- Confirms cross-view synchronization

**Not covered yet:**
- Multi-dataset comparison workflows
- Fusion (multi-source combine)
- Mobile/responsive layouts (Phase 2)
- Visual pixel-perfect assertions (Phase 2+)

**Future consideration:** Phase 2+ may add:
- Visual snapshot regression tests
- Accessibility audit (axe-core integration)
- Performance profile capture (Lighthouse)
- Multi-browser coverage (Firefox, Safari)

---

## Security & Compliance

### Data Privacy

**Decision:** No cloud storage, no telemetry, no analytics. All data processing is local.

**Scope:**
- No cookies (except session management, not tracking)
- No web beacons or fingerprinting
- No user account or login (single-user workbench)
- Project archives are encrypted if stored on unencrypted filesystem (user's responsibility)

**Constraint:** OpenStreetMap basemap tiles (map view only) require network access and are subject to OSM tile server privacy policy.

**Future consideration:** Phase 3 may add:
- Optional encrypted cloud sync (user-provided credentials, end-to-end encryption)
- Privacy policy template for organizations deploying JDDC server-side
- Data residency compliance (GDPR, CCPA) for cloud backend

---

### Cryptographic Integrity

**Decision:** Dataset checksums (SHA-256) are stored; archives can be integrity-verified.

**Strategy:**
- Every dataset has SHA-256 hash computed at import
- Project archives embed dataset checksums
- Release artifacts include SHA-256SUMS and Sigstore attestations
- Reproducible builds (when available) enable verification of binary provenance

**Rationale:**
- **Detection:** Corruption is detected if archive or export is tampered with
- **Auditability:** Checksums prove data integrity at specific points in time
- **Compliance:** Some military/aviation contexts require cryptographic proof of data chain-of-custody

**Future consideration:**
- Digital signatures for exported datasets (Phase 3+)
- Hardware security module (HSM) integration for mission-critical deployments

---

## Long-Term Vision (5+ Years)

### Convergence with Data Infrastructure

**Hypothesis:** As JDDC scales beyond single-user, it will converge with traditional data platforms.

**Potential paths:**
1. **Platform as Service (PaaS)** — Hosted JDDC instance with multi-user support, cloud storage, and API
2. **Enterprise Server** — On-premises deployment for large organizations with Kubernetes operators
3. **Data Lake Integration** — Bidirectional sync with S3, Azure Data Lake, or PostGIS for large datasets
4. **Scientific Publishing** — Direct integration with Zenodo, PANGAEA, or other research data repositories

**Strategic questions:**
- Should JDDC remain client-side, or offer server-side deployment?
- If server-side: how does pricing/licensing model work?
- Does collaborative editing demand real-time sync, or eventual consistency?
- Should JDDC integrate with existing GIS/CAD ecosystems (QGIS, ArcGIS, FME)?

**Timeline:** These are Phase 4+ and beyond; current focus is single-user perfection.

---

## Feedback & Discussion

This document is not final. Strategic decisions are informed by:
- User feedback and real-world workflows
- Performance benchmarks and load testing
- Security audits and threat modeling
- Community input (GitHub discussions, issues)

Please raise concerns or suggest alternatives in GitHub issues or pull requests.

---

**Last updated:** 2026-08-14  
**Maintained by:** JDDC Core Team
