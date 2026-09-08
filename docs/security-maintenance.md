# Security maintenance

[Documentation home](../README.md) · [Security policy](../SECURITY.md) · [Release process](versioning.md)

This records the security review for the prepared v2.5.0 release on September 8, 2026. GitHub alerts track the default branch; local fixes do not close those alerts until the changes reach that branch and the relevant analysis runs again. Findings were repaired in source and dependencies rather than dismissed or excluded from scanning.

## Reported repository findings

| Finding | Remediation |
| --- | --- |
| Dependabot alerts 1–4: High-severity `fast-uri` advisories | The lockfile uses `fast-uri` 3.1.7, beyond the advisories' first patched version 3.1.6. The Runtime Verify bundle is regenerated. |
| Code scanning alert 59: vulnerable dependencies | The same dependency update removes the four reported advisories from the dependency graph after merge. |
| Code scanning alerts 18–19: overly broad ranges in the Impact bundle | `ignore` is updated from 7.0.6 to 7.0.8 and Impact is rebuilt; the flagged dependency expression is absent. CodeQL must reanalyze the new bundle. |
| Code scanning alerts 51–58: unpinned reusable-workflow calls | Internal calls use the full component commit recorded in `release-components.json`. Validation checks that the referenced commit has exactly the component code included in this release. |

The new release also updates Swagger Parser to its security release, its pinned reference resolver, esbuild, Node type definitions, Docker Buildx/QEMU, CodeQL SARIF upload, pnpm setup, Rust cache, and the Sentinel runtime image. Third-party Actions and base images retain immutable pins. Dependabot now monitors the Sentinel Dockerfile weekly alongside npm and GitHub Actions updates.

Automatic Dependabot security-update pull requests were enabled in the repository settings during this review. Secret scanning and push protection were already enabled; the API reported no open secret-scanning alerts.

## Runtime Verify fixes

Before any request is constructed, the initial operation target must remain within the configured target origin. Ambiguous authority paths, backslashes, and control characters are rejected. The existing cross-origin redirect restriction remains in place, and encoded ordinary path/query parameters remain supported. Regression tests verify that rejected paths result in no request and no target credential forwarding.

Response validation findings use schema-owned locations rather than response-owned map keys. This prevents dynamic customer identifiers or echoed credentials from becoming finding evidence submitted to Alconite. Response bodies continue to stay on the runner.

## Container scan and remaining upstream finding

The refreshed Sentinel image has no High or Critical Grype findings. One **Medium** finding remains: **CVE-2026-18374 / GLIBC-SA-2026-0015** in `glibc` 2.44-r5. The latest reviewed Wolfi package does not contain the upstream fix yet. The advisory describes a local, high-complexity attack involving an attacker-controlled `fopen` mode string; this application does not configure those mode strings. The dependency remains affected and the finding is retained.

References: [upstream advisory](https://sourceware.org/git/?p=glibc.git;a=blob_plain;f=advisories/GLIBC-SA-2026-0015), [upstream fix](https://sourceware.org/git/?p=glibc.git;a=commit;h=9765a538ebf8661a6e5578e01e35a3dd30db7eb4), and [reviewed Wolfi package recipe](https://github.com/wolfi-dev/os/blob/1d0ee011991cbd50424ee2883030b699018f188d/glibc-2.44.yaml). Update the runtime digest when the vendor ships the fix; no vulnerability ignore rule has been added. The existing release gate fails on High or Critical findings, including unfixed ones.

Image scanning inventories the OS packages and copied Node binary. The bundled JavaScript does not carry npm package manifests, so a separate production-lockfile scan and npm audit cover those dependencies. Do not interpret the image SBOM alone as a complete inventory of bundled npm libraries.

## Keep future updates safe

Run the checks in [Contributing](../CONTRIBUTING.md), including the npm audit and rebuilt distribution comparison. A dependency update is incomplete until the checked-in bundles are regenerated. Build and scan the exact Sentinel image before release; include operating-system and language packages and do not ignore unfixed vulnerabilities to make the gate pass.

After updating any Action component, create the reviewed component commit, update the internal workflow SHA pins and `release-components.json`, then validate the final release commit. Preserve the component commit in history when merging; a squash or rebase that drops it invalidates the ancestry check. See [versioning](versioning.md) for the difference between the component SHA and the final release SHA.

Once these commits are published, confirm Dependabot, CodeQL, and Scorecard results on `main`. The existing GitHub credential must include the `workflow` scope to publish changes to workflow files. Local reports and a clean npm audit do not replace GitHub's post-merge analysis.
