import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApprovedContract } from '../../src/runtime-verify/openapi';
import type { PlannedOperation } from '../../src/runtime-verify/operation-plan';
import { validateResponse } from '../../src/runtime-verify/response-validator';

const contract: ApprovedContract = {
  path: 'openapi.yaml', contentHash: `sha256:${'a'.repeat(64)}`, version: '3.1', operationCount: 1,
  document: {
    openapi: '3.1.0', info: { title: 'Fixture', version: '1' }, components: { schemas: {
      Health: { type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string' } } }
    } }, paths: {}
  }
};

const operation = {
  responses: {
    '200': {
      description: 'OK', headers: { 'X-Request-Id': { required: true, schema: { type: 'string' } } },
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } }
    },
    '4XX': { description: 'Problem', content: { 'application/problem+json': { schema: { type: 'object' } } } }
  }
};

function plan(expect: PlannedOperation['expect'] = {}): PlannedOperation {
  return { operationId: 'getHealth', method: 'GET', pathTemplate: '/health', requestPath: '/health', headers: {}, operation, pathItem: {}, expect };
}

function validate(status: number, contentType: string, body: string, headers: Record<string, string> = {}, expect = {}) {
  return validateResponse({
    contract, plan: plan(expect), statusCode: status,
    headers: new Headers({ 'content-type': contentType, 'x-request-id': 'request', ...headers }),
    body: Buffer.from(body), durationMilliseconds: 4
  });
}

test('accepts a passing documented JSON response', () => {
  assert.deepEqual(validate(200, 'application/json; charset=utf-8', '{"status":"healthy"}').findings, []);
});

test('matches range statuses and JSON-compatible problem media types', () => {
  assert.deepEqual(validate(404, 'application/problem+json', '{"title":"missing"}').findings, []);
});

test('reports undocumented status without a body excerpt', () => {
  const result = validate(503, 'text/plain', 'top secret response');
  assert.equal(result.findings[0]?.ruleId, 'runtime.response.undocumented-status');
  assert.doesNotMatch(JSON.stringify(result), /top secret/);
});

test('reports content-type mismatch', () => {
  assert.equal(validate(200, 'text/plain', 'hello').findings.at(-1)?.ruleId, 'runtime.response.content-type-mismatch');
});

test('reports invalid JSON without body contents', () => {
  const result = validate(200, 'application/json', '{secret');
  assert.equal(result.findings.at(-1)?.ruleId, 'runtime.response.invalid-json');
  assert.doesNotMatch(JSON.stringify(result), /\{secret/);
});

test('reports missing properties and type mismatches without observed values', () => {
  assert.equal(validate(200, 'application/json', '{}').findings.at(-1)?.ruleId, 'runtime.response.required-property-missing');
  const wrongType = validate(200, 'application/json', '{"status":42}');
  assert.equal(wrongType.findings.at(-1)?.ruleId, 'runtime.response.type-mismatch');
  assert.doesNotMatch(JSON.stringify(wrongType), /42/);
});

test('reports missing contract-required and configuration-required headers case-insensitively', () => {
  const result = validateResponse({ contract, plan: plan({ requiredHeaders: ['X-Correlation-Id'] }), statusCode: 200,
    headers: new Headers({ 'content-type': 'application/json' }), body: Buffer.from('{"status":"ok"}'), durationMilliseconds: 1 });
  assert.equal(result.findings.filter(value => value.ruleId === 'runtime.response.required-header-missing').length, 2);
});

test('HEAD skips JSON body validation', () => {
  const head = { ...plan(), method: 'HEAD' as const };
  const result = validateResponse({ contract, plan: head, statusCode: 200,
    headers: new Headers({ 'content-type': 'application/json', 'x-request-id': 'request' }), body: Buffer.alloc(0), durationMilliseconds: 1 });
  assert.deepEqual(result.findings, []);
});

test('applies OpenAPI 3.0 nullable response semantics', () => {
  const openapi30: ApprovedContract = { ...contract, version: '3.0', document: { openapi: '3.0.3', info: {}, paths: {} } };
  const nullablePlan = { ...plan(), operation: { responses: { '200': { description: 'OK', content: {
    'application/json': { schema: { type: 'object', required: ['value'], properties: { value: { type: 'string', nullable: true } } } }
  } } } } };
  const result = validateResponse({ contract: openapi30, plan: nullablePlan, statusCode: 200,
    headers: new Headers({ 'content-type': 'application/json' }), body: Buffer.from('{"value":null}'), durationMilliseconds: 1 });
  assert.deepEqual(result.findings, []);
});
