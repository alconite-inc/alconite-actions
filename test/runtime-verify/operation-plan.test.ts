import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConfiguration } from '../../src/runtime-verify/configuration';
import type { ApprovedContract } from '../../src/runtime-verify/openapi';
import { createOperationPlan } from '../../src/runtime-verify/operation-plan';

function approved(method = 'get'): ApprovedContract {
  return {
    path: 'openapi.yaml', contentHash: `sha256:${'a'.repeat(64)}`, version: '3.1', operationCount: 1,
    document: {
      openapi: '3.1.0', info: { title: 'Fixture', version: '1' },
      paths: {
        '/customers/{customerId}': {
          [method]: {
            operationId: 'getCustomer',
            parameters: [
              { name: 'customerId', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'includeHistory', in: 'query', required: true, schema: { type: 'boolean' } }
            ],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
              '404': { description: 'Missing', content: { 'application/problem+json': { schema: { type: 'object' } } } }
            }
          }
        }
      }
    }
  };
}

function configuration(overrides: Record<string, unknown> = {}) {
  return parseConfiguration({ version: 1, operations: [{
    operationId: 'getCustomer', pathParameters: { customerId: 'a/b' }, queryParameters: { includeHistory: false },
    expect: { statuses: [200], contentTypes: ['application/json'] }, ...overrides
  }] });
}

test('plans exactly the configured safe operation and encodes primitive parameters', () => {
  const plan = createOperationPlan(approved(), configuration(), new Map([['getCustomer', { Authorization: 'secret' }]]));
  assert.equal(plan.length, 1);
  assert.equal(plan[0]?.method, 'GET');
  assert.equal(plan[0]?.requestPath, '/customers/a%2Fb?includeHistory=false');
  assert.equal(plan[0]?.pathTemplate, '/customers/{customerId}');
});

test('rejects a configured operation missing from the contract', () => {
  const config = parseConfiguration({ version: 1, operations: [{ operationId: 'missing' }] });
  assert.throws(() => createOperationPlan(approved(), config, new Map()), /missing from/);
});

test('rejects mutation operations without an unsafe override', () => {
  assert.throws(() => createOperationPlan(approved('post'), configuration(), new Map()), /GET or HEAD/);
});

test('requires every required path and query parameter', () => {
  assert.throws(() => createOperationPlan(approved(), configuration({ pathParameters: {} }), new Map()), /required path/);
  assert.throws(() => createOperationPlan(approved(), configuration({ queryParameters: {} }), new Map()), /required query/);
});

test('validates configured primitive parameter types', () => {
  assert.throws(() => createOperationPlan(approved(), configuration({ queryParameters: { includeHistory: 'false' } }), new Map()), /wrong primitive type/);
});

test('configuration expectations may narrow but cannot expand the contract', () => {
  assert.doesNotThrow(() => createOperationPlan(approved(), configuration({ expect: { statuses: [404], contentTypes: ['application/problem+json'] } }), new Map()));
  assert.throws(() => createOperationPlan(approved(), configuration({ expect: { statuses: [201] } }), new Map()), /cannot expand/);
  assert.throws(() => createOperationPlan(approved(), configuration({ expect: { contentTypes: ['text/plain'] } }), new Map()), /cannot expand/);
});

test('enforces the platform-returned operation limit', () => {
  assert.throws(() => createOperationPlan(approved(), configuration(), new Map(), 0), /operation limit/);
});
