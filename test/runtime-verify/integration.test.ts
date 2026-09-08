import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { platformContractContentHash } from '../../src/runtime-verify/openapi';
import { finding } from '../../src/runtime-verify/findings';
import { createRunnerResult } from '../../src/runtime-verify/report';

interface Scenario {
  targetStatus?: number;
  targetBody?: string;
  targetContentType?: string;
  targetCredential?: string;
  contractText?: string;
  expectedHash?: string;
  replay?: boolean;
  gateResult?: 'passed' | 'passed_with_warnings' | 'failed';
  failOn?: 'failed' | 'warnings' | 'never';
  maximumOperations?: number;
  explicitCheckId?: boolean;
  omitResolvedCheckId?: boolean;
  noApprovedCheck?: boolean;
  omitReportPath?: boolean;
  deploymentId?: string;
}

interface ScenarioResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
  summary: string;
  report?: any;
  targetCalls: number;
  resultCalls: number;
  failureCalls: number;
  uploadedResult?: any;
  initiation?: any;
  idempotencyKey?: string;
}

const projectToken = 'alc_cg_plaintext_example';
const targetSecret = 'Bearer super-secret';
const projectId = 'cgprj_44444444444444444444444444444444';
const environmentId = 'rtvenv_11111111111111111111111111111111';
const checkId = 'cgchk_22222222222222222222222222222222';
const runId = 'rtvrun_33333333333333333333333333333333';
const versionId = 'cgver_55555555555555555555555555555555';

async function listen(server: Server): Promise<URL> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return new URL(`http://127.0.0.1:${address.port}/`);
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

