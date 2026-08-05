import type { RuntimeErrorCode } from './errors';
import { RuntimeVerifyError } from './errors';
import type { RuntimeVerifyInputs } from './inputs';
import type { RuntimeFinding } from './findings';
import type { RunnerResult, RuntimeReportSummary, RuntimeVerifyReport } from './report';

const MAX_PLATFORM_RESPONSE_BYTES = 4 * 1024 * 1024;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

export interface InitiationRequest {
  environmentId: string;
  contractGuardCheckId: string;
  contractContentHash: string;
  configurationContentHash: string;
  displayName?: string;
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
  maximumOperations?: number;
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
    const body = await this.post(`/api/v1/runtime-verify/projects/${this.options.projectId}/runs`, request, idempotencyKey);
    return validateInitiation(body);
  }

  async complete(runId: string, result: RunnerResult): Promise<RuntimeVerifyReport> {
    validateRunId(runId);
    const body = await this.post(`/api/v1/runtime-verify/projects/${this.options.projectId}/runs/${runId}/results`, result);
    return validateReport(body);
  }

  async fail(runId: string, code: RuntimeErrorCode, message: string): Promise<void> {
    validateRunId(runId);
    await this.post(`/api/v1/runtime-verify/projects/${this.options.projectId}/runs/${runId}/failure`, {
      code, message: message.slice(0, 300)
    });
  }

  private async post(route: string, body: unknown, idempotencyKey?: string): Promise<unknown> {
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
            'User-Agent': 'alconite-runtime-verify-action/2.1.0',
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
      if (!response.ok) throw platformHttpError(response.status, parsed);
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
    ...(inputs.displayName ? { displayName: inputs.displayName } : {}),
    deployment: {
      provider: 'github-actions', repository: bounded(environment.GITHUB_REPOSITORY, 200),
      commitSha: bounded(environment.GITHUB_SHA, 80), ref: bounded(environment.GITHUB_REF, 300),
      workflow: bounded(environment.GITHUB_WORKFLOW, 200), workflowRunId: bounded(environment.GITHUB_RUN_ID, 80),
      workflowRunAttempt: positiveInteger(environment.GITHUB_RUN_ATTEMPT),
      ...(inputs.deploymentId ? { releaseIdentifier: inputs.deploymentId } : {})
    },
    runner: {
      name: 'alconite-runtime-verify-action', version: '2.1.0',
      operatingSystem: bounded(environment.RUNNER_OS ?? process.platform, 80),
      architecture: bounded(environment.RUNNER_ARCH ?? process.arch, 80)
    }
  };
}

function validateInitiation(raw: unknown): InitiationResponse {
  const value = object(raw, 'initiation response');
  if (value.schemaVersion !== undefined && value.schemaVersion !== 'alconite.runtime-verify.run.v1') mismatch('The initiation schema version is unsupported.');
  const runId = string(value.runId, 'runId', 80);
  validateRunId(runId);
  const status = value.status;
  if (status !== 'pending' && status !== 'completed') mismatch('Initiation status is invalid.');
  const expectedContractContentHash = hash(value.expectedContractContentHash, 'expectedContractContentHash');
  const maximumOperations = value.maximumOperations === undefined ? undefined : integer(value.maximumOperations, 0, 1_000, 'maximumOperations');
  const report = value.report === undefined ? undefined : validateReport(value.report);
  if (status === 'completed' && !report) mismatch('A completed replay did not include its canonical report.');
  return {
    runId, status, expectedContractContentHash,
    ...(maximumOperations === undefined ? {} : { maximumOperations }),
    replayed: value.replayed === true || status === 'completed',
    ...(report ? { report } : {})
  };
}

