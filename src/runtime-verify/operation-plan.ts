import type { RuntimeConfiguration, RuntimeOperationConfiguration } from './configuration';
import { RuntimeVerifyError } from './errors';
import type { ApprovedContract, JsonObject } from './openapi';
import { isObject, resolveLocalReference } from './openapi';

export interface PlannedOperation {
  operationId: string;
  method: 'GET' | 'HEAD';
  pathTemplate: string;
  requestPath: string;
  headers: Record<string, string>;
  operation: JsonObject;
  pathItem: JsonObject;
  expect: RuntimeOperationConfiguration['expect'];
}

interface LocatedOperation {
  method: string;
  pathTemplate: string;
  pathItem: JsonObject;
  operation: JsonObject;
}

export function createOperationPlan(
  contract: ApprovedContract,
  configuration: RuntimeConfiguration,
  resolvedHeaders: Map<string, Record<string, string>>,
  platformMaximumOperations?: number
): PlannedOperation[] {
  if (platformMaximumOperations !== undefined && configuration.operations.length > platformMaximumOperations) {
    throw planError('The configuration exceeds the operation limit returned by Alconite.');
  }
  const operations = indexOperations(contract.document);
  return configuration.operations.map(configured => {
    const located = operations.get(configured.operationId);
    if (!located) throw planError(`Configured operation ${configured.operationId} is missing from the approved contract.`);
    const method = located.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') throw planError(`Configured operation ${configured.operationId} does not use GET or HEAD.`);
    const parameters = collectParameters(contract.document, located.pathItem, located.operation);
    validateRequiredParameters(parameters, configured);
    validateConfiguredParameters(contract.document, parameters, configured);
    validateExpectations(contract.document, located.operation, configured);
    const expandedPath = expandPath(located.pathTemplate, configured.pathParameters);
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(configured.queryParameters)) query.append(name, String(value));
    const requestPath = query.size === 0 ? expandedPath : `${expandedPath}?${query.toString()}`;
    return {
      operationId: configured.operationId,
      method,
      pathTemplate: located.pathTemplate,
      requestPath,
      headers: resolvedHeaders.get(configured.operationId) ?? {},
      operation: located.operation,
      pathItem: located.pathItem,
      expect: configured.expect
    };
  });
}

function indexOperations(document: JsonObject): Map<string, LocatedOperation> {
  const result = new Map<string, LocatedOperation>();
  const paths = isObject(document.paths) ? document.paths : {};
  for (const [pathTemplate, rawPathItem] of Object.entries(paths)) {
    const pathItem = resolveLocalReference(document, rawPathItem);
    if (!isObject(pathItem)) continue;
    for (const method of ['get', 'head', 'post', 'put', 'patch', 'delete', 'options', 'trace']) {
      const operation = pathItem[method];
      if (!isObject(operation) || typeof operation.operationId !== 'string') continue;
      result.set(operation.operationId, { method, pathTemplate, pathItem, operation });
    }
  }
  return result;
}

function collectParameters(document: JsonObject, pathItem: JsonObject, operation: JsonObject): JsonObject[] {
  const combined = [...array(pathItem.parameters), ...array(operation.parameters)]
    .map(value => resolveLocalReference(document, value))
    .filter(isObject);
  const unique = new Map<string, JsonObject>();
  for (const parameter of combined) {
    if (typeof parameter.name === 'string' && typeof parameter.in === 'string') unique.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...unique.values()];
}

function validateRequiredParameters(parameters: JsonObject[], configured: RuntimeOperationConfiguration): void {
  for (const parameter of parameters) {
    const name = parameter.name as string;
    if (parameter.in === 'path' && parameter.required === true && configured.pathParameters[name] === undefined) {
      throw planError(`Operation ${configured.operationId} is missing a required path parameter.`);
    }
    if (parameter.in === 'query' && parameter.required === true && configured.queryParameters[name] === undefined) {
      const schema = isObject(parameter.schema) ? parameter.schema : {};
      if (schema.default === undefined) throw planError(`Operation ${configured.operationId} is missing a required query parameter.`);
      configured.queryParameters[name] = schema.default as string | number | boolean;
    }
  }
}

