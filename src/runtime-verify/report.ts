import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeFinding } from './findings';
import { sha256 } from './redaction';

export interface RuntimeObservation {
  operationId: string;
  method: 'GET' | 'HEAD';
  pathTemplate: string;
  outcome: 'passed' | 'warning' | 'failed' | 'not_executed';
  statusCode?: number;
  contentType?: string;
  durationMilliseconds: number;
  responseBytes?: number;
}

export interface RunnerExecutionSummary {
  configuredOperations: number;
  executedOperations: number;
  passedOperations: number;
  failedOperations: number;
  warningOperations: number;
  totalDurationMilliseconds: number;
}

export interface RunnerResult {
  schema: 'alconite.runtime-verify.runner-result.v1';
  resultDigest: string;
  completedAt: string;
  execution: RunnerExecutionSummary;
  contract: {
    localContentHash: string;
    matchedApprovedCandidate: boolean;
  };
  observations: RuntimeObservation[];
  findings: RuntimeFinding[];
}

export interface RuntimeReportSummary extends RunnerExecutionSummary {
  informationalFindings: number;
}

export interface RuntimeReportFinding {
  id: string;
  runId: string;
  fingerprint: string;
  operationId: string | null;
  method: string | null;
  pathTemplate: string | null;
  classification: 'failure' | 'warning' | 'informational';
  ruleId: string;
  summary: string;
  explanation: string;
  guidance: string;
  location: string | null;
  expected: string | null;
  actual: string | null;
  durationMilliseconds: number | null;
  createdAt: number;
}

export interface RuntimeVerifyReport {
  schema: 'alconite.runtime-verify.report.v1';
  runId: string;
  projectId: string;
  environmentId: string;
  contractGuardCheckId: string;
  status: 'completed';
  gateResult: 'passed' | 'passed_with_warnings' | 'failed';
  policyRevision: number;
  contract: {
    approvedCandidateVersionId: string;
    approvedCandidateContentHash: string;
    localContractContentHash: string;
    hashMatched: boolean;
  };
  deployment: {
    provider: string;
    repository: string | null;
    commitSha: string | null;
    ref: string | null;
    workflow: string | null;
    workflowRunId: string | null;
    workflowRunAttempt: number | null;
    releaseIdentifier: string | null;
  };
  runner: {
    name: string;
    version: string;
    operatingSystem: string;
    architecture: string;
  };
  summary: RuntimeReportSummary;
  violations: Array<{ code: string; message: string; failure: boolean }>;
  findings: RuntimeReportFinding[];
  createdAt: number;
  completedAt: number;
  reportUrl: string;
}

export function createRunnerResult(input: Omit<RunnerResult, 'schema' | 'resultDigest'>): RunnerResult {
  const schema = 'alconite.runtime-verify.runner-result.v1' as const;
  const digestProjection = {
    schema,
    completedAt: unixSeconds(input.completedAt),
    execution: {
      configuredOperations: input.execution.configuredOperations,
      executedOperations: input.execution.executedOperations,
      passedOperations: input.execution.passedOperations,
      failedOperations: input.execution.failedOperations,
      warningOperations: input.execution.warningOperations,
      totalDurationMilliseconds: input.execution.totalDurationMilliseconds
    },
    contract: {
      localContentHash: input.contract.localContentHash,
      matchedApprovedCandidate: input.contract.matchedApprovedCandidate
    },
    observations: input.observations.map(value => ({
      operationId: value.operationId,
      method: value.method,
      pathTemplate: value.pathTemplate,
      statusCode: value.statusCode ?? null,
      contentType: value.contentType ?? null,
      durationMilliseconds: value.durationMilliseconds,
      responseBytes: value.responseBytes ?? null,
      outcome: value.outcome
    })),
    findings: input.findings.map(value => ({
      fingerprint: value.fingerprint,
      operationId: value.operationId ?? null,
      method: value.method ?? null,
      pathTemplate: value.pathTemplate ?? null,
      classification: value.classification,
      ruleId: value.ruleId,
      summary: value.summary,
      explanation: value.explanation,
      guidance: value.guidance,
      location: value.location ?? null,
      expected: value.expected ?? null,
      actual: value.actual ?? null,
      durationMilliseconds: value.durationMilliseconds ?? null
    }))
  };
  return { schema, resultDigest: sha256(JSON.stringify(digestProjection)), ...input };
}

export function summarize(configuredOperations: number, observations: RuntimeObservation[]): RunnerExecutionSummary {
  const executed = observations.filter(value => value.outcome !== 'not_executed');
  return {
    configuredOperations,
    executedOperations: executed.length,
    passedOperations: executed.filter(value => value.outcome === 'passed').length,
    failedOperations: executed.filter(value => value.outcome === 'failed').length,
    warningOperations: executed.filter(value => value.outcome === 'warning').length,
    totalDurationMilliseconds: observations.reduce((total, value) => total + value.durationMilliseconds, 0)
  };
}

export async function writeCanonicalReport(report: RuntimeVerifyReport, requestedPath: string | undefined): Promise<string> {
  const fallbackDirectory = process.env.RUNNER_TEMP || process.env.GITHUB_WORKSPACE || process.cwd();
  const reportPath = path.resolve(requestedPath || path.join(fallbackDirectory, 'alconite-runtime-verify-report.json'));
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return reportPath;
}

function unixSeconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Runtime Verify completedAt must be an RFC 3339 timestamp.');
  return Math.floor(milliseconds / 1_000);
}
