import type { RuntimeErrorCode } from './errors';
import { RuntimeVerifyError } from './errors';
import type { RuntimeVerifyInputs } from './inputs';
import type { RunnerResult, RuntimeReportFinding, RuntimeReportSummary, RuntimeVerifyReport } from './report';

const MAX_PLATFORM_RESPONSE_BYTES = 8 * 1024 * 1024;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const RUNTIME_RULE_IDS = new Set([
  'runtime.contract.hash-mismatch',
  'runtime.contract.check-not-approved',
  'runtime.execution.operation-not-executed',
  'runtime.execution.operation-not-found',
  'runtime.execution.duration-exceeded',
  'runtime.transport.unreachable',
  'runtime.transport.timeout',
  'runtime.transport.redirect-rejected',
  'runtime.response.too-large',
  'runtime.response.content-encoding-invalid',
  'runtime.response.undocumented-status',
  'runtime.response.content-type-mismatch',
  'runtime.response.required-header-missing',
  'runtime.response.schema-invalid',
  'runtime.response.required-property-missing',
  'runtime.response.type-mismatch',
  'runtime.response.invalid-json',
  'runtime.response.unexpected-body'
]);

export interface InitiationRequest {
  environmentId: string;
  contractGuardCheckId: string;
  contractContentHash: string;
  configurationContentHash: string;
  displayName: string;
  deployment: {
    provider: 'github-actions';
    repository: string;
    commitSha: string;
    ref: string;
    workflow: string;
    workflowRunId: string;
    workflowRunAttempt: number;
    releaseIdentifier?: string;
  };
  runner: {
    name: 'alconite-runtime-verify-action';
    version: string;
    operatingSystem: string;
    architecture: string;
  };
}

export interface InitiationResponse {
  runId: string;
  status: 'pending' | 'completed';
  expectedContractContentHash: string;
  maximumOperations: number;
  replayed: boolean;
  report?: RuntimeVerifyReport;
}

export interface PlatformClientOptions {
  apiUrl: URL;
  projectId: string;
  projectToken: string;
  retryAttempts: number;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  timeoutMilliseconds?: number;
}

export class RuntimeVerifyPlatformClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: PlatformClientOptions) {
    const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(options.apiUrl.hostname);
    if (options.apiUrl.protocol !== 'https:' && !(options.apiUrl.protocol === 'http:' && loopback)) {
      throw new RuntimeVerifyError('invalid_input', 'The Alconite API URL must use HTTPS except for loopback testing.');
    }
    if (options.apiUrl.username || options.apiUrl.password || options.apiUrl.search || options.apiUrl.hash) {
      throw new RuntimeVerifyError('invalid_input', 'The Alconite API URL contains unsupported URL components.');
    }
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
  }

  async initiate(request: InitiationRequest, idempotencyKey: string): Promise<InitiationResponse> {
    const body = await this.post(
      `/api/v1/runtime-verify/projects/${this.options.projectId}/runs`,
      request,
      'run initiation',
      idempotencyKey
    );
    return validateInitiation(body);
  }

  async complete(runId: string, result: RunnerResult): Promise<RuntimeVerifyReport> {
    validateRunId(runId);
    const body = await this.post(
      `/api/v1/runtime-verify/projects/${this.options.projectId}/runs/${runId}/results`,
      result,
      'result submission'
    );
    return validateReport(body);
  }

  async fail(runId: string, code: RuntimeErrorCode, message: string): Promise<void> {
    validateRunId(runId);
    await this.post(`/api/v1/runtime-verify/projects/${this.options.projectId}/runs/${runId}/failure`, {
      code, message: message.slice(0, 300)
    }, 'processing-failure submission');
  }

  private async post(route: string, body: unknown, phase: string, idempotencyKey?: string): Promise<unknown> {
    const url = new URL(route, this.options.apiUrl);
    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt += 1) {
      let response: Response;
      try {
        const timeoutSignal = AbortSignal.timeout(this.options.timeoutMilliseconds ?? 120_000);
        const signal = this.options.signal ? AbortSignal.any([this.options.signal, timeoutSignal]) : timeoutSignal;
        response = await this.fetchImplementation(url, {
          method: 'POST', redirect: 'manual', signal,
          headers: {
            Authorization: `Bearer ${this.options.projectToken}`,
            'Content-Type': 'application/json', Accept: 'application/json',
            'User-Agent': 'alconite-runtime-verify-action/2.1.1',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
          },
          body: JSON.stringify(body)
        });
      } catch {
        if (attempt < this.options.retryAttempts && !this.options.signal?.aborted) {
          await this.retryDelay(attempt);
          continue;
        }
        throw new RuntimeVerifyError('platform_error', 'Alconite could not be reached after bounded retry attempts.');
      }
      if (response.status >= 300 && response.status < 400) {
        throw new RuntimeVerifyError('platform_error', 'Alconite returned a redirect, which Runtime Verify refuses.');
      }
      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.options.retryAttempts) {
        await discard(response);
        await this.retryDelay(attempt);
        continue;
      }
      const parsed = await readJson(response);
      if (!response.ok) throw platformHttpError(response.status, parsed, phase);
      return parsed;
    }
    throw new RuntimeVerifyError('platform_error', 'Alconite did not complete the request.');
  }

  private async retryDelay(attempt: number): Promise<void> {
    const base = Math.min(2_000, 250 * (2 ** (attempt - 1)));
    await this.sleep(Math.round(base + base * 0.25 * this.random()));
  }
}

