# Troubleshooting

Start with the first failed step in the Actions run, the component's job summary, and any explicitly uploaded report. A completed Alconite policy gate can fail a step while still producing a valid report. An input, authentication, transport, or report-validation error can fail before outputs exist.

Use the [getting-started guide](getting-started.md), [helper references](helpers/README.md), [Stack CI reference](stack-ci.md), and [versioning guide](versioning.md) to check the configuration against the version you are running.

## Workflow setup and permissions

| Symptom | What to check |
| --- | --- |
| GitHub cannot find the Action | The root is `alconite-inc/alconite-actions` followed by the selected version or SHA for Contract Guard. Helpers include the directory, such as `/node-ci@<ref>`. Use a published release or its verified commit; the prepared v2.5.0 examples need that release to exist. |
| A reusable workflow is rejected as an Action | Put `.github/workflows/stack-ci.yml@<ref>` or `.github/workflows/runtime-verify.yml@<ref>` at `jobs.<name>.uses`, without `runs-on` or `steps` in that calling job. Put component Actions under a normal job's `steps:`. |
| A local project, contract, or source file cannot be found | Check out the application repository before a direct Action. Check file casing and the Action's `working-directory`, `source-root`, `candidate-path`, or `contract-path`; setting a shell's working directory does not set these inputs. Reusable workflows check out the caller's repository themselves. |
| The called workflow requests permissions the caller does not allow | Stack CI callers must grant `contents: read` and `packages: write` because the workflow declares package publication permissions, even when `docker-push` is false. Use individual build helpers when your policy permits only `contents: read`. Runtime Verify's reusable workflow only needs `contents: read`. |
| A required project token is empty | Confirm the exact secret name, organization secret repository access, environment selection, and explicit `secrets:` forwarding for reusable workflows. Variables and secrets are separate GitHub settings. |
| Credentials are missing in a PR | Fork and Dependabot contexts can withhold secrets. The stack deliberately passes no private package token on any `pull_request` event. Keep untrusted builds secret-free and use a reviewed trusted run for credential-backed checks. |
| A stack language job is unexpectedly skipped | Automatic detection examines root-level project markers. For projects in subdirectories or custom commands, use direct helpers with explicit directories. Set a detection input to `true` only when the expected project exists at the location the workflow uses. |
| A stack publish job is skipped | `docker-push` must be true, the event must not be `pull_request`, Docker must be detected/enabled, the Docker build must pass, and all enabled preceding language and Contract Guard jobs must succeed. |

A reusable workflow can keep or reduce the caller's `GITHUB_TOKEN` permissions; it cannot elevate them. Conditions on publishing jobs do not provide a separate caller permission contract. See GitHub's [reusable workflow permissions reference](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).

## Enterprise environments and attestations

Version 2.5.0 removes the `actions/attest` step from consumer Stack CI Docker publishing and removes its `id-token: write` and `attestations: write` requests. Consumers can build and publish without access to GitHub's artifact-attestation service. Use `contents: read` and `packages: write` when calling Stack CI.

GitHub Enterprise Cloud supports artifact attestations, including private/internal repositories. Availability also depends on repository visibility, plan, and organization policy; an enterprise account is not by itself a reason attestations are unavailable. GitHub Enterprise Server does not support that service. See [GitHub's availability guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) and the [pinned attestation Action's GHES notice](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/README.md).

Three different features are involved:

| Feature | How it applies here |
| --- | --- |
| GitHub artifact attestation | A signed statement submitted to GitHub by `actions/attest`. Stack CI does not call this service. Alconite's own protected release workflow can still attest release assets and Sentinel images. |
| BuildKit SBOM / provenance | OCI build metadata controlled by `docker-ci` inputs `sbom` and `provenance`. Stack publishing enables `sbom: "true"` and `provenance: mode=max`; it does not need the GitHub attestation API or those write permissions. Direct `docker-ci` defaults both to `false`. |
| GitHub workflow artifacts | Reports uploaded by `actions/upload-artifact`. Storing a test/report file is separate from attesting a file or image. |

