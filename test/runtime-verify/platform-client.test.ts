import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test, { type TestContext } from 'node:test';
import { RuntimeVerifyPlatformClient, type InitiationRequest, validateReport } from '../../src/runtime-verify/platform-client';
import { createRunnerResult, type RuntimeVerifyReport } from '../../src/runtime-verify/report';

const hash = `sha256:${'a'.repeat(64)}`;
const projectId = 'cgprj_44444444444444444444444444444444';
const environmentId = 'rtvenv_11111111111111111111111111111111';
const checkId = 'cgchk_22222222222222222222222222222222';
const runId = 'rtvrun_33333333333333333333333333333333';
const request: InitiationRequest = {
  environmentId, contractGuardCheckId: checkId, contractContentHash: hash,
  configurationContentHash: hash, displayName: 'Runtime verification', deployment: {
    provider: 'github-actions', repository: 'owner/repo', commitSha: 'abc', ref: 'refs/heads/main', workflow: 'CI',
    workflowRunId: '1', workflowRunAttempt: 1
  }, runner: { name: 'alconite-runtime-verify-action', version: '2.1.1', operatingSystem: 'Linux', architecture: 'X64' }
};
const report: RuntimeVerifyReport = {
  schema: 'alconite.runtime-verify.report.v1', runId, projectId, environmentId, contractGuardCheckId: checkId,
  status: 'completed', gateResult: 'passed', policyRevision: 1,
  contract: {
    approvedCandidateVersionId: 'cgver_55555555555555555555555555555555',
    approvedCandidateContentHash: hash, localContractContentHash: hash, hashMatched: true
  },
  deployment: {
    provider: 'github-actions', repository: 'owner/repo', commitSha: 'abc', ref: 'refs/heads/main', workflow: 'CI',
    workflowRunId: '1', workflowRunAttempt: 1, releaseIdentifier: null
  },
  runner: { name: 'alconite-runtime-verify-action', version: '2.1.1', operatingSystem: 'Linux', architecture: 'X64' },
  summary: {
    configuredOperations: 0, executedOperations: 0, passedOperations: 0, failedOperations: 0, warningOperations: 0,
    informationalFindings: 0, totalDurationMilliseconds: 0
  },
  violations: [], findings: [], createdAt: 1, completedAt: 2,
  reportUrl: `/api/v1/runtime-verify/projects/${projectId}/runs/${runId}/report`
};
const result = createRunnerResult({
  completedAt: '2026-01-01T00:00:01.000Z',
  execution: {
    configuredOperations: 0, executedOperations: 0, passedOperations: 0, failedOperations: 0, warningOperations: 0,
    totalDurationMilliseconds: 0
  },
  contract: { localContentHash: hash, matchedApprovedCandidate: true }, observations: [], findings: []
});

async function mockServer(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse, body: any) => void): Promise<URL> {
  const instance = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
    incoming.on('end', () => {
      let body: unknown = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* tested by client */ }
      handler(incoming, outgoing, body);
    });
  });
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => { instance.closeAllConnections(); instance.close(); });
  const address = instance.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return new URL(`http://127.0.0.1:${address.port}/`);
}

function client(apiUrl: URL, retryAttempts = 1, sleep = async () => undefined) {
  return new RuntimeVerifyPlatformClient({ apiUrl, projectId, projectToken: 'alc_cg_secret', retryAttempts, sleep, random: () => 0 });
}
function json(reply: ServerResponse, status: number, body: unknown): void {
  reply.writeHead(status, { 'content-type': 'application/json' }); reply.end(JSON.stringify(body));
}
function pending(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId, status: 'pending', replayed: false, expectedContractContentHash: hash,
    limits: { maximumOperations: 10, maximumFindings: 500, maximumResultBytes: 5_242_880, maximumResponseBytes: 1_048_576 },
    report: null,
    ...overrides
  };
}

test('initiates with bearer auth, idempotency, required display name, and no target origin', async t => {
  const apiUrl = await mockServer(t, (incoming, reply, body) => {
    assert.equal(incoming.headers.authorization, 'Bearer alc_cg_secret');
    assert.equal(incoming.headers['idempotency-key'], 'runtime-gh-v1-test');
    assert.equal(body.displayName, 'Runtime verification');
    assert.equal(JSON.stringify(body).includes('baseUrl'), false);
    json(reply, 200, pending());
  });
  const response = await client(apiUrl).initiate(request, 'runtime-gh-v1-test');
  assert.equal(response.status, 'pending');
  assert.equal(response.maximumOperations, 10);
});

