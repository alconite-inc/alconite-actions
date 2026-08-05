import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadConfiguration } from '../../src/runtime-verify/configuration';
import { loadOpenApi } from '../../src/runtime-verify/openapi';
import { validateReport } from '../../src/runtime-verify/platform-client';

const fixtures = path.resolve('test/runtime-verify/fixtures');

test('checked-in Runtime Verify OpenAPI and configuration fixtures are valid', async () => {
  const contract = await loadOpenApi('openapi.yaml', fixtures);
  const masked: string[] = [];
  const configuration = await loadConfiguration('runtime-verify.yaml', fixtures,
    { STAGING_API_AUTHORIZATION: 'fixture-secret' }, value => masked.push(value));
  assert.equal(contract.operationCount, 2);
  assert.equal(configuration.configuration.operations.length, 2);
  assert.deepEqual(masked, ['fixture-secret']);
});

test('checked-in platform and response fixtures remain parseable and bounded', async () => {
  const report = validateReport(JSON.parse(await readFile(path.join(fixtures, 'platform/report-passed.json'), 'utf8')));
  const initiation = JSON.parse(await readFile(path.join(fixtures, 'platform/initiation-pending.json'), 'utf8'));
  const cases = JSON.parse(await readFile(path.join(fixtures, 'cases.json'), 'utf8'));
  assert.equal(report.gateResult, 'passed');
  assert.equal(initiation.schemaVersion, 'alconite.runtime-verify.run.v1');
  assert.deepEqual(Object.keys(cases).sort(), [
    'authenticatedGet', 'contractHashMismatch', 'invalidContentType', 'missingRequiredProperty', 'oversizedResponse',
    'pathParameter', 'problemDetails', 'publicHealth', 'queryParameter', 'timeout', 'undocumentedStatus'
  ]);
  JSON.parse(await readFile(path.join(fixtures, 'responses/health.json'), 'utf8'));
  JSON.parse(await readFile(path.join(fixtures, 'responses/problem.json'), 'utf8'));
});