export function createInitiationRequest(
  inputs: RuntimeVerifyInputs,
  contractContentHash: string,
  configurationContentHash: string,
  environment: NodeJS.ProcessEnv = process.env
): InitiationRequest {
  return {
    environmentId: inputs.environmentId,
    contractGuardCheckId: inputs.checkId,
    contractContentHash,
    configurationContentHash,
    displayName: inputs.displayName ?? bounded(environment.GITHUB_SHA || 'Runtime verification', 160),
    deployment: {
      provider: 'github-actions', repository: bounded(environment.GITHUB_REPOSITORY, 200),
      commitSha: bounded(environment.GITHUB_SHA, 80), ref: bounded(environment.GITHUB_REF, 300),
      workflow: bounded(environment.GITHUB_WORKFLOW, 200), workflowRunId: bounded(environment.GITHUB_RUN_ID, 80),
      workflowRunAttempt: positiveInteger(environment.GITHUB_RUN_ATTEMPT),
      ...(inputs.deploymentId ? { releaseIdentifier: inputs.deploymentId } : {})
    },
    runner: {
      name: 'alconite-runtime-verify-action', version: '2.1.1',
      operatingSystem: bounded(environment.RUNNER_OS ?? process.platform, 80),
      architecture: bounded(environment.RUNNER_ARCH ?? process.arch, 80)
    }
  };
}

function validateInitiation(raw: unknown): InitiationResponse {
  const value = object(raw, 'initiation response');
  const runId = string(value.runId, 'runId', 80);
  validateRunId(runId);
  const status = value.status;
  if (status !== 'pending' && status !== 'completed') mismatch('Initiation status is invalid.');
  const expectedContractContentHash = hash(value.expectedContractContentHash, 'expectedContractContentHash');
  const limits = object(value.limits, 'initiation limits');
  const maximumOperations = integer(limits.maximumOperations, 1, 500, 'limits.maximumOperations');
  const report = value.report === undefined || value.report === null ? undefined : validateReport(value.report);
  if (status === 'completed' && !report) mismatch('A completed replay did not include its canonical report.');
  if (typeof value.replayed !== 'boolean') mismatch('The initiation replay state is invalid.');
  return {
    runId, status, expectedContractContentHash, maximumOperations,
    replayed: value.replayed || status === 'completed',
    ...(report ? { report } : {})
  };
}

