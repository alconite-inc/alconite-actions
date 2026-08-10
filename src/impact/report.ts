import { constants, promises as fs, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { ActionDeadline } from './deadline';
import { ImpactActionError } from './errors';
import { RISK_VALUES, type ImpactReport, type ImpactRisk } from './models';
import {
  assertDirectoryIdentity,
  isContained,
  sameIdentity,
  stableIdentity,
  verifyAbsoluteDirectory,
  type StableIdentity,
  type VerifiedDirectory,
} from './secure-filesystem';
import { markdownTable } from '../github';

export type RiskThreshold = 'never' | 'low' | 'medium' | 'high' | 'critical';

export interface ReportWriteHooks {
  afterFileCreated?: (filename: string) => Promise<void>;
}

export function parseRiskThreshold(value: string, name: string): RiskThreshold {
  const threshold = value.trim().toLowerCase();
  if (!['never', 'low', 'medium', 'high', 'critical'].includes(threshold)) {
    throw new ImpactActionError('invalid_input', `${name} must be one of: never, low, medium, high, critical.`);
  }
  return threshold as RiskThreshold;
}

export function shouldFailRisk(risk: ImpactRisk, threshold: RiskThreshold): boolean {
  if (threshold === 'never') return false;
  return RISK_VALUES.indexOf(risk) >= RISK_VALUES.indexOf(threshold.toUpperCase() as ImpactRisk);
}

function fileIdentity(stats: BigIntStats): StableIdentity {
  return stableIdentity(stats, 'report');
}

async function safeFailureCleanup(
  root: VerifiedDirectory,
  directory: VerifiedDirectory | undefined,
  filename: string | undefined,
  identity: StableIdentity | undefined,
): Promise<void> {
  try {
    await assertDirectoryIdentity(root, 'report');
    if (filename && identity) {
      const stats = await fs.lstat(filename, { bigint: true });
      if (stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1n && sameIdentity(identity, fileIdentity(stats))) {
        await fs.unlink(filename);
      }
    }
    if (directory) {
      await assertDirectoryIdentity(directory, 'report');
      if ((await fs.readdir(directory.path)).length === 0) await fs.rmdir(directory.path);
    }
  } catch {
    // Never broaden cleanup after an identity failure. The runner will remove RUNNER_TEMP.
  }
}

/** Persist a creation-only canonical report below a verified runner-owned temporary directory. */
export async function writePrivateReport(
  report: ImpactReport,
  runnerTemp: string,
  workspacePath: string,
  deadline: ActionDeadline,
  hooks: ReportWriteHooks = {},
): Promise<string> {
  deadline.throwIfExpired();
  // Node 24 does not expose Windows reparse attributes or portable ACL/mode verification. The
  // approved plan requires fail-closed behavior rather than silently weakening this boundary.
  if (process.platform === 'win32') {
    throw new ImpactActionError(
      'unsupported_secure_report_filesystem',
      'Secure Impact report creation is unavailable on this Windows Node filesystem; use a supported Linux runner.',
    );
  }
  const workspace = await verifyAbsoluteDirectory(path.resolve(workspacePath), 'source', deadline);
  const root = await verifyAbsoluteDirectory(path.resolve(runnerTemp), 'report', deadline);
  if (isContained(workspace.realPath, root.realPath)) {
    throw new ImpactActionError('unsupported_secure_report_filesystem', 'RUNNER_TEMP must resolve outside GITHUB_WORKSPACE.');
  }
  await assertDirectoryIdentity(root, 'report');
  const bytes = Buffer.from(`${JSON.stringify(report)}\n`, 'utf8');
  deadline.throwIfExpired();
  let directory: VerifiedDirectory | undefined;
  let filename: string | undefined;
  let createdIdentity: StableIdentity | undefined;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const createdPath = await fs.mkdtemp(path.join(root.path, 'alconite-impact-'));
    await fs.chmod(createdPath, 0o700);
    directory = await verifyAbsoluteDirectory(createdPath, 'report', deadline);
    const directoryStats = await fs.lstat(directory.path, { bigint: true });
    if ((Number(directoryStats.mode) & 0o777) !== 0o700 || !isContained(root.realPath, directory.realPath, false)) {
      throw new ImpactActionError('unsupported_secure_report_filesystem', 'The private Impact report directory failed mode or containment verification.');
    }
    await assertDirectoryIdentity(root, 'report');
    filename = path.join(directory.path, 'impact-report.json');
    if (typeof constants.O_NOFOLLOW !== 'number') {
      throw new ImpactActionError('unsupported_secure_report_filesystem', 'The runner does not expose O_NOFOLLOW for private report creation.');
    }
    handle = await fs.open(
      filename,
      constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
      0o600,
    );
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n) throw new ImpactActionError('report_write_failed', 'The private Impact report destination is not a regular private file.');
    createdIdentity = fileIdentity(opened);
    if ((Number(opened.mode) & 0o777) !== 0o600) {
      throw new ImpactActionError('unsupported_secure_report_filesystem', 'The private Impact report file mode could not be enforced.');
    }
    await hooks.afterFileCreated?.(filename);
    await handle.writeFile(bytes);
    await handle.sync();
    deadline.throwIfExpired();
    const afterWrite = await handle.stat({ bigint: true });
    if (!afterWrite.isFile() || afterWrite.nlink !== 1n || !sameIdentity(createdIdentity, fileIdentity(afterWrite)) || afterWrite.size !== BigInt(bytes.length)) {
      throw new ImpactActionError('report_write_failed', 'The private Impact report changed while it was written.');
    }
    await handle.close();
    handle = undefined;
    const pathStats = await fs.lstat(filename, { bigint: true });
    const finalPath = await fs.realpath(filename);
    if (
      !pathStats.isFile() || pathStats.isSymbolicLink() || pathStats.nlink !== 1n || !sameIdentity(createdIdentity, fileIdentity(pathStats)) ||
      !isContained(directory.realPath, finalPath, false)
    ) {
      throw new ImpactActionError('report_write_failed', 'The private Impact report failed final identity verification.');
    }
    await assertDirectoryIdentity(directory, 'report');
    await assertDirectoryIdentity(root, 'report');
    return filename;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await safeFailureCleanup(root, directory, filename, createdIdentity);
    if (error instanceof ImpactActionError) throw error;
    throw new ImpactActionError('report_write_failed', 'The private Impact report could not be created securely.', { cause: error });
  }
}

