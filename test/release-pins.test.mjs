import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateReleasePins } from '../scripts/generate-release-pins.mjs';

async function fixture(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'alconite-release-pins-'));
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
  git('add', 'release-components.json');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'Pin components');
  const outputDirectory = path.join(cwd, 'output');
  return { cwd, git, outputDirectory, componentCommit, tag: 'v2.5.0' };
}

test('release pins use the peeled annotated tag commit for every entry point', async (t) => {
  const f = await fixture(t);
  f.git('-c', 'tag.gpgsign=false', 'tag', '-a', f.tag, '-m', 'Release fixture');
  const pins = await generateReleasePins(f);
  assert.equal(pins.commit, f.git('rev-parse', 'HEAD'));
  assert.equal(pins.componentCommit, f.componentCommit);
  assert.notEqual(pins.commit, f.git('rev-parse', `refs/tags/${f.tag}`));
  assert.equal(pins.references.length, 11);
  for (const ref of pins.references) {
    assert.equal(ref.shaRef, `${ref.path}@${pins.commit}`);
    assert.equal(ref.versionRef, `${ref.path}@${f.tag}`);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(f.outputDirectory, 'release-pins.json'), 'utf8')), pins);
  assert.match(await readFile(path.join(f.outputDirectory, 'release-pins.md'), 'utf8'), new RegExp(pins.commit, 'u'));
});

test('release pins reject missing tags, mismatched versions, dirty changes, and a different checkout', async (t) => {
  const f = await fixture(t);
  await assert.rejects(generateReleasePins(f));
  f.git('-c', 'tag.gpgsign=false', 'tag', f.tag);
  await assert.rejects(generateReleasePins({ ...f, tag: 'main' }), /exact v2/u);
  await assert.rejects(generateReleasePins({ ...f, tag: 'v2.5.1' }), /package version/u);
  await writeFile(path.join(f.cwd, 'package.json'), '{"version":"2.5.0","private":true}\n');
  await assert.rejects(generateReleasePins(f), /commit tracked changes/u);
  f.git('add', 'package.json');
  f.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'Later commit');
  await assert.rejects(generateReleasePins(f), /checked-out release tag/u);
});
