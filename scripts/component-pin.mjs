import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Published Action files and inputs used to reproduce their Sentinel distribution.
export const componentPaths = [
  'action.yml', 'dist', 'src', 'package.json', 'package-lock.json',
  'discord-notify', 'docker-ci', 'java-ci', 'java-publish', 'node-ci', 'rust-ci',
  'impact', 'runtime-verify', 'sentinel-executor',
  'scripts/build-impact.mjs', 'scripts/build-runtime-verify.mjs', 'scripts/build-sentinel-executor.mjs',
  'tsconfig.json', 'tsconfig.build.json', '.dockerignore', 'LICENSE',
];

export async function validateComponentPin(cwd = process.cwd()) {
  const pin = JSON.parse(await readFile(path.join(cwd, 'release-components.json'), 'utf8'));
  assert.deepEqual(Object.keys(pin).sort(), ['commit', 'version'], 'component pin must contain only version and commit');
  assert.match(pin.commit ?? '', /^[a-f0-9]{40}$/u, 'component pin must be a full commit SHA');
  const manifest = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
  assert.equal(pin.version, manifest.version, 'component pin version must match package.json');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.equal(git('rev-parse', '--verify', `${pin.commit}^{commit}`), pin.commit, 'component pin must resolve to its exact commit');
  git('merge-base', '--is-ancestor', pin.commit, 'HEAD');
  const pinnedManifest = JSON.parse(git('show', `${pin.commit}:package.json`));
  assert.equal(pinnedManifest.version, pin.version, 'pinned component commit must carry the release version');
  assert.equal(
    git('diff', '--name-only', pin.commit, '--', ...componentPaths), '',
    'Action content differs from the pinned component commit; commit the rebuilt components and update the SHA pin',
  );
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', ...componentPaths);
  assert.equal(untracked, '', 'commit new component files before updating the component pin');
  return pin;
}
