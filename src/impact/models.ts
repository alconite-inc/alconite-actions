export const IMPACT_REPORT_SCHEMA_VERSION = 'alconite.impact.report.v1' as const;
export const CLIENT_COLLECTION_SCHEMA_VERSION = 'alconite.impact.client-collection.v1' as const;
export const MAX_REPORT_BYTES = 8 * 1024 * 1024;

export const RISK_VALUES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type ImpactRisk = (typeof RISK_VALUES)[number];
export const CONFIDENCE_VALUES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ImpactConfidence = (typeof CONFIDENCE_VALUES)[number];
export const SOURCE_LANGUAGES = ['RUST', 'JAVA', 'TYPESCRIPT', 'JAVASCRIPT'] as const;
export type SourceLanguage = (typeof SOURCE_LANGUAGES)[number];

export const SKIP_CODES = [
  'FIXED_IGNORE',
  'GITIGNORE',
  'ADDITIONAL_IGNORE',
  'UNSUPPORTED_FILE',
  'BINARY_FILE',
  'INVALID_UTF8',
  'FILE_TOO_LARGE',
  'SYMLINK_OR_REPARSE',
  'PATH_TOO_LONG',
  'DEPTH_EXCEEDED',
] as const;
export type SkipCode = (typeof SKIP_CODES)[number];

export const EVIDENCE_TYPES = [
  'OPERATION_ID',
  'ENDPOINT_PATH',
  'SCHEMA_NAME',
  'PROPERTY_REFERENCE',
  'PARAMETER_REFERENCE',
  'SERDE_RENAME',
  'JACKSON_PROPERTY',
  'TYPE_REFERENCE',
  'CLIENT_METHOD',
  'HTTP_CALL',
  'ENUM_REFERENCE',
] as const;
export type ImpactEvidenceType = (typeof EVIDENCE_TYPES)[number];

export const CONFIDENCE_CONDITIONS = [
  'METHOD_PATH_CALL',
  'MATCHING_TYPE_MEMBER',
  'OWNED_ENUM',
  'OWNED_PARAMETER',
  'OPERATION_PATH_CALL',
  'QUALIFIED_MEMBER',
  'EXACT_CLIENT_METHOD',
  'EXACT_TYPE',
  'UNIQUE_UNQUALIFIED_PROPERTY',
  'ISOLATED_PATH',
  'ISOLATED_SCHEMA',
] as const;

export const WARNING_CODES = [
  'BINARY_FILE_SKIPPED',
  'INVALID_UTF8_SKIPPED',
  'FILE_TOO_LARGE_SKIPPED',
  'PATH_TOO_LONG_SKIPPED',
  'DEPTH_EXCEEDED',
  'SYMLINK_SKIPPED',
  'FILE_READ_FAILED',
  'MALFORMED_SOURCE',
  'EVIDENCE_TRUNCATED',
  'AFFECTED_SOURCES_TRUNCATED',
  'REPORT_TRUNCATED',
  'WARNINGS_TRUNCATED',
] as const;

export const CHANGE_KINDS = [
  'ENDPOINT_ADDED',
  'ENDPOINT_REMOVED',
  'HTTP_METHOD_ADDED',
  'HTTP_METHOD_REMOVED',
  'PARAMETER_ADDED',
  'REQUIRED_PARAMETER_ADDED',
  'PARAMETER_REMOVED',
  'PARAMETER_TYPE_CHANGED',
  'PARAMETER_REQUIREMENT_CHANGED',
  'PARAMETER_CONSTRAINT_CHANGED',
  'PARAMETER_ENUM_VALUE_ADDED',
  'PARAMETER_ENUM_VALUE_REMOVED',
  'REQUEST_BODY_ADDED',
  'REQUIRED_REQUEST_BODY_ADDED',
  'REQUEST_BODY_REMOVED',
  'REQUEST_BODY_REQUIREMENT_CHANGED',
  'REQUEST_SCHEMA_CHANGED',
  'REQUEST_MEDIA_TYPE_ADDED',
  'REQUEST_MEDIA_TYPE_REMOVED',
  'RESPONSE_ADDED',
  'RESPONSE_REMOVED',
  'RESPONSE_SCHEMA_CHANGED',
  'RESPONSE_MEDIA_TYPE_ADDED',
  'RESPONSE_MEDIA_TYPE_REMOVED',
  'SCHEMA_ADDED',
  'SCHEMA_REMOVED',
  'PROPERTY_ADDED',
  'PROPERTY_REMOVED',
  'PROPERTY_TYPE_CHANGED',
  'PROPERTY_REQUIREMENT_CHANGED',
  'PROPERTY_CONSTRAINT_CHANGED',
  'REQUIRED_REQUEST_PROPERTY_ADDED',
  'ENUM_VALUE_ADDED',
  'ENUM_VALUE_REMOVED',
  'OPERATION_ID_CHANGED',
  'DEPRECATION_CHANGED',
  'SECURITY_REQUIREMENT_STRENGTHENED',
  'SECURITY_REQUIREMENT_WEAKENED',
  'SECURITY_SCHEME_ADDED',
  'SECURITY_SCHEME_REMOVED',
  'SECURITY_SCOPE_ADDED',
  'SECURITY_SCOPE_REMOVED',
  'SERVER_ADDED',
  'SERVER_REMOVED',
  'METADATA_CHANGED',
  'ANALYZER_REGRESSION',
  'ANALYZER_RESOLUTION',
] as const;
export type ContractChangeKind = (typeof CHANGE_KINDS)[number];

