"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const github = __importStar(require("./github"));
const contract_guard_1 = require("./contract-guard");
function reportDestination(requestedPath, checkId) {
    if (requestedPath.trim())
        return node_path_1.default.resolve(requestedPath.trim());
    return node_path_1.default.join(process.env.RUNNER_TEMP || node_os_1.default.tmpdir(), `contract-guard-${checkId}.json`);
}
async function writeSummary(report, reportUrl, reportPath) {
    const gateLabel = report.gateResult.replaceAll('_', ' ');
    let markdown = `## Alconite Contract Guard\n\n**Gate:** ${gateLabel}\n\n`;
    markdown += `${github.markdownTable(['Breaking', 'Risky', 'Non-breaking', 'Informational', 'Policy failures', 'Policy warnings'], [[
            report.summary.breaking,
            report.summary.risky,
            report.summary.nonBreaking,
            report.summary.informational,
            report.summary.policyFailures,
            report.summary.policyWarnings,
        ]])}\n\n`;
    markdown += `[Open the canonical report](${reportUrl}) · Local JSON: \`${reportPath}\`\n`;
    if (report.violations.length > 0) {
        const rows = report.violations.slice(0, 50).map((violation) => [violation.severity, violation.code, violation.message]);
        markdown += `\n### Policy findings\n\n${github.markdownTable(['Severity', 'Code', 'Message'], rows)}\n`;
    }
    github.writeJobSummary(markdown);
}
function annotateViolations(report) {
    for (const violation of report.violations.slice(0, 25)) {
        const title = `Contract Guard: ${violation.code}`;
        if (violation.severity === 'failure')
            github.error(violation.message, title);
        else
            github.warning(violation.message, title);
    }
    if (report.violations.length > 25) {
        github.notice(`${report.violations.length - 25} additional policy findings are available in the Contract Guard report.`);
    }
}
async function main() {
    const projectId = (0, contract_guard_1.validateProjectId)(github.getInput('project-id', { required: true }));
    const projectToken = (0, contract_guard_1.validateProjectToken)(github.getInput('project-token', { required: true }));
    github.setSecret(projectToken);
    const apiUrl = (0, contract_guard_1.validateApiUrl)(github.getInput('api-url'));
    const candidate = await (0, contract_guard_1.readCandidate)(github.getInput('candidate-path'), process.env.GITHUB_WORKSPACE);
    const displayNameInput = (0, contract_guard_1.validateDisplayName)(github.getInput('display-name'));
    const displayName = (displayNameInput ||
        `${process.env.GITHUB_REPOSITORY || 'local'}@${process.env.GITHUB_REF_NAME || 'unknown'} (${(process.env.GITHUB_SHA || candidate.sha256).slice(0, 12)})`).slice(0, 160);
    const idempotencyInput = github.getInput('idempotency-key');
    const idempotencyKey = idempotencyInput
        ? (0, contract_guard_1.validateIdempotencyKey)(idempotencyInput)
        : (0, contract_guard_1.createDefaultIdempotencyKey)({
            repositoryId: process.env.GITHUB_REPOSITORY_ID,
            repository: process.env.GITHUB_REPOSITORY,
            runId: process.env.GITHUB_RUN_ID,
            projectId,
            candidateHash: candidate.sha256,
        });
    const timeoutMs = (0, contract_guard_1.parseBoundedInteger)(github.getInput('timeout-seconds'), 'timeout-seconds', 1, 600) * 1_000;
    const attempts = (0, contract_guard_1.parseBoundedInteger)(github.getInput('retry-attempts'), 'retry-attempts', 1, 5);
    const failOn = (0, contract_guard_1.parseFailOn)(github.getInput('fail-on'));
    github.info(`Submitting ${candidate.filename} (${candidate.bytes.length} bytes) to Contract Guard project ${projectId}.`);
    const report = await (0, contract_guard_1.runCheck)({
        apiUrl,
        projectId,
        projectToken,
        candidate,
        displayName,
        idempotencyKey,
        timeoutMs,
        attempts,
    });
    const reportUrl = (0, contract_guard_1.canonicalReportUrl)(apiUrl, report);
    const outputPath = reportDestination(github.getInput('report-path'), report.checkId);
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(outputPath), { recursive: true });
    await node_fs_1.promises.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
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
    if ((0, contract_guard_1.shouldFailGate)(report.gateResult, failOn)) {
        github.setFailed(`Contract Guard release gate ${report.gateResult}. Report: ${reportUrl}`);
    }
    else {
        github.info(`Contract Guard release gate ${report.gateResult}. Report: ${reportUrl}`);
    }
}
main().catch((error) => {
    github.setFailed(error instanceof Error ? error.message : 'Contract Guard action failed with an unknown error');
});
//# sourceMappingURL=index.js.map