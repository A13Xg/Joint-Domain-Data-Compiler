# Changelog

Notable user-facing and operational changes are recorded here. This project follows Semantic
Versioning; release tags use the `vX.Y.Z` form.

## Unreleased

### Added

- A self-contained, print-ready HTML analysis report with dataset statistics, reference and
  source metadata, quality evidence, warnings, bookmarks, and operation history.
- A light, low-ink VectorPunk/HUD report design with responsive and print-specific layouts.
- Browser and Electron diagnostic-bundle export with strict schema and size validation.
- Chromium end-to-end coverage of the primary import, linked-inspection, transform,
  project-round-trip, report, diagnostic, and export workflow.
- Deterministic bounded property/fuzz coverage for transforms, GeoJSON, text parsers, and
  project-archive corruption.
- Native packaged-application smoke definitions for Linux, Windows, and macOS.
- Release artifact manifest verification, CycloneDX SBOMs, and GitHub/Sigstore provenance
  attestations.
- A reviewed Electron Fuse V1 policy and a shared, tested nine-operation IPC security contract.
- Desktop builds now keep a bounded, oldest-pruned local safety-net copy of every imported and
  exported file in a dedicated archive folder (independent of wherever the OS puts downloads),
  reachable from the Project tab's "Open archive folder" button.
- The release workflow's build-verification job now runs the full lint/unit-test suite and the
  Chromium end-to-end smoke tests before packaging installers, closing a gap where a tag push
  could publish a release without either gate passing.
- A Track Health Scan that grades a loaded track against six pass/fail checks and lets the
  operator drill into each failure, with the offending samples highlighted on the map and the
  time-series chart.
- A "Drop outliers" repair that removes points breaking their local trend in position,
  elevation, or ground speed, scored by the same robust MAD detector the Track Health scan
  grades against. Channels can be selected individually.
- A "Round precision" repair that reduces stored decimal places for coordinates, elevation,
  and numeric channels through the same formatter the exporters use.
- "Clip to time window" is now reachable from the Transform tab; it defaults to the selected
  time range and was previously implemented but had no UI.
- A "Restore original" action in the Transform tab that discards every applied operation and
  returns to the original import. The restore is itself undoable.
- A Track Metrics panel in the Overview tab: elapsed time and span, high/low speed and altitude,
  point accounting (valid, invalid, timed, elevated, duplicate, and per-provenance-flag counts),
  and the format-specific metadata parsers capture. `metadata.meta` — GPX creator, EAG platform,
  exercise and mission ids, GPB track name — was parsed and stored but had no consumer until now.
- A spatial density overlay on the map, toggled from the map controls with an adjustable cell
  size. Binning is equal-area (longitude scaled by cos(lat)) and antimeridian-safe.
- A collapsible log dock, collapsed by default to a single line showing the newest entry, so the
  220px dock no longer competes with the workspace for height.
- Typed, stackable, dismissible toast notifications with severity colouring, replacing the
  single-slot toast that discarded a message whenever a second one arrived.
- A header status light reporting idle / working / ready / warnings / errors from live log
  tallies; a finished run that logged errors previously looked identical to a clean one.
- Destructive actions now open a dialog that names the consequence and shows before/after
  counts, replacing `window.confirm`.
- Skeleton placeholders during the Track Health scan's first run.
- Entrance, hover, and status animations throughout, all disabled under `prefers-reduced-motion`.
- Track Health's outlier check now offers a "Drop flagged points" action that runs the
  drop-outliers operation at the scan's own thresholds. The scan could previously only point at
  bad samples; there was no remediation affordance anywhere in the app.
- A "Fill gaps" repair that bridges dropouts with Fritsch–Carlson monotone cubic interpolation
  fitted through the real points on either side. A gap whose fill would imply motion outside the
  selected motion profile (aircraft, ground vehicle, marine, or unconstrained) is skipped and
  reported rather than invented, and every inserted point is flagged `interpolated`.

- A **Points** tab: a point visualizer that shows one sample in its own neighbourhood rather
  than as another table row. A quality strip spans the whole track and jumps to any sample; an
  equal-aspect local plan view and elevation profile show whether the sample sits on the line
  its neighbours describe; the legs either side report their interval, geodesic distance,
  implied speed, elevation change, and bearing; and the full field list covers provenance,
  quality flags, overlapping quality events, and every channel. Selection is the shared store,
  so stepping through samples here moves the map, charts, table, and 3D scene with it.
