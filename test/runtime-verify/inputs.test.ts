import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveIdempotencyKey, readInputs, validateOrigin, type RuntimeVerifyInputs } from '../../src/runtime-verify/inputs';

test('requires HTTPS origins except for loopback tests and normalizes trailing slashes', () => {
  assert.equal(validateOrigin('https://api.example.test', 'Target').toString(), 'https://api.example.test/');
  assert.equal(validateOrigin('http://127.0.0.1:3000', 'Target').toString(), 'http://127.0.0.1:3000/');
  for (const value of ['http://api.example.test', 'https://user:secret@api.example.test', 'https://api.example.test?secret=yes',
    'https://api.example.test/#fragment', 'https://api.example.test/v1']) {
    assert.throws(() => validateOrigin(value, 'Target'), /Target/);
  }
});

test('derives a deterministic bounded versioned Runtime Verify idempotency key', () => {
  const inputs = {
    projectId: 'cgprj_test', projectToken: 'alc_cg_test', environmentId: 'rtvenv_test', checkId: 'cgchk_test',
    baseUrl: new URL('https://api.example.test'), contractPath: 'openapi.yaml', configurationPath: 'runtime.yaml',
    apiUrl: new URL('https://alconite.com'), timeoutSeconds: 120, retryAttempts: 3, failOn: 'failed'
  } satisfies RuntimeVerifyInputs;
  const environment = {
    GITHUB_REPOSITORY: 'owner/repo', GITHUB_WORKFLOW: 'Deploy', GITHUB_SHA: 'abc',
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2'
  };
  const first = deriveIdempotencyKey(inputs, `sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`, environment);
  const second = deriveIdempotencyKey(inputs, `sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`, {
    ...environment, GITHUB_RUN_ID: 'different-run'
  });
  assert.equal(first, second);
  assert.match(first, /^runtime-gh-v2-[a-f0-9]{64}$/);
  assert.notEqual(first, deriveIdempotencyKey(inputs, `sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`, {
    ...environment, GITHUB_RUN_ATTEMPT: '3'
  }));
  const { checkId: _checkId, ...automaticInputs } = inputs;
  assert.notEqual(first, deriveIdempotencyKey(automaticInputs, `sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`, environment));
  assert.ok(first.length <= 200);
});

test('accepts explicit or omitted check-id and rejects malformed non-empty values', () => {
  const keys = [
    'INPUT_PROJECT-ID', 'INPUT_PROJECT-TOKEN', 'INPUT_ENVIRONMENT-ID', 'INPUT_CHECK-ID', 'INPUT_BASE-URL'
  ] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    'INPUT_PROJECT-ID': `cgprj_${'1'.repeat(32)}`,
    'INPUT_PROJECT-TOKEN': 'alc_cg_runtime_test',
    'INPUT_ENVIRONMENT-ID': `rtvenv_${'2'.repeat(32)}`,
    'INPUT_BASE-URL': 'https://api.example.test'
  });
  try {
    process.env['INPUT_CHECK-ID'] = `cgchk_${'3'.repeat(32)}`;
    assert.equal(readInputs().checkId, `cgchk_${'3'.repeat(32)}`);
    for (const value of ['', '   \t']) {
      process.env['INPUT_CHECK-ID'] = value;
      assert.equal(readInputs().checkId, undefined);
    }
    delete process.env['INPUT_CHECK-ID'];
    assert.equal(readInputs().checkId, undefined);
    process.env['INPUT_CHECK-ID'] = 'not-a-check';
    assert.throws(() => readInputs(), /check ID has an invalid format/);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
