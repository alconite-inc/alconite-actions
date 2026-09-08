# Java CI

`alconite-inc/alconite-actions/java-ci@v2.5.0` runs Gradle or Maven through the project's committed wrapper, caches dependencies, and optionally uploads test and coverage reports. Source: [java-ci/action.yaml](../../java-ci/action.yaml). For package publication, use [Java Publish](java-publish.md).

## Requirements and permissions

Check out the project first. Use a Linux runner with Bash, a complete Gradle wrapper (`gradlew` and wrapper files) or Maven wrapper (`mvnw` and its files), and network access to the selected JDK/build-tool/dependency repositories. The helper installs Eclipse Temurin. Gradle/Maven versions come from your wrapper and must support the requested JDK.

Use `contents: read`. Private GitHub Packages dependencies additionally need a token with package read access; grant `packages: read` if passing `github.token`. Both token and username are optional for public dependencies. See [shared setup](README.md).

## Inputs

All inputs are optional.

| Input | Default | Meaning |
| --- | --- | --- |
| `java-version` | `25` | Temurin Java version passed to setup-java. |
| `build-tool` | `auto` | `auto`, `gradle`, or `maven`. Auto detects Gradle first, then Maven. |
| `working-directory` | `.` | Existing project directory relative to the workspace. |
| `packages-user` | empty | GitHub Packages user; falls back to `github.actor`. |
| `packages-token` | empty | Dependency registry credential; pass a secret or authorized `github.token`. |
| `maven-server-id` | `alconite-gpr` | Maven settings server ID; match the ID used by the project's authenticated repository. |
| `skip-tests` | `false` | Adds `-x test` to Gradle or `-DskipTests` to Maven. |
| `gradle-tasks` | `test` | One line of space-separated Gradle task/argument tokens. Must not be empty. |
| `maven-goals` | `verify` | One line of space-separated Maven goal/argument tokens. Must not be empty. |
| `upload-reports` | `true` | Attempt report upload even after a failed build step. |
| `artifact-name` | `java-test-reports` | GitHub report artifact name; use unique names in a matrix. |
| `artifact-paths` | See below | Workspace-relative paths/globs, one per line; not rebased to `working-directory`. |

Default report paths:

```text
**/build/reports/tests/
**/build/reports/jacoco/
**/target/site/jacoco/
**/target/surefire-reports/
**/target/failsafe-reports/
```

## Behavior and output

Auto detection checks `gradlew`, `build.gradle`, `build.gradle.kts`, `settings.gradle`, or `settings.gradle.kts` for Gradle; otherwise it checks `mvnw` or `pom.xml` for Maven. Detection alone does not satisfy wrapper requirements: the actual run fails if the chosen wrapper script is missing. The helper marks that script executable.

Gradle runs `./gradlew <tasks> --no-daemon --stacktrace`, with `-x test` when requested. Maven runs `./mvnw -B -ntp -Dstyle.color=always <goals>`, with `-DskipTests` when requested. Task/goal strings are split on whitespace into arguments; shell operators and shell-style quoting are not evaluated. Put complex build logic in the project's build configuration.

Gradle credentials are supplied as `ORG_GRADLE_PROJECT_gprUser` and `ORG_GRADLE_PROJECT_gprKey`, which your repository configuration can read as Gradle properties `gprUser` and `gprKey`. Maven setup generates settings with the selected server ID and environment-backed credential placeholders. The helper does not add repositories to the project or configure publishing. Gradle uses setup-gradle's basic cache provider; Maven uses setup-java's Maven cache.

Reports retain for 14 days, subject to GitHub policy. Missing report files are ignored; test failures still fail the step. Set `upload-reports: "false"` when your environment does not support the pinned upload action.

| Output | Meaning |
| --- | --- |
| `build-tool` | Selected `gradle` or `maven`. Read with `${{ steps.java.outputs.build-tool }}` when the step has `id: java`. |

## Example: a Maven service in a subdirectory

```yaml
name: Java CI
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
      - id: java
        uses: alconite-inc/alconite-actions/java-ci@v2.5.0
        with:
          java-version: "25"
          build-tool: maven
          working-directory: services/api
          maven-goals: verify
          artifact-name: api-java-reports
          artifact-paths: |
            services/api/target/surefire-reports/
            services/api/target/failsafe-reports/
```

For private dependencies in a trusted job, add `packages: read` under job permissions and `packages-token: ${{ github.token }}` under `with:`. Configure the matching Maven repository ID or Gradle credential properties in the project.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Unable to detect a build tool | Verify checkout and `working-directory`; explicitly choose the tool if both are present. |
| Wrapper required | Commit the wrapper script and its support files. A system Gradle/Maven installation is not used as fallback. |
| Dependency download returns 401/403 | Check token access, package-to-repository access, Maven repository/server ID matching, or Gradle credential property wiring. |
| JDK/build-tool incompatibility | Update the wrapper or select a compatible `java-version`. |
| No report artifact | Ensure the build writes reports and paths are relative to the workspace. `skip-tests` does not produce test reports. |
| Unexpected tests are still running | Custom Gradle test tasks and Maven plugins may require project-specific skip flags beyond `-x test` / `-DskipTests`. |
