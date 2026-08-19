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
- A reviewed Electron Fuse V1 policy and a shared, tested six-operation IPC security contract.

### Changed

- Project archives now preserve validated operation history and multi-source display settings.
- Project names persist through restore, and dirty workspaces warn before replacement or unload.
- Windows packaging signs installers when `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` are present;
  when they are absent, CI intentionally builds and verifies unsigned artifacts.
- GitHub Actions and the scanner container now use immutable revisions, and
  `electron-builder` is exact-pinned.
- Documentation now distinguishes locally proven gates from native-runner and credential
  requirements.

### Fixed

- GPX and KML parsers now reject malformed XML roots with intentional parser errors instead of
  dereferencing a missing document element.
- Linked selection now survives index-stable transforms and clears only when an operation
  reorders or removes points.
- Restored project identity is retained in report names and exported filenames.

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