export function validateReport(raw: unknown): RuntimeVerifyReport {
  const value = object(raw, 'Runtime Verify report');
  if (value.schemaVersion !== 'alconite.runtime-verify.report.v1') mismatch('The report schema version is unsupported.');
  const runId = string(value.runId, 'runId', 80); validateRunId(runId);
  const status = value.status;
  if (status !== 'completed') mismatch('The report status is not completed.');
  const gateResult = value.gateResult;
  if (gateResult !== 'passed' && gateResult !== 'passed_with_warnings' && gateResult !== 'failed') mismatch('The report gate result is invalid.');
  const rawFindings = Array.isArray(value.findings) ? value.findings : mismatch('The report findings collection is invalid.');
  if (rawFindings.length > 500) mismatch('The report contains too many findings.');
  const findings = rawFindings.map(validateFinding);
  const summaryRaw = object(value.summary, 'summary');
  const summary: RuntimeReportSummary = {
    configuredOperations: integer(summaryRaw.configuredOperations, 0, 1_000, 'configuredOperations'),
    executedOperations: integer(summaryRaw.executedOperations, 0, 1_000, 'executedOperations'),
    passedOperations: integer(summaryRaw.passedOperations, 0, 1_000, 'passedOperations'),
    failedOperations: integer(summaryRaw.failedOperations, 0, 1_000, 'failedOperations'),
    warningOperations: integer(summaryRaw.warningOperations, 0, 1_000, 'warningOperations'),
    findingCount: integer(summaryRaw.findingCount, 0, 500, 'findingCount')
  };
  if (summary.findingCount !== findings.length) mismatch('The report finding total does not match its findings collection.');
  if (summary.passedOperations + summary.failedOperations + summary.warningOperations !== summary.executedOperations) {
    mismatch('The report operation outcome totals are inconsistent.');
  }
  return {
    schemaVersion: 'alconite.runtime-verify.report.v1', runId,
    projectId: string(value.projectId, 'projectId', 80), environmentId: string(value.environmentId, 'environmentId', 80),
    contractGuardCheckId: string(value.contractGuardCheckId, 'contractGuardCheckId', 80), status, gateResult,
    contractContentHash: hash(value.contractContentHash, 'contractContentHash'),
    expectedContractContentHash: hash(value.expectedContractContentHash, 'expectedContractContentHash'),
    summary, findings,
    ...(typeof value.reportUrl === 'string' && value.reportUrl.length <= 300 ? { reportUrl: value.reportUrl } : {})
  };
}

function validateFinding(raw: unknown): RuntimeFinding {
  const value = object(raw, 'finding');
  const method = value.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'CONTRACT') mismatch('A report finding method is invalid.');
  const classification = value.classification;
  if (classification !== 'failure' && classification !== 'warning') mismatch('A report finding classification is invalid.');
  return {
    operationId: string(value.operationId, 'operationId', 160), method, pathTemplate: string(value.pathTemplate, 'pathTemplate', 600),
    classification, ruleId: string(value.ruleId, 'ruleId', 100), summary: string(value.summary, 'summary', 300),
    explanation: string(value.explanation, 'explanation', 1_200), guidance: string(value.guidance, 'guidance', 1_200),
    location: string(value.location, 'location', 1_000),
    ...(typeof value.expected === 'string' ? { expected: value.expected.slice(0, 300) } : {}),
    ...(typeof value.actual === 'string' ? { actual: value.actual.slice(0, 300) } : {}),
    durationMilliseconds: integer(value.durationMilliseconds, 0, 3_600_000, 'durationMilliseconds')
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
function platformHttpError(status: number, raw: unknown): RuntimeVerifyError {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const detail = value.error && typeof value.error === 'object' ? value.error as Record<string, unknown> : {};
  const code = typeof detail.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(detail.code) ? ` (${detail.code})` : '';
  return new RuntimeVerifyError('platform_error', `Alconite rejected the Runtime Verify request with HTTP ${status}${code}.`);
}
function validateRunId(value: string): void { if (!/^rtvrun_[A-Za-z0-9_-]{1,72}$/.test(value)) mismatch('The Runtime Verify run identifier is invalid.'); }
function object(raw: unknown, context: string): Record<string, unknown> { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) mismatch(`The ${context} is invalid.`); return raw as Record<string, unknown>; }
function string(raw: unknown, context: string, maximum: number): string { if (typeof raw !== 'string' || raw.length === 0 || raw.length > maximum) mismatch(`The ${context} is invalid.`); return raw; }
function hash(raw: unknown, context: string): string { const value = string(raw, context, 71); if (!/^sha256:[a-f0-9]{64}$/.test(value)) mismatch(`The ${context} is invalid.`); return value; }
function integer(raw: unknown, minimum: number, maximum: number, context: string): number { if (!Number.isInteger(raw) || (raw as number) < minimum || (raw as number) > maximum) mismatch(`The ${context} is invalid.`); return raw as number; }
function bounded(raw: string | undefined, maximum: number): string { return (raw ?? '').slice(0, maximum); }
function positiveInteger(raw: string | undefined): number { const value = Number(raw ?? '1'); return Number.isInteger(value) && value >= 1 ? value : 1; }
function mismatch(message: string): never { throw new RuntimeVerifyError('platform_contract_mismatch', message); }
