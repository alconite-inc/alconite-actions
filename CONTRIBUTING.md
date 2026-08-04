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
- Rebuild `dist/` and commit it whenever `src/` changes.
- Pin new external actions to a full verified commit SHA with a release-version comment.
- Never add a credential to a build step that executes pull request-controlled code.
- Update `CHANGELOG.md` for user-visible changes.

Changes to public inputs, outputs, defaults, gate behavior, or supported runtimes require a SemVer compatibility assessment.
