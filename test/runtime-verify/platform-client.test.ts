import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test, { type TestContext } from 'node:test';
import { RuntimeVerifyPlatformClient, type InitiationRequest } from '../../src/runtime-verify/platform-client';
import { createRunnerResult, type RuntimeVerifyReport } from '../../src/runtime-verify/report';

const hash = `sha256:${'a'.repeat(64)}`;
const request: InitiationRequest = {
  environmentId: 'rtvenv_test', contractGuardCheckId: 'cgchk_test', contractContentHash: hash,
  configurationContentHash: hash, deployment: {
    provider: 'github-actions', repository: 'owner/repo', commitSha: 'abc', ref: 'refs/heads/main', workflow: 'CI',
    workflowRunId: '1', workflowRunAttempt: 1
  }, runner: { name: 'alconite-runtime-verify-action', version: '2.1.0', operatingSystem: 'Linux', architecture: 'X64' }
};
const report: RuntimeVerifyReport = {
  schemaVersion: 'alconite.runtime-verify.report.v1', runId: 'rtvrun_test', projectId: 'cgprj_test',
  environmentId: 'rtvenv_test', contractGuardCheckId: 'cgchk_test', status: 'completed', gateResult: 'passed',
  contractContentHash: hash, expectedContractContentHash: hash,
  summary: { configuredOperations: 1, executedOperations: 1, passedOperations: 1, failedOperations: 0, warningOperations: 0, findingCount: 0 },
  findings: [], reportUrl: '/runtime/report'
};
const result = createRunnerResult({ runId: 'rtvrun_test', contractContentHash: hash, configurationContentHash: hash,
  startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', observations: [], findings: [] });

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
  return new RuntimeVerifyPlatformClient({ apiUrl, projectId: 'cgprj_test', projectToken: 'alc_cg_secret', retryAttempts, sleep, random: () => 0 });
}
function json(reply: ServerResponse, status: number, body: unknown): void {
  reply.writeHead(status, { 'content-type': 'application/json' }); reply.end(JSON.stringify(body));
}

test('initiates with bearer auth, idempotency, and no target origin', async t => {
  const apiUrl = await mockServer(t, (incoming, reply, body) => {
    assert.equal(incoming.headers.authorization, 'Bearer alc_cg_secret');
    assert.equal(incoming.headers['idempotency-key'], 'runtime-gh-v1-test');
    assert.equal(JSON.stringify(body).includes('baseUrl'), false);
    json(reply, 200, { schemaVersion: 'alconite.runtime-verify.run.v1', runId: 'rtvrun_test', status: 'pending', expectedContractContentHash: hash, maximumOperations: 10 });
  });
  const response = await client(apiUrl).initiate(request, 'runtime-gh-v1-test');
  assert.equal(response.status, 'pending');
  assert.equal(response.maximumOperations, 10);
});

test('submits completion, failure, and the same deterministic result digest on replay', async t => {
  const digests: string[] = [];
  let failures = 0;
  const apiUrl = await mockServer(t, (incoming, reply, body) => {
    if (incoming.url?.endsWith('/failure')) { failures += 1; json(reply, 200, {}); return; }
    digests.push(body.resultDigest); json(reply, 200, report);
  });
  const platform = client(apiUrl);
  await platform.complete('rtvrun_test', result);
  await platform.complete('rtvrun_test', result);
  await platform.fail('rtvrun_test', 'runner_internal_error', 'Safe runner failure.');
  assert.deepEqual(digests, [result.resultDigest, result.resultDigest]);
  assert.equal(failures, 1);
});

test('returns a completed replay without target work', async t => {
  const apiUrl = await mockServer(t, (_incoming, reply) => json(reply, 200, {
    schemaVersion: 'alconite.runtime-verify.run.v1', runId: 'rtvrun_test', status: 'completed', expectedContractContentHash: hash, replayed: true, report
  }));
  const replay = await client(apiUrl).initiate(request, 'key');
  assert.equal(replay.replayed, true);
  assert.equal(replay.report?.gateResult, 'passed');
});

test('recognizes a pending idempotent replay and continues runner work', async t => {
  const apiUrl = await mockServer(t, (_incoming, reply) => json(reply, 200, {
    schemaVersion: 'alconite.runtime-verify.run.v1', runId: 'rtvrun_test', status: 'pending', expectedContractContentHash: hash, replayed: true
  }));
  const replay = await client(apiUrl).initiate(request, 'key');
  assert.equal(replay.status, 'pending');
  assert.equal(replay.replayed, true);
});

for (const status of [401, 403, 409, 429]) {
  test(`does not retry platform HTTP ${status}`, async t => {
    let calls = 0;
    const apiUrl = await mockServer(t, (_incoming, reply) => { calls += 1; json(reply, status, { error: { code: 'rejected', message: 'unsafe detail omitted' } }); });
    await assert.rejects(client(apiUrl, 3).initiate(request, 'key'), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  });
}

test('retries only bounded transient platform failures', async t => {
  let calls = 0;
  const delays: number[] = [];
  const apiUrl = await mockServer(t, (_incoming, reply) => {
    calls += 1;
    if (calls < 3) { json(reply, 503, { error: { code: 'unavailable', message: 'retry' } }); return; }
    json(reply, 200, { schemaVersion: 'alconite.runtime-verify.run.v1', runId: 'rtvrun_test', status: 'pending', expectedContractContentHash: hash });
  });
  await new RuntimeVerifyPlatformClient({ apiUrl, projectId: 'cgprj_test', projectToken: 'alc_cg_secret', retryAttempts: 3,
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

test('rejects malformed platform reports', async t => {
  const apiUrl = await mockServer(t, (_incoming, reply) => json(reply, 200, { ...report, schemaVersion: 'unknown' }));
  await assert.rejects(client(apiUrl).complete('rtvrun_test', result), /schema version/);
});
