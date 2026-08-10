import { constants, promises as fs, type BigIntStats, type Dirent } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { ActionDeadline } from './deadline';
import { ImpactActionError } from './errors';

export interface StableIdentity {
  dev: bigint;
  ino: bigint;
  mode: bigint;
  nlink: bigint;
  ctimeNs: bigint;
}

export interface VerifiedDirectory {
  path: string;
  realPath: string;
  identity: StableIdentity;
}

export interface SourceRaceHooks {
  beforeDirectoryRead?: (directory: string) => Promise<void>;
  beforeFileOpen?: (filename: string) => Promise<void>;
  afterFileRead?: (filename: string) => Promise<void>;
}

export interface VerifiedFile {
  bytes: Buffer;
  identity: StableIdentity;
  size: number;
}

function sourceUnsupported(message: string): never {
  throw new ImpactActionError('unsupported_secure_source_filesystem', message);
}

export function stableIdentity(stats: BigIntStats, purpose: 'source' | 'report' = 'source'): StableIdentity {
  if (stats.ino <= 0n || stats.dev < 0n) {
    const code = purpose === 'report' ? 'unsupported_secure_report_filesystem' : 'unsupported_secure_source_filesystem';
    throw new ImpactActionError(code, `The runner filesystem does not expose stable identity required for secure ${purpose} handling.`);
  }
  return { dev: stats.dev, ino: stats.ino, mode: stats.mode, nlink: stats.nlink, ctimeNs: stats.ctimeNs };
}

export function sameIdentity(left: StableIdentity, right: StableIdentity): boolean {
  return sameFilesystemObject(left, right) && left.ctimeNs === right.ctimeNs;
}

export function sameFilesystemObject(left: StableIdentity, right: StableIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value;
  return normalize(path.normalize(left)) === normalize(path.normalize(right));
}

export function isContained(parent: string, child: string, allowEqual = true): boolean {
  const relative = path.relative(parent, child);
  if (relative === '') return allowEqual;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function lstatBigInt(filename: string): Promise<BigIntStats> {
  return fs.lstat(filename, { bigint: true });
}

/** Validate every existing component and reject all symlink/junction components before trusting a root. */
export async function verifyAbsoluteDirectory(
  requested: string,
  purpose: 'source' | 'report',
  deadline: ActionDeadline,
): Promise<VerifiedDirectory> {
  deadline.throwIfExpired();
  if (!path.isAbsolute(requested)) {
    const code = purpose === 'report' ? 'unsupported_secure_report_filesystem' : 'unsupported_secure_source_filesystem';
    throw new ImpactActionError(code, `The ${purpose} root must be an absolute existing directory.`);
  }
  const resolved = path.resolve(requested);
  const parsed = path.parse(resolved);
  const components = path.relative(parsed.root, resolved).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const component of components) {
    deadline.throwIfExpired();
    current = path.join(current, component);
    const stats = await lstatBigInt(current).catch((error: unknown) => {
      const code = purpose === 'report' ? 'unsupported_secure_report_filesystem' : 'unsupported_secure_source_filesystem';
      throw new ImpactActionError(code, `The ${purpose} root is not an accessible existing directory.`, { cause: error });
    });
    if (stats.isSymbolicLink()) {
      const code = purpose === 'report' ? 'unsupported_secure_report_filesystem' : 'unsupported_secure_source_filesystem';
      throw new ImpactActionError(code, `The ${purpose} root contains a symbolic link or junction component.`);
    }
  }
  const before = await lstatBigInt(resolved);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    const code = purpose === 'report' ? 'unsupported_secure_report_filesystem' : 'unsupported_secure_source_filesystem';
    throw new ImpactActionError(code, `The ${purpose} root must be a non-link directory.`);
  }
  const identity = stableIdentity(before, purpose);
  const realPath = await fs.realpath(resolved);
  const after = await lstatBigInt(resolved);
  if (!sameIdentity(identity, stableIdentity(after, purpose)) || !after.isDirectory() || !samePath(realPath, await fs.realpath(resolved))) {
    throw new ImpactActionError(
      purpose === 'report' ? 'unsupported_secure_report_filesystem' : 'source_race_detected',
      `The ${purpose} root changed while its identity was being established.`,
    );
  }
  return { path: resolved, realPath, identity };
}

