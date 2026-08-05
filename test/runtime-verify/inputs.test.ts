import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveIdempotencyKey, validateOrigin, type RuntimeVerifyInputs } from '../../src/runtime-verify/inputs';

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
  const environment = { GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' };
  const first = deriveIdempotencyKey(inputs, `sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`, environment);
  const second = deriveIdempotencyKey(inputs, `sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`, environment);
  assert.equal(first, second);
  assert.match(first, /^runtime-gh-v1-[a-f0-9]{64}$/);
  assert.ok(first.length <= 200);
});
