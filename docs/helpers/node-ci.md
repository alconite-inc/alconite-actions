# Node CI

`alconite-inc/alconite-actions/node-ci@v2.5.0` installs dependencies from a committed lockfile and runs one npm, pnpm, or Yarn package script. It also caches package-manager downloads and can upload existing JUnit XML files. Source: [node-ci/action.yaml](../../node-ci/action.yaml).

## Requirements and permissions

Check out source and use a Linux runner with Bash and `node` already available: package-manager detection uses Node before setup-node installs `node-version`. Yarn also requires `corepack` on `PATH` before this helper runs. The helper activates the requested Yarn release, but does not install Corepack itself. A current GitHub-hosted runner is the intended environment; provision those prerequisites explicitly on a self-hosted runner.

The project directory must contain `package.json` and the selected manager's lockfile. npm needs `package-lock.json` or `npm-shrinkwrap.json`; pnpm needs `pnpm-lock.yaml`; Yarn needs `yarn.lock`. Commit the lockfile and keep it consistent with `package.json`.

Use `contents: read` for checkout. Private GitHub Packages installation additionally requires a token with read access and, for `github.token`, `packages: read` plus package access for the caller repository. The default registry is GitHub Packages; for an ordinary npm registry project set `registry-url: https://registry.npmjs.org`. Project `.npmrc` / `.yarnrc.yml` configuration can affect registry routing and authentication. See [shared setup](README.md).

## Inputs

All inputs are optional.

| Input | Default | Meaning |
| --- | --- | --- |
| `node-version` | `24` | Node version installed by setup-node. |
| `package-manager` | `auto` | `auto`, `npm`, `pnpm`, or `yarn`. |
| `working-directory` | `.` | Workspace-relative directory containing `package.json` and the lockfile. |
| `pnpm-version` | empty | Explicit pnpm release; otherwise `package.json` must declare `packageManager: pnpm@...`. |
| `yarn-version` | empty | Explicit Yarn release; otherwise `package.json` must declare `packageManager: yarn@...`. |
| `script` | `test` | One package script name. Empty installs dependencies without running a script. |
| `cache-dependency-path` | empty | Override the cache key's dependency path(s); defaults to the detected lockfile under `working-directory`. |
| `registry-url` | `https://npm.pkg.github.com` | Registry configuration supplied to setup-node. |
| `registry-scope` | empty | Optional scope, such as `@alconite-inc`, supplied to setup-node. |
| `packages-token` | empty | Token exposed as `NODE_AUTH_TOKEN` for dependency installation and script execution. |
| `upload-reports` | `true` | Attempt JUnit XML upload, including after test failure. |
| `junit-files` | `**/junit*.xml` | Workspace-relative report paths/globs; not rebased to `working-directory`. |
| `artifact-name` | `node-test-reports` | Report artifact name; use unique names for matrix jobs. |

## Detection and execution

Auto selection prefers pnpm when `pnpm-lock.yaml` exists or the package's `packageManager` begins with `pnpm@`. Otherwise it selects Yarn when `yarn.lock` exists or `packageManager` begins with `yarn@`; otherwise it selects npm. Avoid conflicting lockfiles and manager declarations. An explicit `package-manager` chooses the install command, but the selected manager still needs its lockfile.

For pnpm projects in a subdirectory, supply `pnpm-version` explicitly. The helper reads the selected directory for detection, while its upstream pnpm setup step uses the repository-root package file when choosing a version from `packageManager`. An explicit version avoids that mismatch; keep it consistent with the project's declaration.

Yarn uses `corepack enable` followed by `corepack prepare yarn@<version> --activate` (or the full `packageManager` value). npm uses the version bundled with the selected Node installation. Installation commands are:

| Manager | Installation | Script |
| --- | --- | --- |
| npm | `npm ci` | `npm run <script>` |
| pnpm | `pnpm install --frozen-lockfile` | `pnpm run <script>` |
| Yarn 1 | `yarn install --frozen-lockfile` | `yarn run <script>` |
| Yarn 2+ | `yarn install --immutable` | `yarn run <script>` |

The script input accepts letters, digits, `_`, `.`, `:`, `@`, `/`, and `-`. It is a package script name, not a shell command; use a project script to combine lint/build/test tasks. Both installation lifecycle scripts and the selected script execute project/dependency code with `NODE_AUTH_TOKEN` available when supplied.

setup-node caches package-manager data using the selected lockfile or explicit `cache-dependency-path`; the helper still runs the locked installation every time. A custom cache path does not remove the requirement for the package manager's own lockfile. Modern Yarn projects may need `.yarnrc.yml` registry/auth settings that reference the provided environment variable.

JUnit files must be produced by your test framework. Matching reports retain for 14 days, subject to GitHub policy; no matches are ignored. A report upload does not suppress a failed script. Disable uploads with `upload-reports: "false"` if your environment does not support the pinned uploader.

| Output | Meaning |
| --- | --- |
| `package-manager` | Selected `npm`, `pnpm`, or `yarn`; access as `${{ steps.node.outputs.package-manager }}` with `id: node`. |

## Example: npm test workflow

```yaml
name: Node CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - id: node
        uses: alconite-inc/alconite-actions/node-ci@v2.5.0
        with:
          registry-url: https://registry.npmjs.org
          script: test
```

For a pnpm application in `apps/web`, replace the helper inputs with:

```yaml
with:
  working-directory: apps/web
  package-manager: pnpm
  pnpm-version: "10.1.0" # Use the same version as this project's packageManager field.
  registry-url: https://registry.npmjs.org
  script: ci
  artifact-name: web-test-reports
  junit-files: apps/web/reports/junit.xml
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| A committed lockfile is required | Commit the correct lockfile in `working-directory`; cache overrides do not replace it. |
| Pin pnpm/Yarn error | Declare a versioned `packageManager` or supply the matching version input. |
| Corepack not found | Provision Corepack before invoking the helper for Yarn. |
| pnpm cannot locate package.json | For a subdirectory package, set `pnpm-version` explicitly and align it with `packageManager`. |
| Script rejected or missing | Pass an existing script name, not `npm test`, shell operators, or CLI arguments. Use `script: ""` for install-only. |
| Installation fails because of lockfile drift | Regenerate with the pinned manager locally and commit the resulting lockfile. |
| Registry 401/403/404 | Check `registry-url`, scope routing, package access, token permissions, and manager-specific auth configuration. |
