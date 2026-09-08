import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selfReferencePrefix,
  validateChangelog,
  validateSelfReferences,
} from '../scripts/release-policy.mjs';
import {
  classifyRegistryInspection,
  validateManifestPreservingCopies,
} from '../scripts/validate-sentinel-container.mjs';

const currentVersion = '2.5.0';
const currentTag = `v${currentVersion}`;
const mixedCasePrefix = ['AlCoNiTe-InC', 'AlCoNiTe-AcTiOnS'].join('/');

const releaseManifestCopy = 'docker buildx imagetools create --prefer-index=false --tag "$image:$alias" "$image@$digest"';
const dockerHubVersionCopy = 'docker buildx imagetools create --prefer-index=false --tag "$TARGET_IMAGE:$RELEASE_TAG" "$source_image@$digest"';
const dockerHubLatestCopy = 'docker buildx imagetools create --prefer-index=false --tag "$TARGET_IMAGE:latest" "$source_image@$digest"';

test('registry copies preserve manifests at exactly the three approved sites', () => {
  const releaseSource = `for alias in tags; do\n  ${releaseManifestCopy}\ndone`;
  const promotionSource = `case absent in\n  ${dockerHubVersionCopy}\nesac\nif latest; then\n  ${dockerHubLatestCopy}\nfi`;
  assert.doesNotThrow(() => validateManifestPreservingCopies(releaseSource, promotionSource));

  for (const command of [releaseManifestCopy, dockerHubVersionCopy, dockerHubLatestCopy]) {
    assert.throws(
      () => validateManifestPreservingCopies(
        releaseSource.replace(command, ''),
        promotionSource.replace(command, ''),
      ),
      /exactly three/u,
      `removing approved manifest copy must fail: ${command}`,
    );
  }
  assert.throws(
    () => validateManifestPreservingCopies(
      `${releaseSource}\n${releaseManifestCopy}`,
      promotionSource,
    ),
    /exactly three/u,
    'adding a fourth manifest copy site must fail',
  );
  assert.throws(
    () => validateManifestPreservingCopies(
      releaseSource.replace('--prefer-index=false ', ''),
      promotionSource,
    ),
    /every registry manifest copy/u,
    'dropping manifest preservation must fail',
  );
});

test('registry manifest inspection distinguishes confirmed absence from ambiguous failures', () => {
  assert.equal(classifyRegistryInspection(0, '"sha256:' + 'a'.repeat(64) + '"'), 'present');
  for (const diagnostic of [
    'manifest unknown: manifest unknown',
    'unexpected status from HEAD request: 404 Not Found',
    'ERROR: unexpected status from HEAD request to https://ghcr.io/v2/alconite-inc/sentinel-executor/manifests/v2.5.0: 404 Not Found',
    'ghcr.io/alconite-inc/sentinel-executor:v2.5.0: not found',
    'ERROR: docker.io/alconite/sentinel-executor:2.5.0: not found',
    'response status code: 404 Not Found',
  ]) {
    assert.equal(classifyRegistryInspection(1, diagnostic), 'absent', diagnostic);
  }
  for (const diagnostic of [
    'unauthorized: authentication required',
    'unexpected status from HEAD request: 401 Unauthorized',
    'unexpected status from HEAD request: 429 Too Many Requests',
    'dial tcp: network is unreachable',
    'i/o timeout',
    'unauthorized: authentication required; unexpected status from HEAD request: 404 Not Found',
    'failed to authorize: token endpoint returned 404 Not Found',
    'unexpected status from HEAD request: 503 Service Unavailable; 404 Not Found',
    'warning: registry response was ambiguous\nghcr.io/alconite-inc/sentinel-executor:v2.5.0: not found',
    'something: not found',
    '',
  ]) {
    assert.equal(classifyRegistryInspection(1, diagnostic), 'unknown', diagnostic);
  }
  assert.equal(classifyRegistryInspection(Number.NaN, '404 Not Found'), 'unknown');
});

