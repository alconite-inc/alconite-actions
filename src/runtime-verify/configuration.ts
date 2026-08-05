import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { RuntimeVerifyError } from './errors';
import { sha256 } from './redaction';

export const MAX_CONFIGURATION_BYTES = 1024 * 1024;
export const MAX_CONFIGURED_OPERATIONS = 100;

export interface RuntimeDefaults {
  timeoutSeconds: number;
  maximumResponseBytes: number;
  followRedirects: boolean;
}

export type HeaderValue = { value: string } | { fromEnvironment: string };

export interface RuntimeExpectation {
  statuses?: number[];
  contentTypes?: string[];
  requiredHeaders?: string[];
}

export interface RuntimeOperationConfiguration {
  operationId: string;
  pathParameters: Record<string, string | number | boolean>;
  queryParameters: Record<string, string | number | boolean>;
  headers: Record<string, HeaderValue>;
  expect: RuntimeExpectation;
}

export interface RuntimeConfiguration {
  version: 1;
  defaults: RuntimeDefaults;
  operations: RuntimeOperationConfiguration[];
}

export interface LoadedConfiguration {
  path: string;
  contentHash: string;
  configuration: RuntimeConfiguration;
  resolvedHeaders: Map<string, Record<string, string>>;
  secrets: string[];
}

const TOP_LEVEL_FIELDS = new Set(['version', 'defaults', 'operations']);
const DEFAULT_FIELDS = new Set(['timeoutSeconds', 'maximumResponseBytes', 'followRedirects']);
const OPERATION_FIELDS = new Set(['operationId', 'pathParameters', 'queryParameters', 'headers', 'expect']);
const EXPECT_FIELDS = new Set(['statuses', 'contentTypes', 'requiredHeaders']);
const HEADER_FIELDS = new Set(['value', 'fromEnvironment']);
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const FORBIDDEN_HEADERS = new Set([
  'connection', 'content-length', 'host', 'keep-alive', 'proxy-authenticate', 'proxy-connection',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'
]);
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie', 'x-api-key']);

export async function readWorkspaceFile(
  requestedPath: string,
  workspace: string,
  maximumBytes: number,
  extensions?: ReadonlySet<string>
): Promise<{ bytes: Buffer; resolvedPath: string }> {
  const workspaceReal = await realpath(workspace).catch(() => path.resolve(workspace));
  const candidate = path.resolve(workspaceReal, requestedPath);
  if (!isWithin(workspaceReal, candidate)) {
    throw new RuntimeVerifyError('invalid_input', 'The selected file must be beneath GITHUB_WORKSPACE.');
  }
  const resolvedPath = await realpath(candidate).catch(() => candidate);
  if (!isWithin(workspaceReal, resolvedPath)) {
    throw new RuntimeVerifyError('invalid_input', 'The selected file resolves outside GITHUB_WORKSPACE.');
  }
  const fileStat = await lstat(resolvedPath).catch(() => undefined);
  if (!fileStat?.isFile()) {
    throw new RuntimeVerifyError('invalid_input', 'The selected file is not a regular file.');
  }
  if (extensions && !extensions.has(path.extname(resolvedPath).toLowerCase())) {
    throw new RuntimeVerifyError('invalid_input', 'The selected contract must use .json, .yaml, or .yml.');
  }
  if (fileStat.size > maximumBytes) {
    throw new RuntimeVerifyError('invalid_input', `The selected file exceeds the ${maximumBytes}-byte limit.`);
  }
  return { bytes: await readFile(resolvedPath), resolvedPath };
}

export async function loadConfiguration(
  requestedPath: string,
  workspace: string,
  environment: NodeJS.ProcessEnv,
  maskSecret: (value: string) => void
): Promise<LoadedConfiguration> {
  const { bytes, resolvedPath } = await readWorkspaceFile(requestedPath, workspace, MAX_CONFIGURATION_BYTES);
  let raw: unknown;
  try {
    if (path.extname(resolvedPath).toLowerCase() === '.json') raw = JSON.parse(bytes.toString('utf8'));
    else {
      const document = parseDocument(bytes.toString('utf8'), { strict: true, uniqueKeys: true });
      if (document.errors.length > 0) throw new Error('invalid YAML');
      raw = document.toJS({ maxAliasCount: 0 });
    }
  } catch {
    throw new RuntimeVerifyError('invalid_configuration', 'Runtime Verify configuration is not valid JSON or YAML.');
  }
  const configuration = parseConfiguration(raw);
  const resolvedHeaders = new Map<string, Record<string, string>>();
  const secrets: string[] = [];
  for (const operation of configuration.operations) {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(operation.headers)) {
      if ('value' in value) headers[name] = safeHeaderValue(value.value);
      else {
        const secret = environment[value.fromEnvironment];
        if (!secret) {
          throw new RuntimeVerifyError('invalid_configuration', 'A configured target secret environment variable is missing or empty.');
        }
        maskSecret(secret);
        safeHeaderValue(secret);
        secrets.push(secret);
        headers[name] = secret;
      }
    }
    resolvedHeaders.set(operation.operationId, headers);
  }
  return { path: resolvedPath, contentHash: sha256(bytes), configuration, resolvedHeaders, secrets };
}

