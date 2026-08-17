import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test, { type TestContext } from 'node:test';
import type { RuntimeDefaults } from '../../src/runtime-verify/configuration';
import type { ApprovedContract } from '../../src/runtime-verify/openapi';
import type { PlannedOperation } from '../../src/runtime-verify/operation-plan';
import { executePlan } from '../../src/runtime-verify/target-client';

const contract: ApprovedContract = {
  path: 'openapi.yaml', contentHash: `sha256:${'a'.repeat(64)}`, version: '3.1', operationCount: 1,
  document: { openapi: '3.1.0', info: { title: 'Fixture', version: '1' }, paths: {} }
};
const response = { description: 'OK', content: { 'application/json': { schema: {
  type: 'object', required: ['status'], properties: { status: { type: 'string' } }
} } } };
function plan(method: 'GET' | 'HEAD' = 'GET', requestPath = '/health'): PlannedOperation {
  return { operationId: 'getHealth', method, pathTemplate: '/health', requestPath,
    headers: { Authorization: 'Bearer super-secret' }, operation: { responses: { '200': response } }, pathItem: {}, expect: {} };
}
const defaults: RuntimeDefaults = { timeoutSeconds: 1, maximumResponseBytes: 1024, followRedirects: false };

async function server(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<URL> {
  const instance = createServer(handler);
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => { instance.closeAllConnections(); instance.close(); });
  const address = instance.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return new URL(`http://127.0.0.1:${address.port}/`);
}

test('executes a passing JSON response entirely in the runner', async t => {
  const baseUrl = await server(t, (request, reply) => {
    assert.equal(request.headers['user-agent'], 'alconite-runtime-verify-action/2.3.0');
    reply.writeHead(200, { 'content-type': 'application/json' }); reply.end('{"status":"healthy"}');
  });
  const result = await executePlan(contract, [plan()], baseUrl, defaults);
  assert.equal(result.observations[0]?.outcome, 'passed');
  assert.equal(Object.hasOwn(result.observations[0] ?? {}, 'responseBodyHash'), false);
  assert.deepEqual(result.findings, []);
});

test('reports invalid JSON and never includes the response body', async t => {
  const baseUrl = await server(t, (_request, reply) => {
    reply.writeHead(200, { 'content-type': 'application/json' }); reply.end('{session-cookie-value');
  });
  const result = await executePlan(contract, [plan()], baseUrl, defaults);
  assert.equal(result.findings[0]?.ruleId, 'runtime.response.invalid-json');
  assert.doesNotMatch(JSON.stringify(result), /session-cookie-value/);
});

test('aborts oversized decompressed responses', async t => {
  const baseUrl = await server(t, (_request, reply) => {
    reply.writeHead(200, { 'content-type': 'application/json' }); reply.end(JSON.stringify({ value: 'x'.repeat(4_000) }));
  });
  const result = await executePlan(contract, [plan()], baseUrl, { ...defaults, maximumResponseBytes: 1024 });
  assert.equal(result.findings[0]?.ruleId, 'runtime.response.too-large');
});

test('turns target timeouts into runtime findings', async t => {
  const baseUrl = await server(t, () => undefined);
  const result = await executePlan(contract, [plan()], baseUrl, { ...defaults, timeoutSeconds: 0.02 });
  assert.equal(result.findings[0]?.ruleId, 'runtime.transport.timeout');
});

test('turns connection failures into runtime findings', async () => {
  const temporary = createServer();
  await new Promise<void>(resolve => temporary.listen(0, '127.0.0.1', resolve));
  const address = temporary.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const baseUrl = new URL(`http://127.0.0.1:${address.port}/`);
  await new Promise<void>(resolve => temporary.close(() => resolve()));
  const result = await executePlan(contract, [plan()], baseUrl, defaults);
  assert.equal(result.findings[0]?.ruleId, 'runtime.transport.unreachable');
});

test('follows at most same-origin redirects when enabled and retains target headers', async t => {
  let observedAuthorization = '';
  const baseUrl = await server(t, (request, reply) => {
    if (request.url === '/start') { reply.writeHead(302, { location: '/final' }); reply.end(); return; }
    observedAuthorization = request.headers.authorization ?? '';
    reply.writeHead(200, { 'content-type': 'application/json' }); reply.end('{"status":"ok"}');
  });
  const result = await executePlan(contract, [plan('GET', '/start')], baseUrl, { ...defaults, followRedirects: true });
  assert.equal(result.observations[0]?.outcome, 'passed');
  assert.equal(observedAuthorization, 'Bearer super-secret');
});

test('rejects cross-origin redirects before forwarding secret headers', async t => {
  let forwarded = false;
  const other = await server(t, request => { forwarded = Boolean(request.headers.authorization); });
  const baseUrl = await server(t, (_request, reply) => { reply.writeHead(302, { location: other.toString() }); reply.end(); });
  const result = await executePlan(contract, [plan()], baseUrl, { ...defaults, followRedirects: true });
  assert.equal(result.findings[0]?.ruleId, 'runtime.transport.redirect-rejected');
  assert.equal(forwarded, false);
});

test('does not follow redirects by default', async t => {
  const baseUrl = await server(t, (_request, reply) => { reply.writeHead(302, { location: '/final' }); reply.end(); });
  const result = await executePlan(contract, [plan()], baseUrl, defaults);
  assert.equal(result.findings[0]?.ruleId, 'runtime.transport.redirect-rejected');
});

test('HEAD does not attempt JSON body validation', async t => {
  const baseUrl = await server(t, (_request, reply) => { reply.writeHead(200, { 'content-type': 'application/json' }); reply.end(); });
  const result = await executePlan(contract, [plan('HEAD')], baseUrl, defaults);
  assert.equal(result.observations[0]?.outcome, 'passed');
  assert.equal(result.observations[0]?.responseBytes, 0);
});
