import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selfReferencePrefix,
  validateChangelog,
  validateSelfReferences,
} from '../scripts/release-policy.mjs';

const currentVersion = '2.2.0';
const currentTag = `v${currentVersion}`;
const mixedCasePrefix = ['AlCoNiTe-InC', 'AlCoNiTe-AcTiOnS'].join('/');

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
    `v${['2', '2', '1'].join('.')}`,
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