export interface ClientCollectionMetadata {
  schemaVersion: typeof CLIENT_COLLECTION_SCHEMA_VERSION;
  entriesVisited: number;
  directoriesVisited: number;
  filesDiscovered: number;
  filesSubmitted: number;
  filesSkipped: number;
  skipCounts: Partial<Record<SkipCode, number>>;
  collectionDurationMs: number;
}

export interface InlineSourceFile {
  path: string;
  content: string;
}

export interface ImpactRequest {
  source: {
    logicalRoot: string;
    files: InlineSourceFile[];
    clientCollection: ClientCollectionMetadata;
  };
  options: {
    languages: SourceLanguage[];
    includeGeneratedDirectories: boolean;
    additionalIgnorePatterns: string[];
  };
}

export interface ImpactEvidence {
  type: ImpactEvidenceType;
  value: string;
}

export interface AffectedSource {
  file: string;
  line: number;
  column: number;
  language: SourceLanguage;
  confidence: ImpactConfidence;
  evidence: ImpactEvidence[];
}

export interface ChangeSubject {
  operation: null | {
    path: string;
    method: string;
    baselineOperationId: string | null;
    candidateOperationId: string | null;
  };
  schema: null | { name: string; property: string | null; uses: Array<'REQUEST' | 'RESPONSE' | 'UNKNOWN'> };
  parameter: null | { name: string; location: 'PATH' | 'QUERY' | 'HEADER' | 'COOKIE' };
  responseStatus: string | null;
  mediaType: string | null;
  enumValue: string | null;
  securityScheme: string | null;
  securityScope: string | null;
  metadataPointer: string | null;
}

export interface ImpactChange {
  id: string;
  deltaFingerprint: string;
  kind: ContractChangeKind;
  classification: 'breaking' | 'risky' | 'non_breaking' | 'informational';
  category: string;
  ruleId: string;
  ruleVersion: number;
  summary: string;
  explanation: string;
  baselineValue: string | null;
  candidateValue: string | null;
  subject: ChangeSubject;
  potentialRisk: ImpactRisk;
  risk: ImpactRisk;
  confidence: ImpactConfidence | null;
  confidenceBasis: {
    level: ImpactConfidence | null;
    conditions: Array<(typeof CONFIDENCE_CONDITIONS)[number]>;
    evidenceTypes: ImpactEvidenceType[];
    criticalRisk: null | Record<string, unknown>;
  };
  affectedLocationCount: number;
  returnedAffectedLocationCount: number;
  omittedAffectedLocationCount: number;
  affectedFileCount: number;
  highConfidenceFileCount: number;
  affectedSources: AffectedSource[];
  recommendation: { code: string; message: string };
}

export interface ImpactReport {
  schemaVersion: typeof IMPACT_REPORT_SCHEMA_VERSION;
  analysisFingerprint: string;
  contract: {
    type: 'CONTRACT_GUARD_CHECK';
    projectId: string;
    checkId: string;
    baselineVersionId: string;
    candidateVersionId: string;
    baselineContentHash: string;
    candidateContentHash: string;
    baselineOpenapiVersion: string;
    candidateOpenapiVersion: string;
  };
  engines: {
    analyzerVersion: string;
    analyzerRuleSetVersion: number;
    analyzerCompatibilityVersion: number;
    legacyComparisonEngineVersion: number;
    contractDeltaEngineVersion: number;
    impactAnalysisEngineVersion: number;
  };
  overallRisk: ImpactRisk;
  overallPotentialRisk: ImpactRisk;
  breakingChanges: number;
  affectedFiles: number;
  affectedSourceLocations: number;
  changes: ImpactChange[];
  metadata: {
    serverScan: Record<string, unknown>;
    clientCollection?: Record<string, unknown>;
    languagesDetected: SourceLanguage[];
    warnings: Array<{ code: string; message: string; path?: string }>;
    warningsOmitted: number;
    truncated: boolean;
    totalAffectedSourceLocations: number;
    returnedAffectedSourceLocations: number;
    changesWithoutReturnedLocations: number;
    analysisDurationMs: number;
  };
}

export class ImpactContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ImpactContractError';
  }
}

const HTTP_METHODS = new Set(['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH', 'TRACE']);
const CLASSIFICATIONS = new Set(['breaking', 'risky', 'non_breaking', 'informational']);
const CATEGORIES = new Set([
  'operation', 'parameter', 'request_body', 'response', 'schema', 'security', 'server', 'media_type', 'metadata',
  'analyzer_regression', 'analyzer_resolution',
]);
const RISK_SET = new Set<string>(RISK_VALUES);
const CONFIDENCE_SET = new Set<string>(CONFIDENCE_VALUES);
const LANGUAGE_SET = new Set<string>(SOURCE_LANGUAGES);
const EVIDENCE_SET = new Set<string>(EVIDENCE_TYPES);
const CONDITION_SET = new Set<string>(CONFIDENCE_CONDITIONS);
const WARNING_SET = new Set<string>(WARNING_CODES);
const CHANGE_KIND_SET = new Set<string>(CHANGE_KINDS);
const SKIP_CODE_SET = new Set<string>(SKIP_CODES);