function validateConfiguredParameters(document: JsonObject, parameters: JsonObject[], configured: RuntimeOperationConfiguration): void {
  for (const [location, values] of [['path', configured.pathParameters], ['query', configured.queryParameters]] as const) {
    for (const [name, value] of Object.entries(values)) {
      const parameter = parameters.find(candidate => candidate.in === location && candidate.name === name);
      if (!parameter) throw planError(`Operation ${configured.operationId} configures an undocumented ${location} parameter.`);
      const resolvedSchema = resolveLocalReference(document, parameter.schema);
      const schema = isObject(resolvedSchema) ? resolvedSchema : {};
      const expectedType = schema.type;
      if (typeof expectedType === 'string' && expectedType !== 'string' && typeof value !== expectedType) {
        if (!(expectedType === 'integer' && typeof value === 'number' && Number.isInteger(value))) {
          throw planError(`Operation ${configured.operationId} has a parameter with the wrong primitive type.`);
        }
      }
      if (['object', 'array'].includes(String(expectedType))) throw planError('Runtime Verify version 1 supports only primitive parameter values.');
    }
  }
}

function validateExpectations(document: JsonObject, operation: JsonObject, configured: RuntimeOperationConfiguration): void {
  const responses = isObject(operation.responses) ? operation.responses : {};
  for (const status of configured.expect.statuses ?? []) {
    if (!responseForStatus(responses, status)) throw planError('Configuration expectations cannot expand documented response statuses.');
  }
  for (const contentType of configured.expect.contentTypes ?? []) {
    const normalized = normalizeMediaType(contentType);
    if (!normalized || !Object.entries(responses).some(([, raw]) => {
      const response = resolveLocalReference(document, raw);
      return isObject(response) && isObject(response.content) && Object.keys(response.content).some(type => mediaTypesMatch(type, normalized));
    })) throw planError('Configuration expectations cannot expand documented response content types.');
  }
}

export function responseForStatus(responses: JsonObject, status: number): unknown {
  const exact = responses[String(status)];
  if (exact !== undefined) return exact;
  const range = responses[`${Math.floor(status / 100)}XX`] ?? responses[`${Math.floor(status / 100)}xx`];
  return range ?? responses.default;
}

export function normalizeMediaType(value: string): string | undefined {
  const normalized = value.split(';', 1)[0]?.trim().toLowerCase();
  return normalized && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized) ? normalized : undefined;
}

export function mediaTypesMatch(documented: string, observed: string): boolean {
  const left = normalizeMediaType(documented);
  const right = normalizeMediaType(observed);
  if (!left || !right) return false;
  if (left === right || left === '*/*') return true;
  const [leftType, leftSubtype] = left.split('/');
  const [rightType, rightSubtype] = right.split('/');
  if (leftType !== '*' && leftType !== rightType) return false;
  return leftSubtype === '*' || leftSubtype === rightSubtype;
}

export function isJsonMediaType(value: string): boolean {
  const normalized = normalizeMediaType(value);
  return normalized === 'application/json' || normalized?.endsWith('+json') === true;
}

function expandPath(template: string, parameters: Record<string, string | number | boolean>): string {
  const expanded = template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = parameters[name];
    if (value === undefined) throw planError('A required path parameter has no configured value.');
    return encodeURIComponent(String(value));
  });
  if (expanded.includes('{') || expanded.includes('}')) throw planError('The OpenAPI path template could not be safely expanded.');
  return expanded.startsWith('/') ? expanded : `/${expanded}`;
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function planError(message: string): RuntimeVerifyError { return new RuntimeVerifyError('operation_plan_invalid', message); }