export function validateReport(raw: unknown): RuntimeVerifyReport {
  const value = object(raw, 'Runtime Verify report');
  if (value.schema !== 'alconite.runtime-verify.report.v1') mismatch('The report schema version is unsupported.');
  const runId = string(value.runId, 'runId', 80); validateRunId(runId);
  const status = value.status;
  if (status !== 'completed') mismatch('The report status is not completed.');
  const gateResult = value.gateResult;
  if (gateResult !== 'passed' && gateResult !== 'passed_with_warnings' && gateResult !== 'failed') mismatch('The report gate result is invalid.');
  const rawFindings = array(value.findings, 'report findings', 5_000);
  const findings = rawFindings.map(item => validateFinding(item, runId));
  const summaryRaw = object(value.summary, 'summary');
  const summary: RuntimeReportSummary = {
    configuredOperations: integer(summaryRaw.configuredOperations, 0, 500, 'configuredOperations'),
    executedOperations: integer(summaryRaw.executedOperations, 0, 500, 'executedOperations'),
    passedOperations: integer(summaryRaw.passedOperations, 0, 500, 'passedOperations'),
    failedOperations: integer(summaryRaw.failedOperations, 0, 500, 'failedOperations'),
    warningOperations: integer(summaryRaw.warningOperations, 0, 500, 'warningOperations'),
    informationalFindings: integer(summaryRaw.informationalFindings, 0, 5_000, 'informationalFindings'),
    totalDurationMilliseconds: integer(summaryRaw.totalDurationMilliseconds, 0, Number.MAX_SAFE_INTEGER, 'totalDurationMilliseconds')
  };
  if (summary.passedOperations + summary.failedOperations + summary.warningOperations !== summary.executedOperations) {
    mismatch('The report operation outcome totals are inconsistent.');
  }
  if (summary.informationalFindings !== findings.filter(item => item.classification === 'informational').length) {
    mismatch('The report informational finding total is inconsistent.');
  }
  const contractRaw = object(value.contract, 'report contract');
  const contract = {
    approvedCandidateVersionId: string(contractRaw.approvedCandidateVersionId, 'approvedCandidateVersionId', 80),
    approvedCandidateContentHash: hash(contractRaw.approvedCandidateContentHash, 'approvedCandidateContentHash'),
    localContractContentHash: hash(contractRaw.localContractContentHash, 'localContractContentHash'),
    hashMatched: boolean(contractRaw.hashMatched, 'hashMatched')
  };
  if (contract.hashMatched !== (contract.approvedCandidateContentHash === contract.localContractContentHash)) {
    mismatch('The report contract hash result is inconsistent.');
  }
  const deploymentRaw = object(value.deployment, 'report deployment');
  const deployment = {
    provider: string(deploymentRaw.provider, 'deployment.provider', 50),
    repository: nullableString(deploymentRaw.repository, 'deployment.repository', 200),
    commitSha: nullableString(deploymentRaw.commitSha, 'deployment.commitSha', 64),
    ref: nullableString(deploymentRaw.ref, 'deployment.ref', 300),
    workflow: nullableString(deploymentRaw.workflow, 'deployment.workflow', 160),
    workflowRunId: nullableString(deploymentRaw.workflowRunId, 'deployment.workflowRunId', 80),
    workflowRunAttempt: nullableInteger(deploymentRaw.workflowRunAttempt, 1, Number.MAX_SAFE_INTEGER, 'deployment.workflowRunAttempt'),
    releaseIdentifier: nullableString(deploymentRaw.releaseIdentifier, 'deployment.releaseIdentifier', 160)
  };
  const runnerRaw = object(value.runner, 'report runner');
  const runner = {
    name: string(runnerRaw.name, 'runner.name', 100),
    version: string(runnerRaw.version, 'runner.version', 50),
    operatingSystem: string(runnerRaw.operatingSystem, 'runner.operatingSystem', 50),
    architecture: string(runnerRaw.architecture, 'runner.architecture', 30)
  };
  const violations = array(value.violations, 'report violations', 100).map((raw) => {
    const violation = object(raw, 'policy violation');
    return {
      code: string(violation.code, 'violation.code', 100),
      message: string(violation.message, 'violation.message', 500),
      failure: boolean(violation.failure, 'violation.failure')
    };
  });
  return {
    schema: 'alconite.runtime-verify.report.v1', runId,
    projectId: identifier(value.projectId, 'projectId', /^cgprj_[0-9a-f]{32}$/),
    environmentId: identifier(value.environmentId, 'environmentId', /^rtvenv_[0-9a-f]{32}$/),
    contractGuardCheckId: identifier(value.contractGuardCheckId, 'contractGuardCheckId', /^cgchk_[0-9a-f]{32}$/),
    status, gateResult,
    policyRevision: integer(value.policyRevision, 1, Number.MAX_SAFE_INTEGER, 'policyRevision'),
    contract, deployment, runner, summary, violations, findings,
    createdAt: integer(value.createdAt, 0, Number.MAX_SAFE_INTEGER, 'createdAt'),
    completedAt: integer(value.completedAt, 0, Number.MAX_SAFE_INTEGER, 'completedAt'),
    reportUrl: string(value.reportUrl, 'reportUrl', 500)
  };
}