function mismatch(message: string): never {
  throw new ImpactContractError(`Alconite returned an invalid Impact report: ${message}`);
}

function record(value: unknown, context: string, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) mismatch(`${context} must be an object`);
  const result = value as Record<string, unknown>;
  const allowed = new Set([...keys, ...optional]);
  for (const key of Object.keys(result)) if (!allowed.has(key)) mismatch(`${context} contains an unknown field`);
  for (const key of keys) if (!(key in result)) mismatch(`${context} omitted a required field`);
  return result;
}

function stringValue(value: unknown, context: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') mismatch(`${context} must be a string`);
  const scalars = [...value].length;
  if (scalars < minimum || scalars > maximum) mismatch(`${context} is outside its supported bound`);
  return value;
}

function byteString(value: unknown, context: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') mismatch(`${context} must be a string`);
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes < minimum || bytes > maximum) mismatch(`${context} is outside its supported byte bound`);
  return value;
}

function nullableString(value: unknown, context: string, maximum: number): string | null {
  return value === null ? null : stringValue(value, context, 1, maximum);
}

function integer(value: unknown, context: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    mismatch(`${context} must be a bounded integer`);
  }
  return value as number;
}

function booleanValue(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') mismatch(`${context} must be a boolean`);
  return value;
}

function enumValue<T extends string>(value: unknown, context: string, allowed: ReadonlySet<string>): T {
  if (typeof value !== 'string' || !allowed.has(value)) mismatch(`${context} is unsupported`);
  return value as T;
}

function arrayValue(value: unknown, context: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) mismatch(`${context} must be a bounded array`);
  return value;
}

function sortedUnique(values: readonly string[], context: string): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous.localeCompare(current) >= 0) {
      mismatch(`${context} must be sorted and deduplicated`);
    }
  }
}

function canonicalUnique(values: readonly string[], canonical: readonly string[], context: string): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || canonical.indexOf(previous) >= canonical.indexOf(current)) {
      mismatch(`${context} must be sorted and deduplicated`);
    }
  }
}

function validatePortablePath(value: unknown, context: string): string {
  const candidate = byteString(value, context, 1, 512);
  if (
    candidate.includes('\\') || candidate.includes('\0') || candidate.startsWith('/') ||
    /^[A-Za-z]:/u.test(candidate) || candidate.startsWith('//')
  ) mismatch(`${context} is not a portable relative path`);
  const components = candidate.split('/');
  if (components.some((component) => !component || component === '.' || component === '..')) {
    mismatch(`${context} is not a normalized portable path`);
  }
  return candidate;
}

function validateSkipCounts(value: unknown, context: string): number {
  const counts = record(value, context, [], [...SKIP_CODES]);
  let total = 0;
  for (const [key, raw] of Object.entries(counts)) {
    if (!SKIP_CODE_SET.has(key)) mismatch(`${context} contains an unsupported skip code`);
    total += integer(raw, `${context}.${key}`);
  }
  return total;
}

function validateClientCollection(value: unknown, context: string): void {
  const item = record(value, context, [
    'schemaVersion', 'authoritative', 'entriesVisited', 'directoriesVisited', 'filesDiscovered', 'filesSubmitted',
    'filesSkipped', 'skipCounts', 'collectionDurationMs',
  ]);
  if (item.schemaVersion !== CLIENT_COLLECTION_SCHEMA_VERSION) mismatch(`${context}.schemaVersion is unsupported`);
  if (item.authoritative !== false) mismatch(`${context}.authoritative must be false`);
  const entries = integer(item.entriesVisited, `${context}.entriesVisited`, 0, 20_000);
  const directories = integer(item.directoriesVisited, `${context}.directoriesVisited`, 0, 5_000);
  const discovered = integer(item.filesDiscovered, `${context}.filesDiscovered`, 0, 20_000);
  const submitted = integer(item.filesSubmitted, `${context}.filesSubmitted`, 0, 2_000);
  const skipped = integer(item.filesSkipped, `${context}.filesSkipped`, 0, 20_000);
  integer(item.collectionDurationMs, `${context}.collectionDurationMs`, 0, 600_000);
  if (directories > entries || discovered !== submitted + skipped) mismatch(`${context} contains inconsistent counts`);
  if (validateSkipCounts(item.skipCounts, `${context}.skipCounts`) !== skipped) mismatch(`${context}.skipCounts is inconsistent`);
}