test('submits the canonical completion envelope, failure, and deterministic result digest on replay', async t => {
  const digests: string[] = [];
  let failures = 0;
  const apiUrl = await mockServer(t, (incoming, reply, body) => {
    if (incoming.url?.endsWith('/failure')) { failures += 1; json(reply, 200, {}); return; }
    assert.equal(body.schema, 'alconite.runtime-verify.runner-result.v1');
    assert.equal(Object.hasOwn(body, 'schemaVersion'), false);
    assert.equal(Object.hasOwn(body, 'runId'), false);
    assert.deepEqual(body.contract, { localContentHash: hash, matchedApprovedCandidate: true });
    digests.push(body.resultDigest); json(reply, 200, report);
  });
  const platform = client(apiUrl);
  await platform.complete(runId, result);
  await platform.complete(runId, result);
  await platform.fail(runId, 'runner_internal_error', 'Safe runner failure.');
  assert.deepEqual(digests, [result.resultDigest, result.resultDigest]);
  assert.equal(failures, 1);
});

test('returns a completed replay without target work', async t => {
  const apiUrl = await mockServer(t, (_incoming, reply) => json(reply, 200, pending({
    status: 'completed', replayed: true, report
  })));
  const replay = await client(apiUrl).initiate(request, 'key');
  assert.equal(replay.replayed, true);
  assert.equal(replay.report?.gateResult, 'passed');
});

test('recognizes a pending idempotent replay and continues runner work', async t => {
  const apiUrl = await mockServer(t, (_incoming, reply) => json(reply, 200, pending({ replayed: true })));
  const replay = await client(apiUrl).initiate(request, 'key');
  assert.equal(replay.status, 'pending');
  assert.equal(replay.replayed, true);
});

test('releases a safely identified pending run when initiation validation fails', async t => {
  let failureCalls = 0;
  const apiUrl = await mockServer(t, (incoming, reply, body) => {
    if (incoming.url?.endsWith('/failure')) {
      failureCalls += 1;
      assert.equal(body.code, 'platform_contract_mismatch');
      assert.doesNotMatch(body.message, /alc_cg_secret/);
      json(reply, 200, {});
      return;
    }
    json(reply, 200, pending({ limits: { maximumOperations: 0 } }));
  });

  await assert.rejects(client(apiUrl).initiate(request, 'key'), /limits\.maximumOperations/);
  assert.equal(failureCalls, 1);
});

for (const status of [401, 403, 409, 429]) {
  test(`does not retry platform HTTP ${status}`, async t => {
    let calls = 0;
    const apiUrl = await mockServer(t, (_incoming, reply) => { calls += 1; json(reply, status, { error: { code: 'rejected', message: 'unsafe detail omitted' } }); });
    await assert.rejects(client(apiUrl, 3).initiate(request, 'key'), new RegExp(`run initiation with HTTP ${status}`));
    assert.equal(calls, 1);
  });
}

test('identifies the failed platform phase without exposing request data', async t => {
  const apiUrl = await mockServer(t, (_incoming, reply) => {
    json(reply, 503, { error: { code: 'service_unavailable', message: 'internal detail omitted' } });
  });
  await assert.rejects(
    client(apiUrl).complete(runId, result),
    /result submission with HTTP 503 \(service_unavailable\)/
  );
});

test('retries only bounded transient platform failures', async t => {
  let calls = 0;
  const delays: number[] = [];
  const apiUrl = await mockServer(t, (_incoming, reply) => {
    calls += 1;
    if (calls < 3) { json(reply, 503, { error: { code: 'unavailable', message: 'retry' } }); return; }
    json(reply, 200, pending());
  });
  await new RuntimeVerifyPlatformClient({ apiUrl, projectId, projectToken: 'alc_cg_secret', retryAttempts: 3,
    sleep: async delay => { delays.push(delay); }, random: () => 0 }).initiate(request, 'key');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 500]);
});

test('refuses platform redirects', async t => {
  const apiUrl = await mockServer(t, (_incoming, reply) => { reply.writeHead(302, { location: '/other' }); reply.end(); });
  await assert.rejects(client(apiUrl).initiate(request, 'key'), /redirect/);
});

test('refuses non-HTTPS non-loopback Alconite origins', () => {
  assert.throws(() => client(new URL('http://example.test/')), /must use HTTPS/);
});

test('rejects malformed and legacy platform reports', async t => {
  const apiUrl = await mockServer(t, (_incoming, reply) => json(reply, 200, { ...report, schema: 'unknown' }));
  await assert.rejects(client(apiUrl).complete(runId, result), /schema version/);
  assert.throws(() => validateReport({ ...report, schema: undefined, schemaVersion: 'alconite.runtime-verify.report.v1' }), /schema version/);
});