export async function assertDirectoryIdentity(directory: VerifiedDirectory, purpose: 'source' | 'report'): Promise<void> {
  const stats = await lstatBigInt(directory.path);
  const realPath = await fs.realpath(directory.path);
  const current = stableIdentity(stats, purpose);
  const unchanged = purpose === 'report'
    ? sameFilesystemObject(directory.identity, current)
    : sameIdentity(directory.identity, current);
  if (!stats.isDirectory() || stats.isSymbolicLink() || !unchanged || !samePath(realPath, directory.realPath)) {
    throw new ImpactActionError(
      purpose === 'report' ? 'unsupported_secure_report_filesystem' : 'source_race_detected',
      `The verified ${purpose} root changed during the operation.`,
    );
  }
}

function noFollowFlags(directory = false): number {
  const noFollow = constants.O_NOFOLLOW;
  if (process.platform !== 'win32' && typeof noFollow !== 'number') sourceUnsupported('The runner does not expose O_NOFOLLOW.');
  let flags = constants.O_RDONLY | (typeof noFollow === 'number' ? noFollow : 0);
  if (directory && typeof constants.O_DIRECTORY === 'number') flags |= constants.O_DIRECTORY;
  return flags;
}

async function openVerifiedDirectoryHandle(directory: string, before: StableIdentity): Promise<FileHandle | undefined> {
  // Windows Node does not expose O_DIRECTORY and normally refuses regular directory handles. The
  // pre/readdir/post identity and final-path checks below are the strongest portable primitive there.
  if (process.platform === 'win32') return undefined;
  const handle = await fs.open(directory, noFollowFlags(true));
  const opened = await handle.stat({ bigint: true });
  if (!opened.isDirectory() || !sameIdentity(before, stableIdentity(opened))) {
    await handle.close().catch(() => undefined);
    throw new ImpactActionError('source_race_detected', 'A source directory changed before it could be opened securely.');
  }
  return handle;
}