function validateSubject(value: unknown, kind: ContractChangeKind): ChangeSubject {
  const item = record(value, 'change.subject', [
    'operation', 'schema', 'parameter', 'responseStatus', 'mediaType', 'enumValue', 'securityScheme', 'securityScope',
    'metadataPointer',
  ]);
  if (item.operation !== null) {
    const operation = record(item.operation, 'change.subject.operation', [
      'path', 'method', 'baselineOperationId', 'candidateOperationId',
    ]);
    byteString(operation.path, 'change.subject.operation.path', 1, 512);
    enumValue(operation.method, 'change.subject.operation.method', HTTP_METHODS);
    nullableString(operation.baselineOperationId, 'change.subject.operation.baselineOperationId', 256);
    nullableString(operation.candidateOperationId, 'change.subject.operation.candidateOperationId', 256);
  }
  if (item.schema !== null) {
    const schema = record(item.schema, 'change.subject.schema', ['name', 'property', 'uses']);
    stringValue(schema.name, 'change.subject.schema.name', 1, 256);
    nullableString(schema.property, 'change.subject.schema.property', 256);
    const uses = arrayValue(schema.uses, 'change.subject.schema.uses', 3).map((entry) =>
      enumValue<string>(entry, 'change.subject.schema.uses[]', new Set(['REQUEST', 'RESPONSE', 'UNKNOWN'])));
    if (uses.length === 0) mismatch('change.subject.schema.uses must not be empty');
    canonicalUnique(uses, ['REQUEST', 'RESPONSE', 'UNKNOWN'], 'change.subject.schema.uses');
    if (uses.includes('UNKNOWN') && uses.length !== 1) mismatch('UNKNOWN schema use is mutually exclusive');
  }
  if (item.parameter !== null) {
    const parameter = record(item.parameter, 'change.subject.parameter', ['name', 'location']);
    stringValue(parameter.name, 'change.subject.parameter.name', 1, 256);
    enumValue(parameter.location, 'change.subject.parameter.location', new Set(['PATH', 'QUERY', 'HEADER', 'COOKIE']));
  }
  nullableString(item.responseStatus, 'change.subject.responseStatus', 256);
  nullableString(item.mediaType, 'change.subject.mediaType', 256);
  nullableString(item.enumValue, 'change.subject.enumValue', 256);
  nullableString(item.securityScheme, 'change.subject.securityScheme', 256);
  nullableString(item.securityScope, 'change.subject.securityScope', 256);
  if (item.metadataPointer !== null) byteString(item.metadataPointer, 'change.subject.metadataPointer', 1, 512);

  const present = new Set<string>();
  for (const key of ['operation', 'schema', 'parameter', 'responseStatus', 'mediaType', 'enumValue', 'securityScheme', 'securityScope', 'metadataPointer']) {
    if (item[key] !== null) present.add(key);
  }
  if (present.size === 0) mismatch('change.subject must contain at least one subject');
  validateSubjectForKind(item, present, kind);
  return item as unknown as ChangeSubject;
}

function requireExactSubject(present: ReadonlySet<string>, required: readonly string[], kind: string): void {
  const requiredSet = new Set(required);
  if (present.size !== requiredSet.size || [...present].some((key) => !requiredSet.has(key))) {
    mismatch(`change.subject does not match ${kind}`);
  }
}

function validateSubjectForKind(item: Record<string, unknown>, present: ReadonlySet<string>, kind: ContractChangeKind): void {
  const operationOnly = new Set([
    'ENDPOINT_ADDED', 'ENDPOINT_REMOVED', 'HTTP_METHOD_ADDED', 'HTTP_METHOD_REMOVED', 'OPERATION_ID_CHANGED',
    'DEPRECATION_CHANGED', 'REQUEST_BODY_ADDED', 'REQUIRED_REQUEST_BODY_ADDED', 'REQUEST_BODY_REMOVED',
    'REQUEST_BODY_REQUIREMENT_CHANGED',
  ]);
  const parameterKinds = new Set([
    'PARAMETER_ADDED', 'REQUIRED_PARAMETER_ADDED', 'PARAMETER_REMOVED', 'PARAMETER_TYPE_CHANGED',
    'PARAMETER_REQUIREMENT_CHANGED', 'PARAMETER_CONSTRAINT_CHANGED',
  ]);
  const requestSchemaKinds = new Set(['REQUEST_SCHEMA_CHANGED']);
  const requestMediaKinds = new Set(['REQUEST_MEDIA_TYPE_ADDED', 'REQUEST_MEDIA_TYPE_REMOVED']);
  const responseKinds = new Set(['RESPONSE_ADDED', 'RESPONSE_REMOVED']);
  const responseSchemaKinds = new Set(['RESPONSE_SCHEMA_CHANGED']);
  const responseMediaKinds = new Set(['RESPONSE_MEDIA_TYPE_ADDED', 'RESPONSE_MEDIA_TYPE_REMOVED']);
  const schemaKinds = new Set(['SCHEMA_ADDED', 'SCHEMA_REMOVED']);
  const propertyKinds = new Set([
    'PROPERTY_ADDED', 'PROPERTY_REMOVED', 'PROPERTY_TYPE_CHANGED', 'PROPERTY_REQUIREMENT_CHANGED',
    'PROPERTY_CONSTRAINT_CHANGED',
    'REQUIRED_REQUEST_PROPERTY_ADDED',
  ]);
  if (operationOnly.has(kind)) return requireExactSubject(present, ['operation'], kind);
  if (parameterKinds.has(kind)) return requireExactSubject(present, ['operation', 'parameter'], kind);
  if (kind === 'PARAMETER_ENUM_VALUE_ADDED' || kind === 'PARAMETER_ENUM_VALUE_REMOVED') {
    return requireExactSubject(present, ['operation', 'parameter', 'enumValue'], kind);
  }
  if (requestSchemaKinds.has(kind)) return requireExactSubject(present, ['operation', 'schema'], kind);
  if (requestMediaKinds.has(kind)) return requireExactSubject(present, ['operation', 'mediaType'], kind);
  if (responseKinds.has(kind)) return requireExactSubject(present, ['operation', 'responseStatus'], kind);
  if (responseSchemaKinds.has(kind)) return requireExactSubject(present, ['operation', 'responseStatus', 'schema'], kind);
  if (responseMediaKinds.has(kind)) return requireExactSubject(present, ['operation', 'responseStatus', 'mediaType'], kind);
  if (schemaKinds.has(kind)) {
    requireExactSubject(present, ['schema'], kind);
    if ((item.schema as { property: unknown }).property !== null) mismatch(`${kind} requires a schema without a property`);
    return;
  }
  if (propertyKinds.has(kind)) {
    requireExactSubject(present, ['schema'], kind);
    if ((item.schema as { property: unknown }).property === null) mismatch(`${kind} requires a schema property`);
    return;
  }
  if (kind === 'ENUM_VALUE_ADDED' || kind === 'ENUM_VALUE_REMOVED') {
    return requireExactSubject(present, ['schema', 'enumValue'], kind);
  }
  if (kind === 'SECURITY_REQUIREMENT_STRENGTHENED' || kind === 'SECURITY_REQUIREMENT_WEAKENED') {
    if (!(present.size === 1 && present.has('operation')) && !(present.size === 2 && present.has('operation') && present.has('securityScheme'))) {
      mismatch(`change.subject does not match ${kind}`);
    }
    return;
  }
  if (kind === 'SECURITY_SCOPE_ADDED' || kind === 'SECURITY_SCOPE_REMOVED') {
    return requireExactSubject(present, ['operation', 'securityScope'], kind);
  }
  if (kind === 'SECURITY_SCHEME_ADDED' || kind === 'SECURITY_SCHEME_REMOVED') {
    return requireExactSubject(present, ['securityScheme'], kind);
  }
  if (kind === 'SERVER_ADDED' || kind === 'SERVER_REMOVED' || kind === 'METADATA_CHANGED') {
    return requireExactSubject(present, ['metadataPointer'], kind);
  }
  // Analyzer regression/resolution deliberately accepts the richest available typed subject.
}

