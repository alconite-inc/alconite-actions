import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeSummary } from '../../src/runtime-verify/github-summary';
import { redactSecrets, sha256, stableJson } from '../../src/runtime-verify/redaction';
import { createRunnerResult, type RuntimeVerifyReport } from '../../src/runtime-verify/report';

const secrets = ['Bearer super-secret', 'api-key-value', 'session-cookie-value', 'alc_cg_plaintext_example'];

test('redacts every registered secret from bounded diagnostic text', () => {
  const raw = secrets.join(' :: ');
  const redacted = redactSecrets(raw, secrets);
  for (const secret of secrets) assert.doesNotMatch(redacted, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(redacted, '*** :: *** :: *** :: ***');
});

test('canonical result digests are deterministic and exclude unsubmitted target material', () => {
  const input = {
    runId: 'rtvrun_test', contractContentHash: sha256('contract'), configurationContentHash: sha256('configuration'),
    startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', observations: [], findings: []
  };
  assert.equal(createRunnerResult(input).resultDigest, createRunnerResult(input).resultDigest);
  const serialized = stableJson(createRunnerResult(input));
  for (const secret of secrets) assert.equal(serialized.includes(secret), false);
});

test('GitHub summary escapes Markdown and HTML-sensitive platform values', () => {
  const hash = `sha256:${'a'.repeat(64)}`;
  const report: RuntimeVerifyReport = {
    schemaVersion: 'alconite.runtime-verify.report.v1', runId: 'rtvrun_test', projectId: 'cgprj_test', environmentId: 'rtvenv_test',
    contractGuardCheckId: 'cgchk_test', status: 'completed', gateResult: 'failed', contractContentHash: hash,
    expectedContractContentHash: hash,
    summary: { configuredOperations: 1, executedOperations: 1, passedOperations: 0, failedOperations: 1, warningOperations: 0, findingCount: 1 },
    findings: [{ operationId: 'get|Health', method: 'GET', pathTemplate: '/health', classification: 'failure',
      ruleId: 'runtime.response.schema-invalid', summary: '<unsafe>', explanation: 'safe', guidance: 'safe', location: '`/status`', durationMilliseconds: 1 }]
  };
  const summary = runtimeSummary(report, 'https://alconite.com/report', true);
  assert.doesNotMatch(summary, /<unsafe>/);
  assert.match(summary, /&lt;unsafe&gt;/);
  assert.match(summary, /get\\\|Health/);
  assert.equal(summary.split('runtime.response.schema-invalid').length - 1, 2);
});
