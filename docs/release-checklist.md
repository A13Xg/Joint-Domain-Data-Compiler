# Release checklist

JDDC uses semantic versions without a leading `v` in `package.json` and matching `vX.Y.Z` Git
tags. Tags publish stable releases; prereleases use a semver prerelease suffix such as
`0.2.0-rc.1` and must be explicitly marked as prereleases in GitHub until the release workflow
automates that distinction.

## Prepare

1. Confirm the intended version and user-visible scope. Update `package.json`,
   `package-lock.json`, `README.md`, and the roadmap together.
2. Start from a clean checkout of the exact commit to be tagged.
3. Install with `npm ci`; do not reuse a locally drifted dependency tree.
4. Run:

   ```bash
   npm run check:all
   npm audit --omit=dev --audit-level=high
   npm run bench
   ```

5. Review benchmark deltas against `docs/performance-baseline.md`. Investigate material
   regressions rather than silently replacing the baseline.
6. Run the applicable desktop package commands and native packaged-renderer smoke gate. The
   release matrix automates this on Linux, Windows, and macOS; manually repeat the primary
   workflow on each platform for release-candidate UX acceptance.
7. Configure `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` to sign Windows artifacts, or leave both
   absent for an explicitly unsigned fallback build. CI verifies `Valid` signatures when the
   certificate is configured and `NotSigned` otherwise; unsigned builds must never be described
   as signed.

## Publish

1. Push the release commit and wait for the Quality Gates workflow to pass.
2. Create and push the exact matching tag, for example `v0.2.0`.
3. Wait for all Linux, Windows, and macOS package jobs to pass. A skipped or unavailable platform
   is not a complete stable release.
4. Verify the release contains the expected installer/archive for each platform, platform SBOMs,
   `SHA256SUMS-Windows.txt`, and the complete `SHA256SUMS.txt`.
5. Download the release bundle into a new directory and run:

   ```bash
   sha256sum --check SHA256SUMS.txt
   ```

6. Verify GitHub build provenance for at least one downloaded package:

   ```bash
   gh attestation verify '<package-file>' --repo A13Xg/Joint-Domain-Data-Compiler
   ```

7. Review generated notes for correctness, known limitations, signing status, project-schema
   compatibility, and security-relevant changes before announcing the release.

## Current constraints and manual gates

Native packaged launch tests are defined for Linux, Windows, and macOS. The following local
Windows evidence was refreshed on 2026-07-28:

- `npm run build:desktop:win` produced one NSIS installer and one portable x64 executable.
- `npm run check:desktop:win` confirmed the packaged renderer mounted the JDDC workbench, not
  merely a native window.
- A local `npm sbom --sbom-format=cyclonedx` Windows SBOM was generated and validated as a
  CycloneDX document.
- Browser E2E verifies the browser build explicitly discloses that persistent KML/KMZ library
  storage and map overlays are desktop-only; Electron IPC and overlay-state harnesses cover the
  corresponding desktop contract.

These results do **not** constitute a complete release bundle: Linux/macOS artifacts, their SBOMs,
the aggregate `SHA256SUMS.txt`, and GitHub provenance attestation can only be verified after the
matrix workflow runs. That workflow is currently blocked by the repository payment/spending-limit
state. macOS signing/notarization also remains manual and requires owner-provided credentials.
Windows signing is opportunistic: repository credentials are used when available, while their
absence produces a verified unsigned build. Tagged releases receive GitHub/Sigstore
build-provenance attestations. Record every manual result or omission in the release notes, and
never convert an omitted or runner-blocked gate into a pass.
