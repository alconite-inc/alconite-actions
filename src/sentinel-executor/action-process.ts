import { spawn } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  writeSync,
  type Stats,
} from 'node:fs';
import path from 'node:path';
import { validateReportsRelativePath, type ParsedExecution, type SentinelCommand } from './arguments';
import { readPortableOutputs } from './output';

export interface ExecutionRoots { workspace: string; reports: string; temporary: string; actionRoot: string; }
export interface ExecutionResult { command: SentinelCommand; exitCode: 0 | 1; outputs: Record<string, string>; }
export interface RunActionHooks { beforeReportPersist?: (destination: string) => Promise<void> | void; }

interface ReportDestination {
  destination: string;
  parent: string;
  basename: string;
  reportsReal: string;
  parentReal: string;
}

const ENTRY_POINTS: Record<SentinelCommand, string> = {
  'contract-guard': 'dist/index.js',
  impact: 'impact/dist/index.js',
  'runtime-verify': 'runtime-verify/dist/index.js',
};
const MAX_REPORT_BYTES = 16 * 1024 * 1024;

export async function runAction(
  parsed: ParsedExecution,
  token: string,
  roots: ExecutionRoots,
  hooks: RunActionHooks = {},
): Promise<ExecutionResult> {
  if (Object.values(parsed.inputs).some((value) => value.includes(token))) {
    throw new Error('Sentinel option values must not contain protected token material.');
  }
  validateRootsAndReportDestination(parsed, roots);
  const directory = mkdtempSync(path.join(roots.temporary, 'alconite-sentinel-'));
  chmodSync(directory, 0o700);
  const filename = path.join(directory, 'outputs.jsonl');
  const stagedReport = parsed.command === 'impact' ? undefined : path.join(directory, 'report.json');
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filename, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    const opened = fstatSync(descriptor);
    assertSameFile(opened, lstatSync(filename), filename);
    const inheritedEnvironment: NodeJS.ProcessEnv = { ...process.env };
    delete inheritedEnvironment.ALCONITE_PROJECT_TOKEN;
    delete inheritedEnvironment.GITHUB_OUTPUT;
    delete inheritedEnvironment.GITHUB_STEP_SUMMARY;
    const environment: NodeJS.ProcessEnv = {
      ...inheritedEnvironment,
      ALCONITE_EXECUTION_MODE: 'portable',
      ALCONITE_PORTABLE_OUTPUT_FD: '3',
      GITHUB_WORKSPACE: roots.workspace,
      RUNNER_TEMP: parsed.command === 'impact' ? roots.reports : directory,
      'INPUT_PROJECT-TOKEN': token,
    };
    for (const [name, value] of Object.entries(parsed.inputs)) {
      environment[`INPUT_${name.toUpperCase()}`] = name === 'report-path' && stagedReport ? stagedReport : value;
    }
    const child = spawn(process.execPath, [path.join(roots.actionRoot, ENTRY_POINTS[parsed.command])], {
      cwd: roots.workspace,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe', descriptor],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let total = 0;
    child.stdout!.on('data', (chunk: Buffer) => { stdout.push(chunk); total += chunk.length; if (total > 256 * 1024) child.kill('SIGKILL'); });
    child.stderr!.on('data', (chunk: Buffer) => { stderr.push(chunk); total += chunk.length; if (total > 256 * 1024) child.kill('SIGKILL'); });
    const exitCode = await new Promise<0 | 1>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve(code === 0 && !signal && total <= 256 * 1024 ? 0 : 1));
    });
    const unexpectedStdout = Buffer.concat(stdout).toString('utf8').trim();
    if (unexpectedStdout) throw new Error('Portable Action child wrote unexpected stdout.');
    const diagnostic = Buffer.concat(stderr).toString('utf8').replaceAll(token, '[REDACTED]');
    if (diagnostic) process.stderr.write(diagnostic.slice(0, 256 * 1024));
    const after = fstatSync(descriptor);
    assertSameFile(opened, after, filename);
    assertSameFile(opened, lstatSync(filename), filename);
    if (realpathSync(filename) !== filename) throw new Error('Portable output path was replaced.');
    const outputs = readPortableOutputs(parsed.command, descriptor, after);
    if (Object.values(outputs).some((value) => value.includes(token))) throw new Error('Portable output contained protected token material.');
    if (stagedReport) await persistActionReport(parsed, outputs, stagedReport, roots, hooks);
    else validateImpactReportOutput(outputs, roots);
    return { command: parsed.command, exitCode, outputs };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertSameFile(expected: Stats, actual: Stats, filename: string): void {
  if (!actual.isFile() || actual.isSymbolicLink() || actual.nlink !== 1 || expected.dev !== actual.dev || expected.ino !== actual.ino || (actual.mode & 0o777) !== 0o600) {
    throw new Error(`Portable output file changed while processing ${path.basename(filename)}.`);
  }
}