test('release policy accepts only the current self-reference outside labeled history', () => {
  assert.doesNotThrow(() => validateSelfReferences(
    'README.md',
    `${selfReferencePrefix}/impact@${currentTag}`,
    currentTag,
  ));
  assert.doesNotThrow(() => validateSelfReferences(
    '.github/workflows/example.yml',
    `${selfReferencePrefix}/.github/workflows/runtime-verify.yml@${currentTag}`,
    currentTag,
  ));
  assert.doesNotThrow(() => validateSelfReferences(
    'README.md',
    `${mixedCasePrefix}/impact@${currentTag}`,
    currentTag,
  ));

  const rejectedRefs = [
    'main',
    'v2',
    `v${['2', '1', '2'].join('.')}`,
    'a'.repeat(40),
    'feature/unsafe-release',
    '<arbitrary-ref>',
    '$' + '{{ github.sha }}',
  ];
  for (const ref of rejectedRefs) {
    assert.throws(
      () => validateSelfReferences('README.md', `${selfReferencePrefix}/impact@${ref}`, currentTag),
      /non-current self-reference/u,
      `validator must reject self-reference ${ref}`,
    );
  }
  assert.throws(
    () => validateSelfReferences(
      '.github/workflows/example.yml',
      `${selfReferencePrefix}/<dynamic-component>@main`,
      currentTag,
    ),
    /non-current self-reference/u,
  );
  assert.throws(
    () => validateSelfReferences(
      'README.md',
      `${mixedCasePrefix}/impact@main`,
      currentTag,
    ),
    /non-current self-reference/u,
  );

  const historicalLine = (ref) => `- Historical compatibility: ${selfReferencePrefix}@${ref} is frozen.`;
  const historical = historicalLine(`v${['2', '0', '0'].join('.')}`);
  assert.doesNotThrow(() => validateSelfReferences('CHANGELOG.md', historical, currentTag));
  assert.throws(
    () => validateSelfReferences('README.md', historical, currentTag),
    /non-current self-reference/u,
  );

  const invalidHistoricalRefs = [
    'main',
    'a'.repeat(40),
    'feature/old-release',
    currentTag,
    `v${['2', '5', '1'].join('.')}`,
    `v${['1', '9', '9'].join('.')}`,
  ];
  for (const ref of invalidHistoricalRefs) {
    assert.throws(
      () => validateSelfReferences('CHANGELOG.md', historicalLine(ref), currentTag),
      /non-current self-reference/u,
      `historical compatibility must reject ${ref}`,
    );
  }
});

test('release policy permits only the explicitly reviewed component SHA', () => {
  const reviewed = 'b'.repeat(40);
  assert.doesNotThrow(() => validateSelfReferences('README.md', `${selfReferencePrefix}/impact@${reviewed}`, currentTag, reviewed));
  assert.throws(() => validateSelfReferences('README.md', `${selfReferencePrefix}/impact@${'c'.repeat(40)}`, currentTag, reviewed), /non-current/u);
  assert.throws(() => validateSelfReferences('README.md', `${selfReferencePrefix}/impact@main`, currentTag, 'main'), /non-current/u);
});

test('release policy requires one dated current heading directly after the empty pending section', () => {
  const pendingHeading = ['Un', 'released'].join('');
  const releaseHeading = `## [${currentVersion}] - 2026-08-11`;
  const valid = `# Changelog\n\n## [${pendingHeading}]\n\n${releaseHeading}\n`;
  assert.doesNotThrow(() => validateChangelog(valid, currentVersion));
  assert.throws(
    () => validateChangelog(`${valid}\n${releaseHeading}\n`, currentVersion),
    /exactly one/u,
  );
  assert.throws(
    () => validateChangelog(valid.replace(`\n\n${releaseHeading}`, '\n\nPending notes.\n\n' + releaseHeading), currentVersion),
    /immediately follow/u,
  );
  assert.throws(
    () => validateChangelog(valid.replace(releaseHeading, `## [${currentVersion}] - 2026-02-31`), currentVersion),
    /real calendar date/u,
  );
  assert.throws(
    () => validateChangelog(valid.replace(releaseHeading, `## [${currentVersion}]`), currentVersion),
    /dated heading/u,
  );
});
