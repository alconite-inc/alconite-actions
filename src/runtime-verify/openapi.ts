import path from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { parseDocument } from 'yaml';
import { readWorkspaceFile } from './configuration';
import { RuntimeVerifyError } from './errors';
import { sha256 } from './redaction';

export const MAX_CONTRACT_BYTES = 9 * 1024 * 1024;
export const MAX_OPENAPI_DEPTH = 100;
export const MAX_OPENAPI_OPERATIONS = 1_000;
export const MAX_OPENAPI_SCHEMAS = 5_000;
const MAX_DOCUMENT_NODES = 250_000;

export type JsonObject = Record<string, unknown>;

export interface ApprovedContract {
  path: string;
  contentHash: string;
  version: '3.0' | '3.1';
  document: JsonObject;
  operationCount: number;
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

export async function loadOpenApi(requestedPath: string, workspace: string): Promise<ApprovedContract> {
  const { bytes, resolvedPath } = await readWorkspaceFile(
    requestedPath, workspace, MAX_CONTRACT_BYTES, new Set(['.json', '.yaml', '.yml'])
  );
  let raw: unknown;
  try {
    if (path.extname(resolvedPath).toLowerCase() === '.json') raw = JSON.parse(bytes.toString('utf8'));
    else {
      const document = parseDocument(bytes.toString('utf8'), { strict: true, uniqueKeys: true });
      if (document.errors.length > 0) throw new Error('invalid YAML');
      raw = document.toJS({ maxAliasCount: 0 });
    }
  } catch {
    throw new RuntimeVerifyError('invalid_openapi', 'The selected contract is not valid JSON or YAML.');
  }
  if (!isObject(raw)) throw new RuntimeVerifyError('invalid_openapi', 'The selected contract must be an OpenAPI object.');
  const versionValue = typeof raw.openapi === 'string' ? raw.openapi : '';
  const version = versionValue.startsWith('3.0.') ? '3.0' : versionValue.startsWith('3.1.') ? '3.1' : undefined;
  if (!version) throw new RuntimeVerifyError('unsupported_openapi', 'Runtime Verify supports OpenAPI 3.0 and 3.1 contracts.');
  const limits = inspectDocument(raw);
  try {
    await SwaggerParser.validate(raw as never, { resolve: { external: false } });
  } catch {
    throw new RuntimeVerifyError('invalid_openapi', 'The selected OpenAPI contract failed structural or local-reference validation.');
  }
  assertUniqueOperationIds(raw);
  return { path: resolvedPath, contentHash: sha256(bytes), version, document: raw, operationCount: limits.operations };
}

function inspectDocument(root: JsonObject): { operations: number; schemas: number } {
  let nodes = 0;
  let schemas = 0;
  let operations = 0;
  const stack: Array<{ value: unknown; depth: number; pointer: string }> = [{ value: root, depth: 0, pointer: '#' }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_DOCUMENT_NODES) throw invalid('The OpenAPI contract contains too many document nodes.');
    if (current.depth > MAX_OPENAPI_DEPTH) throw invalid('The OpenAPI contract exceeds the maximum document depth.');
    if (Array.isArray(current.value)) {
      current.value.forEach((value, index) => stack.push({ value, depth: current.depth + 1, pointer: `${current.pointer}/${index}` }));
      continue;
    }
    if (!isObject(current.value)) continue;
    const reference = current.value.$ref;
    if (typeof reference === 'string' && !reference.startsWith('#')) {
      throw invalid('Remote and filesystem OpenAPI references are not supported.');
    }
    if (current.pointer.startsWith('#/components/schemas/') && current.pointer.split('/').length === 4) schemas += 1;
    if (schemas > MAX_OPENAPI_SCHEMAS) throw invalid(`The OpenAPI contract may contain at most ${MAX_OPENAPI_SCHEMAS} component schemas.`);
    if (current.pointer.startsWith('#/paths/') && current.pointer.split('/').length === 3) {
      for (const key of Object.keys(current.value)) if (HTTP_METHODS.has(key.toLowerCase())) operations += 1;
      if (operations > MAX_OPENAPI_OPERATIONS) throw invalid(`The OpenAPI contract may contain at most ${MAX_OPENAPI_OPERATIONS} operations.`);
    }
    for (const [key, value] of Object.entries(current.value)) {
      stack.push({ value, depth: current.depth + 1, pointer: `${current.pointer}/${escapePointer(key)}` });
    }
  }
  return { operations, schemas };
}

function assertUniqueOperationIds(document: JsonObject): void {
  const seen = new Set<string>();
  const paths = isObject(document.paths) ? document.paths : {};
  for (const pathItem of Object.values(paths)) {
    if (!isObject(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isObject(operation) || typeof operation.operationId !== 'string') continue;
      if (seen.has(operation.operationId)) throw invalid('The OpenAPI contract contains duplicate operationId values.');
      seen.add(operation.operationId);
    }
  }
}

export function resolveLocalReference(document: JsonObject, value: unknown, maximumHops = 64): unknown {
  let current = value;
  const seen = new Set<string>();
  for (let hop = 0; hop <= maximumHops; hop += 1) {
    if (!isObject(current) || typeof current.$ref !== 'string') return current;
    const reference = current.$ref;
    if (!reference.startsWith('#/')) throw invalid('Only local in-document OpenAPI references are supported.');
    if (seen.has(reference)) throw invalid('A cyclic local reference exceeded the bounded resolver policy.');
    seen.add(reference);
    current = reference.slice(2).split('/').reduce<unknown>((parent, token) => {
      if (!isObject(parent) && !Array.isArray(parent)) return undefined;
      return (parent as Record<string, unknown>)[unescapePointer(token)];
    }, document);
    if (current === undefined) throw invalid('The OpenAPI contract contains an unresolved local reference.');
  }
  throw invalid('A local OpenAPI reference exceeds the bounded resolver depth.');
}

export function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalid(message: string): RuntimeVerifyError { return new RuntimeVerifyError('invalid_openapi', message); }
function escapePointer(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1'); }
function unescapePointer(value: string): string { return value.replaceAll('~1', '/').replaceAll('~0', '~'); }
