import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runAction, type ExecutionRoots } from '../../src/sentinel-executor/action-process';
import { parseExecutionArguments } from '../../src/sentinel-executor/arguments';

const TOKEN = 'alc_cg_do-not-print-this-token';

test('redacts the environment token from every top-level parse diagnostic', () => {
  const entryPoint = path.join(process.cwd(), 'build/src/sentinel-executor/index.js');
  for (const arguments_ of [
    ['contract-guard', '--project-id', 'cgprj_test', TOKEN],
    [TOKEN],
    ['contract-guard', '--project-id', 'cgprj_test', `--unknown-${TOKEN}`, 'value'],
  ]) {
    const result = spawnSync(process.execPath, [entryPoint, ...arguments_], {
      encoding: 'utf8',
      env: { ...process.env, ALCONITE_PROJECT_TOKEN: TOKEN },
    });
    assert.equal(result.status, 1);
    assert.equal(`${result.stdout}${result.stderr}`.includes(TOKEN), false, arguments_.join(' '));
  }
});

test('passes the token only through the Contract Guard child environment and reads descriptor outputs', async () => {
  const fixture = await createFixture('dist/index.js', [
    "const fs = require('node:fs');",
    "if (process.argv.join(' ').includes(process.env['INPUT_PROJECT-TOKEN'])) process.exit(9);",
    `if (process.env.ALCONITE_PROJECT_TOKEN || process.env['INPUT_PROJECT-TOKEN'] !== '${TOKEN}') process.exit(10);`,
    "fs.appendFileSync(3, JSON.stringify({name:'check-id',value:'cgchk_test'}) + '\\n');",
    "process.stderr.write('portable child completed\\n');",
  ]);
  const parsed = parseExecutionArguments(['contract-guard', '--project-id', 'cgprj_test']);
  try {
    const result = await runAction(parsed, TOKEN, fixture.roots);
    assert.deepEqual(result, { command: 'contract-guard', exitCode: 0, outputs: { 'check-id': 'cgchk_test' } });
  } finally {
    await fixture.cleanup();
  }
});

test('executes the Impact entry point with portable environment and preserves its private report', async () => {
  const fixture = await createFixture('impact/dist/index.js', [
    "const fs = require('node:fs'); const path = require('node:path');",
    `if (process.env.ALCONITE_PROJECT_TOKEN || process.env['INPUT_PROJECT-TOKEN'] !== '${TOKEN}') process.exit(10);`,
    "if (process.env.ALCONITE_EXECUTION_MODE !== 'portable' || process.env.GITHUB_WORKSPACE !== process.cwd()) process.exit(11);",
    "const directory = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'alconite-impact-')); fs.chmodSync(directory, 0o700);",
    "const report = path.join(directory, 'impact-report.json'); fs.writeFileSync(report, '{\"schema\":\"impact\"}\\n', {mode:0o600});",
    "for (const record of [{name:'check-id',value:'cgchk_impact'},{name:'overall-risk',value:'LOW'},{name:'report-path',value:report}]) fs.appendFileSync(3, JSON.stringify(record) + '\\n');",
  ]);
  const parsed = parseExecutionArguments(['impact', '--project-id', 'cgprj_test', '--check-id', 'cgchk_impact']);
  try {
    const result = await runAction(parsed, TOKEN, fixture.roots);
    assert.equal(result.exitCode, 0);
    assert.equal(result.outputs['check-id'], 'cgchk_impact');
    assert.ok(result.outputs['report-path']?.startsWith(`${fixture.roots.reports}${path.sep}alconite-impact-`));
    assert.equal(await readFile(result.outputs['report-path']!, 'utf8'), '{"schema":"impact"}\n');
    assert.equal((await stat(result.outputs['report-path']!)).mode & 0o777, 0o600);
  } finally {
    await fixture.cleanup();
  }
});

