import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ActionDeadline } from '../src/impact/deadline';
import { ImpactActionError } from '../src/impact/errors';
import { MAX_REPORT_BYTES, type ImpactRequest } from '../src/impact/models';
import {
  ImpactPlatformClient,
  MAX_REQUEST_BYTES,
  validateApiUrl,
  validateCheckId,
  validateProjectId,
  validateProjectToken,
} from '../src/impact/platform-client';

const PROJECT_ID = 'cgprj_11111111111111111111111111111111';
const CHECK_ID = 'cgchk_22222222222222222222222222222222';
const TOKEN = 'alc_cg_test-secret';

async function fixture(): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.resolve('test/fixtures/impact-report-v1.json'), 'utf8')) as unknown;
}

function request(): ImpactRequest {
  return {
    source: {
      logicalRoot: '.',
      files: [{ path: 'src/customer.ts', content: 'interface Customer { firstName: string }' }],
      clientCollection: {
        schemaVersion: 'alconite.impact.client-collection.v1',
        entriesVisited: 1,
        directoriesVisited: 1,
        filesDiscovered: 1,
        filesSubmitted: 1,
        filesSkipped: 0,
        skipCounts: {},
        collectionDurationMs: 1,
      },
    },
    options: {
      languages: ['RUST', 'JAVA', 'TYPESCRIPT', 'JAVASCRIPT'],
      includeGeneratedDirectories: false,
      additionalIgnorePatterns: [],
    },
  };
}

function client(fetchImplementation: typeof fetch, attempts = 1, deadline = new ActionDeadline(30_000)): ImpactPlatformClient {
  return new ImpactPlatformClient({
    apiUrl: 'https://alconite.com',
    projectId: PROJECT_ID,
    projectToken: TOKEN,
    checkId: CHECK_ID,
    attempts,
    deadline,
    fetchImplementation,
  });
}

test('locks the Standard Action wire profiles', () => {
  assert.equal(MAX_REQUEST_BYTES, 24 * 1024 * 1024);
  assert.equal(MAX_REPORT_BYTES, 8 * 1024 * 1024);
});

test('posts the strict check-linked request with masked-token-compatible bearer handling', async () => {
  let observedUrl = '';
  let observedBody = '';
  const mockFetch: typeof fetch = async (input, init) => {
    observedUrl = String(input);
    observedBody = String(init?.body);
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
    assert.equal(init?.redirect, 'manual');
    return new Response(JSON.stringify(await fixture()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await client(mockFetch).analyze(request());
  assert.equal(result.overallRisk, 'HIGH');
  assert.equal(observedUrl, `https://alconite.com/api/v1/contract-guard/projects/${PROJECT_ID}/checks/${CHECK_ID}/impact`);
  assert.equal((JSON.parse(observedBody) as Record<string, unknown>).source !== undefined, true);
});

test('retries only explicit busy/storage errors and gateway responses without an Impact envelope', async () => {
  let requests = 0;
  const busyFetch: typeof fetch = async () => {
    requests += 1;
    if (requests === 1) {
      return new Response(JSON.stringify({ error: { code: 'impact_analysis_busy', message: 'Busy.' } }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '0' },
      });
    }
    return new Response(JSON.stringify(await fixture()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  assert.equal((await client(busyFetch, 2).analyze(request())).overallRisk, 'HIGH');
  assert.equal(requests, 2);

  requests = 0;
  const gatewayFetch: typeof fetch = async () => {
    requests += 1;
    if (requests === 1) return new Response('gateway timeout', { status: 504 });
    return new Response(JSON.stringify(await fixture()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await client(gatewayFetch, 2).analyze(request());
  assert.equal(requests, 2);
});

test('does not retry deterministic timeout, disabled, or other valid Impact errors', async () => {
  for (const [status, code] of [[504, 'impact_analysis_timeout'], [503, 'impact_disabled'], [422, 'impact_delta_limit']] as const) {
    let requests = 0;
    const mockFetch: typeof fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: { code, message: 'Deterministic failure.' } }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    };
    await assert.rejects(
      client(mockFetch, 3).analyze(request()),
      (error: unknown) => error instanceof ImpactActionError && error.platformCode === code,
    );
    assert.equal(requests, 1);
  }
});

test('retries bounded network failures but refuses redirects and unsupported response types', async () => {
  let requests = 0;
  const networkFetch: typeof fetch = async () => {
    requests += 1;
    if (requests === 1) throw new TypeError('offline');
    return new Response(JSON.stringify(await fixture()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await client(networkFetch, 2).analyze(request());
  assert.equal(requests, 2);

  await assert.rejects(
    client(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })).analyze(request()),
    /redirects are refused/u,
  );
  await assert.rejects(
    client(async () => new Response('{}', { status: 200, headers: { 'content-type': 'text/plain' } })).analyze(request()),
    /content type/u,
  );
});

test('never sleeps past the remaining overall deadline', async () => {
  let now = 0;
  const deadline = new ActionDeadline(1_000, {
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
  });
  await assert.rejects(
    client(async () => { throw new TypeError('offline'); }, 3, deadline).analyze(request()),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'action_deadline_exceeded',
  );
});

test('validates IDs, tokens, and HTTPS/loopback URL rules strictly', () => {
  assert.equal(validateProjectId(PROJECT_ID), PROJECT_ID);
  assert.equal(validateCheckId(CHECK_ID), CHECK_ID);
  assert.equal(validateProjectToken(TOKEN), TOKEN);
  assert.equal(validateApiUrl('https://alconite.com/'), 'https://alconite.com');
  assert.equal(validateApiUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.throws(() => validateProjectId('cgprj_short'));
  assert.throws(() => validateCheckId('cgchk_short'));
  assert.throws(() => validateProjectToken('not-a-token'));
  assert.throws(() => validateApiUrl('http://example.com'));
  assert.throws(() => validateApiUrl('https://user:secret@alconite.com'));
});