async function runScenario(scenario: Scenario = {}): Promise<ScenarioResult> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'runtime-action-'));
  const contractText = scenario.contractText ?? `openapi: 3.1.0\ninfo:\n  title: Integration\n  version: 1.0.0\npaths:\n  /health:\n    get:\n      operationId: getHealth\n      responses:\n        '200':\n          description: Healthy\n          content:\n            application/json:\n              schema:\n                type: object\n                required: [status]\n                properties:\n                  status:\n                    type: string\n`;
  const configurationText = `version: 1\noperations:\n  - operationId: getHealth\n    headers:\n      Authorization:\n        fromEnvironment: STAGING_API_AUTHORIZATION\n    expect:\n      statuses: [200]\n`;
  await writeFile(path.join(directory, 'openapi.yaml'), contractText);
  await writeFile(path.join(directory, 'runtime.yaml'), configurationText);
  const outputPath = path.join(directory, 'output.txt');
  const summaryPath = path.join(directory, 'summary.md');
  const reportPath = scenario.omitReportPath
    ? path.join(directory, 'alconite-runtime-verify-report.json')
    : path.join(directory, 'report.json');
  await writeFile(outputPath, ''); await writeFile(summaryPath, '');
  let targetCalls = 0;
  const targetCredential = scenario.targetCredential ?? targetSecret;
  const targetServer = createServer((request, reply) => {
    targetCalls += 1;
    assert.equal(request.headers.authorization, targetCredential);
    reply.writeHead(scenario.targetStatus ?? 200, { 'content-type': scenario.targetContentType ?? 'application/json' });
    reply.end(scenario.targetBody ?? '{"status":"healthy"}');
  });
  const targetUrl = await listen(targetServer);
  let resultCalls = 0;
  let failureCalls = 0;
  let uploadedResult: any;
  let initiation: any;
  let idempotencyKey: string | undefined;
  const localHash = platformContractContentHash(Buffer.from(contractText));
  const expectedHash = scenario.expectedHash ?? localHash;
  const canonicalReport = (body: any, selectedGate?: Scenario['gateResult']) => {
    const submitted = (body.findings ?? []).map((item: any, index: number) => ({
      id: `rtvfnd_${(index + 1).toString(16).padStart(32, '0')}`,
      runId,
      fingerprint: item.fingerprint,
      operationId: item.operationId ?? null,
      method: item.method ?? null,
      pathTemplate: item.pathTemplate ?? null,
      classification: item.classification,
      ruleId: item.ruleId,
      summary: item.summary,
      explanation: item.explanation,
      guidance: item.guidance,
      location: item.location ?? null,
      expected: item.expected ?? null,
      actual: item.actual ?? null,
      durationMilliseconds: item.durationMilliseconds ?? null,
      createdAt: 1_785_940_262
    }));
    if (!body.contract.matchedApprovedCandidate) {
      submitted.push({
        id: 'rtvfnd_ffffffffffffffffffffffffffffffff', runId,
        fingerprint: `sha256:${'b'.repeat(64)}`, operationId: null, method: null, pathTemplate: null,
        classification: 'failure', ruleId: 'runtime.contract.hash-mismatch',
        summary: 'Local contract does not match the approved candidate',
        explanation: 'The runner contract fingerprint differs from the approved candidate.',
        guidance: 'Use the exact approved contract.', location: null,
        expected: 'approved candidate fingerprint', actual: 'different local fingerprint',
        durationMilliseconds: null, createdAt: 1_785_940_262
      });
    }
    const gateResult = selectedGate ?? (submitted.some((item: any) => item.classification === 'failure') ? 'failed' : 'passed');
    return {
      schema: 'alconite.runtime-verify.report.v1', runId, projectId, environmentId, contractGuardCheckId: checkId,
      status: 'completed', gateResult, policyRevision: 1,
      contract: {
        approvedCandidateVersionId: versionId,
        approvedCandidateContentHash: expectedHash,
        localContractContentHash: body.contract.localContentHash,
        hashMatched: body.contract.matchedApprovedCandidate
      },
      deployment: {
        provider: 'github-actions', repository: 'owner/repository', commitSha: 'abc', ref: 'refs/heads/main', workflow: 'Deploy',
        workflowRunId: '123', workflowRunAttempt: 1,
        releaseIdentifier: initiation?.deployment?.releaseIdentifier ?? null
      },
      runner: { name: 'alconite-runtime-verify-action', version: '2.5.0', operatingSystem: 'Linux', architecture: 'X64' },
      summary: {
        ...body.execution,
        informationalFindings: submitted.filter((item: any) => item.classification === 'informational').length
      },
      violations: gateResult === 'failed' ? [{ code: 'runtime_conformance_failure', message: 'Runtime findings violate policy.', failure: true }] : [],
      findings: submitted,
      createdAt: 1_785_940_200,
      completedAt: 1_785_940_262,
      reportUrl: `/api/v1/runtime-verify/projects/${projectId}/runs/${runId}/report`
    };
  };
  const platformServer = createServer((request, reply) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      reply.setHeader('content-type', 'application/json');
      if (request.url?.endsWith('/failure')) { failureCalls += 1; reply.end('{}'); return; }
      if (request.url?.endsWith('/results')) {
        resultCalls += 1; uploadedResult = body;
        reply.end(JSON.stringify(canonicalReport(body, scenario.gateResult)));
        return;
      }
      initiation = body;
      idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      if (scenario.noApprovedCheck) {
        reply.statusCode = 409;
        reply.end(JSON.stringify({
          error: {
            code: 'approved_contract_check_not_found',
            message: 'untrusted detail'
          }
        }));
        return;
      }
      const replayReport = canonicalReport({
        contract: { localContentHash: localHash, matchedApprovedCandidate: true },
        execution: {
          configuredOperations: 1, executedOperations: 1, passedOperations: 1, failedOperations: 0,
          warningOperations: 0, totalDurationMilliseconds: 1
        },
        findings: []
      }, 'passed');
      const resolution = scenario.omitResolvedCheckId ? {} : { contractGuardCheckId: checkId };
      reply.end(JSON.stringify(scenario.replay
        ? { runId, status: 'completed', ...resolution, expectedContractContentHash: localHash, replayed: true,
            limits: { maximumOperations: 100, maximumFindings: 500, maximumResultBytes: 5_242_880, maximumResponseBytes: 1_048_576 }, report: replayReport }
        : { runId, status: 'pending', ...resolution, expectedContractContentHash: expectedHash, replayed: false,
            limits: { maximumOperations: scenario.maximumOperations ?? 100, maximumFindings: 500, maximumResultBytes: 5_242_880, maximumResponseBytes: 1_048_576 },
            report: null }));
    });
  });
  const platformUrl = await listen(platformServer);
  try {
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env, GITHUB_WORKSPACE: directory, RUNNER_TEMP: directory, GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_REPOSITORY: 'owner/repository', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'abc',
      GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW: 'Deploy', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64',
      'INPUT_PROJECT-ID': projectId, 'INPUT_PROJECT-TOKEN': projectToken,
      'INPUT_ENVIRONMENT-ID': environmentId,
      'INPUT_BASE-URL': targetUrl.toString(), 'INPUT_CONTRACT-PATH': 'openapi.yaml', 'INPUT_CONFIGURATION-PATH': 'runtime.yaml',
      'INPUT_API-URL': platformUrl.toString(), 'INPUT_FAIL-ON': scenario.failOn ?? 'failed', 'INPUT_RETRY-ATTEMPTS': '1',
      'INPUT_DEPLOYMENT-ID': scenario.deploymentId ?? 'deployment-abc', STAGING_API_AUTHORIZATION: targetCredential
    };
    if (scenario.explicitCheckId) childEnvironment['INPUT_CHECK-ID'] = checkId;
    if (!scenario.omitReportPath) childEnvironment['INPUT_REPORT-PATH'] = reportPath;
    const child = spawn(process.execPath, [path.resolve('runtime-verify/dist/index.js')], {
      cwd: path.resolve('.'),
      env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const exitCode = await new Promise<number>(resolve => child.on('close', code => resolve(code ?? 1)));
    const output = await readFile(outputPath, 'utf8');
    const summary = await readFile(summaryPath, 'utf8');
    let report: any;
    try { report = JSON.parse(await readFile(reportPath, 'utf8')); } catch { /* processing failure has no report */ }
    return { exitCode, stdout, stderr, output, summary, report, targetCalls, resultCalls, failureCalls, uploadedResult, initiation, idempotencyKey };
  } finally {
    await close(targetServer); await close(platformServer);
  }
}