- A graphical **Accept / Revert gate** in front of every repair that changes the track. The
  original and the proposed repair are drawn on one frame — plan view, profile, or both,
  whichever the change makes sense in — with the samples the repair added, removed, moved, or
  retimed marked, alongside the operation's own summary, warnings, and point counts. Nothing is
  applied until Accept: Escape, clicking away, and closing the gate all revert, so making no
  choice leaves the track untouched. Reachable from every Transform card, the worker-backed
  fixed-rate resample, and the Track Health scan's "Drop flagged points". Whether a repair has
  a graphical view is computed from the before/after diff rather than a list of operation ids,
  so a derivation that only writes computed channels applies without raising a gate. A "preview
  repairs" toggle in the Transform toolbar turns the gate off for batch work.

### Removed

- The `file-test/actual/` corpus of real range recordings, ahead of this repository being
  made public. `test/eag-geographic.ts` no longer checks that ≥95% of real points land in a
  bounding box; it now checks that the ECEF→geodetic conversion recovers known WGS-84
  waypoints to within 3e-5 degrees and 2 m, against reference values computed outside
  `src/core/geodesy.ts`. Both filename date encodings the EAG parser supports stay covered.

### Changed

- Test fixtures moved from `file-test/` to `test/fixtures/`, with one shared definition of
  the fixture root in `test/helpers/fixtures.ts`. Three unreferenced fixtures were dropped,
  one of them a byte-for-byte duplicate, along with a midnight-crossing assertion that
  accepted both of its own outcomes.
- Bundled map overlays now ship with the build and load themselves. The browser build serves
  `KML-KMZ/` at `kml-library/` (dev server and build output alike) and the packaged Linux app
  carries the same files in `resources/kml-seed`, so `Special_Use_Airspace.kml` appears on the
  map on first run instead of waiting for a manual "Show on map". Loading happens after first
  paint. Windows installers are unchanged — they stay lean and still resolve the overlay
  remotely — and the web build's overlay copy is excluded from every installer.
- The selection badge is now two controls, not one. Clicking the badge takes you to the samples
  it names — the map fits them, the chart zooms to them, the table scrolls to the row, and the
  3D scene pans to centre them without disturbing the orbit you set up. Only the × discards the
  selection, so the destructive action is no longer under the whole target and there is finally
  a way to ask "where is that point?".
- The Speed Envelope health check now ignores the first 20% of a file. Recordings routinely
  start with the aircraft parked and powered up, which sits below the 10 kt floor as normal
  operation; a brief speed burst at the head (engine start, GPS noise while stationary) could
  open the movement window across the whole parked stretch and spend the check's violation
  budget on it. The skip applies to this check only, is reported in the check's detail when it
  changed what was scored, and removes nothing from the dataset.
- A destructive repair now raises one gate instead of two: the graphical preview carries the
  counts, summary, and warnings the confirmation dialog used to show. The confirmation dialog
  still stands when the preview is switched off.
- `computeStats` now reports a minimum speed alongside the existing max and mean, computed in
  the same single pass rather than recomputed in the UI.
- The Transform tab is now grouped into five labelled sections (validity & structure, outliers
  & smoothing, density & precision, resampling, derive) instead of one flat grid of cards.
- Dedupe, decimate, and simplify are merged into one "Reduce points" card with a mode selector;
  the three elevation filters are merged into one "Elevation filter" card the same way. All six
  underlying algorithms are unchanged — only the card and operation surface is collapsed.
- "Remove elevation outliers" is removed, superseded by the multi-channel "Drop outliers".
- Decimation now always keeps the final point. Dropping it shortened the track's stated time and
  distance extent by up to `factor - 1` samples.
- Project archives now preserve validated operation history and multi-source display settings.
- Project names persist through restore, and dirty workspaces warn before replacement or unload.
- Windows packaging signs installers when `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` are present;
  when they are absent, CI intentionally builds and verifies unsigned artifacts.
