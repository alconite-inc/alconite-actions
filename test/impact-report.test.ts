import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { ActionDeadline } from '../src/impact/deadline';
import { ImpactActionError } from '../src/impact/errors';
import { validateImpactReport, type ImpactReport, type ImpactRisk } from '../src/impact/models';
import {
  impactSummary,
  parseRiskThreshold,
  shouldFailRisk,
  writePrivateReport,
} from '../src/impact/report';

const PROJECT_ID = 'cgprj_11111111111111111111111111111111';
const CHECK_ID = 'cgchk_22222222222222222222222222222222';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<ImpactReport> {
  const raw = JSON.parse(await fs.readFile(path.resolve('test/fixtures/impact-report-v1-single-file.json'), 'utf8')) as unknown;
  return validateImpactReport(raw, PROJECT_ID, CHECK_ID);
}

async function roots(): Promise<{ base: string; workspace: string; runner: string }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'impact-report-test-'));
  temporaryDirectories.push(base);
  const workspace = path.join(base, 'workspace');
  const runner = path.join(base, 'runner-temp');
  await fs.mkdir(workspace, { mode: 0o700 });
  await fs.mkdir(runner, { mode: 0o700 });
  return { base, workspace, runner };
}

test('evaluates every detected and potential risk threshold independently', () => {
  const risks: ImpactRisk[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  for (const risk of risks) {
    assert.equal(shouldFailRisk(risk, 'never'), false);
    assert.equal(shouldFailRisk(risk, 'low'), risks.indexOf(risk) >= risks.indexOf('LOW'));
    assert.equal(shouldFailRisk(risk, 'medium'), risks.indexOf(risk) >= risks.indexOf('MEDIUM'));
    assert.equal(shouldFailRisk(risk, 'high'), risks.indexOf(risk) >= risks.indexOf('HIGH'));
    assert.equal(shouldFailRisk(risk, 'critical'), risk === 'CRITICAL');
  }
  assert.equal(parseRiskThreshold(' HIGH ', 'fail-on-risk'), 'high');
  assert.throws(() => parseRiskThreshold('warning', 'fail-on-risk'), /never, low, medium, high, critical/u);
});

test('renders bounded source/evidence values as inert Markdown and omits host paths', async () => {
  const report = await fixture();
  const source = report.changes[0]?.affectedSources[0];
  assert.ok(source);
  source.file = 'src/<customer>|![leak](https://attacker.invalid/pixel).ts';
  source.evidence[0]!.value = '<Customer>|`code` [link](https://attacker.invalid)';
  const summary = impactSummary(report);
  assert.ok(summary.includes('&lt;customer&gt;\\|\\!\\[leak\\]\\(https\\:\\/\\/attacker\\.invalid\\/pixel\\)\\.ts'));
  assert.ok(summary.includes('&lt;Customer&gt;\\|\\`code\\` \\[link\\]\\(https\\:\\/\\/attacker\\.invalid\\)'));
  assert.ok(!summary.includes('![leak]('));
  assert.ok(!summary.includes('[link]('));
  assert.ok(!summary.includes(process.cwd()));
  assert.ok(!summary.includes('interface Customer'));
});

test('writes one exclusive private report outside the workspace or fails closed on unsupported Windows primitives', async () => {
  const { workspace, runner } = await roots();
  const report = await fixture();
  if (process.platform === 'win32') {
    await assert.rejects(
      writePrivateReport(report, runner, workspace, new ActionDeadline(30_000)),
      (error: unknown) => error instanceof ImpactActionError && error.code === 'unsupported_secure_report_filesystem',
    );
    return;
  }
  const before = await fs.readdir(workspace);
  const reportPath = await writePrivateReport(report, runner, workspace, new ActionDeadline(30_000));
  assert.deepEqual(await fs.readdir(workspace), before);
  assert.equal(path.basename(reportPath), 'impact-report.json');
  assert.ok(reportPath.startsWith(`${runner}${path.sep}`));
  const fileStats = await fs.stat(reportPath);
  const directoryStats = await fs.stat(path.dirname(reportPath));
  assert.equal(fileStats.mode & 0o777, 0o600);
  assert.equal(directoryStats.mode & 0o777, 0o700);
  assert.equal(JSON.parse(await fs.readFile(reportPath, 'utf8')).schemaVersion, 'alconite.impact.report.v1');
  const second = await writePrivateReport(report, runner, workspace, new ActionDeadline(30_000));
  assert.notEqual(second, reportPath);
});

test('scrubs only its open report descriptor and leaves path cleanup to the runner on failure', async () => {
  const { workspace, runner } = await roots();
  const report = await fixture();
  if (process.platform === 'win32') return;
  await assert.rejects(
    writePrivateReport(report, runner, workspace, new ActionDeadline(30_000), {
      afterFileCreated: async () => { throw new Error('test injection'); },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'report_write_failed',
  );
  const entries = await fs.readdir(runner);
  assert.equal(entries.length, 1);
  const invocation = path.join(runner, entries[0]!);
  const files = await fs.readdir(invocation);
  assert.deepEqual(files, ['impact-report.json']);
  assert.equal((await fs.stat(invocation)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(invocation, 'impact-report.json'))).mode & 0o777, 0o600);
  assert.equal((await fs.readFile(path.join(invocation, 'impact-report.json'))).byteLength, 0);
  assert.deepEqual(await fs.readdir(workspace), []);
});

test('Linux report-root binding tolerates invocation metadata changes and preserves descriptor-only scrubbing', {
  skip: process.platform !== 'linux',
}, async () => {
  const { workspace, runner } = await roots();
  const report = await fixture();
  const before = await fs.stat(runner, { bigint: true });
  const reportPath = await writePrivateReport(report, runner, workspace, new ActionDeadline(30_000));
  const after = await fs.stat(runner, { bigint: true });
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mode, before.mode);
  await fs.unlink(reportPath);
  await fs.rmdir(path.dirname(reportPath));
  await assert.rejects(
    writePrivateReport(report, runner, workspace, new ActionDeadline(30_000), {
      afterFileCreated: async () => { throw new Error('cleanup injection'); },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'report_write_failed',
  );
  const failedEntries = await fs.readdir(runner);
  assert.equal(failedEntries.length, 1);
  const failedReport = path.join(runner, failedEntries[0]!, 'impact-report.json');
  assert.equal((await fs.readFile(failedReport)).byteLength, 0);
});

test('fails closed without report bytes when the whole private child directory is swapped', {
  skip: process.platform !== 'linux',
}, async () => {
  const { workspace, runner } = await roots();
  let replacement = '';
  let displaced = '';
  await assert.rejects(
    writePrivateReport(await fixture(), runner, workspace, new ActionDeadline(30_000), {
      afterFileCreated: async (filename) => {
        const directory = path.dirname(filename);
        replacement = directory;
        displaced = `${directory}-displaced`;
        await fs.rename(directory, displaced);
        await fs.mkdir(directory, { mode: 0o700 });
      },
    }),
    (error: unknown) => error instanceof ImpactActionError &&
      (error.code === 'unsupported_secure_report_filesystem' || error.code === 'report_write_failed'),
  );
  assert.ok(replacement);
  assert.ok(displaced);
  assert.deepEqual(await fs.readdir(replacement), []);
  assert.deepEqual(await fs.readdir(displaced), ['impact-report.json']);
  assert.equal((await fs.readFile(path.join(displaced, 'impact-report.json'))).byteLength, 0);
});

test('fails closed when the exclusive destination name or path identity is raced', async () => {
  const { workspace, runner } = await roots();
  const report = await fixture();
  if (process.platform === 'win32') return;
  await assert.rejects(
    writePrivateReport(report, runner, workspace, new ActionDeadline(30_000), {
      afterDirectoryCreated: async (directory) => {
        await fs.writeFile(path.join(directory, 'impact-report.json'), 'attacker-controlled');
      },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'report_write_failed',
  );
  const firstInvocation = path.join(runner, (await fs.readdir(runner))[0]!);
  assert.equal(await fs.readFile(path.join(firstInvocation, 'impact-report.json'), 'utf8'), 'attacker-controlled');

  const secondRoots = await roots();
  let racedFilename = '';
  await assert.rejects(
    writePrivateReport(report, secondRoots.runner, secondRoots.workspace, new ActionDeadline(30_000), {
      afterFileCreated: async (filename) => {
        racedFilename = filename;
        await fs.rename(filename, `${filename}.original`);
        await fs.writeFile(filename, 'replacement');
      },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'report_write_failed',
  );
  assert.ok(racedFilename);
  assert.equal((await fs.readFile(`${racedFilename}.original`)).byteLength, 0);
  assert.equal(await fs.readFile(racedFilename, 'utf8'), 'replacement');
});

test('fails closed when a RUNNER_TEMP parent is swapped after descriptor binding', {
  skip: process.platform !== 'linux',
}, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'impact-report-parent-race-'));
  temporaryDirectories.push(base);
  const workspace = path.join(base, 'workspace');
  const parent = path.join(base, 'runner-parent');
  const displacedParent = path.join(base, 'runner-parent-original');
  const runner = path.join(parent, 'runner-temp');
  const outsideParent = path.join(base, 'outside-parent');
  const outsideRunner = path.join(outsideParent, 'runner-temp');
  await fs.mkdir(workspace, { mode: 0o700 });
  await fs.mkdir(runner, { recursive: true, mode: 0o700 });
  await fs.mkdir(outsideRunner, { recursive: true, mode: 0o700 });
  let swapped = false;
  await assert.rejects(
    writePrivateReport(await fixture(), runner, workspace, new ActionDeadline(30_000), {
      afterRootComponentOpened: async (requestedRoot, openedComponent) => {
        if (!swapped && requestedRoot === runner && openedComponent === parent) {
          swapped = true;
          await fs.rename(parent, displacedParent);
          await fs.symlink(outsideParent, parent, 'dir');
        }
      },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'unsupported_secure_report_filesystem',
  );
  assert.equal(swapped, true);
  assert.deepEqual(await fs.readdir(outsideRunner), []);
  assert.deepEqual(await fs.readdir(path.join(displacedParent, 'runner-temp')), []);
});

test('refuses a report root inside the workspace', async () => {
  const { workspace } = await roots();
  const nested = path.join(workspace, 'runner-temp');
  await fs.mkdir(nested, { mode: 0o700 });
  await assert.rejects(
    writePrivateReport(await fixture(), nested, workspace, new ActionDeadline(30_000)),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'unsupported_secure_report_filesystem',
  );
});

test('requires RUNNER_TEMP to be absolute rather than resolving a caller-controlled relative path', async () => {
  const { workspace } = await roots();
  await assert.rejects(
    writePrivateReport(await fixture(), 'relative-runner-temp', workspace, new ActionDeadline(30_000)),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'unsupported_secure_report_filesystem',
  );
});
