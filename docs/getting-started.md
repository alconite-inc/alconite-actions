# Getting started

Alconite Actions can add a single check to an existing pipeline or provide a shared CI convention for an organization. Start with one component, verify its result on a trusted branch, then make the relevant check required in your repository's branch policy.

These examples describe the prepared **v2.5.0** release. Publish that release before adopting the new tag. See [versioning and SHA pins](versioning.md) for release availability and the verified commit reference.

## Choose an integration

| You want to… | Start with… |
| --- | --- |
| Check an OpenAPI change before merge | The root [Contract Guard Action](../README.md#contract-guard-quick-start). |
| Understand which checked-out source may be affected | [Impact](../README.md#alconite-impact), using a completed Contract Guard `check-id`. |
| Verify the deployed API against its approved contract | [Runtime Verify](../README.md#runtime-verify), after deployment. |
| Add build/test behavior to existing jobs | One of the [individual helper Actions](helpers/README.md). |
| Adopt Java, Node.js, Rust, Docker, and Contract Guard CI together | The [Stack CI reusable workflow](stack-ci.md). |
| Use Docker locally or a CI service other than GitHub | The [Sentinel executor container](../README.md#sentinel-container). |

The language, Docker, and Discord helpers do not need an Alconite subscription or project token. Contract Guard, Impact, and Runtime Verify call the Alconite platform and require an authorized project token with the appropriate product access and scopes.

## Prepare the repository

Use a Linux runner such as `ubuntu-24.04`. The JavaScript entry points use Node 24 through the Actions runner; consumers do not need to run `npm install` in this repository. Java, Node.js, and Rust helpers install or select the requested toolchains. Impact requires Linux filesystem protections and rejects unsupported operating systems. For self-hosted or GitHub Enterprise Server environments, review [compatibility guidance](troubleshooting.md#enterprise-environments-and-attestations) before adoption.

Commit the files needed by the selected component:

| Component | Repository prerequisite |
| --- | --- |
| Contract Guard | An OpenAPI 3.0 or 3.1 JSON/YAML candidate; default `openapi.yaml`. |
| Impact | Supported Rust, Java, TypeScript, or JavaScript source under the selected `source-root`; a completed check for the same Alconite project. |
| Runtime Verify | The exact approved contract and an explicit operation list in `.alconite/runtime-verify.yaml`. |
| Java CI / publish | A Gradle or Maven project and its wrapper files. Publishing also requires repository publication configuration. |
| Node.js | `package.json`, a committed lockfile, and the selected package script; pin pnpm or Yarn as described in the helper reference. |
| Rust | `Cargo.toml`, normally `Cargo.lock` for locked execution, and optionally a Rust toolchain file. |
| Docker | A Dockerfile and build context. Supply registry credentials only when publishing. |
| Discord | A Discord webhook stored in a GitHub secret. |

The direct Actions operate on the current checkout. Add `actions/checkout` first, using `persist-credentials: false` unless another step explicitly requires persisted Git authentication. Relative paths resolve from the workspace or the helper's documented `working-directory`; a `defaults.run.working-directory` setting does not configure an Action's inputs. For a monorepo, pass the component's path input explicitly.

## Create the Alconite credentials

In the Alconite project, create a scoped project token. Store non-secret identifiers as GitHub repository variables and tokens as repository or protected environment secrets. The examples use the following names; the Action only cares about the values passed to its inputs.

| GitHub setting | Used by | Value |
| --- | --- | --- |
| Variable `ALCONITE_CONTRACT_GUARD_PROJECT_ID` | All three Alconite components | Your `cgprj_` project identifier. |
| Secret `ALCONITE_CONTRACT_GUARD_TOKEN` | Contract Guard | Token with `versions:write` and `checks:write`. |
| Secret `ALCONITE_IMPACT_TOKEN` | Impact | Token with `impact:write` for the same project. |
| Variable `ALCONITE_RUNTIME_ENVIRONMENT_ID` | Runtime Verify | The `rtvenv_` environment created in Alconite. |
| Secret `ALCONITE_RUNTIME_VERIFY_TOKEN` | Runtime Verify | Token authorized for initiation, result submission, and failure reporting in that project/environment. |
| Secrets named for your target credentials | Authenticated Runtime Verify operations | Map each secret explicitly to the uppercase environment name used by the configuration. |

An organization can use one project token with all required scopes for a chained workflow, or separate tokens for each component. GitHub's `${{ github.token }}` authenticates GitHub services; it cannot replace an Alconite project token. A GitHub `permissions:` block changes `GITHUB_TOKEN` capabilities and does not grant Alconite scopes.

## Add your first contract workflow

Create `.github/workflows/contract.yml` in your application repository. Replace the contract path if needed and populate the variable and secrets above. Impact is optional; remove that step and its upload step if you only want Contract Guard.

```yaml
name: API contract

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  contract:
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - name: Check contract compatibility
        id: guard
        uses: alconite-inc/alconite-actions@v2.5.0
        with:
          project-id: ${{ vars.ALCONITE_CONTRACT_GUARD_PROJECT_ID }}
          project-token: ${{ secrets.ALCONITE_CONTRACT_GUARD_TOKEN }}
          candidate-path: openapi.yaml
          fail-on: failed

      - name: Analyze impact on source
        id: impact
        if: steps.guard.outcome == 'success'
        uses: alconite-inc/alconite-actions/impact@v2.5.0
        with:
          project-id: ${{ vars.ALCONITE_CONTRACT_GUARD_PROJECT_ID }}
          project-token: ${{ secrets.ALCONITE_IMPACT_TOKEN }}
          check-id: ${{ steps.guard.outputs.check-id }}
          fail-on-risk: never
          fail-on-potential-risk: never

      - name: Preserve Contract Guard report
        if: ${{ always() && steps.guard.outputs.report-path != '' }}
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: contract-guard-report
          path: ${{ steps.guard.outputs.report-path }}
          if-no-files-found: error
          retention-days: 7

      - name: Preserve Impact report
        if: ${{ always() && steps.impact.outputs.report-path != '' }}
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: impact-report
          path: ${{ steps.impact.outputs.report-path }}
          if-no-files-found: error
          retention-days: 7
```

Run this on a trusted branch, then open the Actions run's summary and report artifacts. Contract Guard fails the job if the platform gate is `failed`; Impact initially reports risk without failing the job. Choose `low`, `medium`, `high`, or `critical` thresholds when your team is ready to enforce source-evidenced and/or potential risk. A completed failed gate is a usable report, while authentication or input failures may produce no report.

Impact uploads selected source to Alconite for ephemeral analysis. The platform does not persist that source or the Impact report. The optional GitHub artifact uploads above retain the canonical reports under your repository's access and retention settings; choose retention appropriate for your organization. Do not attach those reports to public issues.

## Add a build helper to an existing workflow

Individual Actions are steps in a normal job. For example, this Node.js job requires no Alconite credential:

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
      - uses: alconite-inc/alconite-actions/node-ci@v2.5.0
        with:
          node-version: "24"
          package-manager: auto
          script: test
```

A reusable workflow has a different placement: set `jobs.ci.uses` to `alconite-inc/alconite-actions/.github/workflows/stack-ci.yml@v2.5.0`. That job does not also define `runs-on` or `steps`. Pass its inputs through job-level `with:` and its secrets through job-level `secrets:`. Copy the complete [stack examples](stack-ci.md) for the necessary permissions and detection settings.

## Keep build and publication credentials scoped

| Operation | GitHub token permissions | Additional credential |
| --- | --- | --- |
| Direct public build/test, Contract Guard, Impact, Runtime Verify | `contents: read` for checkout | Alconite token only for the Alconite components. |
| Read private GitHub Packages dependencies | `contents: read`, `packages: read` when using `github.token` | A package token with access to the dependency; cross-repository packages may need an explicit grant or separate token. |
| Direct Java or GHCR publication | `contents: read`, `packages: write` when using `github.token` | `packages-token` for Java or `registry-password` for Docker. |
| Discord notification in an existing job | No additional GitHub permissions | `webhook-url` secret. |

The stack workflow declares permissions for its reusable jobs; use the caller permissions shown in its [reference](stack-ci.md). No consumer Action or stack publication requires `id-token: write` or `attestations: write`.

Fork pull requests do not ordinarily receive repository secrets. Keep build/test jobs usable without secrets and skip token-backed Alconite checks and publication on untrusted contributions. The stack additionally withholds its private package token from **all** `pull_request` builds, including same-repository PRs. If tests need private dependencies, run the credential-bearing variant only on reviewed, trusted code. Do not use `pull_request_target` to check out and execute untrusted PR code with secrets.

The direct Docker and Java publishing helpers obey their inputs; the caller must restrict them to trusted events. For Docker, `push: "true"` deliberately requests publication. Protect release branches/tags or use a protected environment as appropriate to your repository.

## Verify after deployment

After your deployment job succeeds, add [Runtime Verify](../README.md#deployment-stage-workflow) in a trusted job. Check out the commit that was deployed, use its exact contract, and provide a deployment identifier such as `${{ github.sha }}`. Normal verification omits `check-id`; the platform resolves an approved Contract Guard check for that exact project and contract.

Configure a small, explicit set of `GET` or `HEAD` operations and ensure the runner can reach the target origin. For authenticated operations, pass target credentials through `env:` names referenced by the configuration. Target requests execute from your runner. The reusable Runtime Verify workflow is intended for unauthenticated targets because it does not forward arbitrary target secrets.

Before rolling out across repositories, select the required gate policy, confirm private report retention, and replace friendly release tags with the [verified full commit SHA](versioning.md) if your organization requires immutable references. Consult [troubleshooting](troubleshooting.md) for common setup and compatibility failures.
