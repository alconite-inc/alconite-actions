import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import {
  createDefaultIdempotencyKey,
  MAX_REPORT_BYTES,
  parseFailOn,
  readCandidate,
  runCheck,
  shouldFailGate,
  validateApiUrl,
  validateProjectId,
  type ContractGuardReport,
} from '../src/contract-guard';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function report(projectId = 'cgprj_test'): ContractGuardReport {
  return {
    schemaVersion: 'alconite.contract-guard.report.v1',
    checkId: 'cgchk_test',
    projectId,
    projectName: 'Test API',
    status: 'completed',
    gateResult: 'passed_with_warnings',
    createdAt: 1,
    completedAt: 2,
    baselineVersionId: 'base_1',
    baselineContentHash: 'a'.repeat(64),
    candidateVersionId: 'candidate_1',
    candidateContentHash: 'b'.repeat(64),
    policyRevision: 1,
    summary: {
      breaking: 0,
      risky: 1,
      nonBreaking: 2,
      informational: 3,
      policyFailures: 0,
      policyWarnings: 1,
      baselineAnalyzerScore: 90,
      candidateAnalyzerScore: 91,
    },
    violations: [],
    changes: [],
    analyzerVersion: '1.0.0',
    analyzerRuleSetVersion: 1,
    comparisonEngineVersion: 1,
    reportUrl: '/api/v1/report',
  };
}

test('validates identifiers, URLs, and gate thresholds', () => {
  assert.equal(validateProjectId('cgprj_abc-123'), 'cgprj_abc-123');
  assert.throws(() => validateProjectId('project_123'));
  assert.equal(validateApiUrl('https://alconite.com/'), 'https://alconite.com');
  assert.throws(() => validateApiUrl('http://example.com'));
  assert.equal(parseFailOn('warnings'), 'warnings');
  assert.equal(shouldFailGate('passed_with_warnings', 'failed'), false);
  assert.equal(shouldFailGate('passed_with_warnings', 'warnings'), true);
});

test('creates a stable bounded idempotency key', () => {
  const key = createDefaultIdempotencyKey({
    repository: 'alconite-inc/example',
    runId: '1234',
    projectId: 'cgprj_test',
    candidateHash: 'c'.repeat(64),
  });
  assert.match(key, /^cg-v2-[a-f0-9]{64}$/u);
  assert.equal(
    key,
    createDefaultIdempotencyKey({
      repository: 'alconite-inc/example',
      runId: '1234',
      projectId: 'cgprj_test',
      candidateHash: 'c'.repeat(64),
    }),
  );
  assert.ok(key.length <= 200);
});

test('reads and hashes a candidate inside the workspace', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'contract-guard-test-'));
  temporaryDirectories.push(directory);
  const candidatePath = path.join(directory, 'openapi.yaml');
  await fs.writeFile(candidatePath, 'openapi: 3.1.0\n');
  const candidate = await readCandidate(candidatePath, directory);
  assert.equal(candidate.filename, 'openapi.yaml');
  assert.equal(candidate.contentType, 'application/yaml');
  assert.match(candidate.sha256, /^[a-f0-9]{64}$/u);
});

