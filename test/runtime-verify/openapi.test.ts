import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';
import { loadOpenApi, MAX_CONTRACT_BYTES, MAX_OPENAPI_OPERATIONS, platformContractContentHash, resolveLocalReference } from '../../src/runtime-verify/openapi';

function contract(version: string): Record<string, unknown> {
  return {
    openapi: version,
    info: { title: 'Fixture', version: '1.0.0' },
    paths: { '/health': { get: { operationId: 'getHealth', responses: { '200': { description: 'Healthy' } } } } }
  };
}

async function load(value: unknown, extension: '.json' | '.yaml') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'runtime-openapi-'));
  const filename = `openapi${extension}`;
  await writeFile(path.join(directory, filename), extension === '.json' ? JSON.stringify(value) : stringify(value));
  return loadOpenApi(filename, directory);
}

for (const version of ['3.0.3', '3.1.1']) {
  for (const extension of ['.json', '.yaml'] as const) {
    test(`loads OpenAPI ${version.slice(0, 3)} ${extension.slice(1).toUpperCase()}`, async () => {
      const loaded = await load(contract(version), extension);
      assert.equal(loaded.version, version.startsWith('3.0') ? '3.0' : '3.1');
      assert.match(loaded.contentHash, /^sha256:[a-f0-9]{64}$/);
    });
  }
}

test('supports local in-document references', async () => {
  const value: any = contract('3.1.0');
  value.paths['/health'].get.responses['200'].content = { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } };
  value.components = { schemas: { Health: { type: 'object', required: ['status'], properties: { status: { type: 'string' } } } } };
  const loaded = await load(value, '.yaml');
  assert.equal(loaded.operationCount, 1);
});

test('uses the platform contract fingerprint across LF and CRLF line endings', () => {
  const lf = Buffer.from('openapi: 3.1.0\ninfo:\n  title: Fixture\n');
  const crlf = Buffer.from('openapi: 3.1.0\r\ninfo:\r\n  title: Fixture\r\n');
  assert.equal(platformContractContentHash(lf), platformContractContentHash(crlf));
});

test('supports OpenAPI 3.1 local JSON Schema anchors', async () => {
  const value: any = contract('3.1.0');
  value.paths['/health'].get.responses['200'].content = { 'application/json': { schema: { $ref: '#Health' } } };
  value.components = { schemas: { Health: { $anchor: 'Health', type: 'object' } } };
  const loaded = await load(value, '.json');
  assert.equal(loaded.version, '3.1');
});

test('rejects remote and filesystem references', async () => {
  for (const reference of ['https://example.test/schema.yaml', './schema.yaml']) {
    const value: any = contract('3.1.0');
    value.paths['/health'].get.responses['200'].$ref = reference;
    await assert.rejects(load(value, '.json'), /Remote and filesystem/);
  }
});

test('rejects unsupported OpenAPI versions', async () => {
  await assert.rejects(load(contract('2.0'), '.json'), /supports OpenAPI 3.0 and 3.1/);
});

test('rejects duplicate operation IDs', async () => {
  const value: any = contract('3.1.0');
  value.paths['/ready'] = { get: { operationId: 'getHealth', responses: { '200': { description: 'Ready' } } } };
  await assert.rejects(load(value, '.yaml'), /duplicate operationId/);
});

test('rejects excessive operation counts', async () => {
  const value: any = contract('3.1.0');
  value.paths = Object.fromEntries(Array.from({ length: MAX_OPENAPI_OPERATIONS + 1 }, (_, index) => [
    `/items/${index}`, { get: { operationId: `getItem${index}`, responses: { '200': { description: 'OK' } } } }
  ]));
  await assert.rejects(load(value, '.json'), /at most 1000 operations/);
});

test('rejects excessive document depth', async () => {
  const value: any = contract('3.1.0');
  let current = value;
  for (let index = 0; index < 110; index += 1) current = current[`x-${index}`] = {};
  await assert.rejects(load(value, '.json'), /maximum document depth/);
});

test('rejects an excessive contract file before parsing', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'runtime-size-'));
  await writeFile(path.join(directory, 'openapi.json'), Buffer.alloc(MAX_CONTRACT_BYTES + 1, 0x20));
  await assert.rejects(loadOpenApi('openapi.json', directory), /exceeds/);
});

test('bounded reference resolver rejects cyclic reference chains', () => {
  const value = { components: { parameters: { A: { $ref: '#/components/parameters/B' }, B: { $ref: '#/components/parameters/A' } } } };
  assert.throws(() => resolveLocalReference(value, { $ref: '#/components/parameters/A' }), /cyclic local reference/);
});
