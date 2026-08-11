import assert from 'node:assert/strict';

export const selfReferencePrefix = ['alconite-inc', 'alconite-actions'].join('/');

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parseV2Tag(tag) {
  const match = /^v2\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(tag);
  return match ? [BigInt(match[1]), BigInt(match[2])] : undefined;
}

function isOlderV2Tag(ref, currentTag) {
  const refVersion = parseV2Tag(ref);
  const currentVersion = parseV2Tag(currentTag);
  if (!refVersion || !currentVersion) return false;
  return refVersion[0] < currentVersion[0]
    || (refVersion[0] === currentVersion[0] && refVersion[1] < currentVersion[1]);
}

export function validateSelfReferences(filename, source, currentTag) {
  const reference = new RegExp(
    `${escapePattern(selfReferencePrefix)}[^\\s"'\\x60@]*@([^\\s"'\\x60]+)`,
    'giu',
  );
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    for (const match of line.matchAll(reference)) {
      const ref = match[1];
      const historicalLine = filename === 'CHANGELOG.md'
        && line.startsWith('- Historical compatibility: ');
      const allowed = historicalLine ? isOlderV2Tag(ref, currentTag) : ref === currentTag;
      assert.ok(
        allowed,
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
