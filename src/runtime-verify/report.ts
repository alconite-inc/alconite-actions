import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeFinding } from './findings';
import { sha256, stableJson } from './redaction';

export interface RuntimeObservation {
  operationId: string;
  method: 'GET' | 'HEAD';
  pathTemplate: string;
  outcome: 'passed' | 'warning' | 'failed';
  statusCode?: number;
  contentType?: string;
  durationMilliseconds: number;
  responseBytes: number;
  responseBodyHash?: string;
  findingCount: number;
}

export interface RunnerResult {
  schemaVersion: 'alconite.runtime-verify.runner-result.v1';
  runId: string;
  contractContentHash: string;
  configurationContentHash: string;
  startedAt: string;
  completedAt: string;
  observations: RuntimeObservation[];
  findings: RuntimeFinding[];
  resultDigest: string;
}

export interface RuntimeReportSummary {
  configuredOperations: number;
  executedOperations: number;
  passedOperations: number;
  failedOperations: number;
  warningOperations: number;
  findingCount: number;
}

export interface RuntimeVerifyReport {
  schemaVersion: 'alconite.runtime-verify.report.v1';
  runId: string;
  projectId: string;
  environmentId: string;
  contractGuardCheckId: string;
  status: 'completed';
  gateResult: 'passed' | 'passed_with_warnings' | 'failed';
  contractContentHash: string;
  expectedContractContentHash: string;
  summary: RuntimeReportSummary;
  findings: RuntimeFinding[];
  reportUrl?: string;
}

export function createRunnerResult(input: Omit<RunnerResult, 'schemaVersion' | 'resultDigest'>): RunnerResult {
  const unsigned = { schemaVersion: 'alconite.runtime-verify.runner-result.v1' as const, ...input };
  return { ...unsigned, resultDigest: sha256(stableJson(unsigned)) };
}

export function summarize(configuredOperations: number, observations: RuntimeObservation[], findings: RuntimeFinding[]): RuntimeReportSummary {
  return {
    configuredOperations,
    executedOperations: observations.length,
    passedOperations: observations.filter(value => value.outcome === 'passed').length,
    failedOperations: observations.filter(value => value.outcome === 'failed').length,
    warningOperations: observations.filter(value => value.outcome === 'warning').length,
    findingCount: findings.length
  };
}

export async function writeCanonicalReport(report: RuntimeVerifyReport, requestedPath: string | undefined): Promise<string> {
  const fallbackDirectory = process.env.RUNNER_TEMP || process.env.GITHUB_WORKSPACE || process.cwd();
  const reportPath = path.resolve(requestedPath || path.join(fallbackDirectory, 'alconite-runtime-verify-report.json'));
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return reportPath;
}
