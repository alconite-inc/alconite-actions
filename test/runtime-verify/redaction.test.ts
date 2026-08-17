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
    completedAt: '2026-01-01T00:00:01.000Z',
    execution: {
      configuredOperations: 0, executedOperations: 0, passedOperations: 0, failedOperations: 0,
      warningOperations: 0, totalDurationMilliseconds: 0
    },
    contract: { localContentHash: sha256('contract'), matchedApprovedCandidate: true },
    observations: [], findings: []
  };
  assert.equal(createRunnerResult(input).resultDigest, createRunnerResult(input).resultDigest);
  const serialized = stableJson(createRunnerResult(input));
  for (const secret of secrets) assert.equal(serialized.includes(secret), false);
});

test('GitHub summary escapes Markdown and HTML-sensitive platform values', () => {
  const hash = `sha256:${'a'.repeat(64)}`;
  const report: RuntimeVerifyReport = {
    schema: 'alconite.runtime-verify.report.v1', runId: 'rtvrun_33333333333333333333333333333333',
    projectId: 'cgprj_44444444444444444444444444444444', environmentId: 'rtvenv_11111111111111111111111111111111',
    contractGuardCheckId: 'cgchk_22222222222222222222222222222222', status: 'completed', gateResult: 'failed', policyRevision: 1,
    contract: {
      approvedCandidateVersionId: 'cgver_55555555555555555555555555555555',
      approvedCandidateContentHash: hash, localContractContentHash: hash, hashMatched: true
    },
    deployment: {
      provider: 'github-actions', repository: null, commitSha: null, ref: null, workflow: null,
      workflowRunId: null, workflowRunAttempt: null, releaseIdentifier: null
    },
    runner: { name: 'runner', version: '2.3.0', operatingSystem: 'linux', architecture: 'x64' },
    summary: {
      configuredOperations: 1, executedOperations: 1, passedOperations: 0, failedOperations: 1, warningOperations: 0,
      informationalFindings: 0, totalDurationMilliseconds: 1
    },
    violations: [{ code: 'runtime_conformance_failure', message: 'failure', failure: true }],
    findings: [{ id: 'rtvfnd_66666666666666666666666666666666', runId: 'rtvrun_33333333333333333333333333333333',
      fingerprint: hash, operationId: 'get|Health', method: 'GET', pathTemplate: '/health', classification: 'failure',
      ruleId: 'runtime.response.schema-invalid', summary: '<unsafe>', explanation: 'safe', guidance: 'safe', location: '`/status`',
      expected: null, actual: null, durationMilliseconds: 1, createdAt: 1 }],
    createdAt: 1, completedAt: 2, reportUrl: '/runtime/report'
  };
  const summary = runtimeSummary(report, 'https://alconite.com/report', 'Automatic');
  assert.doesNotMatch(summary, /<unsafe>/);
  assert.match(summary, /&lt;unsafe&gt;/);
  assert.match(summary, /get\\\|Health/);
  assert.equal(summary.split('runtime.response.schema-invalid').length - 1, 2);
});