export function defaultRoots(): ExecutionRoots {
  return {
    workspace: '/workspace',
    reports: '/reports',
    temporary: '/tmp',
    actionRoot: path.resolve(__dirname, '../..'),
  };
}

function validateRootsAndReportDestination(parsed: ParsedExecution, roots: ExecutionRoots): void {
  for (const [label, root] of [['workspace', roots.workspace], ['reports', roots.reports], ['temporary', roots.temporary]] as const) {
    const stats = lstatSync(root);
    if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync(root) !== path.resolve(root)) {
      throw new Error(`The ${label} root must be an existing link-free directory.`);
    }
  }
  const relative = parsed.inputs['report-path'];
  if (relative) reportDestination(relative, roots);
}

async function persistActionReport(
  parsed: ParsedExecution,
  outputs: Record<string, string>,
  stagedReport: string,
  roots: ExecutionRoots,
  hooks: RunActionHooks,
): Promise<void> {
  const reportedPath = outputs['report-path'];
  if (!reportedPath) {
    if (existsSync(stagedReport)) throw new Error('The Action wrote a report without emitting its report-path output.');
    return;
  }
  if (path.resolve(reportedPath) !== stagedReport) throw new Error('The Action emitted an unexpected staged report path.');
  let relative = parsed.inputs['report-path'];
  if (!relative && parsed.command === 'contract-guard') {
    const checkId = outputs['check-id'];
    if (!checkId || !/^cgchk_[A-Za-z0-9_-]{1,73}$/u.test(checkId)) {
      throw new Error('Contract Guard did not emit a valid check ID for its default report path.');
    }
    relative = `contract-guard-${checkId}.json`;
  }
  if (!relative) throw new Error('The Action report destination could not be resolved.');
  const intended = path.join(roots.reports, ...relative.split('/'));
  await hooks.beforeReportPersist?.(intended);
  const destination = reportDestination(relative, roots);
  copyPrivateReport(stagedReport, destination, roots);
  outputs['report-path'] = destination.destination;
}

function validateImpactReportOutput(outputs: Record<string, string>, roots: ExecutionRoots): void {
  const reportPath = outputs['report-path'];
  if (!reportPath) return;
  const reportsReal = realpathSync(roots.reports);
  const resolved = path.resolve(reportPath);
  const stats = lstatSync(resolved);
  const real = realpathSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || (stats.mode & 0o777) !== 0o600 ||
      (real !== reportsReal && !real.startsWith(`${reportsReal}${path.sep}`))) {
    throw new Error('Impact emitted an unsafe report path.');
  }
}

function reportDestination(relative: string, roots: ExecutionRoots): ReportDestination {
  validateReportsRelativePath(relative);
  const destination = path.join(roots.reports, ...relative.split('/'));
  const parent = path.dirname(destination);
  if (!existsSync(parent)) throw new Error('The report destination parent directory must already exist below /reports.');
  let component = roots.reports;
  for (const name of path.relative(roots.reports, parent).split(path.sep).filter(Boolean)) {
    component = path.join(component, name);
    const componentStats = lstatSync(component);
    if (!componentStats.isDirectory() || componentStats.isSymbolicLink()) {
      throw new Error('The report destination must not traverse links or non-directories.');
    }
  }
  const parentStats = lstatSync(parent);
  const reportsReal = realpathSync(roots.reports);
  const parentReal = realpathSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink() ||
      (parentReal !== reportsReal && !parentReal.startsWith(`${reportsReal}${path.sep}`))) {
    throw new Error('The report destination parent must be a link-free directory below /reports.');
  }
  if (existsSync(destination)) throw new Error('The report destination must not already exist.');
  return { destination, parent, basename: path.basename(destination), reportsReal, parentReal };
}