export function parseConfiguration(raw: unknown): RuntimeConfiguration {
  const root = object(raw, 'configuration');
  unknownFields(root, TOP_LEVEL_FIELDS, 'configuration');
  if (root.version !== 1) throw invalid('Only Runtime Verify configuration version 1 is supported.');
  const defaultsRaw = root.defaults === undefined ? {} : object(root.defaults, 'defaults');
  unknownFields(defaultsRaw, DEFAULT_FIELDS, 'defaults');
  const defaults: RuntimeDefaults = {
    timeoutSeconds: boundedInteger(defaultsRaw.timeoutSeconds ?? 10, 1, 120, 'defaults.timeoutSeconds'),
    maximumResponseBytes: boundedInteger(defaultsRaw.maximumResponseBytes ?? 1_048_576, 1_024, 10_485_760, 'defaults.maximumResponseBytes'),
    followRedirects: boolean(defaultsRaw.followRedirects ?? false, 'defaults.followRedirects')
  };
  if (!Array.isArray(root.operations) || root.operations.length === 0) throw invalid('Configuration must list at least one operation.');
  if (root.operations.length > MAX_CONFIGURED_OPERATIONS) throw invalid(`Configuration may list at most ${MAX_CONFIGURED_OPERATIONS} operations.`);
  const seen = new Set<string>();
  const operations = root.operations.map((entry, index) => parseOperation(entry, index, seen));
  return { version: 1, defaults, operations };
}

function parseOperation(raw: unknown, index: number, seen: Set<string>): RuntimeOperationConfiguration {
  const context = `operations[${index}]`;
  const value = object(raw, context);
  unknownFields(value, OPERATION_FIELDS, context);
  const operationId = nonEmpty(value.operationId, `${context}.operationId`, 160);
  if (seen.has(operationId)) throw invalid('Configured operationId values must be unique.');
  seen.add(operationId);
  const headersRaw = optionalObject(value.headers, `${context}.headers`);
  const headers: Record<string, HeaderValue> = {};
  for (const [name, rawHeader] of Object.entries(headersRaw)) {
    if (!HEADER_NAME.test(name) || FORBIDDEN_HEADERS.has(name.toLowerCase())) throw invalid('Configuration contains an unsafe header override.');
    const header = object(rawHeader, `${context}.headers`);
    unknownFields(header, HEADER_FIELDS, `${context}.headers`);
    if (Object.keys(header).length !== 1) throw invalid('Each header must use exactly one supported value form.');
    if (header.value !== undefined) {
      if (SENSITIVE_HEADERS.has(name.toLowerCase())) throw invalid('Sensitive target headers must use fromEnvironment.');
      headers[name] = { value: nonEmpty(header.value, `${context}.headers.value`, 2_000) };
    } else {
      const fromEnvironment = nonEmpty(header.fromEnvironment, `${context}.headers.fromEnvironment`, 128);
      if (!ENVIRONMENT_NAME.test(fromEnvironment)) throw invalid('Environment-variable names must use uppercase letters, digits, and underscores.');
      headers[name] = { fromEnvironment };
    }
  }
  const expectRaw = optionalObject(value.expect, `${context}.expect`);
  unknownFields(expectRaw, EXPECT_FIELDS, `${context}.expect`);
  return {
    operationId,
    pathParameters: primitiveMap(value.pathParameters, `${context}.pathParameters`),
    queryParameters: primitiveMap(value.queryParameters, `${context}.queryParameters`),
    headers,
    expect: {
      ...(expectRaw.statuses === undefined ? {} : { statuses: numberArray(expectRaw.statuses, `${context}.expect.statuses`) }),
      ...(expectRaw.contentTypes === undefined ? {} : { contentTypes: stringArray(expectRaw.contentTypes, `${context}.expect.contentTypes`) }),
      ...(expectRaw.requiredHeaders === undefined ? {} : { requiredHeaders: stringArray(expectRaw.requiredHeaders, `${context}.expect.requiredHeaders`) })
    }
  };
}

function primitiveMap(raw: unknown, context: string): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(optionalObject(raw, context))) {
    if (!/^[A-Za-z0-9_.-]{1,160}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof value)) throw invalid(`${context} must contain bounded primitive values.`);
    const primitive = value as string | number | boolean;
    if (typeof primitive === 'string' && primitive.length > 2_000) throw invalid(`${context} contains an oversized value.`);
    result[key] = primitive;
  }
  return result;
}

function object(raw: unknown, context: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid(`${context} must be an object.`);
  return raw as Record<string, unknown>;
}
function optionalObject(raw: unknown, context: string): Record<string, unknown> { return raw === undefined ? {} : object(raw, context); }
function unknownFields(value: Record<string, unknown>, allowed: Set<string>, context: string): void {
  if (Object.keys(value).some(key => !allowed.has(key))) throw invalid(`${context} contains an unknown field.`);
}
function nonEmpty(raw: unknown, context: string, maximum: number): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > maximum) throw invalid(`${context} must be a non-empty bounded string.`);
  return raw;
}
function boundedInteger(raw: unknown, minimum: number, maximum: number, context: string): number {
  if (!Number.isInteger(raw) || (raw as number) < minimum || (raw as number) > maximum) throw invalid(`${context} must be an integer from ${minimum} through ${maximum}.`);
  return raw as number;
}
function boolean(raw: unknown, context: string): boolean { if (typeof raw !== 'boolean') throw invalid(`${context} must be a boolean.`); return raw; }
function numberArray(raw: unknown, context: string): number[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) throw invalid(`${context} must be a non-empty bounded array.`);
  return raw.map(value => boundedInteger(value, 100, 599, context));
}
function stringArray(raw: unknown, context: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) throw invalid(`${context} must be a non-empty bounded array.`);
  return raw.map(value => nonEmpty(value, context, 160));
}
function invalid(message: string): RuntimeVerifyError { return new RuntimeVerifyError('invalid_configuration', message); }
function safeHeaderValue(value: string): string {
  if (value.length > 8_192 || /[\0\r\n]/.test(value)) throw invalid('A configured target header value is invalid or too long.');
  return value;
}
function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