test('posts multipart data with bearer auth and returns the completed report', async () => {
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/v1/contract-guard/projects/cgprj_test/checks');
    assert.equal(request.headers.authorization, 'Bearer alc_cg_secret');
    assert.equal(request.headers['idempotency-key'], 'test-attempt');
    assert.equal(request.headers['user-agent'], 'alconite-contract-guard-action/2.2.0');
    assert.match(request.headers['content-type'] || '', /^multipart\/form-data; boundary=/u);
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(report()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const result = await runCheck({
      apiUrl: `http://127.0.0.1:${address.port}`,
      projectId: 'cgprj_test',
      projectToken: 'alc_cg_secret',
      candidate: {
        bytes: Buffer.from('openapi: 3.1.0\n'),
        filename: 'openapi.yaml',
        contentType: 'application/yaml',
        sha256: 'c'.repeat(64),
        resolvedPath: '/openapi.yaml',
      },
      displayName: 'test release',
      idempotencyKey: 'test-attempt',
      timeoutMs: 5_000,
      attempts: 1,
    });
    assert.equal(result.gateResult, 'passed_with_warnings');
    assert.equal(requestCount, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('retries transient responses with the same logical request', async () => {
  let requestCount = 0;
  const mockFetch: typeof fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) return new Response(JSON.stringify({ error: { code: 'unavailable', message: 'try again' } }), { status: 503 });
    return new Response(JSON.stringify(report()), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await runCheck(
    {
      apiUrl: 'https://alconite.com',
      projectId: 'cgprj_test',
      projectToken: 'alc_cg_secret',
      candidate: {
        bytes: Buffer.from('{}'),
        filename: 'openapi.json',
        contentType: 'application/json',
        sha256: 'd'.repeat(64),
        resolvedPath: '/openapi.json',
      },
      idempotencyKey: 'retry-attempt',
      timeoutMs: 5_000,
      attempts: 2,
    },
    { fetch: mockFetch, sleep: async () => undefined },
  );
  assert.equal(result.checkId, 'cgchk_test');
  assert.equal(requestCount, 2);
});

test('rejects an oversized report before parsing it', async () => {
  const mockFetch: typeof fetch = async () =>
    new Response('{}', {
      status: 200,
      headers: { 'content-length': String(MAX_REPORT_BYTES + 1) },
    });
  await assert.rejects(
    runCheck(
      {
        apiUrl: 'https://alconite.com',
        projectId: 'cgprj_test',
        projectToken: 'alc_cg_secret',
        candidate: {
          bytes: Buffer.from('{}'),
          filename: 'openapi.json',
          contentType: 'application/json',
          sha256: 'd'.repeat(64),
          resolvedPath: '/openapi.json',
        },
        idempotencyKey: 'oversized-report',
        timeoutMs: 5_000,
        attempts: 1,
      },
      { fetch: mockFetch, sleep: async () => undefined },
    ),
    /response exceeded/u,
  );
});

test('runs the compiled GitHub Action entry point without leaking its token', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'contract-guard-action-test-'));
  temporaryDirectories.push(directory);
  const candidatePath = path.join(directory, 'openapi.yaml');
  const outputPath = path.join(directory, 'github-output.txt');
  const summaryPath = path.join(directory, 'summary.md');
  const reportPath = path.join(directory, 'report.json');
  await fs.writeFile(candidatePath, 'openapi: 3.1.0\ninfo:\n  title: Test\n  version: 1.0.0\n');
  await fs.writeFile(outputPath, '');
  await fs.writeFile(summaryPath, '');

  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ...report(), gateResult: 'passed' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../src/index.js')], {
      env: {
        ...process.env,
        'INPUT_PROJECT-ID': 'cgprj_test',
        'INPUT_PROJECT-TOKEN': 'alc_cg_do-not-log-this',
        'INPUT_CANDIDATE-PATH': candidatePath,
        'INPUT_DISPLAY-NAME': 'integration test',
        'INPUT_API-URL': `http://127.0.0.1:${address.port}`,
        'INPUT_IDEMPOTENCY-KEY': 'entry-point-test',
        'INPUT_TIMEOUT-SECONDS': '5',
        'INPUT_RETRY-ATTEMPTS': '1',
        'INPUT_FAIL-ON': 'failed',
        'INPUT_REPORT-PATH': reportPath,
        GITHUB_WORKSPACE: directory,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        GITHUB_REPOSITORY: 'alconite-inc/test',
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: '1'.repeat(40),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });

    assert.equal(exitCode, 0, stderr);
    const stdoutAfterMaskCommand = stdout.replace('::add-mask::alc_cg_do-not-log-this\n', '');
    assert.ok(!stdoutAfterMaskCommand.includes('alc_cg_do-not-log-this'));
    assert.ok(!stderr.includes('alc_cg_do-not-log-this'));
    assert.match(await fs.readFile(outputPath, 'utf8'), /gate-result<<[^\n]+\npassed\n/u);
    assert.match(await fs.readFile(summaryPath, 'utf8'), /Alconite Contract Guard/u);
    assert.equal(JSON.parse(await fs.readFile(reportPath, 'utf8')).checkId, 'cgchk_test');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
