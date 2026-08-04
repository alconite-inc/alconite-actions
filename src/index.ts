import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as github from './github';
import {
  canonicalReportUrl,
  createDefaultIdempotencyKey,
  parseBoundedInteger,
  parseFailOn,
  readCandidate,
  runCheck,
  shouldFailGate,
  validateApiUrl,
  validateDisplayName,
  validateIdempotencyKey,
  validateProjectId,
  validateProjectToken,
  type ContractGuardReport,
} from './contract-guard';

function reportDestination(requestedPath: string, checkId: string): string {
  if (requestedPath.trim()) return path.resolve(requestedPath.trim());
  return path.join(process.env.RUNNER_TEMP || os.tmpdir(), `contract-guard-${checkId}.json`);
}

async function writeSummary(report: ContractGuardReport, reportUrl: string, reportPath: string): Promise<void> {
  const gateLabel = report.gateResult.replaceAll('_', ' ');
  let markdown = `## Alconite Contract Guard\n\n**Gate:** ${gateLabel}\n\n`;
  markdown += `${github.markdownTable(
    ['Breaking', 'Risky', 'Non-breaking', 'Informational', 'Policy failures', 'Policy warnings'],
    [[
      report.summary.breaking,
      report.summary.risky,
      report.summary.nonBreaking,
      report.summary.informational,
      report.summary.policyFailures,
      report.summary.policyWarnings,
    ]],
  )}\n\n`;
  markdown += `[Open the canonical report](${reportUrl}) · Local JSON: \`${reportPath}\`\n`;

  if (report.violations.length > 0) {
    const rows = report.violations.slice(0, 50).map((violation) => [violation.severity, violation.code, violation.message]);
    markdown += `\n### Policy findings\n\n${github.markdownTable(['Severity', 'Code', 'Message'], rows)}\n`;
  }
  github.writeJobSummary(markdown);
}

function annotateViolations(report: ContractGuardReport): void {
  for (const violation of report.violations.slice(0, 25)) {
    const title = `Contract Guard: ${violation.code}`;
    if (violation.severity === 'failure') github.error(violation.message, title);
    else github.warning(violation.message, title);
  }
  if (report.violations.length > 25) {
    github.notice(`${report.violations.length - 25} additional policy findings are available in the Contract Guard report.`);
  }
}

async function main(): Promise<void> {
  const projectId = validateProjectId(github.getInput('project-id', { required: true }));
  const projectToken = validateProjectToken(github.getInput('project-token', { required: true }));
  github.setSecret(projectToken);

  const apiUrl = validateApiUrl(github.getInput('api-url'));
  const candidate = await readCandidate(github.getInput('candidate-path'), process.env.GITHUB_WORKSPACE);
  const displayNameInput = validateDisplayName(github.getInput('display-name'));
  const displayName = (
    displayNameInput ||
    `${process.env.GITHUB_REPOSITORY || 'local'}@${process.env.GITHUB_REF_NAME || 'unknown'} (${(process.env.GITHUB_SHA || candidate.sha256).slice(0, 12)})`
  ).slice(0, 160);
  const idempotencyInput = github.getInput('idempotency-key');
  const idempotencyKey = idempotencyInput
    ? validateIdempotencyKey(idempotencyInput)
    : createDefaultIdempotencyKey({
        repositoryId: process.env.GITHUB_REPOSITORY_ID,
        repository: process.env.GITHUB_REPOSITORY,
        runId: process.env.GITHUB_RUN_ID,
        projectId,
        candidateHash: candidate.sha256,
      });
  const timeoutMs = parseBoundedInteger(github.getInput('timeout-seconds'), 'timeout-seconds', 1, 600) * 1_000;
  const attempts = parseBoundedInteger(github.getInput('retry-attempts'), 'retry-attempts', 1, 5);
  const failOn = parseFailOn(github.getInput('fail-on'));

  github.info(`Submitting ${candidate.filename} (${candidate.bytes.length} bytes) to Contract Guard project ${projectId}.`);
  const report = await runCheck({
    apiUrl,
    projectId,
    projectToken,
    candidate,
    displayName,
    idempotencyKey,
    timeoutMs,
    attempts,
  });

  const reportUrl = canonicalReportUrl(apiUrl, report);
  const outputPath = reportDestination(github.getInput('report-path'), report.checkId);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

  github.setOutput('check-id', report.checkId);
  github.setOutput('project-id', report.projectId);
  github.setOutput('status', report.status);
  github.setOutput('gate-result', report.gateResult);
  github.setOutput('report-url', reportUrl);
  github.setOutput('report-path', outputPath);
  github.setOutput('baseline-content-hash', report.baselineContentHash);
  github.setOutput('candidate-content-hash', report.candidateContentHash);
  github.setOutput('uploaded-content-hash', candidate.sha256);
  github.setOutput('breaking-changes', String(report.summary.breaking));
  github.setOutput('risky-changes', String(report.summary.risky));
  github.setOutput('policy-failures', String(report.summary.policyFailures));
  github.setOutput('policy-warnings', String(report.summary.policyWarnings));

  annotateViolations(report);
  await writeSummary(report, reportUrl, outputPath);

  if (shouldFailGate(report.gateResult, failOn)) {
    github.setFailed(`Contract Guard release gate ${report.gateResult}. Report: ${reportUrl}`);
  } else {
    github.info(`Contract Guard release gate ${report.gateResult}. Report: ${reportUrl}`);
  }
}

main().catch((error: unknown) => {
  github.setFailed(error instanceof Error ? error.message : 'Contract Guard action failed with an unknown error');
});
