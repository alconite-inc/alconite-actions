import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateReleaseNotes } from '../scripts/generate-release-notes.mjs';

const curated = [
  '# Alconite Actions v2.5.0', '',
  '## Features and documentation', '', 'Consumer attestation is optional.', '',
  '## Security fixes and upgrades', '', 'Credentials remain on the configured origin.', '',
  '## Upgrading', '', 'Adopt the verified tag or its exact SHA.', '',
  '## Known limitation', '', 'One vendor package fix remains pending.', '',
].join('\n');

async function fixture(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'alconite-release-notes-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release@example.invalid');
  await writeFile(path.join(cwd, 'package.json'), '{"version":"2.5.0"}\n');
  git('add', 'package.json');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'Release fixture');
  const componentCommit = git('rev-parse', 'HEAD');
  await writeFile(path.join(cwd, 'release-components.json'), JSON.stringify({ version: '2.5.0', commit: componentCommit }));
  await mkdir(path.join(cwd, 'docs', 'releases'), { recursive: true });
  await writeFile(path.join(cwd, 'docs', 'releases', 'v2.5.0.md'), curated);
  git('add', 'release-components.json', 'docs');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'Pin components and release narrative');
  git('-c', 'tag.gpgsign=false', 'tag', '-a', 'v2.5.0', '-m', 'Release fixture');
  return {
    cwd, git, outputDirectory: path.join(cwd, 'output'), tag: 'v2.5.0',
    sentinelName: 'ghcr.io/alconite-inc/sentinel-executor',
    sentinelDigest: `sha256:${'a'.repeat(64)}`,
  };
}

test('release notes combine curated changes, the real tag commit, and the published image digest', async (t) => {
  const f = await fixture(t);
  await mkdir(f.outputDirectory);
  await writeFile(path.join(f.outputDirectory, 'release-pins.md'), 'Stale pins must be regenerated.');
  await writeFile(path.join(f.outputDirectory, 'release-pins.json'), '{"commit":"stale"}');

  const release = await generateReleaseNotes(f);
  const notes = await readFile(path.join(f.outputDirectory, 'release-notes.md'), 'utf8');
  const pins = JSON.parse(await readFile(path.join(f.outputDirectory, 'release-pins.json'), 'utf8'));
  assert.equal(release.commit, f.git('rev-parse', 'HEAD'));
  assert.notEqual(release.commit, f.git('rev-parse', 'refs/tags/v2.5.0'));
  assert.equal(pins.commit, release.commit);
  assert.ok(notes.startsWith(curated.trim()));
  assert.ok(notes.includes(`${f.sentinelName}@${f.sentinelDigest}`));
  assert.ok(notes.includes('sentinel-executor.spdx.json'));
  assert.equal(notes.includes('Stale pins'), false);
  assert.equal(pins.references.length, 11);
  for (const reference of pins.references) {
    assert.ok(notes.includes(reference.shaRef));
    assert.ok(notes.includes(reference.versionRef));
  }
  assert.match(notes, /^## Alconite Actions v2\.5\.0 references$/mu);
  assert.match(notes, /^### Contract Guard$/mu);
});

test('release notes reject wrong release identity, missing notes, invalid image data, and untagged changes', async (t) => {
  const f = await fixture(t);
  await assert.rejects(generateReleaseNotes({ ...f, sentinelName: 'ghcr.io/another/image' }), /published Sentinel image name/u);
  for (const sentinelDigest of [undefined, 'latest', `sha256:${'g'.repeat(64)}`, `${f.sentinelDigest}\ntext`]) {
    await assert.rejects(generateReleaseNotes({ ...f, sentinelDigest }), /published image digest/u);
  }
  await assert.rejects(generateReleaseNotes({ ...f, tag: '../v2.5.0' }), /exact v2 SemVer/u);
  await assert.rejects(generateReleaseNotes({ ...f, tag: 'v2.5.1' }), /ENOENT/u);

  const curatedPath = path.join(f.cwd, 'docs', 'releases', 'v2.5.0.md');
  await writeFile(curatedPath, curated.replace('# Alconite Actions v2.5.0', '# Alconite Actions v2.5.1'));
  await assert.rejects(generateReleaseNotes(f), /identify the exact release/u);
  await writeFile(curatedPath, curated.replace('Consumer attestation is optional.', 'A tracked change after tagging.'));
  await assert.rejects(generateReleaseNotes(f), /commit tracked changes/u);
  f.git('add', 'docs');
  f.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'Later release notes');
  await assert.rejects(generateReleaseNotes(f), /checked-out release tag/u);
});
