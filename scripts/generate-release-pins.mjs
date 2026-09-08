import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateComponentPin } from './component-pin.mjs';

const repository = ['alconite-inc', 'alconite-actions'].join('/');
const entryPoints = [
  ['Contract Guard', '', 'action'],
  ['Impact', '/impact', 'action'],
  ['Runtime Verify', '/runtime-verify', 'action'],
  ['Java CI', '/java-ci', 'action'],
  ['Java publish', '/java-publish', 'action'],
  ['Node CI', '/node-ci', 'action'],
  ['Rust CI', '/rust-ci', 'action'],
  ['Docker CI', '/docker-ci', 'action'],
  ['Discord notification', '/discord-notify', 'action'],
  ['Stack CI', '/.github/workflows/stack-ci.yml', 'workflow'],
  ['Runtime Verify workflow', '/.github/workflows/runtime-verify.yml', 'workflow'],
];

/** Resolve the real tag target; never substitute a branch or an estimated SHA. */
export async function generateReleasePins({ cwd = process.cwd(), tag, outputDirectory }) {
  const manifest = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
  assert.match(tag ?? '', /^v2\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u, 'an exact v2 SemVer tag is required');
  assert.equal(tag, `v${manifest.version}`, 'tag must match the package version');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
  assert.match(commit, /^[a-f0-9]{40}$/u, 'tag must resolve to a full commit SHA');
  assert.equal(commit, git('rev-parse', 'HEAD'), 'generate pins from the checked-out release tag');
  const taggedPackage = JSON.parse(git('show', `${commit}:package.json`));
  assert.equal(taggedPackage.version, manifest.version, 'tagged package must match the working version');
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'commit tracked changes before generating release pins');
  const componentPin = await validateComponentPin(cwd);
  const references = entryPoints.map(([name, suffix, kind]) => ({
    name, kind, path: `${repository}${suffix}`,
    versionRef: `${repository}${suffix}@${tag}`,
    shaRef: `${repository}${suffix}@${commit}`,
  }));
  const pins = { schemaVersion: 1, version: manifest.version, tag, commit, componentCommit: componentPin.commit, references };
  const markdown = [
    `# Alconite Actions ${tag} references`, '',
    `Tag: [\`${tag}\`](https://github.com/${repository}/releases/tag/${tag})`, '',
    `Commit: [\`${commit}\`](https://github.com/${repository}/commit/${commit})`, '',
    'Generated from the checked-out tag. All entries below select the same release commit.', '',
    'Action entries belong under `jobs.<job>.steps`; reusable workflows belong under `jobs.<job>.uses`.', '',
    `Internal reusable-workflow calls are pinned to component commit \`${componentPin.commit}\`. Its Action content and build inputs are verified identical to this release.`, '',
    ...references.flatMap(({ name, kind, versionRef, shaRef }) => [
      `## ${name}`, '', `Entry point: ${kind}.`, '',
      '```yaml', `uses: ${versionRef}`, '```', '',
      '```yaml', `uses: ${shaRef} # ${tag}`, '```', '',
    ]),
  ].join('\n');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'release-pins.json'), `${JSON.stringify(pins, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, 'release-pins.md'), markdown);
  return pins;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pins = await generateReleasePins({
    tag: process.argv[2] ?? process.env.RELEASE_TAG,
    outputDirectory: process.argv[3] ?? 'build/release',
  });
  process.stdout.write(`Generated ${pins.tag} references at ${pins.commit}.\n`);
}
