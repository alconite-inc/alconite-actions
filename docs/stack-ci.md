# Stack CI reusable workflow

`alconite-inc/alconite-actions/.github/workflows/stack-ci.yml@v2.5.0` combines Alconite's standard root-project CI conventions. It detects Java, Node.js, Rust, Docker, and an explicitly configured Contract Guard project independently, so multiple language jobs can run for one repository. Source: [stack-ci.yml](../.github/workflows/stack-ci.yml).

Call it at `jobs.<job-id>.uses`, not inside `steps`. It checks out the caller repository itself, runs on `ubuntu-24.04`, and chooses its own job structure. Use [individual helpers](helpers/README.md) for subdirectory projects, matrices, custom scripts, custom registries, different runners, report controls, or job outputs.

## Quick start

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
```

This uses auto detection and keeps Docker publication disabled. The calling job grants `packages: write` because the reusable workflow declares that permission for its optional publish job. GitHub validates the reusable workflow's permission requests independently of whether a conditional job will run; `docker-push: false` does not remove that declared request. Internally, Java/Node jobs reduce package permission to read, other build jobs use `contents: read`, and notifications have no GitHub permissions. If your policy permits only read permissions on the caller, use the individual helpers in your own read-only jobs. See [GitHub's reusable-workflow permission rules](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations#supported-keywords-for-jobs-that-call-a-reusable-workflow).

No GitHub attestation or OIDC scope is requested. For immutable action references, see [version and SHA pinning](versioning.md).

## Inputs

All inputs are optional.

| Input | Type | Default | Meaning |
| --- | --- | --- | --- |
| `java` | string | `auto` | Run Java CI: `auto`, `"true"`, or `"false"`. |
| `java-version` | string | `25` | Temurin Java version passed to Java CI. |
| `node` | string | `auto` | Run Node CI: `auto`, `"true"`, or `"false"`. |
| `node-version` | string | `24` | Node version passed to Node CI. |
| `rust` | string | `auto` | Run Rust CI: `auto`, `"true"`, or `"false"`. |
| `docker` | string | `auto` | Run Docker build: `auto`, `"true"`, or `"false"`. |
| `docker-push` | boolean | `false` | Also publish Docker on an allowed non-PR run after required jobs pass. Use unquoted YAML `true` / `false`. |
| `docker-image` | string | empty | Full image name without tag/digest; defaults to lowercased `ghcr.io/<owner>/<repository>`. |
| `contract-guard` | string | `auto` | Run Contract Guard: `auto`, `"true"`, or `"false"`. |
| `contract-guard-project-id` | string | empty | Project ID; its presence enables Contract Guard in auto mode. |
| `contract-candidate-path` | string | `openapi.yaml` | Workspace-relative candidate contract path. |
| `contract-fail-on` | string | `failed` | Contract Guard gate threshold: `failed`, `warnings`, or `never`. |

`true` mode forces a job even when its detection marker is absent; it does not create missing project files. `false` skips it even if a marker exists. Mode strings reject values other than `auto`, `true`, and `false`.

## Secrets

Pass secrets by name under the calling job's `secrets:` mapping.

| Secret | Required | Behavior |
| --- | --- | --- |
| `packages-token` | No | Dependency token forwarded to Java/Node only on events other than `pull_request`. Empty by default; the workflow does not automatically substitute `github.token`. |
| `registry-password` | No | Docker publishing token; falls back to `github.token` when absent. Used only by the publish job. |
| `contract-guard-token` | When Contract Guard runs | Project-scoped Contract Guard token for the selected project. The workflow schema permits omission because the Contract Guard job can be disabled. |
| `discord-webhook` | No | Discord webhook URL. Empty/unavailable skips the notification step. |

GitHub ordinarily withholds repository secrets from fork PRs. This workflow also withholds the dependency token from same-repository `pull_request` builds, skips Contract Guard on fork PRs, and never publishes during `pull_request`. Same-repository Contract Guard PR checks can use the project token. Do not use `pull_request_target` to run untrusted checkout/build code with privileged credentials: the workflow's explicit PR protections test the `pull_request` event name. Your caller triggers and branch/environment policies determine which non-PR refs are trusted.

## Detection and job ordering

Detection examines the checkout root only; it does not recursively discover projects.

| Capability | Auto-detection marker |
| --- | --- |
| Java | Any of `gradlew`, `build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`, `mvnw`, `pom.xml` |
| Node | `package.json` |
| Rust | `Cargo.toml` |
| Docker | `Dockerfile` |
| Contract Guard | Nonempty `contract-guard-project-id`; candidate file existence is checked by the action later |

After detection, Java, Node, Rust, and a build-only Docker job run independently. They use their respective helpers' defaults, apart from Java/Node version and the supplied dependency token. Review the [helper guides](helpers/README.md) for wrappers, lockfiles, registry defaults, test commands, reports, and toolchain requirements.

Contract Guard waits for Java/Node/Rust and runs only if each succeeded or was skipped. It does not wait for Docker build. A fork PR skips Contract Guard. An enabled Contract Guard check still needs both the valid project ID and its token.

Docker publish waits for detection, Java, Node, Rust, Docker build, and Contract Guard. It runs only when `docker-push` is true, Docker was selected, Docker build succeeded, all language/Contract Guard jobs succeeded or were skipped, and the event is not `pull_request`. It rebuilds in a separate job; cache reuse may accelerate that second build. It logs into GHCR, publishes with the requested image name, and sets BuildKit `sbom: "true"` and `provenance: mode=max`. It does not run `actions/attest` or call GitHub's attestation API.

The notification job runs after the language, Docker, and Contract Guard jobs, with `always()`. If a webhook exists, failure takes precedence over cancellation, otherwise it sends success. Skipped jobs alone count as success. Detection is not included directly in the notification's dependency result aggregation, so inspect the actual workflow job results when diagnosing a detection failure. Notification delivery can fail the notification job.

## Example: Contract Guard plus trusted Docker publication

Store the project ID in `ALCONITE_CONTRACT_GUARD_PROJECT_ID` and a matching token in `ALCONITE_CONTRACT_GUARD_TOKEN`, then use:

```yaml
name: CI and publish
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
      contract-guard-project-id: ${{ vars.ALCONITE_CONTRACT_GUARD_PROJECT_ID }}
      contract-candidate-path: openapi/api.yaml
      contract-fail-on: failed
      docker-push: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
    secrets:
      contract-guard-token: ${{ secrets.ALCONITE_CONTRACT_GUARD_TOKEN }}
      discord-webhook: ${{ secrets.DISCORD_WEBHOOK }}
