# Alconite Stack Orchestrator GitHub Actions

This repository contains Alconite’s standardized GitHub Actions for CI/CD across all application repositories.

It provides a **single entrypoint action** (`stack-orchestrator`) that:
- Detects the application stack (Java, Node, or Docker-only)
- Runs build, test, and reporting
- Builds and optionally pushes Docker images
- Publishes Java artifacts on release tags
- Sends Discord notifications

Application repositories only need to reference **one action**.

---

## ✨ Goals

- ✅ One consistent CI/CD experience for all repos  
- ✅ Company-wide standards for:
  - Java versions
  - dependency authentication
  - testing, builds, and coverage
  - Node package-manager handling (npm, pnpm, yarn)
  - Docker tagging
  - release publishing  
- ✅ Minimal workflow files in application repos  
- ✅ Easy to evolve centrally without touching every repo  

---

## 🧱 Repository Structure

```
stack-orchestrator/   # Main entrypoint (used by all repos)
java-ci/              # Java build/test/reporting (Gradle or Maven)
java-publish/         # Java publish on release tags (vX.Y.Z)
docker-ci/            # Docker build/push using docker/metadata-action
node-ci/              # Node CI for npm, pnpm, and yarn
discord-notify/       # Discord success/failure notifications
```

---

## 🚀 Basic Usage (Application Repos)

```yaml
name: CI
on: [push, pull_request]

jobs:
  ci:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      checks: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
      - uses: alconite-inc/stack-orchestrator@v1
        with:
          packages-token: ${{ secrets.GH_PACKAGES_TOKEN }}
          reporting-token: ${{ github.token }}
          registry-password: ${{ github.token }}
          discord-webhook: ${{ secrets.DISCORD_WEBHOOK }}
          push: auto
          publish: auto
```

---

## 🧠 Stack Detection Logic

| Stack | Files Detected |
|-------|----------------|
| `java` | gradlew, build.gradle*, settings.gradle*, pom.xml, mvnw |
| `node` | package.json |
| `docker` | none of the above |

---

## 🟢 Node Support

Supported package managers:

- `npm`
- `pnpm`
- `yarn`

Node package-manager detection order inside `node-ci`:

- explicit `node-package-manager`
- `pnpm-lock.yaml` or `packageManager: "pnpm@..."`
- `yarn.lock` or `packageManager: "yarn@..."`
- fallback to `npm`

Recommended conventions for pnpm repositories:

- Commit `pnpm-lock.yaml`
- Pin `packageManager` in `package.json` so CI can install the expected pnpm version automatically

If a pnpm repository does not pin `packageManager`, pass `node-pnpm-version` through `stack-orchestrator`.

For monorepos or non-root lockfiles, set `node-cache-dependency-path` to the relevant `pnpm-lock.yaml`, `yarn.lock`, or
`package-lock.json` path(s).

---

## 🏷️ Release Behavior

Releases must use tags in the format:

```
v1.2.3
```

On tag builds:
- Java artifacts are published to GitHub Packages
- Docker images are pushed
- Discord notification is sent

---

## 🐳 Docker Tagging Strategy

- `main`
- `sha-<shortsha>`
- `v1.2.3`, `1.2.3`, `1.2`, `1`
- optional `latest` on main

---

## 🧰 Node App Example (pnpm)

```yaml
name: CI
on: [push, pull_request]

jobs:
  ci:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      checks: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
      - uses: alconite-inc/stack-orchestrator@v1
        with:
          packages-token: ${{ secrets.GH_PACKAGES_TOKEN }}
          registry-password: ${{ github.token }}
          node-package-manager: pnpm
          node-script: build
          # Optional when package.json already pins packageManager: "pnpm@..."
          node-pnpm-version: "10"
          push: auto
```

---

## ☕ Java Support

Supported:
- Gradle
- Maven (wrapper required)

Publishing:

Gradle:
```
./gradlew publish -PreleaseVersion=1.2.3
```

Maven:
```
./mvnw deploy -Drevision=1.2.3
```

---

## 🔔 Discord Notifications

If `discord-webhook` is provided, a success/failure message is sent with repo, tag, actor, and run link.

---

## 🔐 Required Permissions

```
contents: read
packages: write
checks: write
pull-requests: write
```

---

## 🧾 Minimal Workflow Example

```yaml
name: CI
on: [push, pull_request]

jobs:
  ci:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      checks: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
      - uses: alconite-inc/stack-orchestrator@v1
        with:
          packages-token: ${{ secrets.GH_PACKAGES_TOKEN }}
          registry-password: ${{ github.token }}
          discord-webhook: ${{ secrets.DISCORD_WEBHOOK }}
          push: auto
          publish: auto
```

---

## 🧠 Design Principle

> Application repositories declare what they are.  
> The orchestrator decides how to build, test, publish, and notify.
