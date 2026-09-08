# Docker CI

`alconite-inc/alconite-actions/docker-ci@v2.5.0` builds an OCI image, generates tags/labels, and optionally loads it locally or publishes it to a registry. Publishing never requires GitHub Artifact Attestations. Source: [docker-ci/action.yaml](../../docker-ci/action.yaml).

## Requirements and permissions

Check out the build context first. Use a Linux runner with Bash and a working Docker engine; the helper configures Buildx and, when `platforms` is nonempty, QEMU. The runner needs access to base-image registries and the GitHub Actions cache service.

Build-only jobs use `contents: read` and need no registry password. When `push: "true"`, supply `registry-password` and optionally `registry-username`; the latter falls back to `github.actor`. For GHCR with `github.token`, grant `packages: write` and ensure the repository has write access to the package. Other registries need their own publishing credentials. `id-token: write` and `attestations: write` are unnecessary for the helper itself.

The standalone action does not inspect the event type or prevent publication from a PR. Restrict publishing in the caller to trusted branches/tags and protect release credentials. `push: "false"` skips registry login entirely, even when a password input is supplied. Authenticated base-image pulls are not configured in this mode; if required, arrange a separate login in a trusted job.

## Inputs

All inputs are optional, except a nonempty registry password is required when pushing.

| Input | Default | Meaning |
| --- | --- | --- |
| `registry` | `ghcr.io` | Registry hostname with optional port; no `https://` scheme. Used for login and default image naming. |
| `image` | empty | Full image name including registry, without tag/digest. Defaults to `<registry>/<owner>/<repository>`, lowercased. |
| `dockerfile` | `Dockerfile` | Path passed to the build action as its Dockerfile. |
| `context` | `.` | Build context, normally a workspace-relative directory. |
| `platforms` | empty | Optional comma-separated targets such as `linux/amd64,linux/arm64`; nonempty enables QEMU setup. |
| `push` | `false` | Publish the built image. Requires registry credentials. |
| `load` | `false` | Load an image into the local Docker engine for later steps; supports one platform only. |
| `registry-username` | empty | Registry user; falls back to `github.actor`. |
| `registry-password` | empty | Registry token/password; used only when `push` is true. |
| `release-version` | empty | Optional version-shaped value, for example `1.2.3` or `1.2.3-rc.1`, added as a raw image tag. |
| `tag-latest` | `false` | Explicitly add a `latest` tag. See the automatic tag behavior below; false is not a global suppression switch. |
| `sbom` | `false` | Enable BuildKit SBOM generation. This is independent of GitHub's attestation API. |
| `provenance` | `false` | BuildKit provenance setting, for example `false`, `true`, `mode=min`, or `mode=max`. Passed through to BuildKit. |

`push`, `load`, `tag-latest`, and `sbom` accept only the strings `"true"` and `"false"`. `push` and `load` cannot both be true. `load` rejects a comma-separated platform list. Image names are lowercased and must include a registry/path, contain no whitespace, and have no tag or digest. Set `registry` and the registry component of `image` consistently; changing `image` alone does not change the login host.

## Tags, caching, and results

The helper configures these Docker metadata rules:

| Trigger/input | Tag rule |
| --- | --- |
| Branch ref | Branch name, sanitized for use as a Docker tag |
| Pull request | `pr-<number>` |
| Tag ref | The Git tag name |
| Every build | `sha-<short-commit-sha>` |
| A `v`-prefixed SemVer tag | Parsed version, major.minor, and major rules; prereleases follow upstream SemVer handling |
| Nonempty `release-version` | Additional raw version tag |
| `tag-latest: "true"` | Additional explicit `latest` tag |

