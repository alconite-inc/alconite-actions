import { readSync, type Stats } from 'node:fs';

const OUTPUTS: Record<string, ReadonlySet<string>> = {
  'contract-guard': new Set(['check-id', 'project-id', 'status', 'gate-result', 'report-url', 'report-path', 'baseline-content-hash', 'candidate-content-hash', 'uploaded-content-hash', 'breaking-changes', 'risky-changes', 'policy-failures', 'policy-warnings']),
  impact: new Set(['check-id', 'overall-risk', 'overall-potential-risk', 'breaking-changes', 'affected-files', 'affected-source-locations', 'files-scanned', 'files-skipped', 'client-entries-visited', 'client-files-discovered', 'client-files-submitted', 'client-files-skipped', 'report-path', 'report-truncated', 'analysis-fingerprint']),
  'runtime-verify': new Set(['run-id', 'project-id', 'environment-id', 'check-id', 'deployment-id', 'status', 'gate-result', 'report-url', 'report-path', 'contract-content-hash', 'configured-operations', 'executed-operations', 'passed-operations', 'failed-operations', 'warning-operations', 'finding-count', 'replayed']),
};

export function readPortableOutputs(command: string, descriptor: number, stats: Stats): Record<string, string> {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > 1024 * 1024 || (stats.mode & 0o777) !== 0o600) {
    throw new Error('Portable output file failed its identity, mode, or size check.');
  }
  const buffer = Buffer.alloc(stats.size);
  let offset = 0;
  while (offset < buffer.length) {
    const count = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  const text = buffer.subarray(0, offset).toString('utf8');
  const allowed = OUTPUTS[command];
  if (!allowed) throw new Error('Portable output command is invalid.');
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line) continue;
    let record: unknown;
    try { record = JSON.parse(line); } catch { throw new Error('Portable output channel contains invalid JSON.'); }
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Portable output record is invalid.');
    const keys = Object.keys(record);
    const value = record as { name?: unknown; value?: unknown };
    if (keys.length !== 2 || !keys.includes('name') || !keys.includes('value') || typeof value.name !== 'string' || typeof value.value !== 'string') {
      throw new Error('Portable output record has an invalid grammar.');
    }
    if (!allowed.has(value.name) || value.name.length > 80 || value.value.length > 262_144) throw new Error('Portable output record exceeds its contract.');
    if (Object.hasOwn(result, value.name)) throw new Error(`Portable output ${value.name} was emitted more than once.`);
    result[value.name] = value.value;
  }
  return result;
}
