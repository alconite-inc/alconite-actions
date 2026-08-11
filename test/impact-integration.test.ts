import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

const PROJECT_ID = 'cgprj_11111111111111111111111111111111';
const CHECK_ID = 'cgchk_22222222222222222222222222222222';
const TOKEN = 'alc_cg_do-not-log-this-impact-token';
const SOURCE_MARKER = 'super-secret-source-marker';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

test('runs the compiled Impact Action against a local mock without logging source or token material', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'impact-action-test-'));
  temporaryDirectories.push(base);
  const workspace = path.join(base, 'workspace');
  const runnerTemp = path.join(base, 'runner-temp');
  const outputPath = path.join(base, 'github-output.txt');
  const summaryPath = path.join(base, 'summary.md');
  await fs.mkdir(workspace, { mode: 0o700 });
  await fs.mkdir(runnerTemp, { mode: 0o700 });
  await fs.writeFile(path.join(workspace, 'customer.ts'), `interface Customer { firstName: string } // ${SOURCE_MARKER}\n`);
  await fs.writeFile(outputPath, '');
  await fs.writeFile(summaryPath, '');
  const baseReport = JSON.parse(await fs.readFile(path.resolve('test/fixtures/impact-report-v1.json'), 'utf8')) as Record<string, unknown>;
  let observedRequest = false;

  const server = createServer((request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, `/api/v1/contract-guard/projects/${PROJECT_ID}/checks/${CHECK_ID}/impact`);
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        source: { files: Array<{ path: string; content: string }>; clientCollection: Record<string, unknown> };
      };
      assert.equal(body.source.files.length, 1);
      assert.equal(body.source.files[0]?.path, 'customer.ts');
      assert.ok(body.source.files[0]?.content.includes(SOURCE_MARKER));
      observedRequest = true;
      const report = structuredClone(baseReport);
      const metadata = report.metadata as Record<string, unknown>;
      metadata.clientCollection = { ...body.source.clientCollection, authoritative: false };
      const serverScan = metadata.serverScan as Record<string, unknown>;
      serverScan.manifestEntriesSubmitted = 1;
      serverScan.filesAccepted = 1;
      serverScan.filesScanned = 1;
      serverScan.filesSkipped = 0;
      serverScan.bytesScanned = Buffer.byteLength(body.source.files[0]?.content ?? '', 'utf8');
      const changes = report.changes as Array<Record<string, unknown>>;
      const affectedSources = changes[0]?.affectedSources as Array<Record<string, unknown>>;
      if (affectedSources[0]) affectedSources[0].file = 'customer.ts';
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(report));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../src/impact/index.js')], {
      env: {
        ...process.env,
        'INPUT_PROJECT-ID': PROJECT_ID,
        'INPUT_PROJECT-TOKEN': TOKEN,
        'INPUT_CHECK-ID': CHECK_ID,
        'INPUT_SOURCE-ROOT': '.',
        'INPUT_API-URL': `http://127.0.0.1:${address.port}`,
        'INPUT_ADDITIONAL-IGNORE': '',
        'INPUT_INCLUDE-GENERATED-DIRECTORIES': 'false',
        'INPUT_TIMEOUT-SECONDS': '30',
        'INPUT_ATTEMPTS': '1',
        'INPUT_FAIL-ON-RISK': 'never',
        'INPUT_FAIL-ON-POTENTIAL-RISK': 'never',
        GITHUB_WORKSPACE: workspace,
        RUNNER_TEMP: runnerTemp,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    const stdoutAfterMask = stdout.replace(`::add-mask::${TOKEN}\n`, '');
    assert.ok(!stdoutAfterMask.includes(TOKEN));
    assert.ok(!stderr.includes(TOKEN));
    assert.ok(!stdout.includes(SOURCE_MARKER));
    assert.ok(!stderr.includes(SOURCE_MARKER));
    assert.ok(!(await fs.readFile(summaryPath, 'utf8')).includes(SOURCE_MARKER));

    if (process.platform === 'win32') {
      assert.equal(observedRequest, false);
      assert.equal(exitCode, 1);
      assert.match(stdout, /requires a Linux runner/u);
      assert.doesNotMatch(stdout, /Collected .* source files/u);
      return;
    }
    assert.equal(observedRequest, true);
    assert.equal(exitCode, 0, stderr);
    const outputs = await fs.readFile(outputPath, 'utf8');
    assert.match(outputs, /overall-risk<<[^\n]+\nHIGH\n/u);
    assert.match(outputs, /overall-potential-risk<<[^\n]+\nHIGH\n/u);
    const reportMatch = /report-path<<[^\n]+\n([^\n]+)\n/u.exec(outputs);
    assert.ok(reportMatch?.[1]);
    assert.ok(reportMatch[1].startsWith(`${runnerTemp}${path.sep}`));
    assert.ok(!reportMatch[1].startsWith(`${workspace}${path.sep}`));
    assert.match(await fs.readFile(summaryPath, 'utf8'), /Alconite Impact/u);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
