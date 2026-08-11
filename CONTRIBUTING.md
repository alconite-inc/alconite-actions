# Contributing

Thank you for helping improve Alconite Actions.

## Local validation

Install Node.js 24 and run:

```shell
npm ci
npm run verify
```

Install actionlint 1.7.7 and run `actionlint` from the repository root to validate workflows and embedded shell scripts.

## Pull requests

- Keep changes focused and explain any input, output, permission, or security-boundary change.
- Add or update unit and fixture tests.
- Rebuild and commit `dist/`, `runtime-verify/dist/`, and `impact/dist/` whenever their source, TypeScript configuration, release identity, or build dependencies change.
- Keep Runtime Verify target and platform tests local: target secrets and response bodies must never appear in fixture uploads, outputs, summaries, or error snapshots.
- Pin new external actions to a full verified commit SHA with a release-version comment.
- Never add a credential to a build step that executes pull request-controlled code.
- Update `CHANGELOG.md` for user-visible changes.

Changes to public inputs, outputs, defaults, gate behavior, or supported runtimes require a SemVer compatibility assessment.

Runtime Verify protocol changes also require updated mock platform fixtures and alignment with the authoritative Platform API contract before release. Run `npm run validate:dependencies` after changing bundled dependencies; runtime libraries must remain pinned, license-reviewed, and free of known high-severity advisories.

Release preparation must also pass `npm run validate:release`. That check keeps the package, component identities, examples, self-references, immutable third-party pins, and three distribution attestation subjects synchronized with the release tag.
