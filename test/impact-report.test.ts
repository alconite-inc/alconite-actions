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
  const raw = JSON.parse(await fs.readFile(path.resolve('test/fixtures/impact-report-v1.json'), 'utf8')) as unknown;
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

test('HTML-escapes bounded source/evidence values in the job summary and omits host paths', async () => {
  const report = await fixture();
  const source = report.changes[0]?.affectedSources[0];
  assert.ok(source);
  source.file = 'src/<customer>|mapper.ts';
  source.evidence[0]!.value = '<Customer>|';
  const summary = impactSummary(report);
  assert.ok(summary.includes('&lt;customer&gt;\\|mapper.ts'));
  assert.ok(summary.includes('&lt;Customer&gt;\\|'));
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

test('removes only its verified empty invocation directory when report creation fails', async () => {
  const { workspace, runner } = await roots();
  const report = await fixture();
  if (process.platform === 'win32') return;
  await assert.rejects(
    writePrivateReport(report, runner, workspace, new ActionDeadline(30_000), {
      afterFileCreated: async () => { throw new Error('test injection'); },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'report_write_failed',
  );
  assert.deepEqual(await fs.readdir(runner), []);
  assert.deepEqual(await fs.readdir(workspace), []);
});

test('Linux report-root binding tolerates invocation metadata changes and preserves scoped cleanup', {
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
  assert.deepEqual(await fs.readdir(runner), []);
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
  assert.deepEqual(await fs.readdir(displaced), []);
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

  const secondRoots = await roots();
  await assert.rejects(
    writePrivateReport(report, secondRoots.runner, secondRoots.workspace, new ActionDeadline(30_000), {
      afterFileCreated: async (filename) => {
        await fs.rename(filename, `${filename}.original`);
        await fs.writeFile(filename, 'replacement');
      },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'report_write_failed',
  );
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
