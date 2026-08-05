import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfiguration, MAX_CONFIGURED_OPERATIONS, parseConfiguration, readWorkspaceFile } from '../../src/runtime-verify/configuration';

const valid = {
  version: 1,
  defaults: { timeoutSeconds: 10, maximumResponseBytes: 1024, followRedirects: false },
  operations: [{ operationId: 'getHealth', headers: { Authorization: { fromEnvironment: 'STAGING_API_AUTHORIZATION' } } }]
};

test('parses a strict version-one configuration', () => {
  const parsed = parseConfiguration(valid);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.operations[0]?.operationId, 'getHealth');
});

for (const [name, mutate] of [
  ['unknown top-level fields', (value: any) => { value.unknown = true; }],
  ['missing operation ID', (value: any) => { delete value.operations[0].operationId; }],
  ['duplicate operation ID', (value: any) => { value.operations.push({ operationId: 'getHealth' }); }],
  ['invalid environment identifier', (value: any) => { value.operations[0].headers.Authorization.fromEnvironment = 'lower-case'; }],
  ['unsafe header override', (value: any) => { value.operations[0].headers.Host = { value: 'example.test' }; }],
  ['invalid timeout', (value: any) => { value.defaults.timeoutSeconds = 121; }],
  ['invalid response-size limit', (value: any) => { value.defaults.maximumResponseBytes = 100; }]
] as const) {
  test(`rejects ${name}`, () => {
    const copy = structuredClone(valid);
    mutate(copy);
    assert.throws(() => parseConfiguration(copy), /configuration|operation|header|must|supported/i);
  });
}

test('rejects excessive configured operation counts', () => {
  const copy: any = structuredClone(valid);
  copy.operations = Array.from({ length: MAX_CONFIGURED_OPERATIONS + 1 }, (_, index) => ({ operationId: `get${index}`, headers: {} }));
  assert.throws(() => parseConfiguration(copy), /at most/i);
});

test('masks resolved target secrets and never persists their values', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'runtime-config-'));
  const filename = path.join(directory, 'runtime.yaml');
  await writeFile(filename, `version: 1\noperations:\n  - operationId: getHealth\n    headers:\n      Authorization:\n        fromEnvironment: STAGING_API_AUTHORIZATION\n`);
  const masked: string[] = [];
  const loaded = await loadConfiguration('runtime.yaml', directory, { STAGING_API_AUTHORIZATION: 'Bearer super-secret' }, value => masked.push(value));
  assert.deepEqual(masked, ['Bearer super-secret']);
  assert.equal(loaded.resolvedHeaders.get('getHealth')?.Authorization, 'Bearer super-secret');
  assert.doesNotMatch(JSON.stringify(loaded.configuration), /super-secret/);
});

test('rejects workspace path traversal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'runtime-path-'));
  await assert.rejects(readWorkspaceFile('../outside.yaml', directory, 1024), /beneath GITHUB_WORKSPACE/);
});

test('rejects a symlink that escapes the workspace when supported', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'runtime-link-'));
  const outside = path.join(os.tmpdir(), `runtime-outside-${Date.now()}.yaml`);
  await writeFile(outside, 'version: 1\noperations: []\n');
  try { await symlink(outside, path.join(directory, 'runtime.yaml'), 'file'); }
  catch { t.skip('Symlink creation is not available in this environment.'); return; }
  await assert.rejects(readWorkspaceFile('runtime.yaml', directory, 1024), /resolves outside/);
  assert.equal((await readFile(outside, 'utf8')).length > 0, true);
});
