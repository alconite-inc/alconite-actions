import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { RuntimeFinding } from './findings';
import { finding } from './findings';
import type { ApprovedContract, JsonObject } from './openapi';
import { isObject, resolveLocalReference } from './openapi';
import { isJsonMediaType, mediaTypesMatch, normalizeMediaType, responseForStatus, type PlannedOperation } from './operation-plan';

export interface ResponseValidationInput {
  contract: ApprovedContract;
  plan: PlannedOperation;
  statusCode: number;
  headers: Headers;
  body: Buffer;
  durationMilliseconds: number;
}

export interface ResponseValidationResult {
  findings: RuntimeFinding[];
  contentType?: string;
}

export function validateResponse(input: ResponseValidationInput): ResponseValidationResult {
  const { contract, plan, statusCode, headers, body, durationMilliseconds } = input;
  const responses = isObject(plan.operation.responses) ? plan.operation.responses : {};
  const rawResponse = responseForStatus(responses, statusCode);
  const findings: RuntimeFinding[] = [];
  if (rawResponse === undefined) {
    findings.push(responseFinding(plan, durationMilliseconds, 'runtime.response.undocumented-status',
      'The target returned an undocumented status.', 'The observed HTTP status is not present in the approved response map.',
      'Update the implementation to return a documented status or approve a revised contract.', '$response/status',
      documentedStatuses(responses), String(statusCode)));
    return { findings };
  }
  if (plan.expect.statuses && !plan.expect.statuses.includes(statusCode)) {
    findings.push(responseFinding(plan, durationMilliseconds, 'runtime.response.undocumented-status',
      'The target status did not meet the configured expectation.', 'The status is documented but excluded by the narrower Runtime Verify configuration.',
      'Return one of the configured expected statuses.', '$response/status', plan.expect.statuses.join(', '), String(statusCode)));
  }
  const response = resolveLocalReference(contract.document, rawResponse);
  if (!isObject(response)) return { findings };
  validateRequiredHeaders(contract.document, plan, response, headers, durationMilliseconds, findings);
  const observedContentType = normalizeMediaType(headers.get('content-type') ?? '');
  if (plan.method === 'HEAD' || body.length === 0) return { findings, ...(observedContentType ? { contentType: observedContentType } : {}) };
  const content = isObject(response.content) ? response.content : {};
  const selected = observedContentType
    ? Object.entries(content).find(([documented]) => mediaTypesMatch(documented, observedContentType))
    : undefined;
  if (!selected) {
    findings.push(responseFinding(plan, durationMilliseconds, 'runtime.response.content-type-mismatch',
      'The target returned an undocumented content type.', 'The response body media type does not match the approved response content map.',
      'Return a documented media type for this status.', '$response/headers/content-type',
      Object.keys(content).slice(0, 20).join(', ') || 'no response body', observedContentType ?? 'missing'));
    return { findings, ...(observedContentType ? { contentType: observedContentType } : {}) };
  }
  if (plan.expect.contentTypes && !plan.expect.contentTypes.some(expected => mediaTypesMatch(expected, observedContentType!))) {
    findings.push(responseFinding(plan, durationMilliseconds, 'runtime.response.content-type-mismatch',
      'The response content type did not meet the configured expectation.', 'The media type is documented but excluded by the narrower Runtime Verify configuration.',
      'Return one of the configured expected content types.', '$response/headers/content-type', plan.expect.contentTypes.join(', '), observedContentType));
  }
  const media = selected[0];
  const mediaObject = resolveLocalReference(contract.document, selected[1]);
  if (!isJsonMediaType(media) || !isObject(mediaObject) || mediaObject.schema === undefined) {
    return { findings, ...(observedContentType ? { contentType: observedContentType } : {}) };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString('utf8')); }
  catch {
    findings.push(responseFinding(plan, durationMilliseconds, 'runtime.response.invalid-json',
      'The target returned invalid JSON.', 'The documented JSON response could not be parsed within the runner.',
      'Return syntactically valid JSON without changing the documented media type.', '$response/body'));
    return { findings, ...(observedContentType ? { contentType: observedContentType } : {}) };
  }
  const validation = compileSchema(contract, mediaObject.schema);
  if (!validation(parsed)) {
    for (const error of (validation.errors ?? []).slice(0, 50)) findings.push(schemaFinding(plan, durationMilliseconds, error));
  }
  return { findings, ...(observedContentType ? { contentType: observedContentType } : {}) };
}