export async function readVerifiedDirectory(
  directory: string,
  workspace: VerifiedDirectory,
  deadline: ActionDeadline,
  hooks: SourceRaceHooks = {},
  maximumEntries = Number.MAX_SAFE_INTEGER,
): Promise<Dirent[]> {
  deadline.throwIfExpired();
  await assertDirectoryIdentity(workspace, 'source');
  const beforeStats = await lstatBigInt(directory);
  if (!beforeStats.isDirectory() || beforeStats.isSymbolicLink()) {
    throw new ImpactActionError('source_race_detected', 'A source directory is a link or is not a directory.');
  }
  const before = stableIdentity(beforeStats);
  const beforeReal = await fs.realpath(directory);
  if (!isContained(workspace.realPath, beforeReal)) {
    throw new ImpactActionError('source_race_detected', 'A source directory resolved outside the workspace.');
  }
  await hooks.beforeDirectoryRead?.(directory);
  let handle: FileHandle | undefined;
  try {
    handle = await openVerifiedDirectoryHandle(directory, before);
    const entries: Dirent[] = [];
    // On Linux, enumerate through the already verified descriptor instead of ambiently reopening
    // the raced pathname. Windows Node exposes no directory descriptor primitive, so it uses the
    // documented pre/opendir/post identity and final-path fail-closed checks.
    const enumerationPath = handle ? `/proc/self/fd/${handle.fd}` : directory;
    const openedDirectory = await fs.opendir(enumerationPath).catch((error: unknown) => {
      if (handle) sourceUnsupported('The Linux runner does not expose descriptor-relative directory enumeration through /proc/self/fd.');
      throw error;
    });
    try {
      for await (const entry of openedDirectory) {
        if (entries.length >= maximumEntries) {
          throw new ImpactActionError('collection_limit_exceeded', 'Source collection exceeded the entry-visit limit.');
        }
        entries.push(entry);
      }
    } finally {
      await openedDirectory.close().catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ERR_DIR_CLOSED') throw error;
      });
    }
    const afterStats = await lstatBigInt(directory);
    const afterReal = await fs.realpath(directory);
    const handleStats = handle ? await handle.stat({ bigint: true }) : afterStats;
    if (
      !afterStats.isDirectory() || afterStats.isSymbolicLink() ||
      !sameIdentity(before, stableIdentity(afterStats)) ||
      !sameIdentity(before, stableIdentity(handleStats)) ||
      !samePath(beforeReal, afterReal) || !isContained(workspace.realPath, afterReal)
    ) {
      throw new ImpactActionError('source_race_detected', 'A source directory changed during enumeration.');
    }
    return entries.sort((left, right) => Buffer.compare(Buffer.from(left.name, 'utf8'), Buffer.from(right.name, 'utf8')));
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function readVerifiedFile(
  filename: string,
  workspace: VerifiedDirectory,
  maximumBytes: number,
  deadline: ActionDeadline,
  hooks: SourceRaceHooks = {},
): Promise<VerifiedFile> {
  deadline.throwIfExpired();
  await assertDirectoryIdentity(workspace, 'source');
  const beforeStats = await lstatBigInt(filename);
  if (!beforeStats.isFile() || beforeStats.isSymbolicLink() || beforeStats.nlink !== 1n) {
    throw new ImpactActionError('source_race_detected', 'A selected source entry is a link or is not a regular file.');
  }
  const before = stableIdentity(beforeStats);
  const beforeSize = Number(beforeStats.size);
  if (!Number.isSafeInteger(beforeSize) || beforeSize < 0) sourceUnsupported('The runner returned an unsupported file size.');
  const beforeReal = await fs.realpath(filename);
  if (!isContained(workspace.realPath, beforeReal)) {
    throw new ImpactActionError('source_race_detected', 'A selected source file resolved outside the workspace.');
  }
  await hooks.beforeFileOpen?.(filename);
  const handle = await fs.open(filename, noFollowFlags(false)).catch((error: unknown) => {
    throw new ImpactActionError('source_file_read_failed', 'A selected source file could not be opened securely.', { cause: error });
  });
  try {
    const openedStats = await handle.stat({ bigint: true });
    if (!openedStats.isFile() || openedStats.nlink !== 1n || !sameIdentity(before, stableIdentity(openedStats))) {
      throw new ImpactActionError('source_race_detected', 'A selected source file changed before it was opened.');
    }
    const allocation = Math.min(maximumBytes + 1, Math.max(1, beforeSize + 1));
    const buffer = Buffer.allocUnsafe(allocation);
    let total = 0;
    while (total < buffer.length) {
      deadline.throwIfExpired();
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    await hooks.afterFileRead?.(filename);
    const openedAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstatBigInt(filename);
    const afterReal = await fs.realpath(filename);
    if (
      !openedAfter.isFile() || !pathAfter.isFile() || pathAfter.isSymbolicLink() || openedAfter.nlink !== 1n || pathAfter.nlink !== 1n ||
      !sameIdentity(before, stableIdentity(openedAfter)) || !sameIdentity(before, stableIdentity(pathAfter)) ||
      openedAfter.size !== beforeStats.size || pathAfter.size !== beforeStats.size || total !== beforeSize ||
      !samePath(beforeReal, afterReal) || !isContained(workspace.realPath, afterReal)
    ) {
      throw new ImpactActionError('source_race_detected', 'A selected source file changed while it was read.');
    }
    return { bytes: buffer.subarray(0, total), identity: before, size: total };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function inspectEntry(filename: string): Promise<BigIntStats> {
  return lstatBigInt(filename);
}
