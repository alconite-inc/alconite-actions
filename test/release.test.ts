import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTION_RELEASE_VERSION,
  CONTRACT_GUARD_USER_AGENT,
  IMPACT_USER_AGENT,
  RUNTIME_VERIFY_RUNNER,
  RUNTIME_VERIFY_USER_AGENT,
} from '../src/release';

test('locks the repository-wide v2.3.0 component identity', () => {
  assert.equal(ACTION_RELEASE_VERSION, '2.3.0');
  assert.equal(CONTRACT_GUARD_USER_AGENT, 'alconite-contract-guard-action/2.3.0');
  assert.equal(IMPACT_USER_AGENT, 'alconite-impact-action/2.3.0');
  assert.equal(RUNTIME_VERIFY_USER_AGENT, 'alconite-runtime-verify-action/2.3.0');
  assert.deepEqual(RUNTIME_VERIFY_RUNNER, {
    name: 'alconite-runtime-verify-action',
    version: '2.3.0',
  });
});
