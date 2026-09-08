# Java Publish

`alconite-inc/alconite-actions/java-publish@v2.5.0` validates a release version and invokes a committed Gradle or Maven wrapper to publish packages. It sets up its own authentication and does not require a preceding [Java CI](java-ci.md) step. Source: [java-publish/action.yaml](../../java-publish/action.yaml).

## Requirements and permissions

Use a trusted tag workflow or protected release job on a Linux runner with Bash and a complete Gradle/Maven wrapper. Check out source first. Your build must already configure its publication plugin, destination repository, and version property. The helper installs Temurin and configures credentials; it does not create publication definitions or edit project version files.

`packages-token` is required and cannot be empty. For GitHub Packages with `github.token`, use `contents: read` and `packages: write`, and grant the repository access to the destination package. For another registry, provide its publishing credential and matching username through secrets. No attestation or OIDC permission is required. See [shared runner guidance](README.md).

## Inputs

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `java-version` | No | `25` | Temurin JDK version. |
| `build-tool` | No | `auto` | `auto`, `gradle`, or `maven`. Auto prefers Gradle. |
| `working-directory` | No | `.` | Existing project directory in the workspace. |
| `packages-user` | No | empty | Registry username; falls back to `github.actor`. |
| `packages-token` | **Yes** | none | Nonempty publishing token, supplied from a secret or `github.token`. |
| `maven-server-id` | No | `alconite-gpr` | Settings server ID matching the publishing `distributionManagement` repository ID. |
| `release-version` | No | empty | Explicit version such as `1.2.3` or `1.2.3-rc.1`. When empty, extract it from the GitHub tag. |
| `tag-prefix` | No | `v` | Prefix removed once from the current tag when deriving a version. Must be nonempty for tag-derived versions. |
| `gradle-tasks` | No | `publish` | One line of whitespace-separated Gradle tasks/arguments. |
| `maven-goals` | No | `deploy` | One line of whitespace-separated Maven goals/arguments. |
| `skip-tests` | No | `true` | Add Gradle `-x test` or Maven `-DskipTests`. |
| `upload-artifacts` | No | `true` | Upload JARs after successful publication. |
| `artifact-name` | No | `java-release-artifacts` | GitHub artifact name. |

## Version and build behavior

An explicit `release-version` takes precedence over the GitHub ref. Otherwise the current ref must be a tag beginning with `tag-prefix`; `v1.2.3` becomes `1.2.3` with the default prefix. The accepted shape is three numeric components without leading zeroes, with optional dot-separated prerelease and build metadata identifiers. Pass the version without the `v` prefix when using `release-version`. A tag prefix alone, `1.2`, or `01.2.3` fails validation.

Auto detection recognizes `gradlew`, `build.gradle`, or `build.gradle.kts` for Gradle, then `mvnw` or `pom.xml` for Maven. Unlike Java CI, settings-only Gradle detection is not implemented here; select `build-tool: gradle` explicitly for that layout. The chosen wrapper must exist and is marked executable.

Gradle runs the selected tasks with `--no-daemon --stacktrace -PreleaseVersion=<version>`. Configure your build to consume `releaseVersion`. Credentials become Gradle properties `gprUser` and `gprKey` through environment variables. Maven runs the selected goals with `-B -ntp -Dstyle.color=always -Drevision=<version>`; your POM must use `${revision}` for that override to affect the published version. Maven settings reference credential environment variables under `maven-server-id`. Both tools also receive the selected skip-tests argument.

Task/goal strings are split into arguments, not executed as shell source. Supply at least one publishing task/goal. Dependency caches are configured through setup-gradle or setup-java.

Successful publication is followed by upload of workspace-wide `**/build/libs/*.jar` and `**/target/*.jar`, with 30-day retention subject to GitHub policy. No matching JAR is an error. This upload can fail after packages have already been published; inspect the registry before rerunning a release. Use `upload-artifacts: "false"` for publications without JARs or environments without the pinned artifact uploader.

| Output | Meaning |
| --- | --- |
| `build-tool` | Selected `gradle` or `maven`. |
| `release-version` | Validated explicit or tag-derived version passed to the build. |

## Example: publish GitHub Packages from release tags

```yaml
name: Publish Java
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
jobs:
  publish:
    runs-on: ubuntu-24.04
    environment: release
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - id: release
        uses: alconite-inc/alconite-actions/java-publish@v2.5.0
        with:
          build-tool: maven
          packages-token: ${{ github.token }}
          maven-server-id: alconite-gpr
          skip-tests: "false"
```

Configure protection rules on the `release` environment to match your approval policy. The example validates tests during publishing; if tests already ran in a required preceding job, the default skip behavior can be used intentionally.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Matching release tag required | Trigger from a matching tag, change `tag-prefix`, or supply `release-version`. |
| Package has the old version | Ensure Gradle uses `releaseVersion` or Maven uses `${revision}`. The output validates the requested value, not the published package's metadata. |
| Publish returns 401/403 | Verify write access, package repository grants, server IDs, and Gradle credential wiring. |
| Upload failed after deploy | Check whether the registry already contains the version before rerunning; fix the JAR output or disable artifact upload. |
| Duplicate version rejected | Most package registries restrict overwrites. Publish a new release version rather than assuming retries are idempotent. |