function validateEvidence(value: unknown): ImpactEvidence {
  const item = record(value, 'affected source evidence', ['type', 'value']);
  enumValue(item.type, 'affected source evidence.type', EVIDENCE_SET);
  stringValue(item.value, 'affected source evidence.value', 1, 512);
  return item as unknown as ImpactEvidence;
}

function validateAffectedSource(value: unknown): AffectedSource {
  const item = record(value, 'affected source', ['file', 'line', 'column', 'language', 'confidence', 'evidence']);
  validatePortablePath(item.file, 'affected source.file');
  integer(item.line, 'affected source.line', 1);
  integer(item.column, 'affected source.column', 1);
  enumValue(item.language, 'affected source.language', LANGUAGE_SET);
  enumValue(item.confidence, 'affected source.confidence', CONFIDENCE_SET);
  const evidence = arrayValue(item.evidence, 'affected source.evidence', 12).map(validateEvidence);
  if (evidence.length === 0) mismatch('affected source.evidence must not be empty');
  const evidenceKeys = evidence.map((entry) => `${EVIDENCE_TYPES.indexOf(entry.type)}\0${entry.value}`);
  sortedUnique(evidenceKeys, 'affected source.evidence');
  return item as unknown as AffectedSource;
}

function validateConfidenceBasis(value: unknown, confidence: ImpactConfidence | null, risk: ImpactRisk): void {
  const item = record(value, 'change.confidenceBasis', ['level', 'conditions', 'evidenceTypes', 'criticalRisk']);
  const level = item.level === null ? null : enumValue<ImpactConfidence>(item.level, 'change.confidenceBasis.level', CONFIDENCE_SET);
  if (level !== confidence) mismatch('change.confidenceBasis.level disagrees with confidence');
  const conditions = arrayValue(item.conditions, 'change.confidenceBasis.conditions', CONFIDENCE_CONDITIONS.length)
    .map((entry) => enumValue<string>(entry, 'change.confidenceBasis.conditions[]', CONDITION_SET));
  canonicalUnique(conditions, CONFIDENCE_CONDITIONS, 'change.confidenceBasis.conditions');
  const evidenceTypes = arrayValue(item.evidenceTypes, 'change.confidenceBasis.evidenceTypes', EVIDENCE_TYPES.length)
    .map((entry) => enumValue<string>(entry, 'change.confidenceBasis.evidenceTypes[]', EVIDENCE_SET));
  canonicalUnique(evidenceTypes, EVIDENCE_TYPES, 'change.confidenceBasis.evidenceTypes');
  if (confidence === null && (conditions.length !== 0 || evidenceTypes.length !== 0 || item.criticalRisk !== null)) {
    mismatch('empty confidence must have an empty confidence basis');
  }
  if ((risk === 'CRITICAL') !== (item.criticalRisk !== null)) mismatch('criticalRisk basis disagrees with risk');
  if (item.criticalRisk !== null) {
    const critical = record(item.criticalRisk, 'change.confidenceBasis.criticalRisk', [
      'destructiveKind', 'minimumAffectedFiles', 'minimumHighConfidenceFiles', 'affectedFiles', 'highConfidenceFiles',
    ]);
    if (critical.destructiveKind !== true) mismatch('criticalRisk.destructiveKind must be true');
    integer(critical.minimumAffectedFiles, 'criticalRisk.minimumAffectedFiles', 10, 10);
    integer(critical.minimumHighConfidenceFiles, 'criticalRisk.minimumHighConfidenceFiles', 5, 5);
    integer(critical.affectedFiles, 'criticalRisk.affectedFiles', 10);
    integer(critical.highConfidenceFiles, 'criticalRisk.highConfidenceFiles', 5);
  }
}

