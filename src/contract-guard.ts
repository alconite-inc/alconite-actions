import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const MAX_CANDIDATE_BYTES = 9_437_184;
export const MAX_REPORT_BYTES = 33_554_432;
export const REPORT_SCHEMA_VERSION = 'alconite.contract-guard.report.v1';

const PROJECT_ID_PATTERN = /^cgprj_[A-Za-z0-9_-]+$/;
const CHECK_ID_PATTERN = /^cgchk_[A-Za-z0-9_-]+$/;
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

export type GateResult = 'passed' | 'passed_with_warnings' | 'failed';
export type FailOn = 'failed' | 'warnings' | 'never';

export interface ChangeSummary {
  breaking: number;
  risky: number;
  nonBreaking: number;
  informational: number;
  policyFailures: number;
  policyWarnings: number;
  baselineAnalyzerScore: number;
  candidateAnalyzerScore: number;
}

export interface PolicyViolation {
  code: string;
  severity: 'warning' | 'failure';
  message: string;
  relatedChangeFingerprints: string[];
}

export interface ContractChange {
  id: string;
  checkId: string;
  fingerprint: string;
  ruleId: string;
  ruleVersion: number;
  classification: 'breaking' | 'risky' | 'non_breaking' | 'informational';
  category: string;
  operationKey?: string;
  jsonPointer?: string;
  summary: string;
  explanation: string;
  migrationGuidance: string;
  baselineValue?: string;
  candidateValue?: string;
}

export interface ContractGuardReport {
  schemaVersion: string;
  checkId: string;
  projectId: string;
  projectName: string;
  status: 'completed';
  gateResult: GateResult;
  createdAt: number;
  completedAt: number;
  baselineVersionId: string;
  baselineDeclaredApiVersion?: string;
  baselineContentHash: string;
  candidateVersionId: string;
  candidateDeclaredApiVersion?: string;
  candidateContentHash: string;
  policyRevision: number;
  summary: ChangeSummary;
  violations: PolicyViolation[];
  changes: ContractChange[];
  analyzerVersion: string;
  analyzerRuleSetVersion: number;
  comparisonEngineVersion: number;
  reportUrl?: string;
}

export interface CandidateFile {
  bytes: Buffer;
  filename: string;
  contentType: string;
  sha256: string;
  resolvedPath: string;
}

export interface CheckRequest {
  apiUrl: string;
  projectId: string;
  projectToken: string;
  candidate: CandidateFile;
  displayName?: string;
  idempotencyKey: string;
  timeoutMs: number;
  attempts: number;
}

export interface RequestDependencies {
  fetch: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
}

export class ContractGuardError extends Error {
  public readonly status?: number;
  public readonly code?: string;

  public constructor(message: string, options?: { status?: number; code?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'ContractGuardError';
    this.status = options?.status;
    this.code = options?.code;
  }
}

export function validateProjectId(value: string): string {
  const projectId = value.trim();
  if (projectId.length < 7 || projectId.length > 80 || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new ContractGuardError("project-id must match '^cgprj_[A-Za-z0-9_-]+$' and be at most 80 characters");
  }
  return projectId;
}

export function validateProjectToken(value: string): string {
  const token = value.trim();
  if (!token.startsWith('alc_cg_') || token.length <= 'alc_cg_'.length) {
    throw new ContractGuardError('project-token must be a non-empty Alconite project token beginning with alc_cg_');
  }
  return token;
}

export function validateApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new ContractGuardError('api-url must be a valid absolute URL', { cause: error });
  }

  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ContractGuardError('api-url must use HTTPS; HTTP is accepted only for a loopback test server');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ContractGuardError('api-url must not contain credentials, a query string, or a fragment');
  }
  return url.toString().replace(/\/+$/, '');
}

export function validateIdempotencyKey(value: string): string {
  const key = value.trim();
  if (key.length < 1 || key.length > 200 || /[\r\n]/u.test(key)) {
    throw new ContractGuardError('idempotency-key must contain 1 through 200 characters and no line breaks');
  }
  return key;
}

export function validateDisplayName(value: string): string {
  const displayName = value.trim();
  if (displayName.length > 160) {
    throw new ContractGuardError('display-name must be at most 160 characters');
  }
  return displayName;
}

