# Alconite Actions

Production-oriented GitHub Actions for [Alconite Contract Guard](https://alconite.com), Alconite Runtime Verify, and repeatable Java, Node.js, Rust, and Docker CI.

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

## Runtime Verify

Runtime Verify is an additive component Action planned for the next minor release. The repository root remains Contract Guard; Runtime Verify is selected explicitly with:

```yaml
uses: alconite-inc/alconite-actions/runtime-verify@v2.1.0
```

The `v2.1.0` reference in this section is the intended release reference and does not claim that the release has already been published.

The Alconite platform never calls the target API. Requests execute inside the customer-controlled GitHub runner. The Action reads the checked-in contract and `.alconite/runtime-verify.yaml`, resolves only explicitly named target secrets from the runner environment, calls the configured target, validates responses locally, and submits a bounded observation/finding envelope. Target origins, expanded request URLs, authorization values, cookies, response bodies, response header values, environment values, local paths, GitHub tokens, and stack traces are not submitted.

The referenced Contract Guard `check-id` identifies the approved candidate. Runtime Verify hashes the exact local contract bytes as `sha256:<hex>` and compares that value with `expectedContractContentHash` returned by Alconite before any target request. A mismatch skips target execution and completes with `runtime.contract.hash-mismatch`; the platform still computes the gate result.

### Runtime Verify setup

1. In Contract Guard, create or select the API project and promote an approved baseline.
2. Create a Runtime Verify environment for the deployed target and record its `rtvenv_` identifier.
3. Create a project token scoped to Runtime Verify initiation, result submission, and failure reporting for that project/environment. Store it as `ALCONITE_RUNTIME_VERIFY_TOKEN`.
4. Store the project and environment identifiers as `ALCONITE_CONTRACT_GUARD_PROJECT_ID` and `ALCONITE_RUNTIME_ENVIRONMENT_ID` repository variables.
5. Store target credentials as repository or environment secrets. Map them to the exact uppercase environment names referenced by the checked-in configuration.

Target credentials are not Action inputs. For example:

```yaml
env:
  STAGING_API_AUTHORIZATION: ${{ secrets.STAGING_API_AUTHORIZATION }}
```

GitHub does not ordinarily provide secrets to workflows triggered from forks. Keep Runtime Verify in a trusted post-deployment job, and do not weaken fork secret protections.

### Configuration

The strict version-one format supports only `version`, `defaults`, and `operations`. Every operation must name exactly one approved OpenAPI `operationId`; only `GET` and `HEAD` are executable.

```yaml
version: 1

defaults:
  timeoutSeconds: 10
  maximumResponseBytes: 1048576
  followRedirects: false

operations:
  - operationId: getPlatformHealth
    expect:
      statuses: [200]

  - operationId: getCustomer
    pathParameters:
      customerId: runtime-test-customer
    queryParameters:
      includeHistory: "false"
    headers:
      Authorization:
        fromEnvironment: STAGING_API_AUTHORIZATION
    expect:
      statuses: [200]
      contentTypes:
        - application/json
      requiredHeaders:
        - X-Request-Id
```

See [examples/runtime-verify.yaml](examples/runtime-verify.yaml) for a complete example. Configuration expectations may narrow documented statuses and media types but cannot expand the approved contract. Header environment names use a strict uppercase identifier; unsafe hop-by-hop and host headers are rejected. Redirects are disabled by default and, when enabled, are limited to three same-origin hops.

OpenAPI 3.0 and 3.1 JSON/YAML are supported. Local in-document `$ref` values are supported. Remote HTTP/HTTPS references, filesystem references, multi-file bundles, unsupported versions, excessive size/depth/schema/operation counts, and unbounded reference chains are rejected. Response schemas are evaluated with the appropriate OpenAPI 3.0 or JSON Schema 2020-12 semantics.

Runtime findings—such as an undocumented status, invalid JSON, schema mismatch, oversized response, timeout, or unreachable target—complete normally and are submitted for platform policy evaluation. Configuration, parser, authentication, platform, and internal runner failures fail the Action regardless of `fail-on`; after initiation, the Action sends only a safe failure code and bounded message. `fail-on: never` suppresses only platform gate failures.

### Inputs and outputs

Required inputs are `project-id`, `project-token`, `environment-id`, `check-id`, and `base-url`. Optional inputs are `contract-path`, `configuration-path`, `display-name`, `deployment-id`, `api-url`, `idempotency-key`, `timeout-seconds`, `retry-attempts`, `fail-on`, and `report-path`. The defaults are documented in [runtime-verify/action.yml](runtime-verify/action.yml).

Outputs are `run-id`, `project-id`, `environment-id`, `check-id`, `status`, `gate-result`, `report-url`, `report-path`, `contract-content-hash`, operation counts, `finding-count`, and `replayed`. Complete findings are never placed in outputs. The platform canonical report is written to `report-path` for artifact upload, and the job summary displays at most 25 escaped findings.

When `idempotency-key` is omitted, the Action derives a bounded `runtime-gh-v1-` key from the workflow run, project/environment/check identifiers, exact contract/configuration hashes, and deployment identifier. Only network failures and HTTP 502/503/504 responses are retried, with the same key. A replayed completed run skips target execution.

### Complete deploy-and-verify workflow

```yaml
name: Deploy and verify

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-24.04
    outputs:
      contract-check-id: ${{ steps.contract.outputs.check-id }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - name: Verify contract compatibility
        id: contract
        uses: alconite-inc/alconite-actions@v2.1.0
        with:
          project-id: ${{ vars.ALCONITE_CONTRACT_GUARD_PROJECT_ID }}
          project-token: ${{ secrets.ALCONITE_CONTRACT_GUARD_TOKEN }}
          candidate-path: openapi/openapi.yaml

      - name: Deploy staging
        run: ./deployment/deploy-staging.sh

      - name: Verify staging implementation
        id: runtime
        uses: alconite-inc/alconite-actions/runtime-verify@v2.1.0
        env:
          STAGING_API_AUTHORIZATION: ${{ secrets.STAGING_API_AUTHORIZATION }}
        with:
          project-id: ${{ vars.ALCONITE_CONTRACT_GUARD_PROJECT_ID }}
          project-token: ${{ secrets.ALCONITE_RUNTIME_VERIFY_TOKEN }}
          environment-id: ${{ vars.ALCONITE_RUNTIME_ENVIRONMENT_ID }}
          check-id: ${{ steps.contract.outputs.check-id }}
          base-url: https://staging.example.com
          contract-path: openapi/openapi.yaml
          configuration-path: .alconite/runtime-verify.yaml

      - name: Preserve Runtime Verify report
        if: ${{ always() && steps.runtime.outputs.report-path != '' }}
        uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6
        with:
          name: runtime-verify-report
          path: ${{ steps.runtime.outputs.report-path }}
```

The reusable [Runtime Verify workflow](.github/workflows/runtime-verify.yml) is suitable for public/unauthenticated target operations and exposes the run ID, gate result, and report URL. It intentionally accepts only the Alconite project token and no arbitrary target-secret map. Because a caller cannot attach arbitrary job-level environment variables to a reusable-workflow job, authenticated target checks should use the component Action directly as shown above, where each configured target secret is mapped explicitly with `env:`.

```yaml
jobs:
  runtime:
    uses: alconite-inc/alconite-actions/.github/workflows/runtime-verify.yml@v2.1.0
    with:
      project-id: ${{ vars.ALCONITE_CONTRACT_GUARD_PROJECT_ID }}
      environment-id: ${{ vars.ALCONITE_RUNTIME_ENVIRONMENT_ID }}
      check-id: ${{ needs.contract.outputs.check-id }}
      base-url: https://staging.example.com
      contract-path: openapi/openapi.yaml
      configuration-path: .alconite/runtime-verify.yaml
    secrets:
      project-token: ${{ secrets.ALCONITE_RUNTIME_VERIFY_TOKEN }}
```

The runner uses `POST /api/v1/runtime-verify/projects/{project_id}/runs`, `/runs/{run_id}/results`, and `/runs/{run_id}/failure`. The submitted result schema is `alconite.runtime-verify.runner-result.v1`; Alconite, not the Action, determines the final gate result.

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