function validateChange(value: unknown): ImpactChange {
  const item = record(value, 'change', [
    'id', 'deltaFingerprint', 'kind', 'classification', 'category', 'ruleId', 'ruleVersion', 'summary', 'explanation',
    'baselineValue', 'candidateValue', 'subject', 'potentialRisk', 'risk', 'confidence', 'confidenceBasis',
    'affectedLocationCount', 'returnedAffectedLocationCount', 'omittedAffectedLocationCount', 'affectedFileCount',
    'highConfidenceFileCount', 'affectedSources', 'recommendation',
  ]);
  if (typeof item.id !== 'string' || !/^cgdelta_[a-f0-9]{32}$/u.test(item.id)) mismatch('change.id is invalid');
  if (typeof item.deltaFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(item.deltaFingerprint)) mismatch('change.deltaFingerprint is invalid');
  const kind = enumValue<ContractChangeKind>(item.kind, 'change.kind', CHANGE_KIND_SET);
  enumValue(item.classification, 'change.classification', CLASSIFICATIONS);
  enumValue(item.category, 'change.category', CATEGORIES);
  byteString(item.ruleId, 'change.ruleId', 1, 64);
  integer(item.ruleVersion, 'change.ruleVersion', 1);
  stringValue(item.summary, 'change.summary', 1, 200);
  stringValue(item.explanation, 'change.explanation', 1, 1_000);
  if (item.baselineValue !== null) stringValue(item.baselineValue, 'change.baselineValue', 0, 500);
  if (item.candidateValue !== null) stringValue(item.candidateValue, 'change.candidateValue', 0, 500);
  validateSubject(item.subject, kind);
  const potentialRisk = enumValue<ImpactRisk>(item.potentialRisk, 'change.potentialRisk', RISK_SET);
  const risk = enumValue<ImpactRisk>(item.risk, 'change.risk', RISK_SET);
  const confidence = item.confidence === null ? null : enumValue<ImpactConfidence>(item.confidence, 'change.confidence', CONFIDENCE_SET);
  validateConfidenceBasis(item.confidenceBasis, confidence, risk);
  const total = integer(item.affectedLocationCount, 'change.affectedLocationCount');
  const returned = integer(item.returnedAffectedLocationCount, 'change.returnedAffectedLocationCount');
  const omitted = integer(item.omittedAffectedLocationCount, 'change.omittedAffectedLocationCount');
  const files = integer(item.affectedFileCount, 'change.affectedFileCount');
  const highFiles = integer(item.highConfidenceFileCount, 'change.highConfidenceFileCount');
  const sources = arrayValue(item.affectedSources, 'change.affectedSources', 200).map(validateAffectedSource);
  if (total !== returned + omitted || returned !== sources.length || files > total || highFiles > files) {
    mismatch('change affected-source counts are inconsistent');
  }
  if ((total === 0) !== (confidence === null) || (total === 0) !== (risk === 'NONE')) {
    mismatch('change confidence/risk does not match its affected-source count');
  }
  if (total > 0 && potentialRisk === 'NONE') mismatch('an affected change cannot have NONE potential risk');
  const recommendation = record(item.recommendation, 'change.recommendation', ['code', 'message']);
  if (typeof recommendation.code !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/u.test(recommendation.code)) {
    mismatch('change.recommendation.code is invalid');
  }
  stringValue(recommendation.message, 'change.recommendation.message', 1, 1_000);
  const compactRow = { ...item, affectedSources: [] };
  if (Buffer.byteLength(JSON.stringify(compactRow), 'utf8') > 6_144) mismatch('change compact row exceeds its bound');
  return item as unknown as ImpactChange;
}

