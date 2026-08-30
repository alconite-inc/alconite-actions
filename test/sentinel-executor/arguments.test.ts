import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExecutionArguments, validateReportsRelativePath } from '../../src/sentinel-executor/arguments';

test('parses Contract Guard defaults and required project ID', () => {
  const parsed = parseExecutionArguments(['contract-guard', '--project-id', 'cgprj_example']);
  assert.equal(parsed.command, 'contract-guard');
  assert.equal(parsed.inputs['candidate-path'], 'openapi.yaml');
  assert.equal(parsed.inputs['timeout-seconds'], '120');
  assert.equal(parsed.inputs['report-path'], '');
});

test('preserves repeated Impact ignores in order', () => {
  const parsed = parseExecutionArguments([
    'impact', '--project-id', 'cgprj_example', '--check-id', 'cgchk_example',
    '--additional-ignore', 'generated/**', '--additional-ignore', 'vendor/**',
  ]);
  assert.equal(parsed.inputs['additional-ignore'], 'generated/**\nvendor/**');
});

test('maps every Contract Guard option to the existing Action input', () => {
  const parsed = parseExecutionArguments([
    'contract-guard', '--project-id', 'cgprj_example', '--candidate-path', 'api/openapi.yaml',
    '--display-name', 'release', '--api-url', 'https://example.test', '--idempotency-key', 'attempt-1',
    '--timeout-seconds', '600', '--retry-attempts', '5', '--fail-on', 'warnings', '--report-path', 'guard/report.json',
  ]);
  assert.deepEqual(parsed.inputs, {
    'project-id': 'cgprj_example', 'api-url': 'https://example.test', 'candidate-path': 'api/openapi.yaml',
    'display-name': 'release', 'idempotency-key': 'attempt-1', 'timeout-seconds': '600',
    'retry-attempts': '5', 'fail-on': 'warnings', 'report-path': 'guard/report.json',
  });
});

test('maps every Impact option and default', () => {
  const parsed = parseExecutionArguments([
    'impact', '--project-id', 'cgprj_example', '--check-id', 'cgchk_example', '--source-root', 'service',
    '--api-url', 'https://example.test', '--additional-ignore', 'one/**', '--additional-ignore', 'two/**',
    '--include-generated-directories', 'true', '--timeout-seconds', '600', '--attempts', '5',
    '--fail-on-risk', 'high', '--fail-on-potential-risk', 'critical',
  ]);
  assert.deepEqual(parsed.inputs, {
    'project-id': 'cgprj_example', 'api-url': 'https://example.test', 'check-id': 'cgchk_example',
    'source-root': 'service', 'additional-ignore': 'one/**\ntwo/**', 'include-generated-directories': 'true',
    'timeout-seconds': '600', attempts: '5', 'fail-on-risk': 'high', 'fail-on-potential-risk': 'critical',
  });
});

test('maps every Runtime Verify option and default', () => {
  const parsed = parseExecutionArguments([
    'runtime-verify', '--project-id', 'cgprj_example', '--environment-id', 'rtvenv_example',
    '--base-url', 'https://target.example', '--check-id', 'cgchk_example', '--contract-path', 'api/openapi.yaml',
    '--configuration-path', 'api/runtime.yaml', '--display-name', 'deployment', '--deployment-id', 'deploy-1',
    '--api-url', 'https://example.test', '--idempotency-key', 'attempt-1', '--timeout-seconds', '3600',
    '--retry-attempts', '5', '--fail-on', 'never', '--report-path', 'runtime/report.json',
  ]);
  assert.deepEqual(parsed.inputs, {
    'project-id': 'cgprj_example', 'api-url': 'https://example.test', 'environment-id': 'rtvenv_example',
    'base-url': 'https://target.example', 'check-id': 'cgchk_example', 'contract-path': 'api/openapi.yaml',
    'configuration-path': 'api/runtime.yaml', 'display-name': 'deployment', 'deployment-id': 'deploy-1',
    'idempotency-key': 'attempt-1', 'timeout-seconds': '3600', 'retry-attempts': '5', 'fail-on': 'never',
    'report-path': 'runtime/report.json',
  });
});

test('requires every command-specific identifier and target', () => {
  assert.throws(() => parseExecutionArguments(['contract-guard']), /--project-id/u);
  assert.throws(() => parseExecutionArguments(['impact', '--project-id', 'cgprj_example']), /--check-id/u);
  assert.throws(() => parseExecutionArguments(['runtime-verify', '--project-id', 'cgprj_example', '--environment-id', 'rtvenv_example']), /--base-url/u);
});

test('rejects token arguments, duplicates, invalid booleans, ranges, and missing values', () => {
  assert.throws(() => parseExecutionArguments(['contract-guard', '--project-token', 'secret']), /only through/u);
  assert.throws(() => parseExecutionArguments(['contract-guard', '--project-id', 'one', '--project-id', 'two']), /Duplicate/u);
  assert.throws(() => parseExecutionArguments(['impact', '--project-id', 'one', '--check-id', 'two', '--include-generated-directories', 'yes']), /invalid value/u);
  assert.throws(() => parseExecutionArguments(['runtime-verify', '--project-id', 'one', '--environment-id', 'two', '--base-url', 'https:\/\/example.com', '--timeout-seconds', '3601']), /outside/u);
  assert.throws(() => parseExecutionArguments(['contract-guard', '--project-id']), /Missing value/u);
  assert.throws(() => parseExecutionArguments(['contract-guard', '--project-id', 'one', '--unknown', 'value']), /Unknown option/u);
  assert.throws(() => parseExecutionArguments(['contract-guard', 'positional']), /Unexpected positional/u);
});

test('rejects unsafe report paths before execution', () => {
  for (const value of ['/tmp/report.json', '../report.json', 'nested//report.json', 'nested/./report.json', 'nested\\report.json', 'line\nbreak']) {
    assert.throws(() => validateReportsRelativePath(value), /safe path/u);
  }
  assert.doesNotThrow(() => validateReportsRelativePath('nested/report.json'));
});
