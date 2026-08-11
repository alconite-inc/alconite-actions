import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { parse } from 'yaml';

const execFileAsync = promisify(execFile);
const packageManifest = JSON.parse(await readFile('package.json', 'utf8'));
const packageLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const releaseVersion = packageManifest.version;
const releaseTag = `v${releaseVersion}`;
const uploadArtifact = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1';
const attest = 'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4';
const uploadArtifactMarker = ['actions/upload', 'artifact@'].join('-');
const attestMarker = ['actions', 'attest@'].join('/');

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
const historicalVersionFile = 'CHANGELOG.md';
const releaseValidator = 'scripts/validate-release.mjs';
let emptyPendingHeadingCount = 0;

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
  if (filename === historicalVersionFile) {
    emptyPendingHeadingCount += (source.match(new RegExp(`^## \\[${pendingHeading}\\]\\r?$`, 'gmu')) ?? []).length;
    const pendingSection = new RegExp(`^## \\[${pendingHeading}\\]\\r?\\n\\r?\\n(?=## \\[)`, 'mu');
    assert.match(source, pendingSection, 'CHANGELOG pending section must remain empty after release preparation');
  }

  for (const match of source.matchAll(/alconite-inc\/alconite-actions(?:\/[A-Za-z0-9_.-]+)*@(v\d+\.\d+\.\d+)/gu)) {
    assert.equal(match[1], releaseTag, `${filename} contains stale self-reference ${match[0]}`);
  }

  for (const line of source.split(/\r?\n/u)) {
    if (line.includes(uploadArtifactMarker)) {
      assert.ok(line.includes(uploadArtifact), `${filename} must use the reviewed upload-artifact v7.0.1 commit`);
    }
    if (line.includes(attestMarker)) {
      assert.ok(line.includes(attest), `${filename} must use the common reviewed actions/attest v4 commit`);
    }
  }
}
assert.equal(emptyPendingHeadingCount, 1, 'CHANGELOG must contain exactly one empty pending-release heading');

const releaseWorkflow = parse(await readFile('.github/workflows/release.yml', 'utf8'));
assert.deepEqual(releaseWorkflow.on?.push?.tags, ['v2.*.*'], 'release workflow must remain limited to v2 SemVer tags');
const steps = releaseWorkflow.jobs?.release?.steps ?? [];
const tagStep = steps.find((step) => step.name === 'Validate immutable tag target');
assert.ok(tagStep?.run?.includes('GITHUB_SHA'), 'release workflow must bind the checkout to the immutable tag target');
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