Current limitation: the helper leaves Docker metadata's `flavor` at its default `latest=auto`. Consequently Git tag/semantic release rules can produce `latest` even when `tag-latest` is false. Inspect the `tags` output when release tag policy matters; use a custom metadata/build workflow if your policy must prohibit it. See [Docker metadata's latest-tag behavior](https://github.com/docker/metadata-action#latest-tag).

Buildx reads and writes a GitHub Actions cache (`type=gha`, export `mode=max`). With both `push` and `load` false, this verifies the build and caches it; it does not make a runnable image available to later `docker run` steps. The upstream build action can also create its own job summary/build record according to its defaults.

| Output | Meaning |
| --- | --- |
| `image` | Resolved image name with registry, without tag or digest. |
| `tags` | Newline-separated fully qualified generated tags. |
| `labels` | Newline-separated generated OCI labels. |
| `digest` | BuildKit image digest when produced by the selected exporter; use the published digest for deployment or signing. |
| `metadata` | JSON build metadata returned by the upstream build action. |

For a published image, `${{ steps.image.outputs.image }}@${{ steps.image.outputs.digest }}` identifies the exact image. Assign `id: image` to read those outputs. The password input is used for registry login and is never forwarded as a Dockerfile build secret. The helper exposes no custom build arguments, build secrets, arbitrary tags, or cache controls; use the underlying Docker actions in a custom workflow when needed.

## BuildKit metadata and GitHub attestations

`sbom` and `provenance` control metadata produced by Docker BuildKit and stored with supported image outputs. Enabling them does not call `actions/attest` or the GitHub attestation API. Registry and image-store support still matter; for example, the classic Docker image store does not retain these attestations when loading an image locally. See [Docker build attestations](https://docs.docker.com/build/metadata/attestations/).

The standalone helper defaults both controls to false. [Stack CI](../stack-ci.md) explicitly enables `sbom: "true"` and `provenance: mode=max` for its publish job. If your registry rejects that metadata, use this standalone helper with both disabled. Maximum provenance may reveal build parameters; keep secrets out of Docker build arguments and image metadata.

GitHub Artifact Attestations is a separate, optional signing service. GitHub Enterprise Cloud supports private/internal repository attestations; GitHub Enterprise Server does not. See [GitHub's availability documentation](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) and [upstream GHES limitation](https://github.com/actions/attest#readme). The [shared enterprise guidance](README.md#enterprise-environments) covers other compatibility limits.

## Example: build pull requests without credentials

```yaml
name: Docker CI
on:
  pull_request:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: alconite-inc/alconite-actions/docker-ci@v2.5.0
        with:
          push: "false"
```

To run the built image later in the same job, set `load: "true"`, use a single platform, and run one of its generated tags (for example the branch or `sha-` tag). This is separate from publishing.

## Example: publish to GHCR without attestation

```yaml
name: Publish image
on:
  push:
    branches: [main]
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
      - id: image
        uses: alconite-inc/alconite-actions/docker-ci@v2.5.0
        with:
          push: "true"
          registry-password: ${{ github.token }}
          sbom: "false"
          provenance: "false"
```

Configure environment protection as needed. For another registry, set `registry`, a matching full `image`, `registry-username`, and its secret password. For a multi-platform publication, add `platforms: linux/amd64,linux/arm64` and ensure your Dockerfile supports both architectures.

## Optional: add GitHub attestation on a supported plan

Use this only when GitHub Artifact Attestations is available and your organization wants it. In the publish job above, extend the job permissions:

```yaml
permissions:
  contents: read
  packages: write
  id-token: write
  attestations: write
```

Then append this step in the same job after the successful image publication:

```yaml
- name: Attest published image
  uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4
  with:
    subject-name: ${{ steps.image.outputs.image }}
    subject-digest: ${{ steps.image.outputs.digest }}
    push-to-registry: true
    create-storage-record: false
```

The subject uses the exact published digest and the tag-free image name. `create-storage-record: false` disables the optional linked-artifact storage record, so the example does not also need `artifact-metadata: write`. See the [pinned attestation action's inputs and permissions](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/README.md). An attestation failure occurs after the image has been published; publication is not rolled back.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Registry validation error | Use a hostname/optional port, without URL scheme or path. |
| Invalid image | Include the registry and repository path; omit tags/digests and whitespace. |
| Push requires a password | Supply the correct registry secret; for GHCR check `packages: write` and repository package access. |
| Multi-platform load rejected | Publish multi-platform images, or load only one platform locally. |
| Image not found by docker run | Set `load: "true"`; default build-only mode does not load the local engine. |
| Unexpected latest tag | Review the metadata auto-tag limitation above. |
| Registry rejects attestations/manifests | Disable BuildKit `sbom`/`provenance` in this helper and check registry OCI support. |
| GitHub attestation entitlement error | Remove the separately added optional `actions/attest` step; the helper itself does not require that service. |
