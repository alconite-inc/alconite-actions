import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { validateChangelog, validateSelfReferences } from './release-policy.mjs';

const execFileAsync = promisify(execFile);
const packageManifest = JSON.parse(await readFile('package.json', 'utf8'));
const packageLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const releaseVersion = packageManifest.version;
const releaseTag = `v${releaseVersion}`;
const uploadArtifact = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1';
const attest = 'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4';
const uploadArtifactMarker = ['actions/upload', 'artifact@'].join('-');
const attestMarker = ['actions', 'attest@'].join('/');
const historicalVersionFile = 'CHANGELOG.md';
const releaseValidator = 'scripts/validate-release.mjs';

assert.match(releaseVersion, /^2\.\d+\.\d+$/u, 'package version must remain in the supported v2 release line');
assert.equal(packageLock.version, releaseVersion, 'package-lock.json version must match package.json');
assert.equal(packageLock.packages?.['']?.version, releaseVersion, 'package-lock root package version must match package.json');

const releaseSource = await readFile('src/release.ts', 'utf8');
assert.match(
  releaseSource,
  new RegExp(`ACTION_RELEASE_VERSION = '${releaseVersion.replaceAll('.', '\\.')}';`, 'u'),
  'the shared component release identity must match package.json',
);
assert.match(
  await readFile('discord-notify/notify.mjs', 'utf8'),
  new RegExp(`alconite-actions/${releaseVersion.replaceAll('.', '\\.')}`, 'u'),
  'Discord notification requests must carry the repository release identity',
);

const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
const trackedFiles = stdout.toString('utf8').split('\0').filter(Boolean);
const forbiddenTokens = [
  ['2', '1', '2'].join('.'),
  ['2', '1', '1'].join('.'),
  ['0', '0', '0'].join('.'),
  ['<immutable', 'sha>'].join('-'),
  ['<same-immutable', 'sha>'].join('-'),
  [['2', '1', '2'].join('.'), ['un', 'released'].join('')].join('-'),
];
const pendingHeading = ['Un', 'released'].join('');
const pendingWord = new RegExp(`\\b${pendingHeading}\\b`, 'iu');
validateChangelog(await readFile(historicalVersionFile, 'utf8'), releaseVersion);

for (const filename of trackedFiles) {
  const bytes = await readFile(filename);
  if (bytes.includes(0)) continue;
  const source = bytes.toString('utf8');
  if (filename !== historicalVersionFile && filename !== releaseValidator) {
    for (const token of forbiddenTokens) {
      assert.equal(source.includes(token), false, `${filename} contains stale release marker ${token}`);
    }
    assert.equal(pendingWord.test(source), false, `${filename} contains a pending-release marker`);
  }
  validateSelfReferences(filename, source, releaseTag);

  for (const line of source.split(/\r?\n/u)) {
    if (line.includes(uploadArtifactMarker)) {
      assert.ok(line.includes(uploadArtifact), `${filename} must use the reviewed upload-artifact v7.0.1 commit`);
    }
    if (line.includes(attestMarker)) {
      assert.ok(line.includes(attest), `${filename} must use the common reviewed actions/attest v4 commit`);
    }
  }
}
const releaseWorkflow = parse(await readFile('.github/workflows/release.yml', 'utf8'));
assert.deepEqual(releaseWorkflow.on?.push?.tags, ['v2.*.*'], 'release workflow must remain limited to v2 SemVer tags');
const steps = releaseWorkflow.jobs?.release?.steps ?? [];
const checkout = steps[0];
assert.match(checkout?.uses ?? '', /^actions\/checkout@[a-f0-9]{40}$/u, 'release workflow must begin with immutable checkout');
assert.equal(checkout?.with?.['fetch-depth'], 0, 'release checkout must fetch full history for ancestry validation');
assert.equal(checkout?.with?.['persist-credentials'], false, 'release checkout must not persist GitHub credentials');
const tagStep = steps.find((step) => step.name === 'Validate immutable tag target and main ancestry');
assert.equal(steps.indexOf(tagStep), 1, 'tag and main ancestry validation must run immediately after checkout');
assert.equal(tagStep?.shell, 'bash', 'tag and main ancestry validation must use bash');
assert.equal(tagStep?.env?.RELEASE_TAG, '${{ github.ref_name }}', 'tag validation must use the triggering ref name');
const expectedTagGate = [
  'set -euo pipefail',
  'git fetch --no-tags --prune origin +refs/heads/main:refs/remotes/origin/main',
  'tag_commit="$(git rev-parse "$RELEASE_TAG^{commit}")"',
  'main_commit="$(git rev-parse "refs/remotes/origin/main^{commit}")"',
  'if [[ "$GITHUB_SHA" != "$tag_commit" ]]; then',
  '  echo "::error::Workflow commit $GITHUB_SHA does not match tag target $tag_commit"',
  '  exit 1',
  'fi',
  'if ! git merge-base --is-ancestor "$tag_commit" "$main_commit"; then',
  '  echo "::error::Tag target $tag_commit is not reachable from origin/main at $main_commit"',
  '  exit 1',
  'fi',
].join('\n');
assert.equal(
  tagStep?.run?.replaceAll('\r\n', '\n').trim(),
  expectedTagGate,
  'release workflow must retain the exact fail-closed tag/main ancestry gate',
);
const attestations = new Map(
  steps
    .filter((step) => typeof step.name === 'string' && step.name.startsWith('Attest '))
    .map((step) => [step.name, step]),
);
const expectedSubjects = new Map([
  ['Attest Contract Guard JavaScript build', 'dist/**'],
  ['Attest Runtime Verify JavaScript build', 'runtime-verify/dist/**'],
  ['Attest Impact JavaScript build', 'impact/dist/**'],
]);
assert.equal(attestations.size, expectedSubjects.size, 'release workflow must attest exactly the three published distributions');
for (const [name, subjectPath] of expectedSubjects) {
  const step = attestations.get(name);
  assert.equal(step?.uses, attest.split(' # ')[0], `${name} must use the common reviewed attestation commit`);
  assert.equal(step?.with?.['subject-path'], subjectPath, `${name} must attest its exact checked-in distribution`);
}
const publish = steps.find((step) => step.name === 'Create GitHub release');
assert.ok(publish?.run?.includes('--verify-tag'), 'release creation must verify the immutable tag');

const readme = await readFile('README.md', 'utf8');
assert.match(readme, /Linux GitHub runner/u, 'Impact documentation must state its Linux runner requirement');
assert.match(readme, /`impact:write`/u, 'Impact documentation must name its exact token scope');
assert.match(readme, /does not deploy or enable/u, 'release documentation must distinguish publishing from platform rollout');

process.stdout.write(`Validated ${releaseTag} release identity, references, documentation, and attestation subjects.\n`);
