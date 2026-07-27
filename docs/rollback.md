# Release rollback

Published artifacts and Git tags are immutable evidence. Prefer a corrective release over
silently replacing them.

## Stop distribution

1. Mark the affected GitHub release as a draft or prerelease and add a prominent warning naming
   the affected versions, platforms, and impact.
2. Preserve the artifacts, checksum manifest, SBOMs, workflow run, and failing sample needed for
   diagnosis. Do not overwrite assets under the same version.
3. If data loss or a security issue is possible, advise users to stop using the affected workflow
   and preserve their original source files and `.jddc-project` archives.

## Recover

1. Reproduce from the release tag with `npm ci`; verify the downloaded artifact against
   `SHA256SUMS.txt`.
2. Identify the last known-good tag and compare dependency lockfiles, project schema versions,
   Electron configuration, and relevant product changes.
3. Revert or fix on a new commit. Never move an already published tag.
4. Increment the version, run the complete release checklist, and publish new artifacts.
5. Link the replacement release from the affected release and state whether saved projects need
   migration or recovery.

## Project compatibility

Before reverting code across a project schema change, confirm that the older build can read
projects created by the affected version. If it cannot, keep the newer archive untouched and
provide a tested forward fix or explicit recovery procedure; never ask users to edit compressed
project JSON by hand.

## Credentials and signing

If a signing or publishing credential may be compromised, revoke and rotate it before rebuilding.
Record which artifacts were signed with the old identity and publish the new certificate identity
or verification instructions with the replacement release.
