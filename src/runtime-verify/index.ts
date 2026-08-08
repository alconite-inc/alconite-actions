import { getInput, info, setFailed, setOutput, setSecret, writeJobSummary } from '../github';
import { shouldFailGate } from '../contract-guard';
import { loadConfiguration } from './configuration';
import { safeError, type RuntimeErrorCode, RuntimeVerifyError } from './errors';
import { runtimeSummary } from './github-summary';
import { deriveIdempotencyKey, readInputs } from './inputs';
import { loadOpenApi } from './openapi';
import { createOperationPlan } from './operation-plan';
import { createInitiationRequest, RuntimeVerifyPlatformClient } from './platform-client';
import { createRunnerResult, summarize, writeCanonicalReport, type RuntimeVerifyReport } from './report';
import { executePlan } from './target-client';

async function run(): Promise<void> {
  const token = getInput('project-token', { required: true });
  setSecret(token);
  const inputs = readInputs();
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const configuration = await loadConfiguration(inputs.configurationPath, workspace, process.env, setSecret);
  const contract = await loadOpenApi(inputs.contractPath, workspace);
  let plan = createOperationPlan(contract, configuration.configuration, configuration.resolvedHeaders);
  const idempotencyKey = deriveIdempotencyKey(inputs, contract.contentHash, configuration.contentHash);
  const platform = new RuntimeVerifyPlatformClient({
    apiUrl: inputs.apiUrl, projectId: inputs.projectId, projectToken: inputs.projectToken,
    retryAttempts: inputs.retryAttempts, timeoutMilliseconds: inputs.timeoutSeconds * 1_000
  });
  let runId: string | undefined;
  let replayed = false;
  try {
    const initiation = await platform.initiate(
      createInitiationRequest(inputs, contract.contentHash, configuration.contentHash), idempotencyKey
    );
    runId = initiation.runId;
    replayed = initiation.replayed;
    info(`Alconite Runtime Verify run ${runId} ${replayed ? 'replayed' : 'initiated'}.`);
    if (initiation.status === 'completed') {
      await finish(initiation.report!, inputs, true, initiation.runId, contract.contentHash,
        initiation.expectedContractContentHash);
      return;
    }
    plan = createOperationPlan(contract, configuration.configuration, configuration.resolvedHeaders, initiation.maximumOperations);
    let observations = [] as Awaited<ReturnType<typeof executePlan>>['observations'];
    let findings = [] as Awaited<ReturnType<typeof executePlan>>['findings'];
    if (contract.contentHash !== initiation.expectedContractContentHash) {
      observations = plan.map(operation => ({
        operationId: operation.operationId,
        method: operation.method,
        pathTemplate: operation.pathTemplate,
        outcome: 'not_executed' as const,
        durationMilliseconds: 0
      }));
    } else {
      const totalSignal = AbortSignal.timeout(inputs.timeoutSeconds * 1_000);
      ({ observations, findings } = await executePlan(contract, plan, inputs.baseUrl, configuration.configuration.defaults, totalSignal));
    }
    findings = boundFindings(findings);
    const completedAt = new Date().toISOString();
    const result = createRunnerResult({
      completedAt,
      execution: summarize(plan.length, observations),
      contract: {
        localContentHash: contract.contentHash,
        matchedApprovedCandidate: contract.contentHash === initiation.expectedContractContentHash
      },
      observations,
      findings
    });
    const report = await platform.complete(runId, result);
    await finish(report, inputs, replayed, initiation.runId, contract.contentHash,
      initiation.expectedContractContentHash);
  } catch (error) {
    const safe = safeError(error);
    if (runId && safe.code !== 'platform_error') {
      await platform.fail(runId, failureCode(safe), safe.message).catch(() => undefined);
    }
    throw safe;
  }
}

async function finish(
  report: RuntimeVerifyReport,
  inputs: ReturnType<typeof readInputs>,
  replayed: boolean,
  expectedRunId: string,
  localContractHash: string,
  expectedContractHash: string
): Promise<void> {
  if (report.projectId !== inputs.projectId || report.environmentId !== inputs.environmentId || report.contractGuardCheckId !== inputs.checkId) {
    throw new RuntimeVerifyError('platform_contract_mismatch', 'The Runtime Verify report does not match the requested project, environment, and Contract Guard check.');
  }
  if (report.runId !== expectedRunId || report.contract.localContractContentHash !== localContractHash
    || report.contract.approvedCandidateContentHash !== expectedContractHash) {
    throw new RuntimeVerifyError('platform_contract_mismatch', 'The Runtime Verify report does not match the initiated run and contract hashes.');
  }
  const reportPath = await writeCanonicalReport(report, inputs.reportPath);
  const reportUrl = canonicalReportUrl(inputs.apiUrl, report);
  setOutput('run-id', report.runId);
  setOutput('project-id', report.projectId);
  setOutput('environment-id', report.environmentId);
  setOutput('check-id', report.contractGuardCheckId);
  setOutput('status', report.status);
  setOutput('gate-result', report.gateResult);
  setOutput('report-url', reportUrl);
  setOutput('report-path', reportPath);
  setOutput('contract-content-hash', report.contract.localContractContentHash);
  setOutput('configured-operations', String(report.summary.configuredOperations));
  setOutput('executed-operations', String(report.summary.executedOperations));
  setOutput('passed-operations', String(report.summary.passedOperations));
  setOutput('failed-operations', String(report.summary.failedOperations));
  setOutput('warning-operations', String(report.summary.warningOperations));
  setOutput('finding-count', String(report.findings.length));
  setOutput('replayed', String(replayed));
  await writeJobSummary(runtimeSummary(report, reportUrl));
  info(`Alconite Runtime Verify completed with gate result ${report.gateResult}.`);
  if (shouldFailGate(report.gateResult, inputs.failOn)) {
    throw new RuntimeVerifyError('platform_error', `Alconite Runtime Verify gate result ${report.gateResult} meets the configured fail-on threshold.`);
  }
}

function canonicalReportUrl(apiUrl: URL, report: RuntimeVerifyReport): string {
  const fallback = `/api/v1/runtime-verify/projects/${report.projectId}/runs/${report.runId}/report`;
  const candidate = new URL(report.reportUrl || fallback, apiUrl);
  if (candidate.origin !== apiUrl.origin || (candidate.protocol !== 'https:' && candidate.hostname !== 'localhost' && candidate.hostname !== '127.0.0.1')) {
    return new URL(fallback, apiUrl).toString();
  }
  return candidate.toString();
}

function boundFindings<T>(findings: T[]): T[] { return findings.slice(0, 500); }
function failureCode(error: RuntimeVerifyError): RuntimeErrorCode {
  return ['invalid_configuration', 'invalid_openapi', 'unsupported_openapi', 'operation_plan_invalid', 'platform_contract_mismatch'].includes(error.code)
    ? error.code : 'runner_internal_error';
}

run().catch((error: unknown) => {
  const safe = safeError(error);
  setFailed(safe.message);
});
