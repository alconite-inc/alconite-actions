import assert from 'node:assert/strict';
import { closeSync, fstatSync, openSync, writeSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readPortableOutputs } from '../../src/sentinel-executor/output';

test('accepts only known, unique string outputs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sentinel-output-test-'));
  const filename = path.join(directory, 'outputs.jsonl');
  const descriptor = openSync(filename, 'wx+', 0o600);
  try {
    writeSync(descriptor, '{"name":"check-id","value":"cgchk_example"}\n');
    assert.deepEqual(readPortableOutputs('contract-guard', descriptor, fstatSync(descriptor)), { 'check-id': 'cgchk_example' });
  } finally {
    closeSync(descriptor);
    await rm(directory, { recursive: true });
  }
});

test('rejects unknown output names and invalid records', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sentinel-output-test-'));
  const filename = path.join(directory, 'outputs.jsonl');
  await writeFile(filename, '{"name":"secret","value":"no"}\n', { mode: 0o600 });
  const descriptor = openSync(filename, 'r');
  try {
    assert.throws(() => readPortableOutputs('impact', descriptor, fstatSync(descriptor)), /exceeds its contract/u);
  } finally {
    closeSync(descriptor);
    await rm(directory, { recursive: true });
  }
});

test('portable GitHub adapter suppresses commands and uses only descriptor output', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sentinel-github-test-'));
  const filename = path.join(directory, 'outputs.jsonl');
  const descriptor = openSync(filename, 'wx+', 0o600);
  try {
    const child = spawnSync(process.execPath, ['-e', [
      "const github = require('./build/src/github.js');",
      "github.setSecret('protected-value');",
      "github.setOutput('check-id', 'cgchk_example');",
      "github.info('completed');",
      "github.warning('bounded warning');",
      "github.writeJobSummary('suppressed');",
    ].join(' ')], {
      cwd: process.cwd(),
      env: { ...process.env, ALCONITE_EXECUTION_MODE: 'portable', ALCONITE_PORTABLE_OUTPUT_FD: '3' },
      stdio: ['ignore', 'pipe', 'pipe', descriptor],
      encoding: 'utf8',
    });
    assert.equal(child.status, 0);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr, 'info: completed\nwarning: bounded warning\n');
    assert.equal(readPortableOutputs('contract-guard', descriptor, fstatSync(descriptor))['check-id'], 'cgchk_example');
  } finally {
    closeSync(descriptor);
    await rm(directory, { recursive: true });
  }
});