function validateServerScan(value: unknown): void {
  const item = record(value, 'metadata.serverScan', [
    'inputType', 'authoritative', 'manifestEntriesSubmitted', 'filesystemEntriesVisited', 'directoriesVisited',
    'gitignoreFilesRead', 'gitignoreBytesRead', 'gitignorePatternsParsed', 'filesAccepted', 'filesScanned',
    'filesSkipped', 'bytesScanned', 'indexedSymbolVariants', 'indexedSymbolBytes', 'lexerTokens', 'skipCounts',
  ]);
  enumValue(item.inputType, 'metadata.serverScan.inputType', new Set(['INLINE_MANIFEST', 'TRUSTED_FILESYSTEM']));
  if (item.authoritative !== true) mismatch('metadata.serverScan.authoritative must be true');
  if (item.manifestEntriesSubmitted !== null) integer(item.manifestEntriesSubmitted, 'metadata.serverScan.manifestEntriesSubmitted', 0, 2_500);
  if (item.filesystemEntriesVisited !== null) integer(item.filesystemEntriesVisited, 'metadata.serverScan.filesystemEntriesVisited', 0, 20_000);
  if (item.directoriesVisited !== null) integer(item.directoriesVisited, 'metadata.serverScan.directoriesVisited', 0, 5_000);
  integer(item.gitignoreFilesRead, 'metadata.serverScan.gitignoreFilesRead', 0, 128);
  integer(item.gitignoreBytesRead, 'metadata.serverScan.gitignoreBytesRead', 0, 512 * 1024);
  integer(item.gitignorePatternsParsed, 'metadata.serverScan.gitignorePatternsParsed', 0, 10_000);
  integer(item.filesAccepted, 'metadata.serverScan.filesAccepted', 0, 2_000);
  integer(item.filesScanned, 'metadata.serverScan.filesScanned', 0, 2_000);
  integer(item.filesSkipped, 'metadata.serverScan.filesSkipped', 0, 2_500);
  integer(item.bytesScanned, 'metadata.serverScan.bytesScanned', 0, 16 * 1024 * 1024);
  integer(item.indexedSymbolVariants, 'metadata.serverScan.indexedSymbolVariants', 0, 100_000);
  integer(item.indexedSymbolBytes, 'metadata.serverScan.indexedSymbolBytes', 0, 8 * 1024 * 1024);
  integer(item.lexerTokens, 'metadata.serverScan.lexerTokens', 0, 5_000_000);
  if (item.inputType === 'INLINE_MANIFEST') {
    if (item.manifestEntriesSubmitted === null || item.filesystemEntriesVisited !== null || item.directoriesVisited !== null) {
      mismatch('metadata.serverScan counters do not match INLINE_MANIFEST');
    }
    if (item.gitignoreFilesRead !== 0 || item.gitignoreBytesRead !== 0 || item.gitignorePatternsParsed !== 0) {
      mismatch('inline manifests cannot report server gitignore reads');
    }
    if ((item.filesAccepted as number) + (item.filesSkipped as number) !== item.manifestEntriesSubmitted) {
      mismatch('metadata.serverScan manifest counts are inconsistent');
    }
  } else if (item.manifestEntriesSubmitted !== null || item.filesystemEntriesVisited === null || item.directoriesVisited === null) {
    mismatch('metadata.serverScan counters do not match TRUSTED_FILESYSTEM');
  }
  if ((item.filesScanned as number) > (item.filesAccepted as number)) mismatch('metadata.serverScan scanned too many files');
  if (validateSkipCounts(item.skipCounts, 'metadata.serverScan.skipCounts') !== item.filesSkipped) {
    mismatch('metadata.serverScan.skipCounts is inconsistent');
  }
}

function validateWarning(value: unknown): void {
  const item = record(value, 'metadata warning', ['code', 'message'], ['path']);
  enumValue(item.code, 'metadata warning.code', WARNING_SET);
  stringValue(item.message, 'metadata warning.message', 1, 200);
  if ('path' in item) validatePortablePath(item.path, 'metadata warning.path');
}

function validateContract(value: unknown, expectedProjectId: string, expectedCheckId: string): void {
  const item = record(value, 'contract', [
    'type', 'projectId', 'checkId', 'baselineVersionId', 'candidateVersionId', 'baselineContentHash',
    'candidateContentHash', 'baselineOpenapiVersion', 'candidateOpenapiVersion',
  ]);
  if (item.type !== 'CONTRACT_GUARD_CHECK') mismatch('contract.type is unsupported by the Action');
  if (item.projectId !== expectedProjectId || item.checkId !== expectedCheckId) mismatch('contract identifiers do not match the request');
  if (typeof item.projectId !== 'string' || !/^cgprj_[0-9a-f]{32}$/u.test(item.projectId)) mismatch('contract.projectId is invalid');
  if (typeof item.checkId !== 'string' || !/^cgchk_[0-9a-f]{32}$/u.test(item.checkId)) mismatch('contract.checkId is invalid');
  for (const key of ['baselineVersionId', 'candidateVersionId']) {
    if (typeof item[key] !== 'string' || !/^cgver_[0-9a-f]{32}$/u.test(item[key])) mismatch(`contract.${key} is invalid`);
  }
  for (const key of ['baselineContentHash', 'candidateContentHash']) {
    if (typeof item[key] !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(item[key])) mismatch(`contract.${key} is invalid`);
  }
  for (const key of ['baselineOpenapiVersion', 'candidateOpenapiVersion']) {
    if (typeof item[key] !== 'string' || !/^3\.(?:0|1)\.\d+$/u.test(item[key])) mismatch(`contract.${key} is unsupported`);
  }
}

function validateEngines(value: unknown): void {
  const item = record(value, 'engines', [
    'analyzerVersion', 'analyzerRuleSetVersion', 'analyzerCompatibilityVersion', 'legacyComparisonEngineVersion',
    'contractDeltaEngineVersion', 'impactAnalysisEngineVersion',
  ]);
  stringValue(item.analyzerVersion, 'engines.analyzerVersion', 1, 80);
  for (const key of [
    'analyzerRuleSetVersion', 'analyzerCompatibilityVersion', 'legacyComparisonEngineVersion',
    'contractDeltaEngineVersion', 'impactAnalysisEngineVersion',
  ]) integer(item[key], `engines.${key}`, 1);
}

