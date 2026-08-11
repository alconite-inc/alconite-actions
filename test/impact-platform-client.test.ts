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
  return JSON.parse(await fs.readFile(path.resolve('test/fixtures/impact-report-v1-single-file.json'), 'utf8')) as unknown;
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

async function responseFixture(input: ImpactRequest = request()): Promise<Record<string, unknown>> {
  const report = await fixture() as Record<string, unknown>;
  const metadata = report.metadata as Record<string, unknown>;
  metadata.clientCollection = { ...input.source.clientCollection, authoritative: false };
  const server = metadata.serverScan as Record<string, unknown>;
  server.manifestEntriesSubmitted = input.source.files.length;
  server.filesAccepted = input.source.files.length;
  server.filesScanned = input.source.files.length;
  server.filesSkipped = 0;
  server.bytesScanned = input.source.files.reduce((total, file) => total + Buffer.byteLength(file.content, 'utf8'), 0);
  server.skipCounts = {};
  return report;
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
    return new Response(JSON.stringify(await responseFixture()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await client(mockFetch).analyze(request());
  assert.equal(result.overallRisk, 'HIGH');
  assert.equal(observedUrl, `https://alconite.com/api/v1/contract-guard/projects/${PROJECT_ID}/checks/${CHECK_ID}/impact`);
  assert.equal((JSON.parse(observedBody) as Record<string, unknown>).source !== undefined, true);
});

test('binds the response to the exact submitted inline manifest and logical root', async () => {
  const cases: Array<(report: Record<string, unknown>, input: ImpactRequest) => void> = [
    (report) => {
      const server = ((report.metadata as Record<string, unknown>).serverScan as Record<string, unknown>);
      server.inputType = 'TRUSTED_FILESYSTEM';
      server.manifestEntriesSubmitted = null;
      server.filesystemEntriesVisited = 1;
      server.directoriesVisited = 1;
    },
    (report) => {
      const change = (report.changes as Array<Record<string, unknown>>)[0];
      const source = (change?.affectedSources as Array<Record<string, unknown>>)[0];
      assert.ok(source);
      source.file = 'src/not-submitted.ts';
    },
    (report) => {
      const change = (report.changes as Array<Record<string, unknown>>)[0];
      const source = (change?.affectedSources as Array<Record<string, unknown>>)[0];
      assert.ok(source);
      source.language = 'JAVASCRIPT';
    },
    (report) => {
      const metadata = report.metadata as Record<string, unknown>;
      metadata.warnings = [{ code: 'FILE_READ_FAILED', message: 'A source file could not be read.', path: 'src/not-submitted.ts' }];
    },
    (report) => {
      const server = ((report.metadata as Record<string, unknown>).serverScan as Record<string, unknown>);
      server.filesScanned = 0;
    },
    (_report, input) => { input.source.logicalRoot = 'packages/client'; },
  ];
  for (const mutate of cases) {
    const input = request();
    const report = await responseFixture(input);
    mutate(report, input);
    await assert.rejects(
      client(async () => new Response(JSON.stringify(report), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })).analyze(input),
      (error: unknown) => error instanceof Error && /invalid Impact report/u.test(error.message),
    );
  }
});

test('accepts authoritative server skips while preserving manifest and affected-source binding', async () => {
  const input = request();
  input.source.files.push({ path: 'src/skipped.java', content: 'class Skipped {}' });
  input.source.clientCollection.entriesVisited = 2;
  input.source.clientCollection.filesDiscovered = 2;
  input.source.clientCollection.filesSubmitted = 2;
  const report = await responseFixture(input);
  const metadata = report.metadata as Record<string, unknown>;
  const server = metadata.serverScan as Record<string, unknown>;
  server.filesAccepted = 1;
  server.filesScanned = 1;
  server.filesSkipped = 1;
  server.bytesScanned = Buffer.byteLength(input.source.files[0]!.content, 'utf8');
  server.skipCounts = { ADDITIONAL_IGNORE: 1 };
  metadata.languagesDetected = ['TYPESCRIPT'];

  const result = await client(async () => new Response(JSON.stringify(report), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })).analyze(input);
  assert.equal(result.metadata.serverScan.filesSkipped, 1);
  assert.equal(result.affectedFiles, 1);
});

test('maps a stalled response-body read to the overall Action deadline', async () => {
  const stalled = new ReadableStream<Uint8Array>({
    start() {
      // Deliberately leave the response open without bytes until the Action deadline aborts it.
    },
  });
  await assert.rejects(
    client(
      async () => new Response(stalled, { status: 200, headers: { 'content-type': 'application/json' } }),
      1,
      new ActionDeadline(20),
    ).analyze(request()),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'action_deadline_exceeded',
  );
});

