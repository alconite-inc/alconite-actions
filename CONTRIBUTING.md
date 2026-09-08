# Contributing

Thank you for helping improve Alconite Actions.

## Local validation

Install Node.js 24 and run:

```shell
npm ci
npm run verify
```

Install actionlint 1.7.7 and run `actionlint` from the repository root to validate workflows and embedded shell scripts.

Container changes must also run `npm run validate:sentinel-container`, build the exact `linux/amd64` Dockerfile, and run `node scripts/test-sentinel-container.mjs <local-image>`. CI owns SPDX SBOM generation and the fail-closed High/Critical scan so source-only development does not require Docker or a scanner.

## Pull requests

- Keep changes focused and explain any input, output, permission, or security-boundary change.
- Add or update unit and fixture tests.
- Rebuild and commit `dist/`, `runtime-verify/dist/`, `impact/dist/`, and `sentinel-executor/dist/` whenever their source, TypeScript configuration, release identity, or build dependencies change.
- Keep Runtime Verify target and platform tests local: target secrets and response bodies must never appear in fixture uploads, outputs, summaries, or error snapshots.
- Pin new external actions to a full verified commit SHA with a release-version comment.
- Never add a credential to a build step that executes pull request-controlled code.
- Update `CHANGELOG.md` for user-visible changes.

Changes to public inputs, outputs, defaults, gate behavior, or supported runtimes require a SemVer compatibility assessment.

Runtime Verify protocol changes also require updated mock platform fixtures and alignment with the authoritative Platform API contract before release. Run `npm run validate:dependencies` after changing bundled dependencies; runtime libraries must remain pinned, license-reviewed, and free of known high-severity advisories.

Release preparation must also pass `npm run validate:release`. That check keeps the package, component identities, examples, self-references, immutable third-party pins, and distribution attestation subjects synchronized with the release tag. Registry login, GHCR publication, and protected Docker Hub promotion are release operations and must never be added to pull-request execution.

See [Versions and SHA pins](docs/versioning.md) for the release sequence. The release workflow generates `release-pins.md` and `release-pins.json` from the actual tag target and publishes both as release assets. Keep the entry-point catalog in `scripts/generate-release-pins.mjs` synchronized when adding an Action or reusable workflow. Maintainer release attestations do not impose attestation permissions on consumer workflows.
