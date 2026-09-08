import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateReleasePins } from './generate-release-pins.mjs';

export function validateReleaseNotes(source, tag) {
  assert.match(tag ?? '', /^v2\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u, 'release notes require an exact v2 SemVer tag');
  assert.equal(source.split(/\r?\n/u)[0], `# Alconite Actions ${tag}`, 'curated release notes must identify the exact release');
  for (const heading of ['Features and documentation', 'Security fixes and upgrades', 'Upgrading', 'Known limitation']) {
    assert.ok(source.includes(`\n## ${heading}\n`), `curated release notes must include ${heading}`);
  }
}

export async function generateReleaseNotes({
  cwd = process.cwd(), tag, outputDirectory, sentinelName, sentinelDigest,
}) {
  assert.equal(sentinelName, 'ghcr.io/alconite-inc/sentinel-executor', 'release notes require the published Sentinel image name');
  assert.match(sentinelDigest ?? '', /^sha256:[a-f0-9]{64}$/u, 'release notes require the published image digest');
  assert.match(tag ?? '', /^v2\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u, 'release notes require an exact v2 SemVer tag');
  const curated = await readFile(path.join(cwd, 'docs', 'releases', `${tag}.md`), 'utf8');
  validateReleaseNotes(curated, tag);

  // Re-resolve the checked-out tag instead of trusting potentially stale generated assets.
  const pins = await generateReleasePins({ cwd, tag, outputDirectory });
  const references = await readFile(path.join(outputDirectory, 'release-pins.md'), 'utf8');
  const version = tag.slice(1);
  const notes = [
    curated.trim(), '',
    '## Published Sentinel image', '',
    `Linux \`amd64\`: \`${sentinelName}@${sentinelDigest}\``, '',
    `Tags at publication: \`${tag}\`, \`${version}\`, \`${version.slice(0, version.lastIndexOf('.'))}\`, \`${version.split('.')[0]}\`, \`latest\`. The digest identifies immutable registry content; moving aliases may change in later releases.`, '',
    'The attached `sentinel-executor.spdx.json` describes the tested release image.', '',
    // Nest the generated reference headings under one section in the release body.
    references.trim().replace(/^#/gmu, '##'), '',
  ].join('\n');
  await writeFile(path.join(outputDirectory, 'release-notes.md'), notes);
  return { tag: pins.tag, commit: pins.commit, sentinelName, sentinelDigest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const release = await generateReleaseNotes({
    tag: process.env.RELEASE_TAG,
    outputDirectory: 'build/release',
    sentinelName: process.env.SENTINEL_NAME,
    sentinelDigest: process.env.SENTINEL_DIGEST,
  });
  process.stdout.write(`Generated ${release.tag} release notes at ${release.commit} with ${release.sentinelDigest}.\n`);
}
