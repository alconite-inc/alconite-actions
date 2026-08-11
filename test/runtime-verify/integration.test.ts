import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sha256 } from '../../src/runtime-verify/redaction';

interface Scenario {
  targetStatus?: number;
  targetBody?: string;
  expectedHash?: string;
  replay?: boolean;
  gateResult?: 'passed' | 'passed_with_warnings' | 'failed';
  failOn?: 'failed' | 'warnings' | 'never';
  maximumOperations?: number;
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
  const contractText = `openapi: 3.1.0\ninfo:\n  title: Integration\n  version: 1.0.0\npaths:\n  /health:\n    get:\n      operationId: getHealth\n      responses:\n        '200':\n          description: Healthy\n          content:\n            application/json:\n              schema:\n                type: object\n                required: [status]\n                properties:\n                  status:\n                    type: string\n`;
  const configurationText = `version: 1\noperations:\n  - operationId: getHealth\n    headers:\n      Authorization:\n        fromEnvironment: STAGING_API_AUTHORIZATION\n    expect:\n      statuses: [200]\n`;
  await writeFile(path.join(directory, 'openapi.yaml'), contractText);
  await writeFile(path.join(directory, 'runtime.yaml'), configurationText);
  const outputPath = path.join(directory, 'output.txt');
  const summaryPath = path.join(directory, 'summary.md');
  const reportPath = path.join(directory, 'report.json');
  await writeFile(outputPath, ''); await writeFile(summaryPath, '');
  let targetCalls = 0;
  const targetServer = createServer((request, reply) => {
    targetCalls += 1;
    assert.equal(request.headers.authorization, targetSecret);
    reply.writeHead(scenario.targetStatus ?? 200, { 'content-type': 'application/json' });
    reply.end(scenario.targetBody ?? '{"status":"healthy"}');
  });
  const targetUrl = await listen(targetServer);
  let resultCalls = 0;
  let failureCalls = 0;
  let uploadedResult: any;
  let initiation: any;
  const localHash = sha256(Buffer.from(contractText));
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
        workflowRunId: '123', workflowRunAttempt: 1, releaseIdentifier: null
      },
      runner: { name: 'alconite-runtime-verify-action', version: '2.2.0', operatingSystem: 'Linux', architecture: 'X64' },
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
      const replayReport = canonicalReport({
        contract: { localContentHash: localHash, matchedApprovedCandidate: true },
        execution: {
          configuredOperations: 1, executedOperations: 1, passedOperations: 1, failedOperations: 0,
          warningOperations: 0, totalDurationMilliseconds: 1
        },
        findings: []
      }, 'passed');
      reply.end(JSON.stringify(scenario.replay
        ? { runId, status: 'completed', expectedContractContentHash: localHash, replayed: true,
            limits: { maximumOperations: 100, maximumFindings: 500, maximumResultBytes: 5_242_880, maximumResponseBytes: 1_048_576 }, report: replayReport }
        : { runId, status: 'pending', expectedContractContentHash: expectedHash, replayed: false,
            limits: { maximumOperations: scenario.maximumOperations ?? 100, maximumFindings: 500, maximumResultBytes: 5_242_880, maximumResponseBytes: 1_048_576 },
            report: null }));
    });
  });
  const platformUrl = await listen(platformServer);
  try {
    const child = spawn(process.execPath, [path.resolve('runtime-verify/dist/index.js')], {
      cwd: path.resolve('.'),
      env: {
        ...process.env, GITHUB_WORKSPACE: directory, RUNNER_TEMP: directory, GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath,
        GITHUB_REPOSITORY: 'owner/repository', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'abc',
        GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW: 'Deploy', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64',
        'INPUT_PROJECT-ID': projectId, 'INPUT_PROJECT-TOKEN': projectToken,
        'INPUT_ENVIRONMENT-ID': environmentId, 'INPUT_CHECK-ID': checkId,
        'INPUT_BASE-URL': targetUrl.toString(), 'INPUT_CONTRACT-PATH': 'openapi.yaml', 'INPUT_CONFIGURATION-PATH': 'runtime.yaml',
        'INPUT_API-URL': platformUrl.toString(), 'INPUT_FAIL-ON': scenario.failOn ?? 'failed', 'INPUT_RETRY-ATTEMPTS': '1',
        'INPUT_REPORT-PATH': reportPath, STAGING_API_AUTHORIZATION: targetSecret
      }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const exitCode = await new Promise<number>(resolve => child.on('close', code => resolve(code ?? 1)));
    const output = await readFile(outputPath, 'utf8');
    const summary = await readFile(summaryPath, 'utf8');
    let report: any;
    try { report = JSON.parse(await readFile(reportPath, 'utf8')); } catch { /* processing failure has no report */ }
    return { exitCode, stdout, stderr, output, summary, report, targetCalls, resultCalls, failureCalls, uploadedResult, initiation };
  } finally {
    await close(targetServer); await close(platformServer);
  }
}

test('end-to-end passing action writes safe outputs, summary, and canonical report', async () => {
  const result = await runScenario();
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.targetCalls, 1); assert.equal(result.resultCalls, 1);
  assert.match(result.output, /gate-result<<[^\n]+\npassed\n/);
  assert.match(result.output, /report-path<<[^\n]+\n/);
  assert.match(result.summary, /Alconite Runtime Verify/);
  assert.equal(result.report?.runId, runId);
  assert.equal(result.uploadedResult?.schema, 'alconite.runtime-verify.runner-result.v1');
  assert.equal(Object.hasOwn(result.uploadedResult ?? {}, 'schemaVersion'), false);
  assert.equal(Object.hasOwn(result.initiation ?? {}, 'baseUrl'), false);
  assert.equal(JSON.stringify(result.initiation).includes('127.0.0.1'), false);
  assert.equal(JSON.stringify(result.uploadedResult).includes(targetSecret), false);
  assert.equal(JSON.stringify(result.uploadedResult).includes('healthy'), false);
  const afterMasks = result.stdout.replace(`::add-mask::${projectToken}\n`, '').replace(`::add-mask::${targetSecret}\n`, '');
  assert.equal(afterMasks.includes(projectToken) || afterMasks.includes(targetSecret), false);
  assert.equal(result.stderr.includes(projectToken) || result.stderr.includes(targetSecret), false);
  assert.equal(result.output.includes(projectToken) || result.output.includes(targetSecret), false);
  assert.equal(result.summary.includes(projectToken) || result.summary.includes(targetSecret), false);
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