export function validateImpactReport(value: unknown, expectedProjectId: string, expectedCheckId: string): ImpactReport {
  const item = record(value, 'report', [
    'schemaVersion', 'analysisFingerprint', 'contract', 'engines', 'overallRisk', 'overallPotentialRisk',
    'breakingChanges', 'affectedFiles', 'affectedSourceLocations', 'changes', 'metadata',
  ]);
  if (item.schemaVersion !== IMPACT_REPORT_SCHEMA_VERSION) mismatch('schemaVersion is unsupported');
  if (typeof item.analysisFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(item.analysisFingerprint)) {
    mismatch('analysisFingerprint is invalid');
  }
  validateContract(item.contract, expectedProjectId, expectedCheckId);
  validateEngines(item.engines);
  const overallRisk = enumValue<ImpactRisk>(item.overallRisk, 'overallRisk', RISK_SET);
  const overallPotentialRisk = enumValue<ImpactRisk>(item.overallPotentialRisk, 'overallPotentialRisk', RISK_SET);
  const breaking = integer(item.breakingChanges, 'breakingChanges');
  const affectedFiles = integer(item.affectedFiles, 'affectedFiles');
  const affectedLocations = integer(item.affectedSourceLocations, 'affectedSourceLocations');
  const changes = arrayValue(item.changes, 'changes', 1_000).map(validateChange);
  if (changes.filter((change) => change.classification === 'breaking').length !== breaking) mismatch('breakingChanges is inconsistent');
  const riskRank = (risk: ImpactRisk): number => RISK_VALUES.indexOf(risk);
  const expectedRisk = changes.reduce<ImpactRisk>((maximum, change) => riskRank(change.risk) > riskRank(maximum) ? change.risk : maximum, 'NONE');
  const expectedPotential = changes.reduce<ImpactRisk>((maximum, change) =>
    riskRank(change.potentialRisk) > riskRank(maximum) ? change.potentialRisk : maximum, 'NONE');
  if (overallRisk !== expectedRisk || overallPotentialRisk !== expectedPotential) mismatch('overall risk values are inconsistent');
  if (changes.reduce((sum, change) => sum + change.affectedLocationCount, 0) !== affectedLocations) {
    mismatch('affectedSourceLocations is inconsistent');
  }
  const returnedFiles = new Set(changes.flatMap((change) => change.affectedSources.map((source) => source.file)));
  if (affectedFiles < returnedFiles.size || affectedFiles > affectedLocations) mismatch('affectedFiles is inconsistent');

  const metadata = record(item.metadata, 'metadata', [
    'serverScan', 'languagesDetected', 'warnings', 'warningsOmitted', 'truncated', 'totalAffectedSourceLocations',
    'returnedAffectedSourceLocations', 'changesWithoutReturnedLocations', 'analysisDurationMs',
  ], ['clientCollection']);
  validateServerScan(metadata.serverScan);
  if ('clientCollection' in metadata) validateClientCollection(metadata.clientCollection, 'metadata.clientCollection');
  const languages = arrayValue(metadata.languagesDetected, 'metadata.languagesDetected', SOURCE_LANGUAGES.length)
    .map((entry) => enumValue<string>(entry, 'metadata.languagesDetected[]', LANGUAGE_SET));
  canonicalUnique(languages, SOURCE_LANGUAGES, 'metadata.languagesDetected');
  const warnings = arrayValue(metadata.warnings, 'metadata.warnings', 200);
  warnings.forEach(validateWarning);
  const warningsOmitted = integer(metadata.warningsOmitted, 'metadata.warningsOmitted');
  const truncated = booleanValue(metadata.truncated, 'metadata.truncated');
  const total = integer(metadata.totalAffectedSourceLocations, 'metadata.totalAffectedSourceLocations');
  const returned = integer(metadata.returnedAffectedSourceLocations, 'metadata.returnedAffectedSourceLocations');
  const changesWithout = integer(metadata.changesWithoutReturnedLocations, 'metadata.changesWithoutReturnedLocations');
  integer(metadata.analysisDurationMs, 'metadata.analysisDurationMs');
  const expectedReturned = changes.reduce((sum, change) => sum + change.returnedAffectedLocationCount, 0);
  const expectedChangesWithout = changes.filter((change) => change.affectedLocationCount > 0 && change.returnedAffectedLocationCount === 0).length;
  if (total !== affectedLocations || returned !== expectedReturned || changesWithout !== expectedChangesWithout) {
    mismatch('metadata affected-source counts are inconsistent');
  }
  if (returned > 5_000) mismatch('metadata.returnedAffectedSourceLocations exceeds the Standard profile');
  const evidenceOmitted = changes.some((change) => change.omittedAffectedLocationCount > 0);
  if (truncated !== (evidenceOmitted || warningsOmitted > 0 || warnings.some((warning) =>
    (warning as { code?: unknown }).code === 'EVIDENCE_TRUNCATED'))) mismatch('metadata.truncated is inconsistent');
  return item as unknown as ImpactReport;
}
