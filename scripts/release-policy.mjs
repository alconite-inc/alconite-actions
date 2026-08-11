import assert from 'node:assert/strict';

export const selfReferencePrefix = ['alconite-inc', 'alconite-actions'].join('/');

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function validateSelfReferences(filename, source, currentTag) {
  const reference = new RegExp(
    `${escapePattern(selfReferencePrefix)}[^\\s"'\\x60@]*@([^\\s"'\\x60]+)`,
    'gu',
  );
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    for (const match of line.matchAll(reference)) {
      const ref = match[1];
      const historical = filename === 'CHANGELOG.md' && line.startsWith('- Historical compatibility: ');
      assert.ok(
        ref === currentTag || historical,
        `${filename}:${index + 1} contains non-current self-reference ${match[0]}`,
      );
    }
  }
}

export function validateChangelog(source, currentVersion) {
  const pendingHeading = ['Un', 'released'].join('');
  const escapedPending = escapePattern(pendingHeading);
  const escapedVersion = escapePattern(currentVersion);
  const pendingMatches = source.match(new RegExp(`^## \\[${escapedPending}\\]\\r?$`, 'gmu')) ?? [];
  assert.equal(pendingMatches.length, 1, 'CHANGELOG must contain exactly one pending-release heading');
  const releaseHeadings = [...source.matchAll(
    new RegExp(`^## \\[${escapedVersion}\\] - (\\d{4}-\\d{2}-\\d{2})\\r?$`, 'gmu'),
  )];
  assert.equal(releaseHeadings.length, 1, `CHANGELOG must contain exactly one ${currentVersion} dated heading`);
  const adjacency = new RegExp(
    `^## \\[${escapedPending}\\]\\r?\\n\\r?\\n## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}\\r?$`,
    'mu',
  );
  assert.match(source, adjacency, `CHANGELOG ${currentVersion} heading must immediately follow the empty pending section`);
  const releaseDate = releaseHeadings[0]?.[1];
  assert.ok(releaseDate, `CHANGELOG ${currentVersion} heading must include a date`);
  assert.equal(
    new Date(`${releaseDate}T00:00:00.000Z`).toISOString().slice(0, 10),
    releaseDate,
    `CHANGELOG ${currentVersion} release date must be a real calendar date`,
  );
}
