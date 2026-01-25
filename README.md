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
  - testing & coverage
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
node-ci/              # Minimal Node CI (expandable)
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
