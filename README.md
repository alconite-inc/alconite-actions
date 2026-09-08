# Alconite Actions

Production-oriented GitHub Actions for [Alconite Contract Guard](https://alconite.com), Alconite Impact, Alconite Runtime Verify, and repeatable Java, Node.js, Rust, and Docker CI.

Version 2 makes Contract Guard the public root action. It uploads an OpenAPI candidate, receives the completed deterministic release-gate report, writes a GitHub job summary, exposes bounded outputs, and fails the step when the configured policy threshold is reached.

The recommended lifecycle treats the Actions as one release-safety product while preserving their modular boundaries:

```text
                     ┌─────────────────┐
Pull Request ───────▶│ Contract Guard  │
                     └────────┬────────┘
                              │ check lineage
                              ▼
                     ┌─────────────────┐
                     │     Impact      │
                     └─────────────────┘

                              │
                           Merge
                              │
                              ▼

                     ┌─────────────────┐
Deployment ─────────▶│ Runtime Verify  │
                     └────────┬────────┘
                              │
                              ▼
                    Automatically resolves
                    approved contract baseline
```

In a pull request, Alconite checks whether the proposed contract is safe and maps its impact. After deployment, Alconite verifies production against the exact contract that Contract Guard approved. Normal deployment workflows do not copy or retain internal `cgchk_` identifiers.

## Start here

Choose the smallest integration that matches your repository. These docs prepare **v2.5.0**, shared by all nine Actions and both reusable workflows; publish the release before adopting its examples. See [versioning and verified SHA pins](docs/versioning.md) for release availability, the exact commit, and the difference between Action commit pins and container digests.

- [Getting started](docs/getting-started.md): prerequisites, a complete first workflow, credentials, permissions, and trusted events.
- [Helper catalog](docs/helpers/README.md): complete input/output references and examples for every build, publishing, and notification helper.
- [Stack CI reference](docs/stack-ci.md): automatic detection, every input and secret, publishing, and limitations.
- [Troubleshooting](docs/troubleshooting.md): failed gates, missing credentials, build errors, reports, and enterprise environments.
- [Security maintenance](docs/security-maintenance.md): alert remediations, dependency updates, and remaining upstream findings.
- [Support](SUPPORT.md), [security](SECURITY.md), [changelog](CHANGELOG.md), and [contributing](CONTRIBUTING.md).

| Entry point | Purpose | Reference |
| --- | --- | --- |
| `alconite-inc/alconite-actions` | Compare an OpenAPI candidate with its approved baseline and enforce the Contract Guard gate. | [Contract Guard](#contract-guard-quick-start) |
| `alconite-inc/alconite-actions/impact` | Map a completed contract check to evidence in the checked-out source. | [Impact](#alconite-impact) |
| `alconite-inc/alconite-actions/runtime-verify` | Verify explicitly configured operations against a deployed API. | [Runtime Verify](#runtime-verify) |
| `alconite-inc/alconite-actions/java-ci` | Test a Gradle or Maven project using its wrapper. | [Java CI reference](docs/helpers/java-ci.md) |
| `alconite-inc/alconite-actions/java-publish` | Publish a versioned Java package in a trusted job. | [Java publishing reference](docs/helpers/java-publish.md) |
| `alconite-inc/alconite-actions/node-ci` | Install from a lockfile and run an npm, pnpm, or Yarn package script. | [Node.js reference](docs/helpers/node-ci.md) |
| `alconite-inc/alconite-actions/rust-ci` | Format, lint, test, and optionally build a Cargo project. | [Rust reference](docs/helpers/rust-ci.md) |
| `alconite-inc/alconite-actions/docker-ci` | Build, load, or explicitly publish an OCI image. | [Docker reference](docs/helpers/docker-ci.md) |
| `alconite-inc/alconite-actions/discord-notify` | Send a workflow result to a configured Discord webhook. | [Discord reference](docs/helpers/discord-notify.md) |
| `.github/workflows/stack-ci.yml` | Run the detected Java, Node.js, Rust, Docker, and Contract Guard jobs together. | [Stack CI reference](docs/stack-ci.md) |
| `.github/workflows/runtime-verify.yml` | Run Runtime Verify and upload its report for unauthenticated target operations. | [Reusable Runtime Verify](#reusable-runtime-verify-reference) |
| `ghcr.io/alconite-inc/sentinel-executor` | Run Contract Guard, Impact, or Runtime Verify in Docker or another CI system. | [Sentinel container](#sentinel-container) |

An Action belongs under `jobs.<job>.steps[*].uses` in a job with `runs-on` and a checkout step. A reusable workflow belongs directly under `jobs.<job>.uses`; it manages its own runners and checks out the caller's repository. Append `@v2.5.0` or its [full release commit SHA](docs/versioning.md) to every GitHub entry point above. The root Action is Contract Guard; it does not automatically run the language helpers. Language and Docker helpers can be used without an Alconite project or token.

The stack workflow publishes without requiring GitHub artifact attestations. Its Docker publication still includes BuildKit SBOM/provenance metadata; these are separate from the GitHub artifact-attestation service. Consumer jobs need no `id-token: write` or `attestations: write` permission. See [enterprise and attestation guidance](docs/troubleshooting.md#enterprise-environments-and-attestations).

## Contract Guard quick start

Create a project token from the Contract Guard project screen and store it as the `ALCONITE_CONTRACT_GUARD_TOKEN` repository secret.

```yaml
name: Contract Guard

on:
  pull_request:

permissions:
  contents: read

jobs:
  contract:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          persist-credentials: false
      - name: Verify API compatibility
        id: contract-guard
        uses: alconite-inc/alconite-actions@v2.5.0
        with:
          project-id: cgprj_1234567890abcdef
          project-token: ${{ secrets.ALCONITE_CONTRACT_GUARD_TOKEN }}
          candidate-path: openapi.yaml
      - name: Preserve the canonical JSON report
        if: ${{ always() && steps.contract-guard.outputs.report-path != '' }}
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: contract-guard-report
          path: ${{ steps.contract-guard.outputs.report-path }}
```

For immutable Action source, replace `v2.5.0` with the full release commit SHA recorded in the [versioning guide](docs/versioning.md). Exact SemVer references are used in these examples for readability. A tag name is convenient but GitHub technically permits maintainers to move tags; use the commit pin when your policy requires immutability.

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

Give the step an `id` to consume outputs, for example `${{ steps.contract_guard.outputs.check-id }}`. All Action outputs are strings, including counts and booleans. A completed policy failure still produces these outputs and its canonical report; an input or service failure may not.

| Output | Meaning |
| --- | --- |
| `check-id` | Stable identifier of the completed check; pass it to Impact. |
| `project-id` | Project that owns the check. |
| `status` | Durable check processing status. |
| `gate-result` | `passed`, `passed_with_warnings`, or `failed`. |
| `report-url` | Canonical machine-report URL; normal Alconite access controls apply. |
| `report-path` | Runner-local canonical JSON file, suitable for an explicitly configured artifact upload. |
| `baseline-content-hash` | Platform-reported fingerprint of the promoted comparison baseline. |
| `candidate-content-hash` | Platform-reported fingerprint of the validated candidate. |
| `uploaded-content-hash` | Fingerprint of the exact candidate bytes sent by the Action. |
| `breaking-changes` | Count of breaking compatibility changes. |
| `risky-changes` | Count of risky compatibility changes. |
| `policy-failures` | Count of failed release-policy rules. |
| `policy-warnings` | Count of release-policy warnings. |

The full report is written to `report-path` rather than placed in a workflow output. A runner-local path cannot be opened by a different job; upload and download an artifact when a later job needs the JSON. The Action writes a job summary but does not post a pull-request comment or upload an artifact itself.

## Alconite Impact

Alconite Impact is an additive component Action that correlates the typed changes from a completed Contract Guard check with deterministic evidence in Rust, Java, TypeScript, and JavaScript source. The released component is selected explicitly with:

```yaml
uses: alconite-inc/alconite-actions/impact@v2.5.0
```

Version 2.5.0 carries Impact under the same repository tag as Contract Guard and Runtime Verify. For an immutable source reference, replace the friendly tag with the full v2.5.0 release commit SHA from the [versioning guide](docs/versioning.md). Publishing this Action does not deploy or enable Alconite Impact on the platform; an environment with the server feature disabled returns the typed `impact_disabled` response.

To analyze an existing completed check without running Contract Guard in the same job:

```yaml
- name: Analyze an existing Contract Guard check
  uses: alconite-inc/alconite-actions/impact@v2.5.0
  with:
    project-id: ${{ vars.ALCONITE_CONTRACT_GUARD_PROJECT_ID }}
    project-token: ${{ secrets.ALCONITE_IMPACT_TOKEN }}
    check-id: cgchk_1234567890abcdef1234567890abcdef
```

### Contract Guard and Impact workflow

Impact chains to the root Action's emitted `check-id`; it does not upload contracts or duplicate compatibility/risk logic on the runner.

```yaml
- name: Contract Guard
  id: contract_guard
  uses: alconite-inc/alconite-actions@v2.5.0
  with:
    project-id: ${{ vars.ALCONITE_CONTRACT_GUARD_PROJECT_ID }}
    project-token: ${{ secrets.ALCONITE_CONTRACT_GUARD_TOKEN }}
    candidate-path: openapi/openapi.yaml

- name: Alconite Impact
  id: impact
  if: steps.contract_guard.outcome == 'success'
  uses: alconite-inc/alconite-actions/impact@v2.5.0
  with:
    project-id: ${{ vars.ALCONITE_CONTRACT_GUARD_PROJECT_ID }}
    project-token: ${{ secrets.ALCONITE_CONTRACT_GUARD_TOKEN }}
    check-id: ${{ steps.contract_guard.outputs.check-id }}

- name: Preserve the private Impact report
  if: ${{ always() && steps.impact.outputs.report-path != '' }}
  uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
  with:
    name: alconite-impact-${{ github.sha }}
    path: ${{ steps.impact.outputs.report-path }}
```

An Impact-only workflow for an existing completed check needs `impact:write`. The chained workflow above needs exactly `versions:write`, `checks:write`, and `impact:write`; it does not need `checks:read`. The recommended PR flow runs Impact after a successful Guard step. Advanced workflows may use `always() && steps.contract_guard.outputs.check-id != ''` to preserve analysis after a completed failed gate; that condition does not clear the failed Contract Guard step or job.

Both steps require a project token. Ordinary GitHub secrets are unavailable to fork pull requests, so keep the repository-identity restriction shown in [examples/impact.yml](examples/impact.yml) and never expose protected tokens to untrusted fork code.

### Inputs, outputs, and gates

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `project-id` | Yes | — | The `cgprj_` project that owns the completed check. |
| `project-token` | Yes | — | Project token with `impact:write`. |
| `check-id` | Yes | — | Completed `cgchk_` check, usually Contract Guard's output. |
| `source-root` | No | `.` | Portable path relative to the checkout selecting the source to collect. Returned evidence paths stay relative to the whole checkout. |
| `api-url` | No | `https://alconite.com` | Alconite API URL; HTTPS except for loopback testing. |
| `additional-ignore` | No | Empty | Up to 20 non-empty, newline-separated ignore-only patterns based at `source-root`. |
| `include-generated-directories` | No | `false` | Include normally excluded generated/vendor directories; `.git` is always excluded. |
| `timeout-seconds` | No | `120` | One overall collection/request/report deadline, 1–600 seconds. |
| `attempts` | No | `3` | Total allowed attempts, 1–5, for the explicit transient retry allowlist. |
| `fail-on-risk` | No | `never` | Detected-risk gate: `never`, `low`, `medium`, `high`, or `critical`. |
| `fail-on-potential-risk` | No | `never` | Independent potential-risk gate with the same choices. |

There is deliberately no `report-path` input. See [impact/action.yml](impact/action.yml) for the executable metadata.

`fail-on-risk` evaluates source-evidenced `overallRisk`. `fail-on-potential-risk` independently evaluates `overallPotentialRisk`, which preserves the severity of an unmatched contract change. Each accepts `never`, `low`, `medium`, `high`, or `critical` and fails for a result at or above the selected threshold. Both default to `never`. Outputs are set and the canonical report is written before either gate is applied.

| Output | Meaning |
| --- | --- |
| `check-id` | Completed Contract Guard check analyzed. |
| `overall-risk` | Highest source-evidenced risk: `NONE`, `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`. |
| `overall-potential-risk` | Highest contract-change severity regardless of source evidence. |
| `breaking-changes` | Number of breaking contract deltas. |
| `affected-files` | Distinct affected source files before report truncation. |
| `affected-source-locations` | Affected source locations before report truncation. |
| `files-scanned` | Files scanned by the authoritative platform engine. |
| `files-skipped` | Submitted entries skipped by the platform engine. |
| `client-entries-visited` | Entries visited by the bounded runner collector. |
| `client-files-discovered` | File entries discovered by the collector. |
| `client-files-submitted` | Supported UTF-8 source files submitted. |
| `client-files-skipped` | File entries skipped locally. |
| `report-path` | Private runner-local canonical JSON report. |
| `report-truncated` | String `true` or `false`: whether bounded packing omitted locations, evidence, or warnings. |
| `analysis-fingerprint` | Deterministic identity of the contract, source manifest, options, and engine semantics. |

Counts and booleans are string-valued outputs. `report-path` is output-only and names a fresh `0600` file inside a fresh `0700` directory below verified `RUNNER_TEMP`, outside the workspace. A caller can upload it with `actions/upload-artifact` or consume it in a later step; Impact itself never uploads artifacts. If report creation fails, the Action zeroes only the still-open file descriptor and leaves the private invocation directory for runner cleanup; it never deletes a raced pathname. The job summary contains bounded HTML-escaped, Markdown-inert evidence only—never source snippets.

Platform analysis is ephemeral request/response processing: the service persists neither submitted source nor an Impact report. Uploading the private runner report is an explicit workflow decision, and the artifact's access and retention follow the repository's GitHub settings.

### Source collection and privacy

`GITHUB_WORKSPACE` is the only source namespace. `source-root` and every evidence/manifest path are portable workspace-relative paths. Components containing control characters, Windows-invalid punctuation, trailing dot/space, or reserved device names are rejected before that entry can be read or submitted, so the runner and Rust service use the same path grammar. Collection is deterministic and single-pass; it supports `.rs`, `.java`, `.ts`, `.tsx`, `.js`, and `.jsx`, applies repository and nested `.gitignore` files plus at most 20 non-empty additional ignore-only patterns, and always excludes `.git`. Generated/vendor directories are excluded unless `include-generated-directories: true` is explicit.

The Standard profile visits at most 20,000 entries and 5,000 directories; reads at most 128 `.gitignore` files, 512 KiB of ignore data, and 10,000 ignore patterns; submits at most 2,000 source files/2,500 manifest entries and 16 MiB decoded source; accepts files up to 512 KiB, paths up to 512 bytes, and depth 32. `timeout-seconds` is one 1–600 second deadline (120 by default) beginning before workspace access and covering collection, retries, response validation, and private report output. Crossing a repository-wide budget fails instead of publishing a partial risk result. Binary, invalid UTF-8, oversized, overlong, deep, ignored, unsupported, and link entries receive bounded aggregate accounting; individual skipped paths are not sent.

The Action never executes source, repository scripts, Git, hooks, build tools, or package managers. It never logs source contents, the project token, absolute source paths, or request bodies. The platform independently validates every submitted entry, and only its `metadata.serverScan` accounting is authoritative. Local `metadata.clientCollection` is explicitly non-authoritative and echoed only for reconciliation.

Report v1 validation enforces the exact Contract Delta v1 category, typed-subject, and canonical-order contract and independently recomputes Impact v1 potential, detected, and Critical risk values. Newer positive semantic engine integers retain the strict report-v1 wire, bounds, identity, count, and structural checks without being interpreted through older v1 policy.

On Linux, every `GITHUB_WORKSPACE` and `RUNNER_TEMP` root component is opened from its pinned parent descriptor with `O_NOFOLLOW | O_DIRECTORY` before the ambient name is trusted. Source reads then use `O_NOFOLLOW` plus stable descriptor identity and final containment checks. Report creation anchors the verified `RUNNER_TEMP` root, fresh child directory, and exclusive file through Linux descriptors and `/proc/self/fd`, while rechecking the ambient output path before any report bytes are written. Node 24 does not expose equivalent Windows no-follow/reparse attributes or enforceable private POSIX report modes, so the Action fails closed before workspace traversal or network submission. Use an `ubuntu-24.04` or another supported Linux GitHub runner for this component.

Only network or response-body transport failures, gateway HTTP 502, gateway 504 without a valid Impact error, the exact `429` + `impact_analysis_busy` pair, and the exact `503` + `impact_storage_unavailable` pair are retried. Redirects, mismatched status/code pairs, authentication/scope errors, disabled/timeout/internal errors, check history errors, payload limits, and deterministic contract/symbol/token/evidence/report complexity errors are never retried.

Impact's lexical evidence is deterministic but heuristic: it does not resolve imports, execute compilers, infer property renames, or prove the absence of a consumer. The report therefore separates potential risk from detected risk and explains every returned confidence/evidence decision. Registered repositories, dependency graphs, runtime telemetry, PR annotations, and automated remediation remain future work.

## Runtime Verify

Runtime Verify is an additive component Action in the repository-wide v2.5.0 release. The repository root remains Contract Guard; Runtime Verify is selected explicitly with:

```yaml
uses: alconite-inc/alconite-actions/runtime-verify@v2.5.0
```

Version 2.3.0 introduced platform-owned automatic contract lineage, retained in v2.5.0. Existing workflows that explicitly supply `check-id` remain supported for debugging, historical verification, replay, and advanced use.

The Alconite platform never calls the target API. Requests execute inside the customer-controlled GitHub runner. The Action reads the checked-in contract and `.alconite/runtime-verify.yaml`, resolves only explicitly named target secrets from the runner environment, calls the configured target, validates responses locally, and submits a bounded observation/finding envelope. Target origins, expanded request URLs, authorization values, cookies, response bodies, response header values, environment values, local paths, GitHub tokens, and stack traces are not submitted.

By default, Runtime Verify computes the same carriage-return-normalized `sha256:<hex>` contract identity as the platform and asks Alconite to resolve an approved completed Contract Guard check for that exact project and contract. Alconite returns the check it selected and the authoritative expected candidate hash before any target request. Resolution never searches GitHub history or falls back to another contract or project's latest check. If no approval exists, the Action fails with guidance to run Contract Guard or intentionally provide an explicit `check-id`.

The Action still compares the local fingerprint with `expectedContractContentHash`. A mismatch skips target execution and completes with `runtime.contract.hash-mismatch`; the platform computes the final gate result.

### Runtime Verify setup

1. In Contract Guard, create or select the API project and run an approved check for the contract that will be deployed. Promoting or switching the project's comparison baseline remains an independent Contract Guard operation.
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

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `project-id` | Yes | — | Contract Guard `cgprj_` project. |
| `project-token` | Yes | — | Project-scoped `alc_cg_` token authorized for Runtime Verify in this environment. |
| `environment-id` | Yes | — | Runtime Verify `rtvenv_` environment. |
| `base-url` | Yes | — | Target HTTPS origin, such as `https://api.example.com`; no credentials, path, query, or fragment. HTTP is allowed only for loopback testing. |
| `check-id` | No | Automatic resolution | Explicit approved `cgchk_` check for replay, diagnosis, or historical verification. |
| `contract-path` | No | `openapi.yaml` | Workspace-relative path to the approved contract. |
| `configuration-path` | No | `.alconite/runtime-verify.yaml` | Workspace-relative path to the operation configuration. |
| `display-name` | No | Empty | Human-readable verification label, at most 160 characters. |
| `deployment-id` | No | Empty | Deployed release identity, at most 200 characters; a commit SHA is a useful choice. |
| `api-url` | No | `https://alconite.com` | Alconite API origin, with the same origin/HTTPS rules as `base-url`. |
| `idempotency-key` | No | Deterministic | Identity of one logical verification request, at most 200 characters. |
| `timeout-seconds` | No | `120` | Total target-execution budget, 1–3600 seconds; also bounds each Alconite request. |
| `retry-attempts` | No | `3` | Total Alconite API attempts, 1–5; does not replay target operations as a general retry policy. |
| `fail-on` | No | `failed` | `failed`, `warnings`, or `never`; processing and platform errors always fail. |
| `report-path` | No | Runner temporary directory | Destination for the canonical report. |

See [runtime-verify/action.yml](runtime-verify/action.yml) for the executable metadata.

| Output | Meaning |
| --- | --- |
| `run-id` | Stable Runtime Verify run identifier. |
| `project-id` | Project that owns the run. |
| `environment-id` | Environment verified. |
| `check-id` | Actual explicit or automatically resolved approved check. |
| `deployment-id` | Deployment identity associated with the run. |
| `status` | Durable verification processing status. |
| `gate-result` | Platform-computed gate result. |
| `report-url` | Canonical report URL under Alconite access controls. |
| `report-path` | Runner-local canonical JSON file. |
| `contract-content-hash` | Platform-compatible identity of the checked-in contract. |
| `configured-operations` | Operations selected in configuration. |
| `executed-operations` | Operations executed against the target. |
| `passed-operations` | Passing operations. |
| `failed-operations` | Failed operations. |
| `warning-operations` | Operations with warnings. |
| `finding-count` | Number of bounded findings. |
| `replayed` | String `true` or `false`: whether a completed existing run was replayed. |

All outputs are strings. Complete findings are never placed in outputs. The platform canonical report is written before the configured gate is applied, so a completed failed verification can still be uploaded from `report-path`; the job summary displays at most 25 escaped findings.

When `idempotency-key` is omitted, the Action derives a bounded `runtime-gh-v2-` key from stable repository/workflow identity, project and environment, deployment ID or commit SHA, run attempt, exact contract/configuration fingerprints, and automatic-versus-explicit resolution mode. It deliberately excludes `github.run_id`: `deployment-id` identifies deployed software, while the idempotency key identifies this requested operation. Only network failures and HTTP 502/503/504 responses are retried with the same key. A replayed completed run skips target execution.

### Deployment-stage workflow

```yaml
name: Deploy and verify runtime

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-24.04
    environment: production
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      # Existing build, test, and deployment steps.

  runtime-verify:
    needs: deploy
    runs-on: ubuntu-24.04
    environment: production
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Verify production runtime
        id: runtime
        uses: alconite-inc/alconite-actions/runtime-verify@v2.5.0
        with:
          project-id: ${{ secrets.ALCONITE_PROJECT_ID }}
          project-token: ${{ secrets.ALCONITE_PROJECT_TOKEN }}
          environment-id: ${{ vars.ALCONITE_RUNTIME_ENVIRONMENT_ID }}
          base-url: https://example.com
          contract-path: openapi/api.yaml
          configuration-path: .alconite/runtime-verify.yaml
          deployment-id: ${{ github.sha }}
          display-name: production-${{ github.sha }}
          fail-on: failed

      - name: Preserve Runtime Verify report
        if: ${{ always() && steps.runtime.outputs.report-path != '' }}
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: runtime-verify-report
          path: ${{ steps.runtime.outputs.report-path }}
```

The reusable [Runtime Verify workflow](.github/workflows/runtime-verify.yml) is suitable for public/unauthenticated target operations and exposes the resolved check, deployment, run, gate, report URL, and report path. It intentionally accepts only the Alconite project token and no arbitrary target-secret map. Because a caller cannot attach arbitrary job-level environment variables to a reusable-workflow job, authenticated target checks should use the component Action directly, where each configured target secret is mapped explicitly with `env:`.

```yaml
jobs:
  runtime:
    uses: alconite-inc/alconite-actions/.github/workflows/runtime-verify.yml@v2.5.0
    with:
      project-id: ${{ vars.ALCONITE_CONTRACT_GUARD_PROJECT_ID }}
      environment-id: ${{ vars.ALCONITE_RUNTIME_ENVIRONMENT_ID }}
      base-url: https://staging.example.com
      contract-path: openapi/openapi.yaml
      configuration-path: .alconite/runtime-verify.yaml
    secrets:
      project-token: ${{ secrets.ALCONITE_RUNTIME_VERIFY_TOKEN }}
```

### Reusable Runtime Verify reference

The reusable workflow above checks out the caller repository on `ubuntu-24.04`, runs the component, and uploads `runtime-verify-report` whenever a report exists, including after a completed failed gate. It needs `contents: read` and the explicitly forwarded `project-token` secret. It does not need GitHub write permissions or GitHub artifact attestation.

| Workflow input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `project-id` | Yes | — | Contract Guard project identifier. |
| `environment-id` | Yes | — | Runtime Verify environment identifier. |
| `base-url` | Yes | — | Target HTTPS origin. |
| `check-id` | No | Empty | Omit to resolve the exact contract approval automatically. |
| `contract-path` | No | `openapi.yaml` | Contract path in the caller's checkout. |
| `configuration-path` | No | `.alconite/runtime-verify.yaml` | Configuration path in the caller's checkout. |
| `display-name` | No | Empty | Human-readable run label. |
| `deployment-id` | No | Empty | Deployed release identity. |
| `fail-on` | No | `failed` | `failed`, `warnings`, or `never`. |

The only accepted secret is required `project-token`. Outputs are `run-id`, `check-id`, `deployment-id`, `gate-result`, `report-url`, and `report-path`, available through `${{ needs.runtime.outputs.run-id }}` when the calling job is named `runtime`. The `report-path` is local to the completed reusable job; download the `runtime-verify-report` artifact in another job to read the JSON. Inputs such as `api-url`, timeouts, retry settings, and `report-path` are not exposed by this workflow; use the component Action for those controls or authenticated target requests.

### Manual verification of a specific approval

Manual selection remains available for replay and diagnosis, but it is not the normal deployment integration:

```yaml
on:
  workflow_dispatch:
    inputs:
      check-id:
        description: Exact Contract Guard approval to verify
        required: true
        type: string

jobs:
  verify-specific-check:
    runs-on: ubuntu-24.04
    environment: production
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: alconite-inc/alconite-actions/runtime-verify@v2.5.0
        with:
          project-id: ${{ secrets.ALCONITE_PROJECT_ID }}
          project-token: ${{ secrets.ALCONITE_PROJECT_TOKEN }}
          environment-id: ${{ vars.ALCONITE_RUNTIME_ENVIRONMENT_ID }}
          check-id: ${{ inputs.check-id }}
          base-url: https://example.com
          contract-path: openapi/api.yaml
          configuration-path: .alconite/runtime-verify.yaml
          deployment-id: ${{ github.sha }}
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
    uses: alconite-inc/alconite-actions/.github/workflows/stack-ci.yml@v2.5.0
    permissions:
      contents: read
      packages: write
    with:
      contract-guard-project-id: cgprj_1234567890abcdef
      contract-candidate-path: openapi.yaml
    secrets:
      contract-guard-token: ${{ secrets.ALCONITE_CONTRACT_GUARD_TOKEN }}
```

Stack CI callers grant `contents: read` and `packages: write` because its publish job declares package write access, even when publishing is disabled. If organization policy permits only a read-only token, compose the individual build helpers instead. To publish Docker images, additionally set `docker-push: true`. No `id-token: write`, `attestations: write`, or GitHub artifact-attestation feature is required. The reusable workflow reduces permissions on build-only jobs and will not publish during a pull request. See the [full stack reference](docs/stack-ci.md) and [complete publishing example](examples/docker-publish.yml) for all inputs, secrets, and event controls.

## Individual actions

All component actions target Linux GitHub-hosted runners and can be used directly. These snippets go after checkout inside `steps:`; see [getting started](docs/getting-started.md) for a complete job. Each reference below documents every input, output, default, credential, and behavior.

### Java

Read the [Java CI](docs/helpers/java-ci.md) and [Java publishing](docs/helpers/java-publish.md) references.

```yaml
- uses: alconite-inc/alconite-actions/java-ci@v2.5.0
  with:
    java-version: "25"
    build-tool: auto
    gradle-tasks: test
    maven-goals: verify
```

Gradle and Maven wrappers are required. Private package credentials are passed as environment-backed Gradle properties or Maven settings placeholders; raw tokens are not persisted by this action.

Publishing is deliberately separate:

```yaml
- uses: alconite-inc/alconite-actions/java-publish@v2.5.0
  with:
    packages-token: ${{ github.token }}
    release-version: 2.0.0
```

Run publishing only in a trusted tag or protected-environment job with `packages: write`.

### Node.js

Read the [Node.js reference](docs/helpers/node-ci.md) for package-manager detection, private dependencies, caching, and report uploads.

```yaml
- uses: alconite-inc/alconite-actions/node-ci@v2.5.0
  with:
    node-version: "24"
    package-manager: auto
    script: test
```

The action supports npm, pnpm, and Yarn, requires a committed lockfile, and requires pnpm to be pinned through `packageManager` or `pnpm-version`.

### Rust

Read the [Rust reference](docs/helpers/rust-ci.md) for toolchains, workspace selection, features, targets, and release builds.

```yaml
- uses: alconite-inc/alconite-actions/rust-ci@v2.5.0
  with:
    toolchain: auto
    workspace: "true"
    locked: "true"
```

The Rust action honors `rust-toolchain.toml`, uses the minimal rustup profile, restores a Cargo cache, runs `cargo fmt --check`, denies Clippy warnings, and runs locked tests. Release builds are opt-in with `build-release: "true"`.

### Docker

Read the [Docker reference](docs/helpers/docker-ci.md) for registries, tag generation, platforms, build outputs, and optional SBOM/provenance metadata.

Pull requests build without logging in:

```yaml
- uses: alconite-inc/alconite-actions/docker-ci@v2.5.0
  with:
    push: "false"
```

Trusted publishing is explicit:

```yaml
- id: image
  uses: alconite-inc/alconite-actions/docker-ci@v2.5.0
  with:
    push: "true"
    registry-password: ${{ github.token }}
    sbom: "true"
    provenance: mode=max
```

The registry password is never passed to the Dockerfile as a build secret. Published builds expose the image digest for downstream deployment or optional verification. `sbom` and `provenance` control BuildKit metadata and do not require the GitHub artifact-attestation service. The direct helper defaults both to `false`; the stack publishing job enables both.

### Discord

Read the [Discord reference](docs/helpers/discord-notify.md) for accepted statuses, webhook setup, and notification failure behavior.

```yaml
- uses: alconite-inc/alconite-actions/discord-notify@v2.5.0
  if: ${{ always() }}
  with:
    webhook-url: ${{ secrets.DISCORD_WEBHOOK }}
    job-status: ${{ job.status }}
```

The notification action uses Node's built-in HTTP client and disables Discord mentions; it has no third-party action dependency.

## Sentinel container

The prepared `ghcr.io/alconite-inc/sentinel-executor` image packages those same three Node 24 executors for local Docker and CI systems outside GitHub. The first image platform is `linux/amd64`; it does not contain a shell, package manager, source tree, or customer credentials. Use the v2.5.0 examples below after the corresponding image is published and its package is made public (or authenticate for pulls). Confirm availability through the [release and pinning guide](docs/versioning.md).

Use the exact immutable release tag in automated systems:

```shell
docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount type=bind,src="$PWD",dst=/workspace,readonly \
  --mount type=bind,src="$PWD/reports",dst=/reports \
  --env ALCONITE_PROJECT_TOKEN \
  ghcr.io/alconite-inc/sentinel-executor:v2.5.0 \
  contract-guard --project-id cgprj_1234567890abcdef
```

Create `reports/` before the run and ensure it is writable by the image's non-root UID/GID `65532:65532`. On Linux, a bind mount can instead run with the calling job's non-root identity by adding `--user "$(id -u):$(id -g)"`; a Docker-managed named volume at `/reports` works with the image's default identity without host ownership preparation. Keep the report location private. Provide `ALCONITE_PROJECT_TOKEN` through the environment or your CI secret injection. Do not put it in the command line, Docker build arguments, image labels, or checked-in configuration. The command writes exactly one compact result object to stdout; diagnostics go to stderr and the Action report path is included in `outputs` when available.

The public grammar is `sentinel contract-guard`, `sentinel impact`, or `sentinel runtime-verify`, followed by the corresponding Action options without `project-token`. Run the image or any subcommand with `--help`. Workspace paths are relative to `/workspace`; explicit Contract Guard and Runtime Verify report paths are relative to `/reports`. Those destinations must not already exist: the executor stages each report privately and creates the durable file with exclusive, no-follow descriptor checks. Impact always creates its own private report below `/reports`.

`contract-guard` requires `--project-id`. Its optional flags are `--candidate-path` (`openapi.yaml`), `--display-name` (existing local identity), `--api-url` (`https://alconite.com`), `--idempotency-key` (deterministic local key), `--timeout-seconds` (`120`, range 1–600), `--retry-attempts` (`3`, range 1–5), `--fail-on` (`failed`; also `warnings` or `never`), and `--report-path` (a safe `/reports`-relative path; otherwise a check-specific filename).

`impact` requires `--project-id` and `--check-id`. Its optional flags are `--source-root` (`.`), `--api-url` (`https://alconite.com`), repeatable `--additional-ignore` (none), `--include-generated-directories` (`false`), `--timeout-seconds` (`120`, range 1–600), `--attempts` (`3`, range 1–5), `--fail-on-risk` (`never`), and `--fail-on-potential-risk` (`never`). Both risk thresholds also accept `low`, `medium`, `high`, or `critical`. Impact deliberately has no report-path option.

`runtime-verify` requires `--project-id`, `--environment-id`, and `--base-url`. Its optional flags are `--check-id` (automatic exact-contract resolution when omitted), `--contract-path` (`openapi.yaml`), `--configuration-path` (`.alconite/runtime-verify.yaml`), `--display-name` (none), `--deployment-id` (none), `--api-url` (`https://alconite.com`), `--idempotency-key` (deterministic local key), `--timeout-seconds` (`120`, range 1–3600), `--retry-attempts` (`3`, range 1–5), `--fail-on` (`failed`; also `warnings` or `never`), and `--report-path` (`alconite-runtime-verify-report.json` below `/reports`).

Every execution prints one `alconite.sentinel-executor.result.v1` JSON object containing `command`, `exitCode`, and string-valued Action `outputs`. A completed policy or risk gate can return `exitCode: 1` with a complete report and outputs; processing, input, authentication, authorization, or quota failures normally return nonzero with no outputs. Treat reports as sensitive build artifacts and apply the CI system's intended access and retention policy.

Sequence Impact from the `check-id` in a completed Contract Guard envelope:

```shell
docker run <hardening-and-mount-options> \
  --env ALCONITE_PROJECT_TOKEN \
  ghcr.io/alconite-inc/sentinel-executor:2.5.0 \
  impact --project-id cgprj_1234567890abcdef --check-id cgchk_1234567890abcdef
```

Keep Runtime Verify in a trusted post-deployment job. Target credentials stay in locally injected environment variables named by the checked-in configuration:

```shell
docker run <hardening-and-mount-options> \
  --env ALCONITE_PROJECT_TOKEN --env STAGING_API_AUTHORIZATION \
  ghcr.io/alconite-inc/sentinel-executor:2.5.0 \
  runtime-verify --project-id cgprj_1234567890abcdef \
  --environment-id rtvenv_1234567890abcdef --base-url https://api.example.com
```

For non-GitHub CI, use the same hardened flags, mount the checkout read-only, mount a dedicated artifact directory at `/reports`, inject `ALCONITE_PROJECT_TOKEN` as a masked secret, and parse only the single stdout JSON line. Runtime Verify target credentials remain environment variables referenced by `.alconite/runtime-verify.yaml`; do not print or enumerate them. Permit outbound network access only to the configured Alconite API and, for Runtime Verify, the selected customer target.

A public image pull never grants Sentinel access. Project-token authentication, token scope, account/project isolation, entitlements, quota accounting, audit, and report retention remain enforced by Alconite. Use the least-privilege scope for the selected operation: Contract Guard requires its version/check write capabilities, Impact requires `impact:write`, and Runtime Verify requires only its initiation/result/failure capabilities for the selected project and environment.

Release automation publishes `v2.5.0` and the same-digest `2.5.0`, `2.5`, `2`, and `latest` aliases to GHCR after tests, SBOM generation, and a High/Critical scan pass. It refuses to rewrite an existing immutable `v2.5.0` reference and fails closed when registry inspection cannot prove absence. Docker Hub is deliberately separate: a protected manual workflow promotes an existing GHCR digest without rebuilding. Before using it, configure the `docker-hub` GitHub environment, set `DOCKERHUB_SENTINEL_IMAGE` to `docker.io/namespace/repository`, and add `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` as environment secrets. Dispatch it with an exact version such as `2.5.0` (no leading `v`); `publish_latest` remains false unless explicitly selected. Promotion accepts a matching existing exact version, creates only a confirmed-absent version, and fails closed on ambiguous registry state. No Docker Hub repository or credential is required by ordinary CI or GHCR publication.

GHCR is the canonical attested source. Pin `ghcr.io/alconite-inc/sentinel-executor@sha256:...` in sensitive CI after verifying the release provenance and SPDX SBOM. To reproduce the release gates locally:

```shell
npm ci
npm test
npm run validate:sentinel-container
npm run build
docker buildx build --load --platform linux/amd64 \
  --file sentinel-executor/Dockerfile \
  --tag alconite/sentinel-executor:2.5.0-test .
node scripts/test-sentinel-container.mjs alconite/sentinel-executor:2.5.0-test
```

CI then uses the pinned Anchore actions to generate SPDX JSON and fail for any High or Critical operating-system or language-package finding. It performs those checks on the exact local image before any registry login.

## Security model

- External actions are pinned to full commit SHAs.
- Build jobs are read-only; publish credentials belong only in trusted publish jobs.
- Action inputs are transferred through environment variables instead of interpolated into shell source.
- The Contract Guard action refuses redirects and non-HTTPS non-loopback API URLs.
- Project tokens are masked immediately and never included in outputs, summaries, or error bodies.
- The root `dist/` directory contains Node 24 JavaScript built from `src/`; the Impact and Runtime Verify entry points bundle their runtime dependencies into their component `dist/` directories.

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
