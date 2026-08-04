# Alconite Actions

Production-oriented GitHub Actions for [Alconite Contract Guard](https://alconite.com) and repeatable Java, Node.js, Rust, and Docker CI.

Version 2 makes Contract Guard the public root action. It uploads an OpenAPI candidate, receives the completed deterministic release-gate report, writes a GitHub job summary, exposes bounded outputs, and fails the step when the configured policy threshold is reached.

## Contract Guard quick start

Create a project token from the Contract Guard project screen and store it as the `ALCONITE_CONTRACT_GUARD_TOKEN` repository secret.

```yaml
name: Contract Guard

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  contract:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          persist-credentials: false
      - name: Verify API compatibility
        id: contract-guard
        uses: alconite-inc/alconite-actions@v2.0.0
        with:
          project-id: cgprj_1234567890abcdef
          project-token: ${{ secrets.ALCONITE_CONTRACT_GUARD_TOKEN }}
          candidate-path: openapi.yaml
      - name: Preserve the canonical JSON report
        if: ${{ always() && steps.contract-guard.outputs.report-path != '' }}
        uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6
        with:
          name: contract-guard-report
          path: ${{ steps.contract-guard.outputs.report-path }}
```

For the strongest supply-chain guarantee, replace `v2.0.0` with its full release commit SHA. Exact SemVer references are used in these examples for readability.

Do not expose the project token to code from untrusted forks. GitHub does not provide ordinary Actions secrets to fork pull requests; keep that protection enabled.

## Contract Guard behavior

The action sends `multipart/form-data` to:

```text
POST /api/v1/contract-guard/projects/{project_id}/checks
```

It supplies the candidate as `candidate`, an optional `display_name`, bearer authentication, and an `Idempotency-Key`. When no key is supplied, the action derives a stable key from the repository, workflow run, project, and candidate digest. Transient network failures and HTTP 502/503/504 responses reuse that same key.

The current API completes checks synchronously. A failed policy gate is therefore an HTTP 200 report with `gateResult: failed`, not a transport failure.

### Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `project-id` | Yes | — | Stable `cgprj_` project identifier. |
| `project-token` | Yes | — | Project-scoped `alc_cg_` bearer token. |
| `candidate-path` | No | `openapi.yaml` | OpenAPI 3.0/3.1 JSON, YAML, or YML file, at most 9 MiB. |
| `display-name` | No | GitHub build label | Human-readable release label, at most 160 characters. |
| `api-url` | No | `https://alconite.com` | Alconite Platform API base URL. HTTPS is required except for loopback tests. |
| `idempotency-key` | No | Deterministic | Retry key for one logical release attempt, at most 200 characters. |
| `timeout-seconds` | No | `120` | Per-request timeout, 1–600 seconds. |
| `retry-attempts` | No | `3` | Total network/transient attempts, 1–5. |
| `fail-on` | No | `failed` | `failed`, `warnings`, or `never`. |
| `report-path` | No | Runner temporary directory | Destination for canonical JSON. |

`fail-on: warnings` fails for `passed_with_warnings` and `failed`. Transport, authentication, validation, quota, and service errors always fail regardless of this setting.

### Outputs

The action exposes `check-id`, `project-id`, `status`, `gate-result`, `report-url`, `report-path`, baseline/candidate/upload hashes, `breaking-changes`, `risky-changes`, `policy-failures`, and `policy-warnings`. The full report is written to `report-path` rather than placed in a workflow output.

## Organization-wide stack workflow

Projects that want Alconite's complete CI convention can call the reusable workflow. Java, Node.js, Rust, Docker, and Contract Guard are detected independently, so polyglot repositories are supported.

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  ci:
    uses: alconite-inc/alconite-actions/.github/workflows/stack-ci.yml@v2.0.0
    permissions:
      contents: read
    with:
      contract-guard-project-id: cgprj_1234567890abcdef
      contract-candidate-path: openapi.yaml
    secrets:
      contract-guard-token: ${{ secrets.ALCONITE_CONTRACT_GUARD_TOKEN }}
```

To publish Docker images, set `docker-push: true` and grant the calling job `packages: write`, `id-token: write`, and `attestations: write`. The reusable workflow reduces permissions on build-only jobs and will not publish during a pull request.

## Individual actions

All component actions target Linux GitHub-hosted runners and can be used directly.

### Java

```yaml
- uses: alconite-inc/alconite-actions/java-ci@v2.0.0
  with:
    java-version: "25"
    build-tool: auto
    gradle-tasks: test
    maven-goals: verify
```

Gradle and Maven wrappers are required. Private package credentials are passed as environment-backed Gradle properties or Maven settings placeholders; raw tokens are not persisted by this action.

Publishing is deliberately separate:

```yaml
- uses: alconite-inc/alconite-actions/java-publish@v2.0.0
  with:
    packages-token: ${{ github.token }}
    release-version: 2.0.0
```

Run publishing only in a trusted tag or protected-environment job with `packages: write`.

### Node.js

```yaml
- uses: alconite-inc/alconite-actions/node-ci@v2.0.0
  with:
    node-version: "24"
    package-manager: auto
    script: test
```

The action supports npm, pnpm, and Yarn, requires a committed lockfile, and requires pnpm to be pinned through `packageManager` or `pnpm-version`.

### Rust

```yaml
- uses: alconite-inc/alconite-actions/rust-ci@v2.0.0
  with:
    toolchain: auto
    workspace: "true"
    locked: "true"
```

The Rust action honors `rust-toolchain.toml`, uses the minimal rustup profile, restores a Cargo cache, runs `cargo fmt --check`, denies Clippy warnings, and runs locked tests. Release builds are opt-in with `build-release: "true"`.

### Docker

Pull requests build without logging in:

```yaml
- uses: alconite-inc/alconite-actions/docker-ci@v2.0.0
  with:
    push: "false"
```

Trusted publishing is explicit:

```yaml
- id: image
  uses: alconite-inc/alconite-actions/docker-ci@v2.0.0
  with:
    push: "true"
    registry-password: ${{ github.token }}
    sbom: "true"
    provenance: mode=max
```

The registry password is never passed to the Dockerfile as a build secret. Published builds expose the image digest for signing or GitHub artifact attestation.

### Discord

```yaml
- uses: alconite-inc/alconite-actions/discord-notify@v2.0.0
  if: ${{ always() }}
  with:
    webhook-url: ${{ secrets.DISCORD_WEBHOOK }}
    job-status: ${{ job.status }}
```

The notification action uses Node's built-in HTTP client and disables Discord mentions; it has no third-party action dependency.

## Security model

- External actions are pinned to full commit SHAs.
- Build jobs are read-only; publish credentials belong only in trusted publish jobs.
- Action inputs are transferred through environment variables instead of interpolated into shell source.
- The Contract Guard action refuses redirects and non-HTTPS non-loopback API URLs.
- Project tokens are masked immediately and never included in outputs, summaries, or error bodies.
- The checked-in `dist/` directory contains dependency-free Node 24 JavaScript built from `src/`.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and supported versions.

## Development

```shell
npm ci
npm run verify
```

CI also runs actionlint with ShellCheck integration and exercises Java, Node.js, Rust, and Docker fixtures. See [CONTRIBUTING.md](CONTRIBUTING.md).

## v1 migration

Version 2 is intentionally breaking:

- The root action is Contract Guard.
- `stack-orchestrator` is replaced by `.github/workflows/stack-ci.yml`.
- Node.js defaults to version 24.
- Docker publication requires `push: "true"`; it no longer happens automatically on `main` or tags.
- Java publication has its own credentials and no longer depends on a preceding action mutating runner home directories.
- PR comments/check creation was removed from the build composites; reports are uploaded as artifacts without write permissions.

Existing `v1`, `v1.1`, and `v1.2` references remain frozen for migration purposes.
