Working scratch list. Anything durable belongs in `ROADMAP.md` (planned work and
known limitations) or `CHANGELOG.md` (what shipped).

Open:

Done:
- Repository-wide audit pass: release info popup (About dialog), automated patch
  versioning + CI auto-tag-on-minor/major-bump, CodeQL + Dependency Review workflows,
  stale test-count corrections in README/AGENTS.md.
- HTML Help document: in-app user guide, feature inventory, screenshot capture, info buttons,
  and the accessible-name audit.
- Wire comparison results into the HTML report (part 1: the section is no longer dead code).
- Unit-system preference (metric / knots+feet) for every readout, display-only.
- e2e coverage for the Track Health repair flow.
- Console log is collapsible and collapsed by default.
- Bake Airspace KML into the release executables.
- Launch loading skeleton + code-split every tab but Import, so the window
  never sits blank while the workbench loads (bytes needed before first
  paint down ~63%, 745 KB -> 275 KB).
- 0.7.0 pass: 3D orbit direction and shared frame, README badges, P5 type code and .rpt/.teq
  explanation, user guide inside the desktop app, portable launcher ghost windows, UI audit of
  every tab, 3D gizmo/keyboard/time playback, comparison distributions, PDF report.