```

The default `github.token` authenticates GHCR publishing. Add `packages-token: ${{ secrets.PACKAGES_READ_TOKEN }}` under `secrets:` for private Java/Node dependency reads on non-PR runs. If PR tests also require private dependencies, use your own carefully scoped trusted-job design with the direct helpers; this workflow intentionally passes no dependency credential on PRs.

The workflow does not expose `registry` or `registry-username`. `docker-image` alone cannot configure a different login host, so use [Docker CI](helpers/docker-ci.md) directly for other registries. Direct use also lets you disable BuildKit metadata for registries that cannot store it, or add a separate optional GitHub attestation step on a supported plan.

## Outputs and customization limits

The reusable workflow declares **no caller-visible outputs**. Its detection outputs are internal job outputs; image digest and Contract Guard outputs are not forwarded through `workflow_call`. Call the corresponding component directly when another job needs a digest, check ID, report path, or build-tool output.

Java publishing, Impact, and Runtime Verify are not part of Stack CI. Add them as separate jobs according to their guides. The workflow also does not expose working directories, language task/script overrides, Rust feature controls, Docker platforms, custom registry routing, report-upload switches, runner labels, or environment approvals. See [getting started](getting-started.md) to choose the appropriate entry point.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Workflow cannot request packages write | Grant the calling job `packages: write`, or use direct build helpers if your policy disallows that request. |
| A capability was skipped | Ensure its marker is at repository root, set its mode, or call the helper with `working-directory`. |
| Java or Node dependency authentication fails on PR | The dependency secret is deliberately withheld for all `pull_request` events. |
| Contract Guard was skipped | Check project ID/mode, fork status, and language-job results. |
| Docker publish was skipped | Check `docker-push`, event, Docker detection/build, and prior language/Contract Guard results. |
| Registry errors with a custom image host | The workflow logs into GHCR; use the standalone Docker helper for custom registry settings. |
| Attestation feature unavailable | Stack CI no longer requests GitHub attestations. Inspect any extra steps in your caller and distinguish BuildKit/registry errors. |
| GitHub Enterprise Server failure | Removing attestation does not guarantee GHES compatibility; see [enterprise runner limits](helpers/README.md#enterprise-environments). |

See [shared troubleshooting](troubleshooting.md) for ecosystem integration errors.