function serverCounter(report: ImpactReport, name: string): number {
  const value = report.metadata.serverScan[name];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function impactSummary(report: ImpactReport): string {
  const client = report.metadata.clientCollection;
  const lines = [
    '## Alconite Impact',
    '',
    markdownTable(
      ['Detected risk', 'Potential risk', 'Breaking changes', 'Affected files', 'Affected locations', 'Truncated'],
      [[
        report.overallRisk,
        report.overallPotentialRisk,
        report.breakingChanges,
        report.affectedFiles,
        report.affectedSourceLocations,
        report.metadata.truncated ? 'yes' : 'no',
      ]],
    ),
    '',
    '### Source accounting',
    '',
    markdownTable(
      ['Layer', 'Visited', 'Discovered', 'Submitted / accepted', 'Scanned', 'Skipped'],
      [
        [
          'Runner collection',
          typeof client?.entriesVisited === 'number' ? client.entriesVisited : '—',
          typeof client?.filesDiscovered === 'number' ? client.filesDiscovered : '—',
          typeof client?.filesSubmitted === 'number' ? client.filesSubmitted : '—',
          '—',
          typeof client?.filesSkipped === 'number' ? client.filesSkipped : '—',
        ],
        [
          'Authoritative server scan',
          '—',
          '—',
          serverCounter(report, 'filesAccepted'),
          serverCounter(report, 'filesScanned'),
          serverCounter(report, 'filesSkipped'),
        ],
      ],
    ),
    '',
  ];
  const locations = report.changes.flatMap((change) => change.affectedSources.map((source) => ({ change, source })));
  if (locations.length > 0) {
    lines.push(
      '### Strongest returned evidence',
      '',
      markdownTable(
        ['Change', 'Source', 'Confidence', 'Evidence'],
        locations.slice(0, 25).map(({ change, source }) => [
          change.kind,
          `${source.file}:${source.line}:${source.column}`,
          source.confidence,
          source.evidence.map((evidence) => `${evidence.type}=${evidence.value}`).join(', '),
        ]),
      ),
      '',
    );
    if (locations.length > 25) lines.push(`_Showing 25 of ${locations.length} returned affected locations._`, '');
  }
  if (report.metadata.truncated) {
    lines.push(
      `_${report.metadata.returnedAffectedSourceLocations} of ${report.metadata.totalAffectedSourceLocations} affected locations were returned by the bounded report profile._`,
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}
