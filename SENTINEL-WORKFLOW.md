# Sentinel production workflows

Reviewed against Alconite Platform and the public Actions v2.5.0 release on 2026-09-28.

This guide covers one API, a gateway with multiple providers, separate repositories,
and verification after deployment. All Action examples use the published immutable
commit `d7600531a8e7eb6de79b8aa2e17014d768d538ce`. They use existing public Action
inputs; publishing this guide does not deploy platform changes.

**Platform rollout prerequisite:** this review found that identical CI uploads
reuse a stored version that Guard and Impact previously rejected. The accompanying
platform fix allows unchanged comparisons through normal policy evaluation and
produces an empty-delta Impact result. Deploy that fix before using the unchanged
candidate acceptance test below. No new Action input or bundle is needed. This
guide does not assert that the fix is already running on the hosted platform.

## Optional platform-managed onboarding

The accompanying platform implementation adds opt-in draft workflow PRs and
selected approved-contract reference updates. It requires a separate platform
rollout and GitHub App permission approval; installing Actions v2.5.0 alone does
not enable it.

Connect a repository, discover/import its OpenAPI document, approve the baseline,
and choose **Create workflow PR** when the platform exposes that control. The
generated workflow uses these released Guard and Impact actions. Add one project
token with `versions:write`, `checks:write`, and `impact:write` as the repository
secret `ALCONITE_PROJECT_TOKEN`, then review the PR and require the Sentinel job.
The App does not install secrets or configure branch protection.

On a dependent project, **Add dependency** previews selected upstream tags,
exact paths, or operation IDs before saving the approved selection. Subsequent
upstream baseline approvals can propose only two managed files:
`.alconite/contracts/<name>.openapi.json` and `<name>.lock.json`. Ordinary checks
do not publish. Unrelated selected-content changes produce no update, closed
same-content PRs are respected, and no PR is auto-merged or branch force-pushed.

