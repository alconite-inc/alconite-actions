# Rust CI

`alconite-inc/alconite-actions/rust-ci@v2.5.0` configures a Rust toolchain, restores a Cargo cache, checks formatting, denies Clippy warnings, and runs tests. Release builds are optional. Source: [rust-ci/action.yaml](../../rust-ci/action.yaml).

## Requirements and permissions

Check out the project and use a Linux runner with Bash, `rustup`, Cargo, and rustc available. The helper manages installed toolchains but does not bootstrap rustup. `working-directory` must contain `Cargo.toml`. With the default `locked: "true"`, commit a current `Cargo.lock`; Cargo must not need to create or update it.

Use `contents: read`. No package token or registry input is provided. For private Cargo registries, configure Cargo and credentials separately before this step in a trusted job. Release builds create files on the runner and do not publish crates or upload release artifacts. See [common setup](README.md).

## Inputs

All inputs are optional; boolean inputs require exactly `"true"` or `"false"`.

| Input | Default | Meaning |
| --- | --- | --- |
| `working-directory` | `.` | Cargo project/workspace directory relative to the workspace. |
| `toolchain` | `auto` | Honor a local `rust-toolchain.toml` / `rust-toolchain`; otherwise select stable. An explicit rustup toolchain is also accepted. |
| `components` | `rustfmt,clippy` | Comma- or space-separated rustup components to install. |
| `targets` | empty | Comma- or space-separated rustup compilation targets to install. |
| `workspace` | `true` | Add `--workspace` to Clippy, tests, and release builds. |
| `all-features` | `false` | Add `--all-features` to Clippy, tests, and release builds. |
| `locked` | `true` | Add `--locked` to Clippy, tests, and release builds. |
| `format` | `true` | Run `cargo fmt --all --check`. |
| `clippy` | `true` | Run Clippy across all targets with `-D warnings`. |
| `test` | `true` | Run `cargo test`. |
| `build-release` | `false` | Run `cargo build --release`. |

## Toolchains, execution, and outputs

Prefer a committed `rust-toolchain.toml` in `working-directory` and `toolchain: auto` to make local development and CI use the same release. Auto mode checks both current-directory toolchain filenames and otherwise installs stable. It sets rustup's profile to minimal, then installs the requested components and targets.

There is a current limitation with the explicit `toolchain` input: selection is written to `GITHUB_ENV` for subsequent steps, while component/target installation and toolchain outputs happen earlier in that same setup step. If the runner's ambient toolchain differs, those operations and outputs can describe the ambient toolchain. A project toolchain file with `toolchain: auto` avoids that discrepancy. Do not use these outputs alone as proof that an explicitly requested toolchain ran every setup operation.

Clippy always receives `--all-targets` and denies warnings. Tests do not receive `--all-targets`. `workspace`, `all-features`, and `locked` apply to Clippy/tests/release builds; formatting always runs `cargo fmt --all --check`. Enabled stages run sequentially and later stages stop after failure.

`targets` installs support libraries only; it does not pass `--target` to Cargo or configure a cross-linker. To choose a build target, configure Cargo (for example in `.cargo/config.toml` or `CARGO_BUILD_TARGET`) and provision any target linker/runtime needed by your build and tests. The cache maps `working-directory` to its `target` directory and does not save a failed run. No report or binary upload is performed.

| Output | Meaning |
| --- | --- |
| `toolchain` | `rustup show active-toolchain` name recorded during setup; see the explicit-toolchain caveat above. |
| `rustc-version` | Full `rustc --version` text recorded during setup. |

## Example: a workspace with a release build

Commit your team's chosen channel and components in `rust-toolchain.toml`:

```toml
[toolchain]
channel = "1.85.0"
profile = "minimal"
components = ["rustfmt", "clippy"]
```

The channel is an example pin; select the release supported by your project.

```yaml
name: Rust CI
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
      - id: rust
        uses: alconite-inc/alconite-actions/rust-ci@v2.5.0
        with:
          toolchain: auto
          workspace: "true"
          locked: "true"
          all-features: "true"
          build-release: "true"
```

Release binaries remain under the project's Cargo target directory (normally `target/release`). Upload selected binaries in a separate step if they are part of your release process. `all-features: "true"` is appropriate only when your crate's features can be enabled together.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Cargo.toml required | Verify checkout and `working-directory`. |
| Cargo.lock needs updating | Regenerate and commit the lockfile with the intended toolchain/dependencies. |
| rustup not found | Install rustup on the self-hosted runner before the helper. |
| rustfmt or Clippy missing | Keep the required components enabled for the corresponding stages; prefer a committed toolchain file. |
| Clippy fails on warnings | Fix or intentionally allow the lint in project code; this helper runs with `-D warnings`. |
| Installed target is not used | Set Cargo's actual build target separately; `targets` only installs target support. |
| Wrong toolchain output/component setup | Use `toolchain: auto` with a toolchain file and review the explicit-toolchain limitation above. |