- GitHub Actions and the scanner container now use immutable revisions, and
  `electron-builder` is exact-pinned.
- Documentation now distinguishes locally proven gates from native-runner and credential
  requirements.

### Fixed

- The decimate summary now reads "every 2nd point" rather than "every 2th point". The wording
  was cosmetic while it only reached the log; the repair preview puts it at the top of a
  dialog.
- The saved-tab list used on project restore had drifted from the real tab list and was missing
  Sources and Fusion, so a project saved on either tab silently reopened on Overview. Both lists
  now read from one definition.
- The original import is no longer discarded after 50 operations. History pruning used
  `slice(-limit)`, which rotated the original out of index 0 — the snapshot that backs
  "Replay verified history", the project archive checkpoint, and the new "Restore original".
  Pruning now takes from index 1 and pins index 0.
- Every transform in the Transform tab is now a registered, replayable operation. Thirteen of
  the seventeen bypassed the operation registry, so applying any one of them recorded a
  synthesized history entry that showed as "not replayable" and disabled named-recipe saving
  for the rest of the session. Fixed-rate resampling records a real operation too, even though
  it executes in a compute worker.
- "Selected range only" now reaches the operation as a recorded scope instead of being applied
  in the panel, so a range-scoped transform replays as what it was.
- No migration is needed for the merged and removed transforms: every one of them was
  unregistered, so its existing history records were already non-replayable fallbacks.
- The Transform tab clipped roughly 1500px of its cards with no scroll path: the panel had
  `overflow: hidden` and shrank as a flex item, leaving `.tab-content` seeing nothing to scroll.
  Tab panels now size to their content and `.tab-content` scrolls. The same bug hid the log
  stream (which also made its autoscroll a no-op) and truncated the Export tab's preview.
- Deduplication of six identical private copies of `clonePoint`, two copies of the longitude
  seam helpers, and two implementations of the bearing/shortest-angle math.
- The density overlay stranded a Leaflet canvas renderer on the map every time it was toggled.
- GPX and KML no longer drop unparseable points silently. Both skipped coordinates that would
  not parse without recording the fact anywhere, so a malformed file was indistinguishable from
  a short one. Parsers now report structured `droppedCounts` alongside a warning, and the Track
  Metrics panel shows what the source originally offered versus what was imported.
- GPX and KML parsers now reject malformed XML roots with intentional parser errors instead of
  dereferencing a missing document element.
- Linked selection now survives index-stable transforms and clears only when an operation
  reorders or removes points.
- Restored project identity is retained in report names and exported filenames.
- Project manifests, HTML reports, and diagnostic bundles now report the actual package version
  (previously hand-typed as a stale `0.1.0` in three places in `ProjectPanel.tsx`).
- Removed three stray files (an empty `npm`, an empty `joint-domain-data-compiler@0.1.0`, and a
  transient `.jddc-driver-state.json` runtime-state file) that had been accidentally committed.
- Windows packaging now clears `release/` before packing. Building over a previous run's output
  let `electron-builder` reuse a stale `app.asar` whose hash no longer matched the header the
  fuses hook embeds, so the packaged app aborted at launch on an integrity violation.

### Security

- Runtime production dependencies audit with zero high or critical findings.
- Electron IPC payloads, navigation, saved files, and packaged paths are covered by focused
  allow-list, traversal, type, and byte-limit tests.
- `@electron/asar` (`^4.3.0`) and `@electron/get` (`^5.1.0`) are pinned via `package.json`
  `overrides`, removing the deprecated `boolean`/`global-agent`/`roarr` chain and moving asar
  packing off `glob@7`/`inflight`.
- `rimraf@2.6.3`, `glob@7.2.3`, and `inflight@1.0.6` remain, reachable only through `temp` via
  `electron-winstaller`/`electron-builder-squirrel-windows` — a required peer of `app-builder-lib`
  loaded solely for the Squirrel.Windows target, which this project does not build. No newer
  `temp` exists, and `temp` calls `rimraf` with the legacy callback API that `rimraf@4+` dropped,
  so overriding it would break Squirrel support rather than fix a live code path. `npm audit`
  remains at zero vulnerabilities.

## 0.1.0

- Initial local-first trajectory and TSPI workbench baseline.
