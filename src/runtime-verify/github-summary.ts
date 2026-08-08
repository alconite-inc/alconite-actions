import type { RuntimeVerifyReport } from './report';
import { escapeMarkdown } from './redaction';

export function runtimeSummary(report: RuntimeVerifyReport, reportUrl: string): string {
  const byRule = new Map<string, number>();
  for (const item of report.findings) byRule.set(item.ruleId, (byRule.get(item.ruleId) ?? 0) + 1);
  const lines = [
    '## Alconite Runtime Verify', '',
    '| Result | Value |', '| --- | --- |',
    `| Runtime Verify status | ${escapeMarkdown(report.status)} |`,
    `| Gate result | ${escapeMarkdown(report.gateResult)} |`,
    `| Environment ID | ${escapeMarkdown(report.environmentId)} |`,
    `| Contract Guard check ID | ${escapeMarkdown(report.contractGuardCheckId)} |`,
    `| Run ID | ${escapeMarkdown(report.runId)} |`,
    `| Contract hash match | ${report.contract.hashMatched ? 'yes' : 'no'} |`,
    `| Configured operations | ${report.summary.configuredOperations} |`,
    `| Executed operations | ${report.summary.executedOperations} |`,
    `| Passed operations | ${report.summary.passedOperations} |`,
    `| Failed operations | ${report.summary.failedOperations} |`,
    `| Warning operations | ${report.summary.warningOperations} |`,
    `| Findings | ${report.findings.length} |`,
    `| Canonical report | [Open in Alconite](${escapeMarkdown(reportUrl)}) |`, ''
  ];
  if (byRule.size > 0) {
    lines.push('### Finding counts', '', '| Rule | Count |', '| --- | ---: |');
    for (const [rule, count] of [...byRule.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`| ${escapeMarkdown(rule)} | ${count} |`);
    }
    lines.push('');
  }
  if (report.findings.length > 0) {
    lines.push('### Findings', '', '| Operation | Rule | Summary | Location |', '| --- | --- | --- | --- |');
    for (const item of report.findings.slice(0, 25)) {
      lines.push(`| ${escapeMarkdown(item.operationId ?? 'Contract')} | ${escapeMarkdown(item.ruleId)} | ${escapeMarkdown(item.summary)} | ${escapeMarkdown(item.location ?? '—')} |`);
    }
    if (report.findings.length > 25) lines.push('', `_Showing 25 of ${report.findings.length} findings. Download the canonical report for the complete bounded result._`);
  }
  return `${lines.join('\n')}\n`;
}