function copyPrivateReport(stagedReport: string, destination: ReportDestination, roots: ExecutionRoots): void {
  let sourceDescriptor: number | undefined;
  let reportsDescriptor: number | undefined;
  let parentDescriptor: number | undefined;
  let destinationDescriptor: number | undefined;
  try {
    sourceDescriptor = openSync(stagedReport, constants.O_RDONLY | constants.O_NOFOLLOW);
    const sourceStats = fstatSync(sourceDescriptor);
    const sourcePathStats = lstatSync(stagedReport);
    if (!sourceStats.isFile() || sourceStats.nlink !== 1 || sourceStats.size > MAX_REPORT_BYTES ||
        (sourceStats.mode & 0o777) !== 0o600 || sourceStats.dev !== sourcePathStats.dev || sourceStats.ino !== sourcePathStats.ino ||
        realpathSync(stagedReport) !== stagedReport) {
      throw new Error('The staged Action report failed its identity, mode, or size check.');
    }
    reportsDescriptor = openVerifiedDirectory(roots.reports, destination.reportsReal);
    parentDescriptor = openVerifiedDirectory(destination.parent, destination.parentReal);
    destinationDescriptor = openSync(
      `/proc/self/fd/${parentDescriptor}/${destination.basename}`,
      constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
      0o600,
    );
    const created = fstatSync(destinationDescriptor);
    assertPrivateDestination(created, lstatSync(destination.destination), destination.destination);
    copyDescriptors(sourceDescriptor, destinationDescriptor, sourceStats.size);
    fsyncSync(destinationDescriptor);
    const completed = fstatSync(destinationDescriptor);
    const anchored = lstatSync(`/proc/self/fd/${parentDescriptor}/${destination.basename}`);
    const ambient = lstatSync(destination.destination);
    if (completed.size !== sourceStats.size) throw new Error('The durable report size changed while it was written.');
    assertPrivateDestination(completed, anchored, destination.destination);
    assertPrivateDestination(completed, ambient, destination.destination);
    if (realpathSync(destination.destination) !== path.join(destination.parentReal, destination.basename)) {
      throw new Error('The durable report path changed while it was written.');
    }
    assertDirectoryDescriptor(reportsDescriptor, roots.reports, destination.reportsReal);
    assertDirectoryDescriptor(parentDescriptor, destination.parent, destination.parentReal);
  } catch (error) {
    if (destinationDescriptor !== undefined) {
      try { ftruncateSync(destinationDescriptor, 0); fsyncSync(destinationDescriptor); } catch { /* preserve the original failure */ }
    }
    throw error;
  } finally {
    if (destinationDescriptor !== undefined) closeSync(destinationDescriptor);
    if (parentDescriptor !== undefined) closeSync(parentDescriptor);
    if (reportsDescriptor !== undefined) closeSync(reportsDescriptor);
    if (sourceDescriptor !== undefined) closeSync(sourceDescriptor);
  }
}

function openVerifiedDirectory(directory: string, expectedReal: string): number {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    assertDirectoryDescriptor(descriptor, directory, expectedReal);
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function assertDirectoryDescriptor(descriptor: number, directory: string, expectedReal: string): void {
  const opened = fstatSync(descriptor);
  const ambient = lstatSync(directory);
  if (!opened.isDirectory() || !ambient.isDirectory() || ambient.isSymbolicLink() || opened.dev !== ambient.dev || opened.ino !== ambient.ino ||
      realpathSync(directory) !== expectedReal || realpathSync(`/proc/self/fd/${descriptor}`) !== expectedReal) {
    throw new Error('The report destination directory changed during persistence.');
  }
}

function assertPrivateDestination(expected: Stats, actual: Stats, filename: string): void {
  if (!expected.isFile() || expected.nlink !== 1 || (expected.mode & 0o777) !== 0o600 || !actual.isFile() || actual.isSymbolicLink() ||
      actual.nlink !== 1 || expected.dev !== actual.dev || expected.ino !== actual.ino || (actual.mode & 0o777) !== 0o600) {
    throw new Error(`The durable report changed while processing ${path.basename(filename)}.`);
  }
}

function copyDescriptors(source: number, destination: number, size: number): void {
  const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(size, 1)));
  let readOffset = 0;
  while (readOffset < size) {
    const count = readSync(source, buffer, 0, Math.min(buffer.length, size - readOffset), readOffset);
    if (count === 0) throw new Error('The staged Action report ended before its verified size.');
    let written = 0;
    while (written < count) written += writeSync(destination, buffer, written, count - written);
    readOffset += count;
  }
}
