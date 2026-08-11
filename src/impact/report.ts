import { constants, promises as fs, type BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { ActionDeadline } from './deadline';
import { ImpactActionError } from './errors';
import { RISK_VALUES, type ImpactReport, type ImpactRisk } from './models';
import {
  assertDirectoryIdentity,
  isContained,
  sameDirectoryObject,
  sameFilesystemObject,
  sameIdentity,
  samePath,
  stableIdentity,
  verifyAbsoluteDirectory,
  type RootVerificationHooks,
  type StableIdentity,
  type VerifiedDirectory,
} from './secure-filesystem';
import { markdownTable } from '../github';

export type RiskThreshold = 'never' | 'low' | 'medium' | 'high' | 'critical';

export interface ReportWriteHooks extends RootVerificationHooks {
  afterDirectoryNameCreated?: (directory: string) => Promise<void>;
  afterDirectoryCreated?: (directory: string) => Promise<void>;
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

async function scrubFailedReport(handle: FileHandle | undefined): Promise<void> {
  if (!handle) return;
  try {
    // Node does not expose identity-bound unlinkat/rmdirat. Scrub only through the still-open
    // descriptor and leave the private invocation directory for runner cleanup; a raced pathname
    // must never cause this Action to delete an attacker's replacement object.
    await handle.truncate(0);
    await handle.sync();
  } catch {
    // Failure is already terminal and the descriptor will be closed. Never fall back to path cleanup.
  }
}

function reportDirectoryFlags(): number {
  if (process.platform !== 'linux' || typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_DIRECTORY !== 'number') {
    throw new ImpactActionError(
      'unsupported_secure_report_filesystem',
      'Secure Impact report creation requires Linux descriptor-relative no-follow filesystem support.',
    );
  }
  return constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY;
}

function descriptorPath(handle: FileHandle): string {
  return `/proc/self/fd/${handle.fd}`;
}

function descriptorChild(handle: FileHandle, child: string): string {
  return `${descriptorPath(handle)}/${child}`;
}

async function assertReportDirectoryHandle(handle: FileHandle, identity: StableIdentity, label: string): Promise<void> {
  const stats = await handle.stat({ bigint: true });
  if (!stats.isDirectory() || !sameDirectoryObject(identity, fileIdentity(stats))) {
    throw new ImpactActionError('unsupported_secure_report_filesystem', `The verified ${label} changed during report creation.`);
  }
}

async function openReportDirectory(directory: VerifiedDirectory, label: string): Promise<FileHandle> {
  let handle: FileHandle;
  try {
    handle = await fs.open(directory.path, reportDirectoryFlags());
  } catch (error) {
    throw new ImpactActionError(
      'unsupported_secure_report_filesystem',
      `The ${label} could not be opened with descriptor-relative no-follow semantics.`,
      { cause: error },
    );
  }
  try {
    await assertReportDirectoryHandle(handle, directory.identity, label);
    const throughDescriptor = await fs.stat(descriptorPath(handle), { bigint: true });
    if (!throughDescriptor.isDirectory() ||
        !sameDirectoryObject(directory.identity, fileIdentity(throughDescriptor))) {
      throw new ImpactActionError(
        'unsupported_secure_report_filesystem',
        `The ${label} cannot be addressed safely through /proc/self/fd.`,
      );
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function assertBoundReportDirectory(
  root: VerifiedDirectory,
  rootHandle: FileHandle,
  directory: VerifiedDirectory,
  directoryHandle: FileHandle,
): Promise<void> {
  await assertReportDirectoryHandle(rootHandle, root.identity, 'runner temporary root');
  await assertDirectoryIdentity(root, 'report');
  await assertReportDirectoryHandle(directoryHandle, directory.identity, 'private report directory');
  await assertDirectoryIdentity(directory, 'report');
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
  reportDirectoryFlags();
  const workspace = await verifyAbsoluteDirectory(workspacePath, 'source', deadline, hooks);
  const root = await verifyAbsoluteDirectory(runnerTemp, 'report', deadline, hooks);
  if (isContained(workspace.realPath, root.realPath)) {
    throw new ImpactActionError('unsupported_secure_report_filesystem', 'RUNNER_TEMP must resolve outside GITHUB_WORKSPACE.');
  }
  await assertDirectoryIdentity(root, 'report');
  const bytes = Buffer.from(`${JSON.stringify(report)}\n`, 'utf8');
  deadline.throwIfExpired();
  let directory: VerifiedDirectory | undefined;
  let filename: string | undefined;
  let anchoredFilename: string | undefined;
  let createdIdentity: StableIdentity | undefined;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let rootHandle: FileHandle | undefined;
  let directoryHandle: FileHandle | undefined;
  try {
    rootHandle = await openReportDirectory(root, 'runner temporary root');
    const createdDescriptorPath = await fs.mkdtemp(descriptorChild(rootHandle, 'alconite-impact-')).catch((error: unknown) => {
      throw new ImpactActionError(
        'unsupported_secure_report_filesystem',
        'The runner does not support descriptor-anchored private directory creation through /proc/self/fd.',
        { cause: error },
      );
    });
    const directoryName = path.basename(createdDescriptorPath);
    const createdPath = path.join(root.path, directoryName);
    const descriptorStats = await fs.lstat(createdDescriptorPath, { bigint: true });
    if (!descriptorStats.isDirectory() || descriptorStats.isSymbolicLink()) {
      throw new ImpactActionError('unsupported_secure_report_filesystem', 'The private Impact report directory is not a regular directory.');
    }
    const provisionalDirectory = {
      path: createdDescriptorPath,
      realPath: createdDescriptorPath,
      identity: fileIdentity(descriptorStats),
    };
    await hooks.afterDirectoryNameCreated?.(createdPath);
    directoryHandle = await openReportDirectory(provisionalDirectory, 'private report directory');
    await directoryHandle.chmod(0o700);
    const securedStats = await directoryHandle.stat({ bigint: true });
    const childIdentity = fileIdentity(securedStats);
    const descriptorRealPath = await fs.realpath(descriptorPath(directoryHandle));
    const ambientStats = await fs.lstat(createdPath, { bigint: true });
    const ambientRealPath = await fs.realpath(createdPath);
    if (!ambientStats.isDirectory() || ambientStats.isSymbolicLink() ||
        !sameDirectoryObject(childIdentity, fileIdentity(ambientStats)) ||
        (Number(securedStats.mode) & 0o777) !== 0o700 || !samePath(descriptorRealPath, ambientRealPath)) {
      throw new ImpactActionError('unsupported_secure_report_filesystem', 'The private Impact report directory path changed during creation.');
    }
    directory = { path: createdPath, realPath: descriptorRealPath, identity: childIdentity };
    if (!isContained(root.realPath, directory.realPath, false)) {
      throw new ImpactActionError('unsupported_secure_report_filesystem', 'The private Impact report directory failed mode or containment verification.');
    }
    await assertBoundReportDirectory(root, rootHandle, directory, directoryHandle);
    await hooks.afterDirectoryCreated?.(directory.path);
    await assertBoundReportDirectory(root, rootHandle, directory, directoryHandle);
    filename = path.join(directory.path, 'impact-report.json');
    anchoredFilename = descriptorChild(directoryHandle, 'impact-report.json');
    handle = await fs.open(
      anchoredFilename,
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
    await assertBoundReportDirectory(root, rootHandle, directory, directoryHandle);
    const anchoredBeforeWrite = await fs.lstat(anchoredFilename, { bigint: true });
    if (!anchoredBeforeWrite.isFile() || anchoredBeforeWrite.isSymbolicLink() || anchoredBeforeWrite.nlink !== 1n ||
        !sameIdentity(createdIdentity, fileIdentity(anchoredBeforeWrite))) {
      throw new ImpactActionError('report_write_failed', 'The private Impact report path changed before it was written.');
    }
    await handle.writeFile(bytes);
    await handle.sync();
    deadline.throwIfExpired();
    const afterWrite = await handle.stat({ bigint: true });
    const afterWriteIdentity = fileIdentity(afterWrite);
    if (!afterWrite.isFile() || afterWrite.nlink !== 1n || !sameFilesystemObject(createdIdentity, afterWriteIdentity) || afterWrite.size !== BigInt(bytes.length)) {
      throw new ImpactActionError('report_write_failed', 'The private Impact report changed while it was written.');
    }
    createdIdentity = afterWriteIdentity;
    const anchoredStats = await fs.lstat(anchoredFilename, { bigint: true });
    const pathStats = await fs.lstat(filename, { bigint: true });
    const finalPath = await fs.realpath(filename);
    if (
      !anchoredStats.isFile() || anchoredStats.isSymbolicLink() || anchoredStats.nlink !== 1n ||
      !sameIdentity(createdIdentity, fileIdentity(anchoredStats)) ||
      !pathStats.isFile() || pathStats.isSymbolicLink() || pathStats.nlink !== 1n || !sameIdentity(createdIdentity, fileIdentity(pathStats)) ||
      !isContained(directory.realPath, finalPath, false)
    ) {
      throw new ImpactActionError('report_write_failed', 'The private Impact report failed final identity verification.');
    }
    await assertBoundReportDirectory(root, rootHandle, directory, directoryHandle);
    await handle.close();
    handle = undefined;
    return filename;
  } catch (error) {
    await scrubFailedReport(handle);
    await handle?.close().catch(() => undefined);
    handle = undefined;
    if (error instanceof ImpactActionError) throw error;
    throw new ImpactActionError('report_write_failed', 'The private Impact report could not be created securely.', { cause: error });
  } finally {
    await directoryHandle?.close().catch(() => undefined);
    await rootHandle?.close().catch(() => undefined);
  }
}

function serverCounter(report: ImpactReport, name: string): number {
  const value = report.metadata.serverScan[name];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

const MARKDOWN_ACTIVE_PUNCTUATION = new Set([
  '\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '"', '$', '%', "'", ',', '/', ':',
  ';', '=', '?', '@', '^', '~',
]);

function markdownLiteral(value: string): string {
  return [...value].map((character) => MARKDOWN_ACTIVE_PUNCTUATION.has(character) ? `\\${character}` : character).join('');
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
        ['Change', 'Source', 'Confidence', 'Basis', 'Evidence'],
        locations.slice(0, 25).map(({ change, source }) => [
          change.kind,
          markdownLiteral(`${source.file}:${source.line}:${source.column}`),
          source.confidence,
          change.confidenceBasis.conditions.join(', '),
          source.evidence.map((evidence) => `${evidence.type}=${markdownLiteral(evidence.value)}`).join(', '),
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
