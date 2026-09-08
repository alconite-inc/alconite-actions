import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const AMBIGUOUS_REGISTRY_FAILURE = /(?:unauthori[sz]ed|authentication|authori[sz](?:e|ation)|forbidden|access denied|insufficient_scope|token endpoint|\b(?:401|403|408|409|425|429|500|502|503|504)\b|too many requests|rate[- ]?limit|timed?\s*out|timeout|deadline exceeded|context canceled|i\/o timeout|dial tcp|network (?:is )?unreachable|connection (?:refused|reset|closed)|temporary failure|service unavailable|internal server error|\btls\b|x509|certificate)/iu;
const CONFIRMED_ABSENCE_LINES = [
  /^(?:error:\s*)?manifest unknown(?::\s*manifest unknown)?\.?$/iu,
  /^(?:error:\s*)?unexpected status from HEAD request(?:\s+to\s+\S+)?:\s*404(?:\s+Not Found)?\.?$/iu,
  /^(?:error:\s*)?(?:response )?status(?: code)?[: ]+404(?:\s+Not Found)?\.?$/iu,
  /^(?:error:\s*)?[a-z0-9][a-z0-9.-]*(?::[0-9]+)?(?:\/[a-z0-9._-]+)+(?:@sha256:[a-f0-9]{64}|:[a-z0-9][a-z0-9._-]{0,127}):\s*not found\.?$/iu,
  /^(?:error:\s*)?no such manifest:\s*\S+\.?$/iu,
];
const RELEASE_MANIFEST_COPY = 'docker buildx imagetools create --prefer-index=false --tag "$image:$alias" "$image@$digest"';
const DOCKER_HUB_VERSION_COPY = 'docker buildx imagetools create --prefer-index=false --tag "$TARGET_IMAGE:$RELEASE_TAG" "$source_image@$digest"';
const DOCKER_HUB_LATEST_COPY = 'docker buildx imagetools create --prefer-index=false --tag "$TARGET_IMAGE:latest" "$source_image@$digest"';

function occurrenceCount(source, value) {
  return source.split(value).length - 1;
}

/** Enforce the three approved manifest-preserving registry copy operations. */
export function validateManifestPreservingCopies(releaseSource, promotionSource) {
  const combined = `${releaseSource}\n${promotionSource}`;
  const allCopies = combined.match(/docker buildx imagetools create\b/gu) ?? [];
  const preservingCopies = combined.match(/docker buildx imagetools create --prefer-index=false --tag\b/gu) ?? [];
  assert.equal(allCopies.length, 3, 'exactly three registry manifest copy operations are approved');
  assert.equal(preservingCopies.length, 3, 'every registry manifest copy must preserve the source manifest format');
  assert.equal(occurrenceCount(releaseSource, RELEASE_MANIFEST_COPY), 1, 'release aliases must preserve the exact image manifest');
  assert.equal(occurrenceCount(promotionSource, DOCKER_HUB_VERSION_COPY), 1, 'Docker Hub exact-version promotion must preserve the source manifest');
  assert.equal(occurrenceCount(promotionSource, DOCKER_HUB_LATEST_COPY), 1, 'Docker Hub latest promotion must preserve the source manifest');
}

/** Classify an OCI manifest inspection without treating ambiguous failures as absence. */
export function classifyRegistryInspection(exitCode, diagnostic) {
  if (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255) return 'unknown';
  if (exitCode === 0) return 'present';
  if (typeof diagnostic !== 'string' || AMBIGUOUS_REGISTRY_FAILURE.test(diagnostic)) return 'unknown';
  const lines = diagnostic.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return 'unknown';
  return lines.every((line) => CONFIRMED_ABSENCE_LINES.some((pattern) => pattern.test(line)))
    ? 'absent'
    : 'unknown';
}