Removing the attestation requirement does **not** establish full GitHub Enterprise Server compatibility. The published reusable workflows select `ubuntu-24.04`; your installation must provide suitable runners and permit access to the pinned Actions, toolchains, package registries, and Alconite endpoints. Current `upload-artifact` versions 4 and newer do not support GHES, including the v7 action pinned here. See the upstream [GHES support guidance](https://github.com/actions/upload-artifact#ghes-support). Node 24 entry points and other upstream actions also require compatible runner versions.

For a GHES installation, compose and validate a workflow for your runner and supported dependencies before rollout. Direct Java/Node helpers expose report/artifact switches; Rust does not upload artifacts; the reusable workflows have fewer controls. Sentinel is another execution path for the three Alconite checks when your CI can run Docker and reach the required endpoints. None of these alternatives guarantees compatibility without validating the actual environment.

If an old run still fails at `Attest published image`, check the **resolved** Stack CI revision. Updating your application's permissions cannot remove a step contained in an older reusable workflow; adopt the published v2.5.0 version or its verified SHA. GitHub can also restrict allowed Actions independently of token permissions.

## Alconite authentication and policy gates

| Symptom | What to check |
| --- | --- |
| Contract Guard returns a failed gate | Read `gate-result`, policy counts, and the canonical report. A completed `failed` gate is a policy result. Address the contract change or adjust the project's intended policy through Alconite. |
| `fail-on: never` still fails | That setting suppresses only a completed policy gate. Invalid files, missing tokens, quota errors, service errors, and invalid reports still fail. Impact's two risk thresholds likewise do not suppress execution failures. |
| Unauthorized or forbidden response | Use an Alconite `alc_cg_` project token, not `${{ github.token }}`. Confirm that it belongs to the same project and has the selected product's scopes and environment authorization. |
| A quota, entitlement, or disabled-feature error appears | Check project/account access and usage. Installing the Action does not enable server-side product features. Impact can return `impact_disabled` when the platform feature is unavailable. |
| An API URL is rejected | Use HTTPS. Runtime Verify's `api-url` and `base-url` must be origins with no embedded credentials, path, query, or fragment. HTTP is limited to loopback tests. |
| A failed request keeps repeating | The actions retry only their documented transient conditions with bounded attempts. A configuration, authentication, deterministic validation, or policy error needs correction rather than a larger retry count. |
| The check compares against an unexpected baseline | Confirm the selected Alconite project and its promoted comparison baseline. Uploading a candidate does not itself change which baseline is promoted. |

A project token used for Contract Guard needs `versions:write` and `checks:write`; Impact needs `impact:write`. A chained job can use one token carrying all three or separate scoped tokens. Runtime Verify requires its initiation, result, and failure permissions for the selected project and environment. See [credential setup](getting-started.md#create-the-alconite-credentials).

## Impact collection and results

| Symptom | What to check |
| --- | --- |
| No supported UTF-8 source was collected | Confirm checkout, `source-root`, source extensions, `.gitignore`, additional ignore patterns, and generated-directory exclusions. Supported source extensions are `.rs`, `.java`, `.ts`, `.tsx`, `.js`, and `.jsx`. |
| The collector exceeds a budget or deadline | Narrow `source-root` or add ignore-only patterns for unrelated source. Repository-wide limits fail the Action instead of silently treating a partial collection as complete. `timeout-seconds` includes collection, requests, validation, and report output. |
| Windows or a filesystem path is rejected | Run Impact on supported Linux. It requires no-follow directory/file checks; unsafe paths, symlinks, and unsupported filesystem protections are rejected before source is submitted. |
| Potential risk is high but detected risk is low or none | Potential risk describes the contract change. Detected risk needs lexical source evidence. Impact does not resolve imports or prove that no consumer exists. Choose the two independent gate thresholds accordingly. |
| The report is truncated | Read `report-truncated` and the report's metadata. Location/evidence packing is bounded; affected counts refer to the pre-truncation analysis. Do not infer completeness from a short report. |
| A user-specified Impact report path is ignored | Impact has no `report-path` input. Use its output path, created privately under `RUNNER_TEMP`, in a later step. |

See the [Impact reference](../README.md#alconite-impact) for collection limits, exact retry conditions, output semantics, and privacy behavior.

## Runtime Verify

| Symptom | What to check |
| --- | --- |
| No approved contract can be resolved | Run Contract Guard for the exact deployed contract and project until it is approved. Normal automatic resolution does not fall back to another project's or contract's latest check. Use an explicit `check-id` only when intentionally selecting a particular approval. |
| `runtime.contract.hash-mismatch` | The checked-out contract differs from the expected approved candidate. Check out the deployed revision and verify `contract-path`; explicit historical checks still require matching contract identity. Target requests are skipped on mismatch. |
| A configured operation is rejected | Each operation must name an approved `operationId`, use `GET` or `HEAD`, and fit the strict version-one configuration. Bundle external references into the contract first; remote and filesystem references are not accepted. |
| Authentication to the target is missing | Map the GitHub secret to the exact uppercase environment name in `fromEnvironment`. Target credentials are not Action inputs. Use the direct component for authenticated targets; the reusable workflow does not expose an arbitrary target-secret map. |
| A target is unreachable or times out | Verify routing, DNS, TLS, firewall rules, and the target origin from the selected runner. A public hosted runner may not reach a private service. Review configured per-operation timeouts and the total target budget. |
| A status, content type, header, or body fails validation | Compare the bounded finding with the approved OpenAPI definition and configured expectations. Expectations may narrow the contract but cannot allow an undocumented behavior. The platform determines the gate result. |
| A repeated request does not call the target again | A completed idempotent run may be replayed. Check the `replayed` output and the documented key inputs. Use a new logical deployment/run identity when you intentionally need a new verification. |

Consult the [Runtime Verify reference](../README.md#runtime-verify) for configuration, automatic lineage, inputs, outputs, and example deployment workflows.

## Build and publication helpers

| Symptom | What to check |
| --- | --- |
| Java cannot detect a build tool or find its wrapper | Set the correct `working-directory`, commit `gradlew` or `mvnw` and supporting wrapper files, and select `build-tool` when detection is ambiguous. See [Java CI](helpers/java-ci.md). |
| Java publication has no version or repository | Pass valid SemVer in `release-version`, or use a matching release tag. Configure the project's publishing destination and credentials as described in [Java publish](helpers/java-publish.md). The helper does not invent publication configuration. |
| Node rejects the lockfile or package manager | Commit the selected manager's lockfile and pin pnpm/Yarn through `packageManager` or the version input. `script` is a package-script name, not a shell command. See [Node.js CI](helpers/node-ci.md). |
| Rust fails before or during tests | Commit the intended lockfile for `locked: "true"`, confirm toolchain/components/targets, and address formatting or Clippy warnings. Default checks can fail before tests begin. See [Rust CI](helpers/rust-ci.md). |
| Docker rejects an image name | Use a lowercase OCI image name with no tag or digest. `registry` is a hostname with an optional port, without a URL scheme. Use `release-version` for version tags. See [Docker CI](helpers/docker-ci.md). |
| Docker refuses to load/push | `push` and `load` cannot both be true; loading supports only one platform. A build-only result is not necessarily loaded into the local Docker daemon. |
| Docker or Java returns a registry authorization error | Confirm token scope, destination permissions, and explicit credential inputs. `packages: write` grants capabilities to GitHub's token but does not authorize a separate registry. Cross-repository GitHub Packages access may require an explicit package grant. |
| An artifact upload conflicts in a matrix | Set unique helper artifact/report names for each invocation. Distinct jobs cannot append to the same modern GitHub artifact. |
| Discord fails the job | Confirm an HTTPS Discord webhook and `job-status` of `success`, `failure`, or `cancelled`. The notification helper fails for invalid input or a non-success webhook response. Select `continue-on-error: true` in the caller if notification delivery is intentionally best-effort. See [Discord](helpers/discord-notify.md). |

## Reports and safe support requests

Report paths identify files on the runner where the Action executed. A different job cannot read that path directly; upload an artifact from the producing job and download it in the consuming job. Use an upload condition such as `${{ always() && steps.guard.outputs.report-path != '' }}` so completed failed gates preserve their report without attempting to upload a nonexistent file after an early error.

A direct Contract Guard, Impact, or Runtime Verify Action writes its canonical report and a job summary; it does not automatically upload the report to GitHub. The reusable Runtime Verify workflow does upload its report. Stack CI does not upload Contract Guard's canonical report. If you need that artifact, compose the direct Action with an explicit upload step. Reports and build artifacts follow your chosen access and retention settings.

For support, include the Action path and full version/SHA, runner operating system, trigger type, safe error/finding code, and a small redacted log excerpt. Do not disclose tokens, target credentials, source files, full Impact reports, response bodies, expanded target URLs, or local filesystem paths. Follow [SUPPORT.md](../SUPPORT.md); report vulnerabilities through [SECURITY.md](../SECURITY.md), not a public issue.
