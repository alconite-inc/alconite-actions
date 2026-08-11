# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [2.2.0] - 2026-08-11

### Added

- Additive `impact/` Node 24 Action for check-linked API change impact analysis against Rust, Java, TypeScript, and JavaScript source in the checked-out workspace.
- Strict `alconite.impact.report.v1` validation, authoritative-versus-client source accounting, detected and potential risk gates, bounded job summaries, and creation-only private report output.
- Single-pass, Git-ignore-aware collection with deterministic ordering, fixed resource budgets, link/race protection, an overall Action deadline, and an explicit transient retry allowlist.

### Security

- Source and ignore files are never executed and are read through verified file handles with pre/open/post identity and containment checks; source contents, tokens, and host paths are not logged.
- Impact reports are created exclusively through descriptor-anchored Linux paths below a verified `RUNNER_TEMP` root outside the workspace, with private modes and whole-directory swap detection. Windows Node 24 lacks the portable no-follow/reparse/mode primitives required by the source/report boundary and therefore fails before collection or source submission.
- Workspace and report roots are now opened component-by-component from pinned parent descriptors; failed reports are scrubbed only through their retained file descriptor, and summary evidence is rendered with inert Markdown punctuation.
- Runner manifests now enforce the platform's exact portable component grammar, and strict response validation binds every count, affected path, warning path, risk elevation, and Contract Delta identity to the submitted inline manifest.
- The v2 release workflow now verifies and attests the checked-in `impact/dist` bundle alongside the Contract Guard and Runtime Verify distributions.
- Report-directory permissions are enforced only through the verified child descriptor, and pre-bind symlink or regular-directory swaps cannot redirect `chmod` to an attacker-selected target.
- Report v1 validation now mirrors all 47 Contract Delta v1 subject/category/order rules and recomputes exact Impact v1 potential, detected, and Critical risk policy; future semantic engine versions remain structurally validated without inheriting v1 policy.
- Response-body resets and live upstream aborts use the existing bounded retry/deadline policy instead of being misreported as an expired Action deadline.

### Changed

- Published Contract Guard, Runtime Verify, and Impact under one repository-wide v2.2.0 release identity, including synchronized runner metadata and outbound user agents.
- Updated current component and reusable-workflow examples to v2.2.0 and aligned report uploads with the reviewed `actions/upload-artifact` v7.0.1 commit.

### Documentation

- Documented the released Impact workflow, exact token scopes, Linux runner boundary, bounded collection and retry behavior, private report lifecycle, and the separation between publishing this Action and enabling the platform feature.

## [2.1.2] - 2026-08-08

### Fixed

- Release a safely identified pending run when initiation-response validation fails so usage is not left reserved until maintenance expiration.

### Documentation

- Clarified the Runtime Verify release compatibility guidance and recommended version.

## [2.1.1] - 2026-08-08

### Fixed

- Aligned Runtime Verify initiation, runner-result, deterministic digest, and canonical report handling with `alconite.runtime-verify.*.v1` in the Alconite Platform OpenAPI contract.
- Read operation limits from the platform's bounded `limits` object and submit sanitized observations and stable finding fingerprints without response-body hashes.
- Accept server-generated informational findings, policy violations, immutable finding identities, and nested approved/local contract metadata.
- Added the official redirect-rejection and content-encoding finding rules to the synchronized runner contract.

### Compatibility

- Runtime Verify from `v2.1.0` is deprecated because its wire model predates the released platform contract. Consumers should move to `v2.1.1` or newer; the Contract Guard root Action in `v2.1.0` is unaffected.

## [2.1.0] - 2026-08-05

### Added

- Customer-runner `runtime-verify/` Action for explicit GET/HEAD verification against approved OpenAPI 3.0/3.1 contracts.
- Strict version-one configuration, local JSON Schema validation, bounded observations/findings, deterministic result digests, contract-hash binding, and replay-aware platform submission.
- Post-deployment reusable Runtime Verify workflow, report artifact preservation, examples, fixtures, and end-to-end mock target/platform coverage.

### Changed

- Added a self-contained Node 24 Runtime Verify distribution while preserving the Contract Guard root Action and every existing component/reusable workflow.
- Extended CI and release validation to require reproducible Runtime Verify bundles, reviewed dependency licenses, and a bounded bundle size.

### Security

- Target credentials resolve only from explicitly configured runner environment variables and are masked before use.
- Target response bodies are validated in memory and never uploaded, logged, or written to disk.
- Remote/filesystem OpenAPI references, mutation methods, cross-origin redirects, unsafe headers, oversized inputs/responses, and unbounded document structures are rejected.
- Pinned YAML 2.9.0 to include the deeply nested collection stack-overflow fix.

## [2.0.0] - 2026-08-04

### Added

- Public root action for synchronous Alconite Contract Guard checks.
- Deterministic idempotency, bounded retries, report validation, JSON persistence, workflow annotations, and job summaries.
- First-class Rust CI action with rustup, formatting, Clippy, tests, release builds, and Cargo caching.
- Capability-based reusable workflow for polyglot Java, Node.js, Rust, Docker, and Contract Guard projects.
- CI fixtures, action metadata validation, actionlint, CodeQL, dependency automation, and release attestations.

### Changed

- Upgraded the default Node.js line from end-of-life Node 20 to Node 24 LTS.
- Pinned external action dependencies to full commit SHAs.
- Split uncredentialed Docker builds from trusted publication.
- Made Java publication self-contained and strictly SemVer-aware.
- Replaced third-party Discord delivery with a dependency-free implementation.
- Replaced the composite stack orchestrator with a reusable workflow.

### Security

- Removed direct action-input interpolation from executable shell source.
- Removed registry credentials from Docker build secrets.
- Stopped persisting raw npm, Gradle, and Maven tokens from composite scripts.
- Reduced default workflow permissions and disabled checkout credential persistence.

## [1.2] - 2026-04-18

- Final v1 release. The v1 line remains frozen for migration.