function validateFinding(raw: unknown, expectedRunId: string): RuntimeReportFinding {
  const value = object(raw, 'finding');
  const runId = string(value.runId, 'finding.runId', 80);
  if (runId !== expectedRunId) mismatch('A report finding belongs to a different run.');
  const classification = value.classification;
  if (classification !== 'failure' && classification !== 'warning' && classification !== 'informational') mismatch('A report finding classification is invalid.');
  const ruleId = string(value.ruleId, 'finding.ruleId', 100);
  if (!RUNTIME_RULE_IDS.has(ruleId)) mismatch('A report finding rule is unsupported.');
  return {
    id: identifier(value.id, 'finding.id', /^rtvfnd_[0-9a-f]{32}$/),
    runId,
    fingerprint: string(value.fingerprint, 'finding.fingerprint', 96),
    operationId: nullableString(value.operationId, 'finding.operationId', 200),
    method: nullableString(value.method, 'finding.method', 10),
    pathTemplate: nullableString(value.pathTemplate, 'finding.pathTemplate', 500),
    classification,
    ruleId,
    summary: string(value.summary, 'finding.summary', 240),
    explanation: string(value.explanation, 'finding.explanation', 1_000),
    guidance: string(value.guidance, 'finding.guidance', 1_000),
    location: nullableString(value.location, 'finding.location', 300),
    expected: nullableString(value.expected, 'finding.expected', 300),
    actual: nullableString(value.actual, 'finding.actual', 300),
    durationMilliseconds: nullableInteger(value.durationMilliseconds, 0, Number.MAX_SAFE_INTEGER, 'finding.durationMilliseconds'),
    createdAt: integer(value.createdAt, 0, Number.MAX_SAFE_INTEGER, 'finding.createdAt')
  };
}

async function readJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_PLATFORM_RESPONSE_BYTES) throw mismatch('Alconite returned an oversized response.');
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PLATFORM_RESPONSE_BYTES) { await reader.cancel().catch(() => undefined); throw mismatch('Alconite returned an oversized response.'); }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { throw mismatch('Alconite returned malformed JSON.'); }
}

async function discard(response: Response): Promise<void> { await response.body?.cancel().catch(() => undefined); }
function platformHttpError(status: number, raw: unknown, phase: string): RuntimeVerifyError {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const detail = value.error && typeof value.error === 'object' ? value.error as Record<string, unknown> : {};
  const code = typeof detail.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(detail.code) ? ` (${detail.code})` : '';
  return new RuntimeVerifyError('platform_error', `Alconite rejected Runtime Verify ${phase} with HTTP ${status}${code}.`);
}
function validateRunId(value: string): void { if (!/^rtvrun_[0-9a-f]{32}$/.test(value)) mismatch('The Runtime Verify run identifier is invalid.'); }
function object(raw: unknown, context: string): Record<string, unknown> { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) mismatch(`The ${context} is invalid.`); return raw as Record<string, unknown>; }
function array(raw: unknown, context: string, maximum: number): unknown[] { if (!Array.isArray(raw) || raw.length > maximum) mismatch(`The ${context} collection is invalid.`); return raw; }
function string(raw: unknown, context: string, maximum: number): string { if (typeof raw !== 'string' || raw.length === 0 || raw.length > maximum) mismatch(`The ${context} is invalid.`); return raw; }
function hash(raw: unknown, context: string): string { const value = string(raw, context, 71); if (!/^sha256:[a-f0-9]{64}$/.test(value)) mismatch(`The ${context} is invalid.`); return value; }
function integer(raw: unknown, minimum: number, maximum: number, context: string): number { if (!Number.isInteger(raw) || (raw as number) < minimum || (raw as number) > maximum) mismatch(`The ${context} is invalid.`); return raw as number; }
function boolean(raw: unknown, context: string): boolean { if (typeof raw !== 'boolean') mismatch(`The ${context} is invalid.`); return raw; }
function nullableString(raw: unknown, context: string, maximum: number): string | null { return raw === null ? null : string(raw, context, maximum); }
function nullableInteger(raw: unknown, minimum: number, maximum: number, context: string): number | null { return raw === null ? null : integer(raw, minimum, maximum, context); }
function identifier(raw: unknown, context: string, pattern: RegExp): string { const value = string(raw, context, 80); if (!pattern.test(value)) mismatch(`The ${context} is invalid.`); return value; }
function bounded(raw: string | undefined, maximum: number): string { return (raw ?? '').slice(0, maximum); }
function positiveInteger(raw: string | undefined): number { const value = Number(raw ?? '1'); return Number.isInteger(value) && value >= 1 ? value : 1; }
function mismatch(message: string): never { throw new RuntimeVerifyError('platform_contract_mismatch', message); }