export function parseBoundedInteger(value: string, name: string, minimum: number, maximum: number): number {
  if (!/^\d+$/u.test(value.trim())) {
    throw new ContractGuardError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ContractGuardError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

export function parseFailOn(value: string): FailOn {
  const failOn = value.trim();
  if (failOn !== 'failed' && failOn !== 'warnings' && failOn !== 'never') {
    throw new ContractGuardError('fail-on must be one of: failed, warnings, never');
  }
  return failOn;
}

export function shouldFailGate(gateResult: GateResult, failOn: FailOn): boolean {
  if (failOn === 'never') return false;
  if (failOn === 'warnings') return gateResult !== 'passed';
  return gateResult === 'failed';
}

export function createDefaultIdempotencyKey(context: {
  repositoryId?: string;
  repository?: string;
  runId?: string;
  projectId: string;
  candidateHash: string;
}): string {
  const repository = context.repositoryId || context.repository || 'local';
  const runId = context.runId || 'manual';
  const digest = createHash('sha256')
    .update(`${repository}\0${runId}\0${context.projectId}\0${context.candidateHash}`)
    .digest('hex');
  return validateIdempotencyKey(`cg-v2-${digest}`);
}

export async function readCandidate(candidatePath: string, workspace?: string): Promise<CandidateFile> {
  const resolvedPath = path.resolve(candidatePath);
  const realPath = await fs.realpath(resolvedPath).catch((error: unknown) => {
    throw new ContractGuardError(`candidate-path does not identify a readable file: ${resolvedPath}`, { cause: error });
  });

  if (workspace) {
    const realWorkspace = await fs.realpath(path.resolve(workspace));
    const relative = path.relative(realWorkspace, realPath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new ContractGuardError('candidate-path must remain inside GITHUB_WORKSPACE');
    }
  }

  const stats = await fs.stat(realPath);
  if (!stats.isFile()) throw new ContractGuardError('candidate-path must identify a regular file');
  if (stats.size < 1) throw new ContractGuardError('candidate contract must not be empty');
  if (stats.size > MAX_CANDIDATE_BYTES) {
    throw new ContractGuardError(`candidate contract exceeds the ${MAX_CANDIDATE_BYTES}-byte API limit`);
  }

  const extension = path.extname(realPath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.json': 'application/json',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
  };
  const contentType = contentTypes[extension];
  if (!contentType) throw new ContractGuardError('candidate-path must end in .json, .yaml, or .yml');

  const bytes = await fs.readFile(realPath);
  return {
    bytes,
    filename: path.basename(realPath),
    contentType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    resolvedPath: realPath,
  };
}

export function validateReport(value: unknown, expectedProjectId: string): ContractGuardReport {
  if (!value || typeof value !== 'object') throw new ContractGuardError('Contract Guard returned a non-object report');
  const report = value as Partial<ContractGuardReport>;
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new ContractGuardError(`unsupported Contract Guard report schema: ${String(report.schemaVersion)}`);
  }
  if (report.projectId !== expectedProjectId) throw new ContractGuardError('Contract Guard report projectId did not match the request');
  if (typeof report.checkId !== 'string' || !CHECK_ID_PATTERN.test(report.checkId)) {
    throw new ContractGuardError('Contract Guard returned an invalid checkId');
  }
  if (report.status !== 'completed') throw new ContractGuardError('Contract Guard returned a report that was not completed');
  if (report.gateResult !== 'passed' && report.gateResult !== 'passed_with_warnings' && report.gateResult !== 'failed') {
    throw new ContractGuardError('Contract Guard returned an invalid gateResult');
  }
  if (!report.summary || typeof report.summary !== 'object') throw new ContractGuardError('Contract Guard report omitted its summary');
  const countKeys: Array<keyof ChangeSummary> = [
    'breaking',
    'risky',
    'nonBreaking',
    'informational',
    'policyFailures',
    'policyWarnings',
    'baselineAnalyzerScore',
    'candidateAnalyzerScore',
  ];
  for (const key of countKeys) {
    if (!Number.isInteger(report.summary[key]) || report.summary[key] < 0) {
      throw new ContractGuardError(`Contract Guard report contains an invalid summary.${key}`);
    }
  }
  if (report.summary.baselineAnalyzerScore > 100 || report.summary.candidateAnalyzerScore > 100) {
    throw new ContractGuardError('Contract Guard report contains an analyzer score above 100');
  }
  if (!Array.isArray(report.violations) || !Array.isArray(report.changes)) {
    throw new ContractGuardError('Contract Guard report omitted violations or changes');
  }
  if (report.violations.length > 500 || report.changes.length > 5_000) {
    throw new ContractGuardError('Contract Guard report exceeded its bounded collection limits');
  }
  if (
    typeof report.baselineContentHash !== 'string' ||
    typeof report.candidateContentHash !== 'string' ||
    !/^[a-fA-F0-9]{64}$/u.test(report.baselineContentHash) ||
    !/^[a-fA-F0-9]{64}$/u.test(report.candidateContentHash)
  ) {
    throw new ContractGuardError('Contract Guard report contains invalid content hashes');
  }
  return report as ContractGuardReport;
}

function endpointFor(apiUrl: string, projectId: string): string {
  return `${apiUrl}/api/v1/contract-guard/projects/${encodeURIComponent(projectId)}/checks`;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return Math.max(0, Math.min(timestamp - Date.now(), 30_000));
  return undefined;
}

async function safeApiError(response: Response): Promise<ContractGuardError> {
  let code: string | undefined;
  let message = `Contract Guard request failed with HTTP ${response.status}`;
  try {
    const body = (await readBoundedJson(response, 65_536)) as { error?: { code?: unknown; message?: unknown } };
    if (typeof body.error?.code === 'string') code = body.error.code.slice(0, 80);
    if (typeof body.error?.message === 'string') message = body.error.message.slice(0, 300);
  } catch {
    // The status is sufficient when an intermediary returns a non-JSON response.
  }
  return new ContractGuardError(code ? `${code}: ${message}` : message, { status: response.status, code });
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ContractGuardError(`Contract Guard response exceeded the ${maximumBytes}-byte limit`, {
      status: response.status,
    });
  }
  if (!response.body) throw new ContractGuardError('Contract Guard returned an empty response', { status: response.status });

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new ContractGuardError(`Contract Guard response exceeded the ${maximumBytes}-byte limit`, {
        status: response.status,
      });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export async function runCheck(
  request: CheckRequest,
  dependencies: RequestDependencies = {
    fetch: globalThis.fetch,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
): Promise<ContractGuardReport> {
  const endpoint = endpointFor(request.apiUrl, request.projectId);
  let lastError: unknown;

  for (let attempt = 1; attempt <= request.attempts; attempt += 1) {
    const body = new FormData();
    if (request.displayName) body.append('display_name', request.displayName);
    body.append(
      'candidate',
      new Blob([new Uint8Array(request.candidate.bytes)], { type: request.candidate.contentType }),
      request.candidate.filename,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await dependencies.fetch(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${request.projectToken}`,
          'idempotency-key': request.idempotencyKey,
          'user-agent': 'alconite-contract-guard-action/2.0.0',
        },
        body,
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status === 200) {
        let json: unknown;
        try {
          json = await readBoundedJson(response, MAX_REPORT_BYTES);
        } catch (error) {
          if (error instanceof ContractGuardError) throw error;
          throw new ContractGuardError('Contract Guard returned invalid JSON', { status: 200, cause: error });
        }
        return validateReport(json, request.projectId);
      }

      if (response.status >= 300 && response.status < 400) {
        throw new ContractGuardError('Contract Guard redirects are refused to protect the project token', {
          status: response.status,
        });
      }

      if (TRANSIENT_STATUSES.has(response.status) && attempt < request.attempts) {
        const delay = parseRetryAfter(response.headers.get('retry-after')) ?? Math.min(1_000 * 2 ** (attempt - 1), 10_000);
        await response.body?.cancel().catch(() => undefined);
        await dependencies.sleep(delay);
        continue;
      }
      throw await safeApiError(response);
    } catch (error) {
      lastError = error;
      if (error instanceof ContractGuardError) throw error;
      if (attempt >= request.attempts) break;
      await dependencies.sleep(Math.min(1_000 * 2 ** (attempt - 1), 10_000));
    } finally {
      clearTimeout(timer);
    }
  }

  const reason = lastError instanceof Error && lastError.name === 'AbortError' ? 'request timed out' : 'network request failed';
  throw new ContractGuardError(`Contract Guard ${reason} after ${request.attempts} attempt(s)`, { cause: lastError });
}

export function canonicalReportUrl(apiUrl: string, report: ContractGuardReport): string {
  const fallback = `/api/v1/contract-guard/projects/${encodeURIComponent(report.projectId)}/checks/${encodeURIComponent(report.checkId)}/report`;
  const base = new URL(`${apiUrl}/`);
  const reportUrl = new URL(report.reportUrl || fallback, base);
  if (reportUrl.origin !== base.origin) throw new ContractGuardError('Contract Guard returned a cross-origin reportUrl');
  return reportUrl.toString();
}
