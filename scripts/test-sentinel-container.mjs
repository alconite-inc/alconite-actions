import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const image = process.argv[2];
if (!image) throw new Error('Usage: node scripts/test-sentinel-container.mjs <image>');
const inspect = JSON.parse(execFileSync('docker', ['image', 'inspect', image], { encoding: 'utf8' }))[0];
assert.equal(inspect.Config.User, '65532:65532');
assert.deepEqual(inspect.Config.Entrypoint, ['/nodejs/bin/node', '/opt/sentinel/sentinel-executor/dist/index.js']);
assert.equal(inspect.Config.WorkingDir, '/workspace');
assert.equal(inspect.Config.Healthcheck, undefined);
assert.equal(inspect.Config.ExposedPorts, undefined);
assert.equal(inspect.Config.Labels['org.opencontainers.image.version'], '2.5.0');

const root = await mkdtemp(path.join(os.tmpdir(), 'sentinel-container-test-'));
const workspace = path.join(root, 'workspace');
await mkdir(workspace);
await writeFile(path.join(workspace, 'openapi.yaml'), 'openapi: 3.1.0\ninfo:\n  title: Test\n  version: 1.0.0\n');
const reportsVolume = `sentinel-container-test-${process.pid}-${Date.now()}`;
execFileSync('docker', ['volume', 'create', reportsVolume], { encoding: 'utf8' });
const hardening = ['--rm', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--mount', `type=bind,src=${workspace},dst=/workspace,readonly`, '--mount', `type=volume,src=${reportsVolume},dst=/reports`];
try {
  assert.equal(execFileSync('docker', ['run', ...hardening, image, '--version'], { encoding: 'utf8' }), '2.5.0\n');
  assert.match(execFileSync('docker', ['run', ...hardening, image, '--help'], { encoding: 'utf8' }), /sentinel contract-guard/u);
  for (const [command, required] of [
    ['contract-guard', ['--project-id', 'cgprj_test']],
    ['impact', ['--project-id', 'cgprj_test', '--check-id', 'cgchk_test']],
    ['runtime-verify', ['--project-id', 'cgprj_test', '--environment-id', 'rtvenv_test', '--base-url', 'https://target.example']],
  ]) {
    assert.match(execFileSync('docker', ['run', ...hardening, image, command, '--help'], { encoding: 'utf8' }), new RegExp(`sentinel ${command}`, 'u'));
    const failure = failedRun(['run', ...hardening, image, command, ...required]);
    const envelope = JSON.parse(String(failure.stdout).trim());
    assert.deepEqual(envelope, { schema: 'alconite.sentinel-executor.result.v1', command, exitCode: 1, outputs: {} });
    assert.equal(`${failure.stdout}${failure.stderr}`.includes('alc_cg_synthetic_container_secret'), false);
    const tokenArgument = failedRun(['run', ...hardening, image, command, ...required, '--project-token', 'alc_cg_synthetic_container_secret']);
    assert.equal(`${tokenArgument.stdout}${tokenArgument.stderr}`.includes('alc_cg_synthetic_container_secret'), false);
  }
  for (const arguments_ of [
    ['contract-guard', '--project-id', 'cgprj_test', 'alc_cg_synthetic_container_secret'],
    ['alc_cg_synthetic_container_secret'],
    ['contract-guard', '--project-id', 'cgprj_test', '--unknown-alc_cg_synthetic_container_secret', 'value'],
  ]) {
    const failure = failedRun(['run', ...hardening, '--env', 'ALCONITE_PROJECT_TOKEN=alc_cg_synthetic_container_secret', image, ...arguments_]);
    assert.equal(`${failure.stdout}${failure.stderr}`.includes('alc_cg_synthetic_container_secret'), false);
  }

  const mockFile = path.join(root, 'mock-platform.mjs');
  await writeFile(mockFile, `import { createServer } from 'node:http';
const server = createServer((request, response) => {
  request.resume();
  const failed = request.headers['idempotency-key'] === 'container-failed-gate';
  const checkId = failed ? 'cgchk_failed' : 'cgchk_passed';
  const report = {
    schemaVersion: 'alconite.contract-guard.report.v1', checkId, projectId: 'cgprj_test', projectName: 'Test API',
    status: 'completed', gateResult: failed ? 'failed' : 'passed', createdAt: 1, completedAt: 2,
    baselineVersionId: 'base_1', baselineContentHash: 'a'.repeat(64), candidateVersionId: 'candidate_1',
    candidateContentHash: 'b'.repeat(64), policyRevision: 1,
    summary: { breaking: failed ? 1 : 0, risky: 0, nonBreaking: 0, informational: 0, policyFailures: failed ? 1 : 0, policyWarnings: 0, baselineAnalyzerScore: 100, candidateAnalyzerScore: failed ? 80 : 100 },
    violations: [], changes: [], analyzerVersion: '1.0.0', analyzerRuleSetVersion: 1, comparisonEngineVersion: 1,
    reportUrl: '/api/v1/report'
  };
  response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(report));
});
server.listen(18431, '127.0.0.1', () => console.log('ready'));`);
  const mock = execFileSync('docker', ['run', '--detach', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--mount', `type=bind,src=${mockFile},dst=/mock-platform.mjs,readonly`, 'node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e', 'node', '/mock-platform.mjs'], { encoding: 'utf8' }).trim();
  try {
    await waitForMock(mock);
    const common = ['run', ...hardening, '--network', `container:${mock}`, '--env', 'ALCONITE_PROJECT_TOKEN=alc_cg_synthetic_container_secret', image, 'contract-guard', '--project-id', 'cgprj_test', '--api-url', 'http://127.0.0.1:18431', '--retry-attempts', '1'];
    const passed = JSON.parse(execFileSync('docker', [...common, '--idempotency-key', 'container-passed-gate'], { encoding: 'utf8' }).trim());
    assert.equal(passed.exitCode, 0);
    assert.equal(passed.outputs['gate-result'], 'passed');
    assert.ok(passed.outputs['report-path'].startsWith('/reports/'));
    const failed = failedRun([...common, '--idempotency-key', 'container-failed-gate']);
    const failedEnvelope = JSON.parse(String(failed.stdout).trim());
    assert.equal(failedEnvelope.exitCode, 1);
    assert.equal(failedEnvelope.outputs['gate-result'], 'failed');
    assert.ok(failedEnvelope.outputs['report-path'].startsWith('/reports/'));
    assert.equal(`${failed.stdout}${failed.stderr}`.includes('alc_cg_synthetic_container_secret'), false);
    const reportFiles = JSON.parse(execFileSync('docker', ['run', ...hardening, '--entrypoint', '/nodejs/bin/node', image, '-e', "process.stdout.write(JSON.stringify(require('node:fs').readdirSync('/reports').sort()))"], { encoding: 'utf8' }));
    assert.ok(reportFiles.includes(path.basename(passed.outputs['report-path'])));
    assert.ok(reportFiles.includes(path.basename(failedEnvelope.outputs['report-path'])));
  } finally {
    execFileSync('docker', ['rm', '--force', mock]);
  }

  const container = execFileSync('docker', ['create', image, '--version'], { encoding: 'utf8' }).trim();
  try {
    const tarFile = path.join(root, 'image.tar');
    execFileSync('docker', ['export', '--output', tarFile, container]);
    const files = execFileSync('tar', ['-tf', tarFile], { encoding: 'utf8' }).split('\n');
    assert.equal(files.some((name) => name.startsWith('opt/sentinel/') && (/\.map$/u.test(name) || /\.(?:ts|tsx)$/u.test(name) || name.includes('package-lock'))), false);
    for (const forbiddenPath of [
      'bin/sh',
      'bin/bash',
      'usr/bin/bash',
      'sbin/apk',
      'usr/sbin/apk',
      'usr/bin/apk',
      'usr/local/bin/npm',
      'usr/local/bin/npx',
      'usr/local/bin/corepack',
      'opt/yarn-v1.22.22',
    ]) {
      assert.equal(files.includes(forbiddenPath) || files.some((name) => name.startsWith(`${forbiddenPath}/`)), false, `image must not contain ${forbiddenPath}`);
    }
    const modes = execFileSync('tar', ['-tvf', tarFile], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\n');
    assert.equal(modes.some((line) => {
      const mode = line.trimStart().split(/\s+/u)[0] ?? '';
      return mode[3] === 's' || mode[3] === 'S' || mode[6] === 's' || mode[6] === 'S';
    }), false, 'image must not contain setuid or setgid files');
  } finally {
    execFileSync('docker', ['rm', container]);
  }
} finally {
  try {
    execFileSync('docker', ['volume', 'rm', reportsVolume]);
  } finally {
    await rm(root, { recursive: true });
  }
}

process.stdout.write(`Sentinel container ${image} passed hardened smoke and content inspection.\n`);

function failedRun(arguments_) {
  try {
    execFileSync('docker', arguments_, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    assert.ok(error && typeof error === 'object' && 'stdout' in error && 'stderr' in error);
    return error;
  }
  throw new Error('Expected Docker command to fail.');
}

async function waitForMock(container) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (execFileSync('docker', ['logs', container], { encoding: 'utf8' }).includes('ready')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Synthetic platform did not become ready.');
}
