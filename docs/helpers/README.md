# CI helpers

The helpers provide build, test, publication, and notification steps for your own workflows. They do not require an Alconite account or project token. Use [Stack CI](../stack-ci.md) to combine the standard root-project conventions, or call individual helpers when you need custom jobs, subdirectories, matrices, or release controls.

All examples use the repository-wide `v2.5.0` release. See [versioning and verified SHA references](../versioning.md) for the matching immutable pins and release assets.

| Helper | Purpose | Writes to an external service by default? |
| --- | --- | --- |
| [Java CI](java-ci.md) | Run wrapper-based Gradle or Maven tests and upload reports | Test report artifacts |
| [Java Publish](java-publish.md) | Publish a versioned Java package | Package registry and JAR artifacts |
| [Node CI](node-ci.md) | Install locked npm, pnpm, or Yarn dependencies and run a script | Test report artifacts |
| [Rust CI](rust-ci.md) | Check formatting, lint, test, and optionally build a release | Cargo cache |
| [Docker CI](docker-ci.md) | Build images; explicitly opt into registry publication | Build cache and upstream build records |
| [Discord Notify](discord-notify.md) | Send a bounded workflow status notification | Discord webhook |

## Common setup

Examples target `ubuntu-24.04`. The composites use Bash and runner tools; use Linux runners with the tools listed in each guide. Self-hosted runners must also support the Node runtime required by the pinned upstream actions. These helpers install language toolchains but do not provision a complete runner machine.

Check out your source before using a build helper. The helper resolves `working-directory`, build context, and report paths against the caller's workspace. A component action selected through `uses:` supplies action code; it does not check out the application's source.

```yaml
name: CI
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
```

All component input values are strings. Quote boolean values as `"true"` and `"false"`; validated boolean inputs accept those exact lowercase values. Reusable workflows have separately typed inputs, so `docker-push` in Stack CI is a YAML boolean.

For private GitHub Packages dependencies, grant `packages: read` when using `github.token` and allow the caller repository to access the package. Pass the token explicitly: build helpers do not automatically use it. Use a dedicated secret for registries or packages outside that token's access. Package installation and build scripts execute repository code with the supplied credentials available; use credentials only for trusted code. Fork PRs ordinarily do not receive repository secrets.

`contents: read` is sufficient for ordinary checkout and public-dependency builds. JUnit/coverage uploads do not need checks or pull-request write access. These helpers upload files your build produces; they do not install a test reporter, configure coverage, create PR comments, or publish GitHub checks. Give matrix jobs distinct artifact names when uploading from several jobs.

## Enterprise environments

Docker builds and publication do not require GitHub Artifact Attestations or OIDC permissions. `sbom` and `provenance` are Docker BuildKit options, described in [Docker CI](docker-ci.md); they are separate from GitHub's attestation service.

GitHub Enterprise Cloud can support artifact attestations for private/internal repositories; GitHub Enterprise Server does not support that feature. Availability also depends on repository visibility and GitHub plan. See [GitHub's availability documentation](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) and [the attestation action's support statement](https://github.com/actions/attest#readme).

Removing that dependency does not certify every helper for GitHub Enterprise Server. For example, the report uploader uses the pinned `upload-artifact` v7 action, while [upstream states that v4 and later are unsupported on GHES](https://github.com/actions/upload-artifact#readme). Java/Node report uploads can be disabled, and Java release artifact uploads can be disabled, but caches, upstream actions, network access, runner versions, and your registry still need validation. Stack CI fixes its runners to `ubuntu-24.04`; choose the individual helpers for a workflow adapted to your runner environment.
