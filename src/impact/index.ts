import * as github from '../github';
import { ActionDeadline } from './deadline';
import { ImpactActionError } from './errors';
import {
  CLIENT_COLLECTION_SCHEMA_VERSION,
  SKIP_CODES,
  SOURCE_LANGUAGES,
  type ClientCollectionMetadata,
  type ImpactRequest,
} from './models';
import {
  ImpactPlatformClient,
  validateApiUrl,
  validateCheckId,
  validateProjectId,
  validateProjectToken,
} from './platform-client';
import { impactSummary, parseRiskThreshold, shouldFailRisk, writePrivateReport } from './report';
import { collectSourceManifest, validateAdditionalIgnorePatterns, validatePortableRoot } from './source-manifest';

function boundedInteger(value: string, name: string, minimum: number, maximum: number): number {
  if (!/^\d+$/u.test(value.trim())) {
    throw new ImpactActionError('invalid_input', `${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ImpactActionError('invalid_input', `${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function booleanInput(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized !== 'true' && normalized !== 'false') {
    throw new ImpactActionError('invalid_input', `${name} must be true or false.`);
  }
  return normalized === 'true';
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new ImpactActionError('invalid_input', `${name} must identify an existing runner directory.`);
  return value;
}

function assertClientAccountingEcho(expected: ClientCollectionMetadata, actual: unknown): void {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    throw new ImpactActionError('platform_contract_mismatch', 'Alconite omitted the non-authoritative client collection accounting.');
  }
  const value = actual as Record<string, unknown>;
  for (const key of [
    'entriesVisited', 'directoriesVisited', 'filesDiscovered', 'filesSubmitted', 'filesSkipped', 'collectionDurationMs',
  ] as const) {
    if (value[key] !== expected[key]) {
      throw new ImpactActionError('platform_contract_mismatch', 'Alconite changed the submitted client collection accounting.');
    }
  }
  if (value.schemaVersion !== CLIENT_COLLECTION_SCHEMA_VERSION || value.authoritative !== false) {
    throw new ImpactActionError('platform_contract_mismatch', 'Alconite returned invalid client collection metadata.');
  }
  if (!value.skipCounts || typeof value.skipCounts !== 'object' || Array.isArray(value.skipCounts)) {
    throw new ImpactActionError('platform_contract_mismatch', 'Alconite changed the submitted client skip accounting.');
  }
  const actualSkip = value.skipCounts as Record<string, unknown>;
  if (
    Object.keys(actualSkip).some((key) => !SKIP_CODES.includes(key as (typeof SKIP_CODES)[number])) ||
    SKIP_CODES.some((code) => actualSkip[code] !== expected.skipCounts[code])
  ) {
    throw new ImpactActionError('platform_contract_mismatch', 'Alconite changed the submitted client skip accounting.');
  }
}

async function main(): Promise<void> {
  // Read the timeout first so one monotonic deadline begins before any workspace filesystem access.
  const timeoutMs = boundedInteger(github.getInput('timeout-seconds'), 'timeout-seconds', 1, 600) * 1_000;
  const deadline = new ActionDeadline(timeoutMs);
  const rawToken = github.getInput('project-token', { required: true });
  github.setSecret(rawToken);
  const projectToken = validateProjectToken(rawToken);
  const projectId = validateProjectId(github.getInput('project-id', { required: true }));
  const checkId = validateCheckId(github.getInput('check-id', { required: true }));
  const apiUrl = validateApiUrl(github.getInput('api-url'));
  const sourceRoot = validatePortableRoot(github.getInput('source-root'));
  const includeGeneratedDirectories = booleanInput(github.getInput('include-generated-directories'), 'include-generated-directories');
  const additionalIgnorePatterns = validateAdditionalIgnorePatterns(github.getInput('additional-ignore').split(/\r?\n/u));
  const attempts = boundedInteger(github.getInput('attempts'), 'attempts', 1, 5);
  const failOnRisk = parseRiskThreshold(github.getInput('fail-on-risk'), 'fail-on-risk');
  const failOnPotentialRisk = parseRiskThreshold(github.getInput('fail-on-potential-risk'), 'fail-on-potential-risk');
  const workspace = requiredEnvironment('GITHUB_WORKSPACE');
  const runnerTemp = requiredEnvironment('RUNNER_TEMP');

  const collection = await collectSourceManifest({
    workspace,
    sourceRoot,
    includeGeneratedDirectories,
    additionalIgnorePatterns,
    deadline,
  });
  if (collection.files.length === 0) {
    throw new ImpactActionError('invalid_input', 'No supported UTF-8 Rust, Java, TypeScript, or JavaScript source files were collected.');
  }
  github.info(
    `Collected ${collection.clientCollection.filesSubmitted} bounded source files for Alconite Impact; ` +
    `${collection.clientCollection.filesSkipped} entries were skipped locally.`,
  );

  const request: ImpactRequest = {
    source: {
      logicalRoot: collection.logicalRoot,
      files: collection.files,
      clientCollection: collection.clientCollection,
    },
    options: {
      languages: [...SOURCE_LANGUAGES],
      includeGeneratedDirectories,
      additionalIgnorePatterns,
    },
  };
  const report = await new ImpactPlatformClient({
    apiUrl,
    projectId,
    projectToken,
    checkId,
    attempts,
    deadline,
  }).analyze(request);
  assertClientAccountingEcho(collection.clientCollection, report.metadata.clientCollection);
  const reportPath = await writePrivateReport(report, runnerTemp, workspace, deadline);

  const server = report.metadata.serverScan;
  const serverNumber = (key: string): string => String(typeof server[key] === 'number' ? server[key] : 0);
  github.setOutput('check-id', checkId);
  github.setOutput('overall-risk', report.overallRisk);
  github.setOutput('overall-potential-risk', report.overallPotentialRisk);
  github.setOutput('breaking-changes', String(report.breakingChanges));
  github.setOutput('affected-files', String(report.affectedFiles));
  github.setOutput('affected-source-locations', String(report.affectedSourceLocations));
  github.setOutput('files-scanned', serverNumber('filesScanned'));
  github.setOutput('files-skipped', serverNumber('filesSkipped'));
  github.setOutput('client-entries-visited', String(collection.clientCollection.entriesVisited));
  github.setOutput('client-files-discovered', String(collection.clientCollection.filesDiscovered));
  github.setOutput('client-files-submitted', String(collection.clientCollection.filesSubmitted));
  github.setOutput('client-files-skipped', String(collection.clientCollection.filesSkipped));
  github.setOutput('report-path', reportPath);
  github.setOutput('report-truncated', String(report.metadata.truncated));
  github.setOutput('analysis-fingerprint', report.analysisFingerprint);
  github.writeJobSummary(impactSummary(report));

  const detectedGate = shouldFailRisk(report.overallRisk, failOnRisk);
  const potentialGate = shouldFailRisk(report.overallPotentialRisk, failOnPotentialRisk);
  if (detectedGate || potentialGate) {
    const reasons = [
      detectedGate ? `detected risk ${report.overallRisk} met fail-on-risk ${failOnRisk}` : undefined,
      potentialGate ? `potential risk ${report.overallPotentialRisk} met fail-on-potential-risk ${failOnPotentialRisk}` : undefined,
    ].filter((value): value is string => value !== undefined);
    github.setFailed(`Alconite Impact gate failed: ${reasons.join('; ')}.`);
  } else {
    github.info(`Alconite Impact completed with detected risk ${report.overallRisk} and potential risk ${report.overallPotentialRisk}.`);
  }
}

void main().catch((error: unknown) => {
  if (error instanceof ImpactActionError || (error instanceof Error && error.name === 'ImpactContractError')) {
    github.setFailed(error.message);
    return;
  }
  github.setFailed('Alconite Impact failed with an unexpected internal error.');
});