async function validateRepositoryContract() {
  const { parse } = await import('yaml');
  const dockerfile = await readFile('sentinel-executor/Dockerfile', 'utf8');
  assert.match(dockerfile, /^FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS builder$/mu);
  assert.match(dockerfile, /^FROM cgr\.dev\/chainguard\/glibc-dynamic:latest@sha256:d49aa7837ef1ef8fae33917f94369294c6d49940d2f0b225beee65a3bb6747ed$/mu);
  assert.match(dockerfile, /RUN npm ci/u);
  assert.match(dockerfile, /^COPY --from=builder \/usr\/local\/bin\/node \/nodejs\/bin\/node$/mu);
  assert.match(dockerfile, /USER 65532:65532/u);
  assert.match(dockerfile, /ENTRYPOINT \["\/nodejs\/bin\/node", "\/opt\/sentinel\/sentinel-executor\/dist\/index\.js"\]/u);
  for (const forbidden of ['HEALTHCHECK', 'EXPOSE', 'npm install', 'COPY . .', '.js.map']) assert.equal(dockerfile.includes(forbidden), false, `Dockerfile contains forbidden ${forbidden}`);

  const pins = [
    'anchore/scan-action@27805bf3b4e84b4a5c980df22ed233c00390a439',
    'anchore/sbom-action@3ad7283483fc7af8ff2b4ea19663c2d5ca935e26',
    'actions/attest-sbom@c604332985a26aa8cf1bdc465b92731239ec6b9e',
    'actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8',
  ];
  const workflows = await Promise.all([
    '.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/promote-sentinel-docker-hub.yml',
  ].map((filename) => readFile(filename, 'utf8')));
  const combined = workflows.join('\n');
  for (const pin of pins) assert.match(combined, new RegExp(pin.replaceAll('/', '\\/'), 'u'), `missing security pin ${pin}`);
  assert.equal(combined.includes('continue-on-error'), false, 'container security gates may not continue on error');
  assert.equal(combined.includes('only-fixed'), false, 'container scans may not ignore unfixed vulnerabilities');

  const ci = parse(workflows[0]);
  assert.equal(ci.jobs?.['sentinel-image']?.permissions?.contents, 'read');
  assert.equal(Object.keys(ci.jobs?.['sentinel-image']?.permissions ?? {}).length, 1, 'CI image job must have contents: read only');
  const release = parse(workflows[1]);
  assert.deepEqual(release.on?.push?.tags, ['v2.*.*']);
  assert.equal(release.jobs?.release?.permissions?.packages, 'write');
  const releaseSteps = release.jobs?.release?.steps ?? [];
  const releaseScan = releaseSteps.findIndex((step) => step.uses?.startsWith('anchore/scan-action@'));
  const releaseLogin = releaseSteps.findIndex((step) => step.uses?.startsWith('docker/login-action@'));
  const releasePush = releaseSteps.findIndex((step) => step.id === 'sentinel');
  assert.ok(releaseScan >= 0 && releaseScan < releaseLogin && releaseLogin < releasePush, 'release must scan before login and push');
  assert.match(releaseSteps[releasePush]?.run ?? '', /registry-inspection-state.*inspection_status/us, 'release must classify exact-version inspection failures');
  assert.match(releaseSteps[releasePush]?.run ?? '', /present\).*refusing to rewrite/us, 'release must refuse an existing exact version before push');
  assert.match(releaseSteps[releasePush]?.run ?? '', /absent\).*docker tag.*docker push/us, 'release may push only after confirmed absence');
  assert.match(releaseSteps[releasePush]?.run ?? '', /for alias in "\$version" "\$minor" "\$major" latest/u);
  assert.match(releaseSteps[releasePush]?.run ?? '', /actual.*==.*digest/us, 'release aliases must be digest-verified');
  const promotion = parse(workflows[2]);
  assert.ok(promotion.on?.workflow_dispatch, 'Docker Hub promotion must be manual');
  assert.deepEqual(Object.keys(promotion.on), ['workflow_dispatch'], 'Docker Hub promotion must have no non-manual trigger');
  assert.equal(promotion.on.workflow_dispatch.inputs?.version?.type, 'string');
  assert.equal(promotion.on.workflow_dispatch.inputs?.publish_latest?.default, false);
  assert.equal(promotion.concurrency?.['cancel-in-progress'], false, 'Docker Hub promotion must not cancel an in-progress version');
  assert.equal(promotion.jobs?.promote?.environment, 'docker-hub');
  assert.equal(promotion.jobs?.promote?.permissions?.packages, 'read');
  assert.equal(promotion.jobs?.promote?.permissions?.contents, 'read');
  assert.equal(Object.keys(promotion.jobs?.promote?.permissions ?? {}).length, 2);
  const promotionSource = workflows[2];
  validateManifestPreservingCopies(workflows[1], promotionSource);
  assert.equal(promotionSource.includes('docker build '), false, 'Docker Hub promotion must not rebuild');
  assert.equal(promotionSource.includes('docker buildx build '), false, 'Docker Hub promotion must not invoke the Dockerfile');
  assert.match(promotionSource, /\^2\\\./u, 'promotion version must omit a leading v');
  assert.match(promotionSource, /DOCKERHUB_SENTINEL_IMAGE/u);
  assert.match(promotionSource, /registry-inspection-state.*inspection_status/us, 'promotion must classify destination inspection failures');
  assert.match(promotionSource, /present\).*existing.*==.*digest/us, 'promotion must accept only a matching existing exact version');
  assert.match(promotionSource, /absent\).*imagetools create --prefer-index=false/us, 'promotion may create the exact version only after confirmed absence');
  assert.match(promotionSource, /Unable to prove Docker Hub exact-version state/us, 'promotion must fail closed on unknown registry state');
  assert.match(promotionSource, /exact version already names different immutable content/u);
  assert.match(promotionSource, /PUBLISH_LATEST.*== "true"/us);
  assert.match(promotionSource, /actual.*==.*digest/us, 'Docker Hub exact version must be digest-verified');

  process.stdout.write('Validated the pinned Sentinel image and workflow contract.\n');
}

async function main() {
  if (process.argv[2] === 'registry-inspection-state') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const exitCode = Number(process.argv[3]);
    process.stdout.write(`${classifyRegistryInspection(exitCode, Buffer.concat(chunks).toString('utf8'))}\n`);
    return;
  }
  await validateRepositoryContract();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