test('end-to-end passing action writes safe outputs, summary, and canonical report', async () => {
  const result = await runScenario({ omitReportPath: true });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.targetCalls, 1); assert.equal(result.resultCalls, 1);
  assert.match(result.output, /gate-result<<[^\n]+\npassed\n/);
  assert.match(result.output, /report-path<<[^\n]+\n/);
  assert.match(result.output, /check-id<<[^\n]+\ncgchk_22222222222222222222222222222222\n/);
  assert.match(result.output, /deployment-id<<[^\n]+\ndeployment-abc\n/);
  assert.match(result.summary, /Alconite Runtime Verify/);
  assert.match(result.summary, /Resolution \| Automatic/);
  assert.equal(result.report?.runId, runId);
  assert.equal(result.uploadedResult?.schema, 'alconite.runtime-verify.runner-result.v1');
  assert.equal(Object.hasOwn(result.uploadedResult ?? {}, 'schemaVersion'), false);
  assert.equal(Object.hasOwn(result.initiation ?? {}, 'baseUrl'), false);
  assert.equal(Object.hasOwn(result.initiation ?? {}, 'contractGuardCheckId'), false);
  assert.match(result.idempotencyKey ?? '', /^runtime-gh-v2-[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result.initiation).includes('127.0.0.1'), false);
  assert.equal(JSON.stringify(result.uploadedResult).includes(targetSecret), false);
  assert.equal(JSON.stringify(result.uploadedResult).includes('healthy'), false);
  const afterMasks = result.stdout.replace(`::add-mask::${projectToken}\n`, '').replace(`::add-mask::${targetSecret}\n`, '');
  assert.equal(afterMasks.includes(projectToken) || afterMasks.includes(targetSecret), false);
  assert.equal(result.stderr.includes(projectToken) || result.stderr.includes(targetSecret), false);
  assert.equal(result.output.includes(projectToken) || result.output.includes(targetSecret), false);
  assert.equal(result.summary.includes(projectToken) || result.summary.includes(targetSecret), false);
});

function contractWithResponseSchema(schema: unknown): string {
  return JSON.stringify({ openapi: '3.1.0', info: { title: 'Privacy fixture', version: '1.0.0' }, paths: {
    '/health': { get: { operationId: 'getHealth', responses: { '200': { description: 'Healthy',
      content: { 'application/json': { schema } }
    } } } }
  } });
}

