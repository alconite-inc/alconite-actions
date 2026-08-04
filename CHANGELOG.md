# Changelog

All notable changes to this project are documented in this file.

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