App delivery needs Contents write and Pull requests write on the selected
repository; workflow proposals additionally need Workflows write. These are
server-side App permissions, not permissions to add to the read-only CI job.
Public exports require explicit consent. See the rollout-gated
[platform automation guide](https://alconite.com/platform/documentation/github-actions/contract-publication-automation)
for operational limits and recovery.

Reference migration acknowledgement is not provider conformance. The generated
Guard/Impact steps still compare the dependent application's own contract, not
an implicit cross-project parent check. Keep provider integration tests required
and use the explicit comparison workflows below where upstream source-impact
evidence is needed.

## What each gate can establish

| Question | Capability | Public integration |
| --- | --- | --- |
| Does a proposed OpenAPI revision violate our compatibility/release policy? | Contract Guard compares it with the project's approved baseline. | Root `alconite-inc/alconite-actions` |
| Where does that contract change have recognizable source references? | Impact correlates typed contract deltas with Rust, Java, TypeScript, and JavaScript source. | `alconite-inc/alconite-actions/impact` |
| Do selected deployed responses match the approved contract? | Runtime Verify runs configured GET/HEAD scenarios and validates their responses. | `alconite-inc/alconite-actions/runtime-verify` |
| Does every provider implement every obligation of a parent gateway specification? | Not a built-in Sentinel conformance mode. Use provider integration tests and gateway tests; Runtime Verify adds bounded response checks. | Customer test jobs plus the integrations above |

Impact is a change-impact analyzer, not a provider implementation validator. If a
provider changes its implementation while the OpenAPI contract stays unchanged,
there may be no contract deltas for Impact to correlate. A successful Impact
analysis cannot establish that this implementation is correct.

Likewise, `overall-risk: NONE` means no detected source risk. It is not proof of
compatibility, full repository coverage, or runtime behavior. Potential risk
describes contract-change severity even when no source evidence is found.

## The gateway and provider model

Consider a commerce gateway exposing `GET /customers/{id}` and `GET /orders`.
The customers and orders services implement different subsets behind it.

```text
Gateway approved OpenAPI -> proposed gateway OpenAPI -> Contract Guard
                                                            |
                                                      exact check-id
                                                            |
                                 +--------------------------+----------------+
                                 |                          |                |
                          customers source             orders source    storefront source
                                 |                          |                |
                               Impact                     Impact           Impact

Provider integration tests + gateway integration tests
                                 |
                          release decision
                                 |
                  deploy exact tested revisions
                                 |
             Runtime Verify: explicit gateway/provider scenarios
```

Use one Sentinel project for the gateway's evolving public contract. Use separate
projects when providers publish independently versioned internal contracts.
The public Actions do not create project relationships or infer gateway route
ownership. Optional platform automation can save explicit selected-surface
dependencies, as described above.

Do not compare the entire gateway baseline with a customers-only candidate and
interpret removed orders routes as a provider failure. Guard compares whole API
revisions; it does not know which service owns each route.

For contract-first providers, pin the gateway contract revision used by provider
tests. For independently described providers, define and version the owned
contract surface and any route/schema transformations in your build. A parent
projection must preserve required references and request/response direction.
The platform's opt-in bounded projection supports selected operations and local
components. Gateway composition and route/schema transformations remain customer
tooling. Internal paths and response envelopes may legitimately differ from the
public gateway.

A source-impact finding can identify affected implementation code or consumers.
It does not distinguish a correct implementation from an incorrect one merely
because both mention the same field.

## Onboard once

1. Open [Sentinel contracts](https://alconite.com/platform/sentinel/contracts),
   select the intended workspace, and create a project.
2. Upload the currently published OpenAPI 3.0/3.1 JSON or YAML, or import its exact
   GitHub revision through the
   [GitHub App onboarding flow](https://alconite.com/platform/documentation/contract-guard/github-repository-onboarding).
3. Review that version and explicitly approve the initial baseline.
4. Create project tokens with the scopes below.
5. Set the GitHub variable and secrets, add the workflow, and run an unchanged
   candidate followed by a known breaking candidate.
6. Make the intended CI job a required check and make deployment depend on it.

Importing a document does not approve a baseline. The public Actions do not create
projects, approve baselines, or configure policies. A token-backed first check
without an established baseline is not a successful onboarding path.

| GitHub setting | Value |
| --- | --- |
| Variable `ALCONITE_PROJECT_ID` | The actual `cgprj_` identifier from the project |
| Secret `ALCONITE_CONTRACT_TOKEN` | `versions:write` and `checks:write` |
| Secret `ALCONITE_IMPACT_TOKEN` | `impact:write`, belonging to the same project as the check |
| Secret `ALCONITE_RUNTIME_TOKEN` | `checks:read`, `runtime:read`, and `runtime:write` |
| Variable `ALCONITE_RUNTIME_ENVIRONMENT_ID` | The project's configured `rtvenv_` environment |
| Variable `ALCONITE_RUNTIME_BASE_URL` | The target origin/path allowed by that environment |

A single token with the union of required scopes also works. Neither Guard nor
Impact needs `checks:read` for the chain shown below. GitHub's `GITHUB_TOKEN`
does not replace an Alconite token. The GitHub App imports a selected OpenAPI blob;
it does not install workflows or automatically fan changes out to providers.

## Pattern 1: one repository, Guard and Impact

Place this in `.github/workflows/sentinel.yml`. Keep build/test jobs alongside
it. The job assumes reviewed same-repository contributions; fork PRs have no
Alconite credentials and need a separate trusted integration process.

```yaml
name: Sentinel contract and impact
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  sentinel:
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Check the candidate
        id: guard
        uses: alconite-inc/alconite-actions@d7600531a8e7eb6de79b8aa2e17014d768d538ce # v2.5.0
        with:
          project-id: ${{ vars.ALCONITE_PROJECT_ID }}
          project-token: ${{ secrets.ALCONITE_CONTRACT_TOKEN }}
          candidate-path: openapi.yaml
          fail-on: failed
      - name: Analyze every completed check, including rejected candidates
        id: impact
        if: ${{ !cancelled() && steps.guard.outputs.check-id != '' }}
        uses: alconite-inc/alconite-actions/impact@d7600531a8e7eb6de79b8aa2e17014d768d538ce # v2.5.0
        with:
          project-id: ${{ vars.ALCONITE_PROJECT_ID }}
          project-token: ${{ secrets.ALCONITE_IMPACT_TOKEN }}
          check-id: ${{ steps.guard.outputs.check-id }}
          source-root: .
          fail-on-risk: high
          fail-on-potential-risk: never
      - name: Require an untruncated impact report
        if: ${{ !cancelled() && steps.impact.outputs.report-truncated == 'true' }}
        run: |
          echo "Impact report was truncated; narrow the source selection and review again." >&2
          exit 1
      - name: Preserve Guard report
        if: ${{ !cancelled() && steps.guard.outputs.report-path != '' }}
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: sentinel-contract
          path: ${{ steps.guard.outputs.report-path }}
          retention-days: 7
          if-no-files-found: error
      - name: Preserve Impact report
        if: ${{ !cancelled() && steps.impact.outputs.report-path != '' }}
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: sentinel-impact
          path: ${{ steps.impact.outputs.report-path }}
          retention-days: 7
          if-no-files-found: error
```

A rejected Guard gate remains a failed job even if Impact succeeds. No
`continue-on-error` is needed. The explicit status function allows the diagnostic
step to run after a failed step; an authentication or processing failure without
a completed check ID does not run Impact.
See [GitHub status expressions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions).

Contract-only adoption: omit Impact, its report step, and its truncation check.
Report-only Impact adoption: set both risk thresholds to `never` while keeping
Guard enforcement. Full strict adoption: use Guard `fail-on: warnings` and choose
explicit Impact thresholds.

## Pattern 2: one gateway check, several source roots

In a monorepo, run Guard once and expose `steps.guard.outputs.check-id` as a job
output. Analyze each provider/consumer in a matrix using that same immutable
check. This avoids charging a separate contract check for each source root.

The following is a **job fragment** to add alongside a job named `gateway`.
That job must declare:
`outputs: {check-id: "${{ steps.guard.outputs.check-id }}"}`.

```yaml
provider-impact:
  needs: gateway
  if: ${{ !cancelled() && needs.gateway.outputs.check-id != '' }}
  runs-on: ubuntu-24.04
  timeout-minutes: 10
  strategy:
    fail-fast: false
    matrix:
      source: [services/customers, services/orders, apps/storefront]
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      with:
        persist-credentials: false
    - id: impact
      uses: alconite-inc/alconite-actions/impact@d7600531a8e7eb6de79b8aa2e17014d768d538ce # v2.5.0
      with:
        project-id: ${{ vars.ALCONITE_PROJECT_ID }}
        project-token: ${{ secrets.ALCONITE_IMPACT_TOKEN }}
        check-id: ${{ needs.gateway.outputs.check-id }}
        source-root: ${{ matrix.source }}
        fail-on-risk: high
        fail-on-potential-risk: never
```

Set deployment dependencies to include `gateway`, `provider-impact`, and your
provider/gateway test jobs. Each matrix item has its own scan; evidence paths
remain workspace-relative. Give retained artifacts unique names per matrix item.

Potential risk comes from the shared contract delta. Setting
`fail-on-potential-risk: high` on every item intentionally blocks even unrelated
services for a high-severity gateway change. Use detected risk for source
triage and Guard for the central compatibility decision.

## Pattern 3: provider source in another repository

An Impact token belongs to the gateway contract project. It may scan source
checked out in a provider repository; the repository itself does not have to be
the gateway's repository. This does not create a persisted dependency graph.

A provider-owned workflow can accept an exact completed gateway check and an
exact provider commit. This example deliberately uses manual dispatch so that
the cross-repository orchestration is visible. A release coordinator can
dispatch the same workflow and wait for its result.

```yaml
name: Provider impact against gateway change
on:
  workflow_dispatch:
    inputs:
      gateway_check_id:
        description: Completed retained gateway check ID
        required: true
        type: string
      provider_commit:
        description: Full provider commit SHA to analyze
        required: true
        type: string
permissions:
  contents: read
jobs:
  impact:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - name: Require an immutable source revision
        env:
          PROVIDER_COMMIT: ${{ inputs.provider_commit }}
        shell: bash
        run: |
          [[ "$PROVIDER_COMMIT" =~ ^[0-9a-f]{40}$ ]] || exit 1
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ inputs.provider_commit }}
          persist-credentials: false
      - id: impact
        uses: alconite-inc/alconite-actions/impact@d7600531a8e7eb6de79b8aa2e17014d768d538ce # v2.5.0
        with:
          project-id: ${{ vars.ALCONITE_PROJECT_ID }}
          project-token: ${{ secrets.ALCONITE_IMPACT_TOKEN }}
          check-id: ${{ inputs.gateway_check_id }}
          source-root: src
          fail-on-risk: high
          fail-on-potential-risk: never
      - name: Preserve source-impact report
        if: ${{ !cancelled() && steps.impact.outputs.report-path != '' }}
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: provider-impact
          path: ${{ steps.impact.outputs.report-path }}
          retention-days: 7
          if-no-files-found: error
```

A dispatch request being accepted is not a passing provider gate. The coordinator
must wait for every required run, fail on missing/failed/cancelled/timed-out runs,
and tie each result to the gateway check and provider SHA. Keep the coordinator's
repository list and token permissions under release-owner control.

To make a provider PR check automatically, provide a reviewed gateway check ID
through your integration configuration. That checks the impact of that existing
gateway delta against the new provider source. It still cannot detect arbitrary
provider regressions against an unchanged parent contract.

Cross-repository dispatch, source checkout authorization, result aggregation,
branch protection, and release ordering remain GitHub/customer responsibilities.
The Actions neither clone other repositories themselves nor dispatch other CI jobs.

## Pattern 4: verify a deployed gateway or provider

Create a Runtime environment in the same project and allow the exact target
base URL. Keep the approved contract bytes with the deployed revision.
For the commerce gateway, a configuration might be:

```yaml
version: 1
defaults:
  timeoutSeconds: 10
  maximumResponseBytes: 1048576
  followRedirects: false
operations:
  - operationId: getCustomer
    pathParameters:
      id: contract-test-customer
    headers:
      Authorization:
        fromEnvironment: SENTINEL_TARGET_AUTHORIZATION
    expect:
      statuses: [200]
      contentTypes: [application/json]
  - operationId: listOrders
    headers:
      Authorization:
        fromEnvironment: SENTINEL_TARGET_AUTHORIZATION
    expect:
      statuses: [200]
      contentTypes: [application/json]
```

Add this **step fragment** to a trusted post-deployment job that checks out the
exact deployed revision. The target secret includes its complete header value
(for example, `Bearer ...`); it is separate from the Alconite project token.

```yaml
- name: Verify deployed contract behavior
  id: runtime
  uses: alconite-inc/alconite-actions/runtime-verify@d7600531a8e7eb6de79b8aa2e17014d768d538ce # v2.5.0
  env:
    SENTINEL_TARGET_AUTHORIZATION: ${{ secrets.SENTINEL_TARGET_AUTHORIZATION }}
  with:
    project-id: ${{ vars.ALCONITE_PROJECT_ID }}
    project-token: ${{ secrets.ALCONITE_RUNTIME_TOKEN }}
    environment-id: ${{ vars.ALCONITE_RUNTIME_ENVIRONMENT_ID }}
    base-url: ${{ vars.ALCONITE_RUNTIME_BASE_URL }}
    contract-path: openapi.yaml
    configuration-path: .alconite/runtime-verify.yaml
    deployment-id: ${{ github.sha }}
    fail-on: failed
```

Here `github.sha` must be the deployed revision. When verifying a different
revision through manual dispatch, use the resolved deployed SHA instead.

Normally omit `check-id`: the platform resolves an approved check for the exact
contract hash. A contract file change, including most formatting changes, can
invalidate that identity. The platform's contract hash normalizes carriage
returns; it is not a semantic schema hash. Do not regenerate the contract at
verification time or substitute the newest contract from another branch.

To verify a provider directly, select only that provider's operations and use a
separately allowed environment. This is valid only when method, path, parameters,
and response shape match the selected contract. Route rewrites and response
transformations must be tested at the gateway or represented by the provider's
own contract/project.

Runtime Verify checks configured GET/HEAD responses and supported schema
constraints. It does not exhaust inputs, test writes, infer business invariants,
or prove authentication enforcement. Keep provider integration tests for those
requirements. Use stable fixtures and explicit scenarios, not merely a health
endpoint.

## Other integration shapes

- **Reusable stack workflow:** `stack-ci.yml` composes language builds, Docker,
  and Guard. It does not currently include Impact. Add a separate Impact job with
  an explicitly supplied completed check, or use the direct Actions when one
  seamless Guard-to-Impact chain is required.
- **Reusable Runtime workflow:** available for unauthenticated target operations.
  Use the direct Action to map arbitrary target credentials explicitly.
- **Other CI systems:** the published Sentinel executor container exposes
  `sentinel contract-guard`, `sentinel impact`, and `sentinel runtime-verify`.
  Mount source read-only and reports separately, supply project tokens through
  its documented secret interface, pin its image digest, and propagate its exit
  code. See the
  [container guide](https://alconite.com/platform/documentation/github-actions/sentinel-container).
- **REST/MCP:** use the same platform comparison and analysis services. A completed
  failed Guard gate can still be HTTP 200; inspect `gateResult`. Public Impact
  requests use a retained check ID and bounded source manifest, not arbitrary
  baseline/candidate uploads.

## Action coverage and deliberate boundaries

| Operation | Action coverage / boundary |
| --- | --- |
| Upload candidate, compare approved baseline, enforce policy | Root Action |
| Return check ID, hashes, gate, counts, report | Root Action outputs |
| Retry a logical check idempotently | Root Action; generated key or `idempotency-key` |
| Analyze an existing check and collect supported source | Impact Action |
| Restrict source root, extra ignores, generated directory opt-in | Impact Action |
| Fail on detected and/or potential risk | Impact Action; both default to `never` |
| Return evidence counts, fingerprint, truncation and collection accounting | Impact Action outputs and JSON report |
| Verify explicit deployed GET/HEAD scenarios | Runtime Verify Action |
| Create project, import/publish a standalone version, promote baseline, change policy, mint token | Platform management workflow, not public Action inputs |
| Arbitrary two-file offline diff or local source conformance | Not provided by these Actions |
| Explicit selected-surface subscriptions and approved reference-update PRs | Optional platform automation; not public Action inputs |
| Inferred parent ownership, provider discovery, implementation conformance | Not provided |
| Run source, resolve application dependencies, compile provider implementation | Customer build/test jobs |
| Persist Impact source/report history on Alconite | Not provided; analysis is ephemeral |
| Persist reports in customer CI | Explicit artifact step; customer access/retention policy |

Guard uses `retry-attempts`; Impact uses `attempts`. Guard gates are `failed`,
`warnings`, or `never`; Impact thresholds are `never`, `low`, `medium`, `high`,
or `critical`. Guard result values include `passed_with_warnings`.

Impact's recognizers are lexical and bounded. They do not resolve arbitrary
imports, dynamic routes, macros, cross-file inferred types, or transitive schema
composition. Inspect collector/server skip counts, warnings, and truncation.
An untruncated report is not equivalent to complete source coverage. Generated
code is excluded by default; opt in only for relevant source and review the
resulting scan budget.

## Release acceptance cases

Before making the gate mandatory, demonstrate all of these on a nonproduction
project and representative service:

| Case | Expected evidence |
| --- | --- |
| Unchanged contract and healthy implementation | Guard passes under the selected policy; runtime scenarios pass |
| Remove required response field used by a consumer | Guard rejects under breaking-change policy; Impact identifies recognizable references |
| Same removal, unrelated source root | Detected risk may be NONE; potential risk remains visible; Guard still blocks |
| Provider returns a malformed response with unchanged OpenAPI | Guard/Impact may pass; provider tests or Runtime Verify must fail |
| Provider owns a strict subset of gateway routes | Do not submit the subset as a replacement for the whole gateway |
| Missing/invalid token, missing baseline, expired check | Pipeline fails setup/processing; no success inference from missing output |
| Output truncation or unexpectedly missing source | Required review/coverage decision before release |
| Contract hash differs from approved/deployed contract | Runtime initiation fails |
| One downstream provider run fails or never returns | Coordinator blocks the release |
| Fork contribution | Build/test remains useful; token-backed checks require trusted integration |

Use branch protection for the final release decision. Do not let a skipped
credential-backed job stand in for full external-contribution verification.
GitHub documents [fork secret restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
and [reusable workflow placement](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).

These workflows improve release evidence. Complete provider conformance requires
test coverage of the owned contract and the gateway's transformations, in addition
to the Sentinel gates.
