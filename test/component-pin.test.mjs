import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateComponentPin } from '../scripts/component-pin.mjs';

async function fixture(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'alconite-component-pin-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init');
  git('config', 'user.name', 'Component pin test');
  git('config', 'user.email', 'component@example.invalid');
  await writeFile(path.join(cwd, 'package.json'), '{"version":"2.5.0"}\n');
  await writeFile(path.join(cwd, 'action.yml'), 'name: Example\n');
  await mkdir(path.join(cwd, 'scripts'));
  await writeFile(path.join(cwd, 'scripts', 'build-runtime-verify.mjs'), '// Reviewed build recipe\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'Components');
  const pin = { version: '2.5.0', commit: git('rev-parse', 'HEAD') };
  const savePin = () => writeFile(path.join(cwd, 'release-components.json'), JSON.stringify(pin));
  await savePin();
  return { cwd, git, pin, savePin };
}

test('component pins permit workflow/docs follow-up commits with identical Action content', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.cwd, 'README.md'), 'Updated documentation\n');
  f.git('add', '.');
  f.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'Document and pin components');
  assert.deepEqual(await validateComponentPin(f.cwd), f.pin);
});

test('component pins reject modified, staged, and new executable content', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.cwd, 'action.yml'), 'name: Changed\n');
  await assert.rejects(validateComponentPin(f.cwd), /Action content differs/u);
  f.git('add', 'action.yml');
  await assert.rejects(validateComponentPin(f.cwd), /Action content differs/u);
  f.git('restore', '--source=HEAD', '--staged', '--worktree', 'action.yml');
  await writeFile(path.join(f.cwd, 'scripts', 'build-runtime-verify.mjs'), '// Changed build recipe\n');
  await assert.rejects(validateComponentPin(f.cwd), /Action content differs/u);
  f.git('restore', 'scripts/build-runtime-verify.mjs');
  await mkdir(path.join(f.cwd, 'dist'));
  await writeFile(path.join(f.cwd, 'dist', 'new.js'), 'process.exit(1);\n');
  await assert.rejects(validateComponentPin(f.cwd), /new component files/u);
});

test('component pins reject arbitrary, mismatched, or missing commits', async (t) => {
  const f = await fixture(t);
  f.pin.version = '2.5.1';
  await f.savePin();
  await assert.rejects(validateComponentPin(f.cwd), /version must match/u);
  f.pin.version = '2.5.0';
  f.pin.commit = 'main';
  await f.savePin();
  await assert.rejects(validateComponentPin(f.cwd), /full commit SHA/u);
  f.pin.commit = 'f'.repeat(40);
  await f.savePin();
  await assert.rejects(validateComponentPin(f.cwd));
});
