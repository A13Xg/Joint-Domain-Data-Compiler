# Future considerations

Known open items that are not regressions and not currently scheduled — recorded here so they aren't lost after the project's roadmap and planning documents were retired.

1. **One pre-existing, unrelated e2e failure.** `browser build discloses the desktop-only persistent KML/KMZ overlay capability` in `test/e2e/workbench-smoke.spec.ts` fails identically on unmodified history (confirmed via `git stash` against baseline). Never diagnosed.
2. **`ExportPanel`'s GPX preview still runs synchronously on every render**, regardless of dataset size. Only the actual download/export action was routed through the chunked Worker (`src/core/compute/gpxExport.ts`); the live preview in the export panel was deliberately left on the synchronous path as a separate, smaller hotspot.
3. **Fusion report in exported HTML only shows the latest fusion run**, not a multi-run aggregate, since `buildFusionSection`/`FusionReport` is single-report-shaped. Documented as a known limitation where it was introduced.
4. **No React/DOM component-test harness exists in this repo.** Several UI-only fixes (scoped de-jitter policy disabling, drift-message rendering, `MapOverlayPanel` confirmation dialogs) have no automated coverage beyond what E2E/manual verification could reach. This is a structural gap, not specific to any one fix.
5. Everything previously tracked in `docs/IMPLEMENTATION_ROADMAP.md`'s per-stage "Remaining" sections (multi-pane charts, deck.gl/Arrow evaluation, macOS signing, etc.) was pre-existing, intentionally-deferred backlog per that document's own scope decisions — not something flagged as broken. That document has been retired; revisit this list if that work resumes.