test('persists a Runtime Verify report before returning its failed gate', async () => {
  const fixture = await createRuntimeFixture();
  await mkdir(path.join(fixture.roots.reports, 'runtime'));
  const parsed = runtimeArguments('runtime/report.json');
  try {
    const result = await runAction(parsed, TOKEN, fixture.roots);
    assert.equal(result.exitCode, 1);
    assert.equal(result.outputs['gate-result'], 'failed');
    assert.equal(result.outputs['report-path'], path.join(fixture.roots.reports, 'runtime/report.json'));
    assert.equal(await readFile(result.outputs['report-path']!, 'utf8'), '{"schema":"runtime"}\n');
    assert.equal((await stat(result.outputs['report-path']!)).mode & 0o777, 0o600);
  } finally {
    await fixture.cleanup();
  }
});

test('rejects a multiply linked report destination before child execution', async () => {
  const fixture = await createRuntimeFixture();
  const outside = path.join(fixture.root, 'outside.json');
  const destination = path.join(fixture.roots.reports, 'report.json');
  const marker = path.join(fixture.roots.workspace, 'child-started');
  await writeFile(outside, 'ORIGINAL', { mode: 0o600 });
  await link(outside, destination);
  await writeFile(path.join(fixture.roots.actionRoot, 'runtime-verify/dist/index.js'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');`);
  try {
    await assert.rejects(runAction(runtimeArguments('report.json'), TOKEN, fixture.roots), /must not already exist/u);
    assert.equal(await readFile(outside, 'utf8'), 'ORIGINAL');
    await assert.rejects(stat(marker), /ENOENT/u);
  } finally {
    await fixture.cleanup();
  }
});

test('fails closed when a report destination appears after validation', async () => {
  const fixture = await createRuntimeFixture();
  const outside = path.join(fixture.root, 'outside.json');
  await writeFile(outside, 'ORIGINAL', { mode: 0o600 });
  try {
    await assert.rejects(runAction(runtimeArguments('report.json'), TOKEN, fixture.roots, {
      beforeReportPersist: async (destination) => link(outside, destination),
    }), /must not already exist/u);
    assert.equal(await readFile(outside, 'utf8'), 'ORIGINAL');
  } finally {
    await fixture.cleanup();
  }
});

function runtimeArguments(reportPath: string) {
  return parseExecutionArguments([
    'runtime-verify', '--project-id', 'cgprj_test', '--environment-id', 'rtvenv_test',
    '--base-url', 'https://target.example', '--report-path', reportPath,
  ]);
}

async function createRuntimeFixture() {
  return createFixture('runtime-verify/dist/index.js', [
    "const fs = require('node:fs'); const path = require('node:path');",
    `if (process.env.ALCONITE_PROJECT_TOKEN || process.env['INPUT_PROJECT-TOKEN'] !== '${TOKEN}') process.exit(10);`,
    "const report = process.env['INPUT_REPORT-PATH'];",
    "if (!report || path.dirname(report) !== process.env.RUNNER_TEMP || !report.includes('alconite-sentinel-')) process.exit(11);",
    "fs.writeFileSync(report, '{\"schema\":\"runtime\"}\\n', {mode:0o600});",
    "for (const record of [{name:'run-id',value:'rtvrun_test'},{name:'check-id',value:'cgchk_runtime'},{name:'gate-result',value:'failed'},{name:'report-path',value:report}]) fs.appendFileSync(3, JSON.stringify(record) + '\\n');",
    'process.exitCode = 1;',
  ]);
}

async function createFixture(entryPoint: string, lines: string[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sentinel-integration-'));
  const workspace = path.join(root, 'workspace');
  const reports = path.join(root, 'reports');
  const actionRoot = path.join(root, 'actions');
  const filename = path.join(actionRoot, entryPoint);
  await mkdir(path.dirname(filename), { recursive: true });
  await mkdir(workspace);
  await mkdir(reports);
  await chmod(workspace, 0o555);
  await writeFile(filename, lines.join('\n'));
  const roots: ExecutionRoots = { workspace, reports, temporary: root, actionRoot };
  return {
    root,
    roots,
    cleanup: async () => {
      await chmod(workspace, 0o755);
      await rm(root, { recursive: true });
    },
  };
}