function compileSchema(contract: ApprovedContract, schema: unknown): ValidateFunction {
  const components = isObject(contract.document.components) ? structuredClone(contract.document.components) : {};
  const wrapped: JsonObject = contract.version === '3.1'
    ? { $schema: 'https://json-schema.org/draft/2020-12/schema', $ref: '#/$defs/response', $defs: { response: schema }, components }
    : { $ref: '#/definitions/response', definitions: { response: normalizeOpenApi30Schema(schema) }, components: normalizeOpenApi30Schema(components) };
  if (contract.version === '3.1') {
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
    addFormats(ajv);
    return ajv.compile(wrapped);
  }
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  return ajv.compile(wrapped);
}

function normalizeOpenApi30Schema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeOpenApi30Schema);
  if (!isObject(value)) return value;
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) result[key] = normalizeOpenApi30Schema(child);
  if (result.nullable === true) {
    if (typeof result.type === 'string') result.type = [result.type, 'null'];
    else result.anyOf = [...(Array.isArray(result.anyOf) ? result.anyOf : [{ ...result, nullable: undefined }]), { type: 'null' }];
  }
  delete result.nullable;
  for (const boundary of ['Minimum', 'Maximum'] as const) {
    const exclusive = `exclusive${boundary}`;
    const ordinary = boundary.toLowerCase();
    if (result[exclusive] === true && typeof result[ordinary] === 'number') {
      result[exclusive] = result[ordinary];
      delete result[ordinary];
    } else if (typeof result[exclusive] === 'boolean') delete result[exclusive];
  }
  return result;
}

function validateRequiredHeaders(
  document: JsonObject, plan: PlannedOperation, response: JsonObject, observed: Headers,
  duration: number, findings: RuntimeFinding[]
): void {
  const required = new Set((plan.expect.requiredHeaders ?? []).map(value => value.toLowerCase()));
  const documented = isObject(response.headers) ? response.headers : {};
  for (const [name, raw] of Object.entries(documented)) {
    const header = resolveLocalReference(document, raw);
    if (isObject(header) && header.required === true) required.add(name.toLowerCase());
  }
  for (const name of required) {
    if (!observed.has(name)) findings.push(responseFinding(plan, duration, 'runtime.response.required-header-missing',
      'A required response header was absent.', 'The target omitted a response header required by the approved contract or configuration.',
      'Return the required header for this operation and status.', `$response/headers/${name}`, name, 'missing'));
  }
}

function schemaFinding(plan: PlannedOperation, duration: number, error: ErrorObject): RuntimeFinding {
  const missing = error.keyword === 'required';
  const wrongType = error.keyword === 'type';
  const missingProperty = missing && typeof error.params.missingProperty === 'string' ? `/${escapePointer(error.params.missingProperty)}` : '';
  const location = `${error.instancePath || '/'}${missingProperty}`;
  const ruleId = missing ? 'runtime.response.required-property-missing' : wrongType ? 'runtime.response.type-mismatch' : 'runtime.response.schema-invalid';
  const summary = missing ? 'A required response property was absent.' : wrongType ? 'A response value had the wrong type.' : 'The response did not match its documented schema.';
  const explanation = missing ? 'Required property was absent.' : wrongType ? `Expected ${String(error.params.type)}; received a different JSON type.` : `The response failed the ${error.keyword} schema constraint.`;
  return responseFinding(plan, duration, ruleId, summary, explanation,
    'Update the target response to satisfy the approved OpenAPI response schema.', location,
    wrongType ? String(error.params.type) : undefined, wrongType ? 'different JSON type' : undefined);
}

function responseFinding(
  plan: PlannedOperation, duration: number, ruleId: string, summary: string,
  explanation: string, guidance: string, location: string, expected?: string, actual?: string
): RuntimeFinding {
  return finding({ operationId: plan.operationId, method: plan.method, pathTemplate: plan.pathTemplate,
    classification: 'failure', ruleId, summary, explanation, guidance, location,
    ...(expected === undefined ? {} : { expected }), ...(actual === undefined ? {} : { actual }), durationMilliseconds: duration });
}
function documentedStatuses(responses: JsonObject): string { return Object.keys(responses).slice(0, 20).join(', ') || 'none'; }
function escapePointer(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1'); }