test('submitted findings exclude response-owned identifiers and secret map keys', async () => {
  const customerIdentifier = 'customer-private@example.com';
  const result = await runScenario({
    contractText: contractWithResponseSchema({ type: 'object', additionalProperties: { type: 'integer' } }),
    targetBody: JSON.stringify({ [customerIdentifier]: 'private-value', [targetSecret]: 'private-value', [projectToken]: 'private-value' })
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.resultCalls, 1);
  assert.equal(result.uploadedResult.findings.length, 1);
  assert.match(result.uploadedResult.findings[0].location, /additionalProperties\/type$/);
  assert.equal(result.uploadedResult.observations[0].operationId, 'getHealth');
  assert.equal(result.report.gateResult, 'failed');
  for (const value of [customerIdentifier, targetSecret, projectToken, 'private-value']) {
    assert.equal(JSON.stringify(result.uploadedResult).includes(value), false);
    assert.equal(JSON.stringify(result.report).includes(value), false);
    assert.equal(result.summary.includes(value), false);
  }
});

test('submitted evidence excludes credentials reflected in an undocumented media type', async () => {
  const targetCredential = 'audit-target-header-secret';
  for (const reflected of [targetCredential, projectToken]) {
    const result = await runScenario({ targetCredential, targetContentType: `application/${reflected}` });
    assert.equal(result.exitCode, 1);
    assert.equal(result.resultCalls, 1);
    assert.equal(result.uploadedResult.observations[0].contentType, undefined);
    assert.equal(result.uploadedResult.findings[0].actual, 'undocumented media type');
    assert.equal(JSON.stringify(result.uploadedResult).includes(reflected), false);
    assert.equal(JSON.stringify(result.report).includes(reflected), false);
    assert.equal(result.summary.includes(reflected), false);
  }
});

test('known-secret evidence redaction precedes finding fingerprints and the submitted result digest', async () => {
  const result = await runScenario({
    contractText: contractWithResponseSchema({ type: 'object', required: [targetSecret, projectToken] }),
    targetBody: '{}'
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.resultCalls, 1);
  for (const value of [targetSecret, projectToken]) {
    assert.equal(JSON.stringify(result.uploadedResult).includes(value), false);
    assert.equal(JSON.stringify(result.report).includes(value), false);
    assert.equal(result.summary.includes(value), false);
  }
  assert.equal(result.uploadedResult.findings.length, 2);
  for (const { fingerprint, ...details } of result.uploadedResult.findings) {
    assert.equal(fingerprint, finding(details).fingerprint);
    assert.equal(details.operationId, 'getHealth');
    assert.equal(details.classification, 'failure');
  }
  const { schema: _schema, resultDigest, ...input } = result.uploadedResult;
  assert.equal(resultDigest, createRunnerResult(input).resultDigest);
});

test('explicit check-id remains compatible when an older initiation response omits the resolved field', async () => {
  const result = await runScenario({ explicitCheckId: true, omitResolvedCheckId: true });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.initiation?.contractGuardCheckId, checkId);
  assert.match(result.summary, /Resolution \| Explicit/);
  assert.match(result.output, /check-id<<[^\n]+\ncgchk_22222222222222222222222222222222\n/);
});

test('automatic resolution failure is actionable and never calls the target', async () => {
  const result = await runScenario({ noApprovedCheck: true });
  assert.equal(result.exitCode, 1);
  assert.equal(result.targetCalls, 0);
  assert.equal(result.resultCalls, 0);
  assert.equal(result.report, undefined);
  assert.match(result.stdout, /No approved Contract Guard check exists for the deployed contract/);
  assert.doesNotMatch(result.stdout, /untrusted detail/);
});

test('end-to-end failed target obeys fail-on failed', async () => {
  const result = await runScenario({ targetStatus: 503, failOn: 'failed' });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report?.gateResult, 'failed');
  assert.equal(result.uploadedResult?.findings[0]?.ruleId, 'runtime.response.undocumented-status');
});

test('contract hash mismatch skips the target and completes as a runtime finding', async () => {
  const result = await runScenario({ expectedHash: `sha256:${'b'.repeat(64)}`, failOn: 'never' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.targetCalls, 0);
  assert.equal(result.uploadedResult?.contract.matchedApprovedCandidate, false);
  assert.equal(result.uploadedResult?.observations[0]?.outcome, 'not_executed');
  assert.equal(result.report?.findings[0]?.ruleId, 'runtime.contract.hash-mismatch');
});

test('completed replay skips both target execution and result submission', async () => {
  const result = await runScenario({ replay: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.targetCalls, 0); assert.equal(result.resultCalls, 0);
  assert.match(result.output, /replayed<<[^\n]+\ntrue\n/);
});

test('invalid platform limits fail before target execution and release the pending run', async () => {
  const result = await runScenario({ maximumOperations: 0 });
  assert.equal(result.exitCode, 1);
  assert.equal(result.targetCalls, 0); assert.equal(result.failureCalls, 1);
  assert.match(`${result.stdout}\n${result.output}`, /limits\.maximumOperations/);
  assert.doesNotMatch(result.stderr, /super-secret/);
});

test('fail-on warnings fails passed-with-warnings while fail-on failed permits it', async () => {
  const strict = await runScenario({ gateResult: 'passed_with_warnings', failOn: 'warnings' });
  const normal = await runScenario({ gateResult: 'passed_with_warnings', failOn: 'failed' });
  assert.equal(strict.exitCode, 1);
  assert.equal(normal.exitCode, 0);
});