test('never awaits an adversarial response cancellation promise', async () => {
  const neverCancellingBody = (): ReadableStream<Uint8Array> => new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{}')); },
    cancel: () => new Promise<void>(() => undefined),
  });
  const finishWithin = async (operation: Promise<unknown>): Promise<unknown> => Promise.race([
    operation.then(() => 'resolved', (error: unknown) => error),
    new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 250)),
  ]);

  const redirect = await finishWithin(client(async () => new Response(neverCancellingBody(), {
    status: 302,
    headers: { location: 'https://evil.example' },
  })).analyze(request()));
  assert.notEqual(redirect, 'hung');
  assert.ok(redirect instanceof ImpactActionError);

  const wrongType = await finishWithin(client(async () => new Response(neverCancellingBody(), {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  })).analyze(request()));
  assert.notEqual(wrongType, 'hung');
  assert.ok(wrongType instanceof ImpactActionError);

  const oversized = await finishWithin(client(async () => new Response(neverCancellingBody(), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-length': String(MAX_REPORT_BYTES + 1) },
  })).analyze(request()));
  assert.notEqual(oversized, 'hung');
  assert.ok(oversized instanceof ImpactActionError);

  let now = 0;
  let attempts = 0;
  const retryDeadline = new ActionDeadline(30_000, {
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
  });
  const gateway = await finishWithin(client(async () => {
    attempts += 1;
    if (attempts === 1) return new Response(neverCancellingBody(), { status: 502 });
    return new Response(JSON.stringify(await responseFixture()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }, 2, retryDeadline).analyze(request()));
  assert.equal(gateway, 'resolved');
  assert.equal(attempts, 2);
});

test('parses a valid report delivered as many tiny chunks within one fixed response buffer', async () => {
  const payload = new TextEncoder().encode(JSON.stringify(await responseFixture()));
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= payload.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(payload.subarray(offset, offset + 1));
      offset += 1;
    },
  });
  const result = await client(async () => new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })).analyze(request());
  assert.equal(result.schemaVersion, 'alconite.impact.report.v1');
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
    return new Response(JSON.stringify(await responseFixture()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  assert.equal((await client(busyFetch, 2).analyze(request())).overallRisk, 'HIGH');
  assert.equal(requests, 2);

  requests = 0;
  const gatewayFetch: typeof fetch = async () => {
    requests += 1;
    if (requests === 1) return new Response('gateway timeout', { status: 504, headers: { 'retry-after': '0' } });
    return new Response(JSON.stringify(await responseFixture()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await client(gatewayFetch, 2).analyze(request());
  assert.equal(requests, 2);

  requests = 0;
  const gateway502Fetch: typeof fetch = async () => {
    requests += 1;
    if (requests === 1) return new Response('bad gateway', { status: 502, headers: { 'retry-after': '0' } });
    return new Response(JSON.stringify(await responseFixture()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await client(gateway502Fetch, 2).analyze(request());
  assert.equal(requests, 2);

  requests = 0;
  const storageFetch: typeof fetch = async () => {
    requests += 1;
    if (requests === 1) {
      return new Response(JSON.stringify({ error: { code: 'impact_storage_unavailable', message: 'Storage unavailable.' } }), {
        status: 503,
        headers: { 'content-type': 'application/json', 'retry-after': '0' },
      });
    }
    return new Response(JSON.stringify(await responseFixture()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await client(storageFetch, 2).analyze(request());
  assert.equal(requests, 2);
});

test('requires the exact status and code pair for explicit retryable errors', async () => {
  for (const [status, code] of [
    [503, 'impact_analysis_busy'],
    [429, 'impact_storage_unavailable'],
    [429, 'impact_disabled'],
    [503, 'impact_analysis_timeout'],
  ] as const) {
    let requests = 0;
    const mockFetch: typeof fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: { code, message: 'Not an exact retry pair.' } }), {
        status,
        headers: { 'content-type': 'application/json', 'retry-after': '0' },
      });
    };
    await assert.rejects(
      client(mockFetch, 3).analyze(request()),
      (error: unknown) => error instanceof ImpactActionError && error.platformCode === code,
    );
    assert.equal(requests, 1);
  }
});

test('does not retry deterministic timeout, disabled, or other valid Impact errors', async () => {
  for (const [status, code] of [
    [401, 'invalid_token'],
    [403, 'insufficient_token_scope'],
    [409, 'impact_check_incomplete'],
    [410, 'impact_contract_artifacts_unavailable'],
    [413, 'impact_payload_too_large'],
    [422, 'impact_delta_limit'],
    [500, 'impact_internal_error'],
    [503, 'impact_disabled'],
    [504, 'impact_analysis_timeout'],
  ] as const) {
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
    return new Response(JSON.stringify(await responseFixture()), { status: 200, headers: { 'content-type': 'application/json' } });
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

  let headerNow = 0;
  const headerDeadline = new ActionDeadline(1_000, {
    now: () => headerNow,
    sleep: async (milliseconds) => { headerNow += milliseconds; },
  });
  await assert.rejects(
    client(async () => new Response(JSON.stringify({ error: { code: 'impact_analysis_busy', message: 'Busy.' } }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '2' },
    }), 2, headerDeadline).analyze(request()),
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
