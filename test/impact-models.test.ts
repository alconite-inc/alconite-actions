import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  CHANGE_KINDS,
  IMPACT_REPORT_SCHEMA_VERSION,
  SKIP_CODES,
  validateImpactReport,
  type ChangeSubject,
  type ContractChangeKind,
  type ImpactReport,
  type ImpactRisk,
} from '../src/impact/models';

const PROJECT_ID = 'cgprj_11111111111111111111111111111111';
const CHECK_ID = 'cgchk_22222222222222222222222222222222';
const PLATFORM_PROJECT_ID = 'cgprj_00000000000000000000000000000000';
const PLATFORM_CHECK_ID = 'cgchk_11111111111111111111111111111111';

async function fixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.resolve('test/fixtures/impact-report-v1-single-file.json'), 'utf8')) as Record<string, unknown>;
}

type Classification = 'breaking' | 'risky' | 'non_breaking' | 'informational';

const CATEGORY_BY_KIND: Record<ContractChangeKind, string> = {
  ENDPOINT_ADDED: 'operation', ENDPOINT_REMOVED: 'operation', HTTP_METHOD_ADDED: 'operation',
  HTTP_METHOD_REMOVED: 'operation', PARAMETER_ADDED: 'parameter', REQUIRED_PARAMETER_ADDED: 'parameter',
  PARAMETER_REMOVED: 'parameter', PARAMETER_TYPE_CHANGED: 'parameter', PARAMETER_REQUIREMENT_CHANGED: 'parameter',
  PARAMETER_CONSTRAINT_CHANGED: 'parameter', PARAMETER_ENUM_VALUE_ADDED: 'parameter',
  PARAMETER_ENUM_VALUE_REMOVED: 'parameter', REQUEST_BODY_ADDED: 'request_body',
  REQUIRED_REQUEST_BODY_ADDED: 'request_body', REQUEST_BODY_REMOVED: 'request_body',
  REQUEST_BODY_REQUIREMENT_CHANGED: 'request_body', REQUEST_SCHEMA_CHANGED: 'request_body',
  REQUEST_MEDIA_TYPE_ADDED: 'media_type', REQUEST_MEDIA_TYPE_REMOVED: 'media_type', RESPONSE_ADDED: 'response',
  RESPONSE_REMOVED: 'response', RESPONSE_SCHEMA_CHANGED: 'response', RESPONSE_MEDIA_TYPE_ADDED: 'media_type',
  RESPONSE_MEDIA_TYPE_REMOVED: 'media_type', SCHEMA_ADDED: 'schema', SCHEMA_REMOVED: 'schema',
  PROPERTY_ADDED: 'schema', PROPERTY_REMOVED: 'schema', PROPERTY_TYPE_CHANGED: 'schema',
  PROPERTY_REQUIREMENT_CHANGED: 'schema', PROPERTY_CONSTRAINT_CHANGED: 'schema',
  REQUIRED_REQUEST_PROPERTY_ADDED: 'schema', ENUM_VALUE_ADDED: 'schema', ENUM_VALUE_REMOVED: 'schema',
  OPERATION_ID_CHANGED: 'metadata', DEPRECATION_CHANGED: 'metadata', SECURITY_REQUIREMENT_STRENGTHENED: 'security',
  SECURITY_REQUIREMENT_WEAKENED: 'security', SECURITY_SCHEME_ADDED: 'security', SECURITY_SCHEME_REMOVED: 'security',
  SECURITY_SCOPE_ADDED: 'security', SECURITY_SCOPE_REMOVED: 'security', SERVER_ADDED: 'server',
  SERVER_REMOVED: 'server', METADATA_CHANGED: 'metadata', ANALYZER_REGRESSION: 'analyzer_regression',
  ANALYZER_RESOLUTION: 'analyzer_resolution',
};

const STATIC_RISK_BY_KIND: Partial<Record<ContractChangeKind, Exclude<ImpactRisk, 'NONE' | 'CRITICAL'>>> = {
  ENDPOINT_ADDED: 'LOW', ENDPOINT_REMOVED: 'HIGH', HTTP_METHOD_ADDED: 'LOW', HTTP_METHOD_REMOVED: 'HIGH',
  PARAMETER_ADDED: 'LOW', REQUIRED_PARAMETER_ADDED: 'HIGH', PARAMETER_REMOVED: 'HIGH',
  PARAMETER_TYPE_CHANGED: 'HIGH', PARAMETER_CONSTRAINT_CHANGED: 'MEDIUM', PARAMETER_ENUM_VALUE_ADDED: 'LOW',
  PARAMETER_ENUM_VALUE_REMOVED: 'HIGH', REQUIRED_REQUEST_BODY_ADDED: 'HIGH', REQUEST_BODY_REMOVED: 'MEDIUM',
  REQUEST_SCHEMA_CHANGED: 'HIGH', REQUEST_MEDIA_TYPE_ADDED: 'LOW', REQUEST_MEDIA_TYPE_REMOVED: 'HIGH',
  RESPONSE_ADDED: 'LOW', RESPONSE_REMOVED: 'HIGH', RESPONSE_SCHEMA_CHANGED: 'HIGH', RESPONSE_MEDIA_TYPE_ADDED: 'LOW',
  RESPONSE_MEDIA_TYPE_REMOVED: 'HIGH', SCHEMA_ADDED: 'LOW', SCHEMA_REMOVED: 'HIGH', PROPERTY_ADDED: 'LOW',
  PROPERTY_REMOVED: 'HIGH', PROPERTY_TYPE_CHANGED: 'HIGH', PROPERTY_CONSTRAINT_CHANGED: 'MEDIUM',
  REQUIRED_REQUEST_PROPERTY_ADDED: 'HIGH', ENUM_VALUE_ADDED: 'LOW', ENUM_VALUE_REMOVED: 'HIGH',
  OPERATION_ID_CHANGED: 'MEDIUM', DEPRECATION_CHANGED: 'LOW', SECURITY_REQUIREMENT_STRENGTHENED: 'HIGH',
  SECURITY_REQUIREMENT_WEAKENED: 'MEDIUM', SECURITY_SCHEME_ADDED: 'LOW', SECURITY_SCHEME_REMOVED: 'HIGH',
  SECURITY_SCOPE_REMOVED: 'MEDIUM', SERVER_ADDED: 'LOW', SERVER_REMOVED: 'MEDIUM', METADATA_CHANGED: 'LOW',
  ANALYZER_REGRESSION: 'MEDIUM', ANALYZER_RESOLUTION: 'LOW',
};

const CONDITIONAL_KINDS = new Set<ContractChangeKind>([
  'PARAMETER_REQUIREMENT_CHANGED', 'REQUEST_BODY_ADDED', 'REQUEST_BODY_REQUIREMENT_CHANGED',
  'PROPERTY_REQUIREMENT_CHANGED', 'SECURITY_SCOPE_ADDED',
]);

function emptySubject(): ChangeSubject {
  return {
    operation: null, schema: null, parameter: null, responseStatus: null, mediaType: null, enumValue: null,
    securityScheme: null, securityScope: null, metadataPointer: null,
  };
}

function operation(method = 'GET'): NonNullable<ChangeSubject['operation']> {
  return {
    path: '/customers/{id}', method, baselineOperationId: 'getCustomer', candidateOperationId: 'getCustomer',
  };
}

function schema(property: string | null, uses: Array<'REQUEST' | 'RESPONSE' | 'UNKNOWN'> = ['UNKNOWN']): NonNullable<ChangeSubject['schema']> {
  return { name: 'Customer', property, uses };
}

function subjectForKind(kind: ContractChangeKind): ChangeSubject {
  const subject = emptySubject();
  if (new Set<ContractChangeKind>([
    'ENDPOINT_ADDED', 'ENDPOINT_REMOVED', 'HTTP_METHOD_ADDED', 'HTTP_METHOD_REMOVED', 'REQUEST_BODY_ADDED',
    'REQUIRED_REQUEST_BODY_ADDED', 'REQUEST_BODY_REMOVED', 'REQUEST_BODY_REQUIREMENT_CHANGED', 'OPERATION_ID_CHANGED',
    'DEPRECATION_CHANGED', 'SECURITY_REQUIREMENT_STRENGTHENED', 'SECURITY_REQUIREMENT_WEAKENED',
  ]).has(kind)) {
    subject.operation = operation();
  } else if (new Set<ContractChangeKind>([
    'PARAMETER_ADDED', 'REQUIRED_PARAMETER_ADDED', 'PARAMETER_REMOVED', 'PARAMETER_TYPE_CHANGED',
    'PARAMETER_REQUIREMENT_CHANGED', 'PARAMETER_CONSTRAINT_CHANGED',
  ]).has(kind)) {
    subject.operation = operation();
    subject.parameter = { name: 'customerId', location: 'PATH' };
  } else if (kind === 'PARAMETER_ENUM_VALUE_ADDED' || kind === 'PARAMETER_ENUM_VALUE_REMOVED') {
    subject.operation = operation();
    subject.parameter = { name: 'state', location: 'QUERY' };
    subject.enumValue = 'ACTIVE';
  } else if (kind === 'REQUEST_SCHEMA_CHANGED') {
    subject.operation = operation();
    subject.schema = schema(null, ['REQUEST']);
  } else if (kind === 'REQUEST_MEDIA_TYPE_ADDED' || kind === 'REQUEST_MEDIA_TYPE_REMOVED') {
    subject.operation = operation();
    subject.mediaType = 'application/json';
  } else if (kind === 'RESPONSE_ADDED' || kind === 'RESPONSE_REMOVED') {
    subject.operation = operation();
    subject.responseStatus = '200';
  } else if (kind === 'RESPONSE_SCHEMA_CHANGED') {
    subject.operation = operation();
    subject.schema = schema(null, ['RESPONSE']);
    subject.responseStatus = '200';
  } else if (kind === 'RESPONSE_MEDIA_TYPE_ADDED' || kind === 'RESPONSE_MEDIA_TYPE_REMOVED') {
    subject.operation = operation();
    subject.responseStatus = '200';
    subject.mediaType = 'application/json';
  } else if (kind === 'SCHEMA_ADDED' || kind === 'SCHEMA_REMOVED') {
    subject.schema = schema(null);
  } else if (new Set<ContractChangeKind>([
    'PROPERTY_ADDED', 'PROPERTY_REMOVED', 'PROPERTY_TYPE_CHANGED', 'PROPERTY_REQUIREMENT_CHANGED',
    'PROPERTY_CONSTRAINT_CHANGED',
  ]).has(kind)) {
    subject.schema = schema('firstName');
  } else if (kind === 'REQUIRED_REQUEST_PROPERTY_ADDED') {
    subject.schema = schema('firstName', ['REQUEST']);
  } else if (kind === 'ENUM_VALUE_ADDED' || kind === 'ENUM_VALUE_REMOVED') {
    subject.schema = schema(null);
    subject.enumValue = 'ACTIVE';
  } else if (kind === 'SECURITY_SCHEME_ADDED' || kind === 'SECURITY_SCHEME_REMOVED') {
    subject.securityScheme = 'oauth';
  } else if (kind === 'SECURITY_SCOPE_ADDED' || kind === 'SECURITY_SCOPE_REMOVED') {
    subject.operation = operation();
    subject.securityScope = 'customers:write';
  } else {
    subject.metadataPointer = '/info';
  }
  return subject;
}

function expectedConditionalRisk(
  kind: ContractChangeKind,
  classification: Classification,
  subject: ChangeSubject,
): Exclude<ImpactRisk, 'NONE' | 'CRITICAL'> {
  if (kind === 'REQUEST_BODY_ADDED' || kind === 'SECURITY_SCOPE_ADDED') {
    return classification === 'breaking' ? 'HIGH' : 'LOW';
  }
  if (kind === 'PROPERTY_REQUIREMENT_CHANGED') {
    if (classification === 'breaking' && subject.schema?.uses.length === 1 && subject.schema.uses[0] === 'REQUEST') {
      return 'HIGH';
    }
    return classification === 'non_breaking' ? 'LOW' : 'MEDIUM';
  }
  if (kind === 'PARAMETER_REQUIREMENT_CHANGED' || kind === 'REQUEST_BODY_REQUIREMENT_CHANGED') {
    if (classification === 'breaking') return 'HIGH';
    return classification === 'non_breaking' ? 'LOW' : 'MEDIUM';
  }
  throw new Error(`Test policy omitted conditional kind ${kind}`);
}

function riskFor(
  kind: ContractChangeKind,
  classification: Classification,
  subject: ChangeSubject,
): Exclude<ImpactRisk, 'NONE' | 'CRITICAL'> {
  const risk = STATIC_RISK_BY_KIND[kind];
  return risk ?? expectedConditionalRisk(kind, classification, subject);
}

async function reportFor(
  kind: ContractChangeKind,
  classification: Classification = 'informational',
  subject: ChangeSubject = subjectForKind(kind),
  risk: ImpactRisk = riskFor(kind, classification, subject),
): Promise<Record<string, unknown>> {
  const raw = await fixture();
  const change = (raw.changes as Array<Record<string, unknown>>)[0];
  assert.ok(change);
  change.kind = kind;
  change.classification = classification;
  change.category = CATEGORY_BY_KIND[kind];
  change.subject = subject;
  const potentialRisk = riskFor(kind, classification, subject);
  change.potentialRisk = potentialRisk;
  change.risk = risk;
  raw.breakingChanges = classification === 'breaking' ? 1 : 0;
  raw.overallPotentialRisk = potentialRisk;
  raw.overallRisk = risk;
  return raw;
}

const SUBJECT_KEYS = [
  'operation', 'schema', 'parameter', 'responseStatus', 'mediaType', 'enumValue', 'securityScheme', 'securityScope',
  'metadataPointer',
] as const;

const SUBJECT_SAMPLES: Record<(typeof SUBJECT_KEYS)[number], unknown> = {
  operation: operation(), schema: schema(null), parameter: { name: 'q', location: 'QUERY' }, responseStatus: '200',
  mediaType: 'application/json', enumValue: 'ACTIVE', securityScheme: 'oauth', securityScope: 'read',
  metadataPointer: '/info',
};

function setAffectedFiles(raw: Record<string, unknown>, files: number, highConfidenceFiles: number, critical: boolean): void {
  const change = (raw.changes as Array<Record<string, unknown>>)[0];
  assert.ok(change);
  const sources = Array.from({ length: files }, (_, index) => ({
    file: `src/customer-${String(index).padStart(2, '0')}.ts`,
    line: 2,
    column: 3,
    language: 'TYPESCRIPT',
    confidence: index < highConfidenceFiles ? 'HIGH' : 'LOW',
    evidence: [
      { type: 'SCHEMA_NAME', value: 'Customer' },
      { type: 'PROPERTY_REFERENCE', value: 'firstName' },
    ],
  }));
  change.affectedSources = sources;
  change.affectedLocationCount = files;
  change.returnedAffectedLocationCount = files;
  change.omittedAffectedLocationCount = 0;
  change.affectedFileCount = files;
  change.highConfidenceFileCount = highConfidenceFiles;
  change.confidence = files === 0 ? null : (highConfidenceFiles > 0 ? 'HIGH' : 'LOW');
  change.risk = files === 0 ? 'NONE' : (critical ? 'CRITICAL' : change.potentialRisk);
  change.confidenceBasis = files === 0 ? {
    level: null, conditions: [], evidenceTypes: [], criticalRisk: null,
  } : {
    level: highConfidenceFiles > 0 ? 'HIGH' : 'LOW',
    conditions: highConfidenceFiles > 0 ? ['MATCHING_TYPE_MEMBER'] : ['ISOLATED_SCHEMA'],
    evidenceTypes: ['SCHEMA_NAME', 'PROPERTY_REFERENCE'],
    criticalRisk: critical ? {
      destructiveRemoval: true,
      requiredDistinctFiles: 10,
      requiredHighConfidenceFiles: 5,
      observedDistinctFiles: files,
      observedHighConfidenceFiles: highConfidenceFiles,
    } : null,
  };
  raw.overallRisk = change.risk;
  raw.affectedFiles = files;
  raw.affectedSourceLocations = files;
  const metadata = raw.metadata as Record<string, unknown>;
  metadata.totalAffectedSourceLocations = files;
  metadata.returnedAffectedSourceLocations = files;
  metadata.languagesDetected = files === 0 ? [] : ['TYPESCRIPT'];
  const server = metadata.serverScan as Record<string, unknown>;
  server.manifestEntriesSubmitted = files;
  server.filesAccepted = files;
  server.filesScanned = files;
  const client = metadata.clientCollection as Record<string, unknown>;
  client.entriesVisited = files + 1;
  client.filesDiscovered = files;
  client.filesSubmitted = files;
}

function setTwoChanges(raw: Record<string, unknown>, second: Record<string, unknown>): void {
  const first = (raw.changes as Array<Record<string, unknown>>)[0];
  assert.ok(first);
  second.deltaFingerprint = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  second.id = 'cgdelta_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  raw.changes = [first, second];
  raw.breakingChanges = [first, second].filter((change) => change.classification === 'breaking').length;
  raw.affectedSourceLocations = 2;
  const metadata = raw.metadata as Record<string, unknown>;
  metadata.totalAffectedSourceLocations = 2;
  metadata.returnedAffectedSourceLocations = 2;
}

test('locks the byte-for-byte platform-generated report fixture provenance', async () => {
  const bytes = await fs.readFile(path.resolve('test/fixtures/impact-report-v1.json'));
  const expected = (await fs.readFile(path.resolve('test/fixtures/impact-report-v1.sha256'), 'utf8')).trim();
  assert.match(expected, /^[a-f0-9]{64}$/u);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
});

test('strictly validates the synchronized Impact report v1 fixture', async () => {
  const raw = JSON.parse(await fs.readFile(path.resolve('test/fixtures/impact-report-v1.json'), 'utf8')) as unknown;
  const report = validateImpactReport(raw, PLATFORM_PROJECT_ID, PLATFORM_CHECK_ID);
  assert.equal(report.schemaVersion, IMPACT_REPORT_SCHEMA_VERSION);
  assert.equal(report.overallRisk, 'CRITICAL');
  assert.equal(report.changes[0]?.subject.operation?.path, '/customers/{id}');
  assert.equal(report.changes[0]?.affectedSources[0]?.evidence.length, 2);
  assert.equal(CHANGE_KINDS.length, 47);
  assert.ok(CHANGE_KINDS.includes('REQUIRED_REQUEST_BODY_ADDED'));
  assert.ok(CHANGE_KINDS.includes('PROPERTY_CONSTRAINT_CHANGED'));
  assert.ok(SKIP_CODES.includes('FILE_READ_FAILED'));
});

test('accepts newer semantic engine versions without weakening the report schema', async () => {
  const raw = await fixture();
  const engines = raw.engines as Record<string, unknown>;
  engines.analyzerCompatibilityVersion = 22;
  engines.contractDeltaEngineVersion = 23;
  engines.impactAnalysisEngineVersion = 24;
  const report = validateImpactReport(raw, PROJECT_ID, CHECK_ID);
  assert.equal(report.engines.impactAnalysisEngineVersion, 24);
});

test('treats future engine risk and confidence semantics as versioned data', async () => {
  const future = await fixture();
  const engines = future.engines as Record<string, unknown>;
  engines.impactAnalysisEngineVersion = 2;
  const change = (future.changes as Array<Record<string, unknown>>)[0];
  assert.ok(change);
  change.risk = 'MEDIUM';
  change.confidence = 'LOW';
  change.highConfidenceFileCount = 0;
  const source = (change.affectedSources as Array<Record<string, unknown>>)[0];
  assert.ok(source);
  source.confidence = 'LOW';
  change.confidenceBasis = {
    level: 'LOW',
    conditions: ['MATCHING_TYPE_MEMBER'],
    evidenceTypes: ['SCHEMA_NAME', 'PROPERTY_REFERENCE'],
    criticalRisk: null,
  };
  future.overallRisk = 'MEDIUM';
  assert.equal(validateImpactReport(future, PROJECT_ID, CHECK_ID).overallRisk, 'MEDIUM');

  engines.impactAnalysisEngineVersion = 1;
  assert.throws(() => validateImpactReport(future, PROJECT_ID, CHECK_ID), /engine v1|v1 conditions/u);
});

test('exhaustively enforces all 47 Impact engine v1 potential and detected risk policies', async () => {
  const staticKinds = new Set(Object.keys(STATIC_RISK_BY_KIND) as ContractChangeKind[]);
  assert.equal(staticKinds.size + CONDITIONAL_KINDS.size, CHANGE_KINDS.length);
  assert.deepEqual([...staticKinds].filter((kind) => CONDITIONAL_KINDS.has(kind)), []);
  assert.deepEqual(
    [...CHANGE_KINDS].filter((kind) => !staticKinds.has(kind) && !CONDITIONAL_KINDS.has(kind)),
    [],
  );

  for (const kind of CHANGE_KINDS) {
    const raw = await reportFor(kind);
    const expected = riskFor(kind, 'informational', subjectForKind(kind));
    const report = validateImpactReport(raw, PROJECT_ID, CHECK_ID);
    assert.equal(report.changes[0]?.potentialRisk, expected, `${kind} potential risk`);
    assert.equal(report.changes[0]?.risk, expected, `${kind} detected risk with evidence`);

    setAffectedFiles(raw, 0, 0, false);
    const noEvidence = validateImpactReport(raw, PROJECT_ID, CHECK_ID);
    assert.equal(noEvidence.changes[0]?.potentialRisk, expected, `${kind} zero-evidence potential risk`);
    assert.equal(noEvidence.changes[0]?.risk, 'NONE', `${kind} zero-evidence detected risk`);
  }
});

test('enforces every conditional v1 risk branch across classifications and schema uses', async () => {
  const classifications: Classification[] = ['breaking', 'risky', 'non_breaking', 'informational'];
  for (const kind of CONDITIONAL_KINDS) {
    if (kind === 'PROPERTY_REQUIREMENT_CHANGED') continue;
    for (const classification of classifications) {
      const subject = subjectForKind(kind);
      const expected = expectedConditionalRisk(kind, classification, subject);
      const report = validateImpactReport(
        await reportFor(kind, classification, subject),
        PROJECT_ID,
        CHECK_ID,
      );
      assert.equal(report.changes[0]?.potentialRisk, expected, `${kind}/${classification}`);
    }
  }

  for (const uses of [
    ['REQUEST'], ['RESPONSE'], ['REQUEST', 'RESPONSE'], ['UNKNOWN'],
  ] as Array<Array<'REQUEST' | 'RESPONSE' | 'UNKNOWN'>>) {
    for (const classification of classifications) {
      const subject = subjectForKind('PROPERTY_REQUIREMENT_CHANGED');
      assert.ok(subject.schema);
      subject.schema.uses = uses;
      const expected = expectedConditionalRisk('PROPERTY_REQUIREMENT_CHANGED', classification, subject);
      const report = validateImpactReport(
        await reportFor('PROPERTY_REQUIREMENT_CHANGED', classification, subject),
        PROJECT_ID,
        CHECK_ID,
      );
      assert.equal(report.changes[0]?.potentialRisk, expected, `${classification}/${uses.join('+')}`);
    }
  }
});

test('requires v1 Critical elevation exactly at the destructive blast-radius gates', async () => {
  for (const kind of ['ENDPOINT_REMOVED', 'HTTP_METHOD_REMOVED', 'SCHEMA_REMOVED'] as const) {
    for (const [files, highFiles, expected] of [
      [9, 5, 'HIGH'], [10, 4, 'HIGH'], [10, 5, 'CRITICAL'], [14, 8, 'CRITICAL'],
    ] as Array<[number, number, ImpactRisk]>) {
      const raw = await reportFor(kind, 'breaking');
      setAffectedFiles(raw, files, highFiles, expected === 'CRITICAL');
      const report = validateImpactReport(raw, PROJECT_ID, CHECK_ID);
      assert.equal(report.changes[0]?.risk, expected, `${kind}/${files}/${highFiles}`);
    }
  }

  const nonDestructive = await reportFor('PROPERTY_REMOVED', 'breaking');
  setAffectedFiles(nonDestructive, 10, 5, false);
  assert.equal(validateImpactReport(nonDestructive, PROJECT_ID, CHECK_ID).changes[0]?.risk, 'HIGH');

  const missedElevation = await reportFor('ENDPOINT_REMOVED', 'breaking');
  setAffectedFiles(missedElevation, 10, 5, false);
  assert.throws(() => validateImpactReport(missedElevation, PROJECT_ID, CHECK_ID), /engine v1 policy/u);
});

test('exhaustively enforces the Contract Delta v1 subject invariant table', async () => {
  for (const kind of CHANGE_KINDS) {
    const subject = subjectForKind(kind);
    assert.equal(validateImpactReport(await reportFor(kind, 'informational', subject), PROJECT_ID, CHECK_ID).changes[0]?.kind, kind);
    const present = new Set(SUBJECT_KEYS.filter((key) => subject[key] !== null));

    for (const key of present) {
      if ((kind === 'SECURITY_REQUIREMENT_STRENGTHENED' || kind === 'SECURITY_REQUIREMENT_WEAKENED') &&
          key === 'securityScheme') continue;
      const missing = structuredClone(subject);
      missing[key] = null as never;
      const missingReport = await reportFor(kind, 'informational', missing);
      assert.throws(
        () => validateImpactReport(missingReport, PROJECT_ID, CHECK_ID),
        /change\.subject/u,
        `${kind} accepted missing ${key}`,
      );
    }

    const allowed = new Set(present);
    if (kind === 'SECURITY_REQUIREMENT_STRENGTHENED' || kind === 'SECURITY_REQUIREMENT_WEAKENED') {
      allowed.add('securityScheme');
    }
    for (const key of SUBJECT_KEYS) {
      if (allowed.has(key)) continue;
      const stray = structuredClone(subject);
      stray[key] = structuredClone(SUBJECT_SAMPLES[key]) as never;
      const strayReport = await reportFor(kind, 'informational', stray);
      assert.throws(
        () => validateImpactReport(strayReport, PROJECT_ID, CHECK_ID),
        new RegExp(kind, 'u'),
        `${kind} accepted stray ${key}`,
      );
    }
  }
});

test('uses enum rank rather than decimal rank text for evidence ordering', async () => {
  const raw = await fixture();
  const change = (raw.changes as Array<Record<string, unknown>>)[0];
  assert.ok(change);
  const source = (change.affectedSources as Array<Record<string, unknown>>)[0];
  assert.ok(source);
  source.evidence = [
    { type: 'HTTP_CALL', value: '/customers/{id}' },
    { type: 'ENUM_REFERENCE', value: 'ACTIVE' },
  ];
  change.confidenceBasis = {
    level: 'HIGH',
    conditions: ['MATCHING_TYPE_MEMBER'],
    evidenceTypes: ['HTTP_CALL', 'ENUM_REFERENCE'],
    criticalRisk: null,
  };
  assert.equal(validateImpactReport(raw, PROJECT_ID, CHECK_ID).changes[0]?.affectedSources[0]?.evidence.length, 2);

  source.evidence = [...(source.evidence as unknown[])].reverse();
  assert.throws(() => validateImpactReport(raw, PROJECT_ID, CHECK_ID), /sorted and deduplicated/u);
});

test('accepts the platform Critical-risk basis and binds its observed counts', async () => {
  const raw = await fixture();
  const change = (raw.changes as Array<Record<string, unknown>>)[0];
  assert.ok(change);
  const subject = change.subject as Record<string, unknown>;
  const schema = subject.schema as Record<string, unknown>;
  schema.property = null;
  change.kind = 'SCHEMA_REMOVED';
  change.risk = 'CRITICAL';
  const sources = Array.from({ length: 10 }, (_, index) => ({
    file: `src/customer-${String(index).padStart(2, '0')}.ts`,
    line: 2,
    column: 3,
    language: 'TYPESCRIPT',
    confidence: 'HIGH',
    evidence: [{ type: 'SCHEMA_NAME', value: 'Customer' }],
  }));
  change.affectedSources = sources;
  change.affectedLocationCount = 10;
  change.returnedAffectedLocationCount = 10;
  change.omittedAffectedLocationCount = 0;
  change.affectedFileCount = 10;
  change.highConfidenceFileCount = 10;
  change.confidenceBasis = {
    level: 'HIGH',
    conditions: ['MATCHING_TYPE_MEMBER'],
    evidenceTypes: ['SCHEMA_NAME'],
    criticalRisk: {
      destructiveRemoval: true,
      requiredDistinctFiles: 10,
      requiredHighConfidenceFiles: 5,
      observedDistinctFiles: 10,
      observedHighConfidenceFiles: 10,
    },
  };
  raw.overallRisk = 'CRITICAL';
  raw.affectedFiles = 10;
  raw.affectedSourceLocations = 10;
  const metadata = raw.metadata as Record<string, unknown>;
  metadata.totalAffectedSourceLocations = 10;
  metadata.returnedAffectedSourceLocations = 10;
  const server = metadata.serverScan as Record<string, unknown>;
  server.manifestEntriesSubmitted = 10;
  server.filesAccepted = 10;
  server.filesScanned = 10;
  const client = metadata.clientCollection as Record<string, unknown>;
  client.entriesVisited = 11;
  client.filesDiscovered = 10;
  client.filesSubmitted = 10;

  const report = validateImpactReport(raw, PROJECT_ID, CHECK_ID);
  assert.equal(report.overallRisk, 'CRITICAL');
  assert.equal(report.changes[0]?.confidenceBasis.criticalRisk?.observedDistinctFiles, 10);

  const futureThresholds = structuredClone(raw);
  const futureEngines = futureThresholds.engines as Record<string, unknown>;
  futureEngines.impactAnalysisEngineVersion = 2;
  const futureChange = (futureThresholds.changes as Array<Record<string, unknown>>)[0];
  const futureBasis = (futureChange?.confidenceBasis as Record<string, unknown>).criticalRisk as Record<string, unknown>;
  futureBasis.requiredDistinctFiles = 7;
  futureBasis.requiredHighConfidenceFiles = 3;
  futureBasis.destructiveRemoval = false;
  assert.equal(validateImpactReport(futureThresholds, PROJECT_ID, CHECK_ID).overallRisk, 'CRITICAL');
  futureEngines.impactAnalysisEngineVersion = 1;
  assert.throws(() => validateImpactReport(futureThresholds, PROJECT_ID, CHECK_ID), /engine v1/u);

  const nonDestructive = structuredClone(raw);
  const nonDestructiveChange = (nonDestructive.changes as Array<Record<string, unknown>>)[0];
  assert.ok(nonDestructiveChange);
  nonDestructiveChange.kind = 'PROPERTY_REMOVED';
  const nonDestructiveSubject = nonDestructiveChange.subject as Record<string, unknown>;
  (nonDestructiveSubject.schema as Record<string, unknown>).property = 'firstName';
  assert.throws(() => validateImpactReport(nonDestructive, PROJECT_ID, CHECK_ID), /engine v1 policy/u);

  const inconsistent = await fixture();
  const inconsistentChange = (inconsistent.changes as Array<Record<string, unknown>>)[0];
  assert.ok(inconsistentChange);
  inconsistentChange.risk = 'CRITICAL';
  inconsistentChange.confidenceBasis = {
    level: 'HIGH',
    conditions: ['MATCHING_TYPE_MEMBER'],
    evidenceTypes: ['SCHEMA_NAME', 'PROPERTY_REFERENCE'],
    criticalRisk: {
      destructiveRemoval: true,
      requiredDistinctFiles: 10,
      requiredHighConfidenceFiles: 5,
      observedDistinctFiles: 10,
      observedHighConfidenceFiles: 5,
    },
  };
  assert.throws(
    () => validateImpactReport(inconsistent, PROJECT_ID, CHECK_ID),
    /observed counts disagree/u,
  );
});

test('recomputes v1 confidence from the compact basis', async () => {
  const emptyEvidence = await fixture();
  const emptyChange = (emptyEvidence.changes as Array<Record<string, unknown>>)[0];
  assert.ok(emptyChange);
  const emptyBasis = emptyChange.confidenceBasis as Record<string, unknown>;
  emptyBasis.evidenceTypes = [];
  assert.throws(() => validateImpactReport(emptyEvidence, PROJECT_ID, CHECK_ID), /requires evidence types/u);

  const overstated = await fixture();
  const overstatedChange = (overstated.changes as Array<Record<string, unknown>>)[0];
  assert.ok(overstatedChange);
  const overstatedBasis = overstatedChange.confidenceBasis as Record<string, unknown>;
  overstatedBasis.conditions = ['EXACT_TYPE'];
  assert.throws(
    () => validateImpactReport(overstated, PROJECT_ID, CHECK_ID),
    /disagrees with its v1 conditions and evidence types/u,
  );

  const isolated = await fixture();
  const isolatedChange = (isolated.changes as Array<Record<string, unknown>>)[0];
  assert.ok(isolatedChange);
  isolatedChange.confidence = 'LOW';
  isolatedChange.highConfidenceFileCount = 0;
  const isolatedSource = (isolatedChange.affectedSources as Array<Record<string, unknown>>)[0];
  assert.ok(isolatedSource);
  isolatedSource.confidence = 'LOW';
  const isolatedBasis = isolatedChange.confidenceBasis as Record<string, unknown>;
  isolatedBasis.level = 'LOW';
  isolatedBasis.conditions = ['ISOLATED_SCHEMA'];
  isolatedBasis.evidenceTypes = ['SCHEMA_NAME'];
  assert.equal(validateImpactReport(isolated, PROJECT_ID, CHECK_ID).changes[0]?.confidence, 'LOW');
});

test('accepts a LOW v1 compact basis unioned from independent LOW locations', async () => {
  const raw = await fixture();
  const change = (raw.changes as Array<Record<string, unknown>>)[0];
  assert.ok(change);
  const first = (change.affectedSources as Array<Record<string, unknown>>)[0];
  assert.ok(first);
  first.confidence = 'LOW';
  first.evidence = [{ type: 'SCHEMA_NAME', value: 'Customer' }];
  change.affectedSources = [
    first,
    {
      file: 'src/other.ts',
      line: 4,
      column: 5,
      language: 'TYPESCRIPT',
      confidence: 'LOW',
      evidence: [{ type: 'PROPERTY_REFERENCE', value: 'firstName' }],
    },
  ];
  change.confidence = 'LOW';
  change.confidenceBasis = {
    level: 'LOW',
    conditions: ['UNIQUE_UNQUALIFIED_PROPERTY', 'ISOLATED_SCHEMA'],
    evidenceTypes: ['SCHEMA_NAME', 'PROPERTY_REFERENCE'],
    criticalRisk: null,
  };
  change.affectedLocationCount = 2;
  change.returnedAffectedLocationCount = 2;
  change.affectedFileCount = 2;
  change.highConfidenceFileCount = 0;
  raw.affectedFiles = 2;
  raw.affectedSourceLocations = 2;
  const metadata = raw.metadata as Record<string, unknown>;
  metadata.totalAffectedSourceLocations = 2;
  metadata.returnedAffectedSourceLocations = 2;
  assert.equal(validateImpactReport(raw, PROJECT_ID, CHECK_ID).changes[0]?.confidence, 'LOW');
});

test('enforces exact security-requirement and analyzer subject shapes', async () => {
  const security = await fixture();
  const securityChange = (security.changes as Array<Record<string, unknown>>)[0];
  assert.ok(securityChange);
  securityChange.kind = 'SECURITY_REQUIREMENT_STRENGTHENED';
  securityChange.category = 'security';
  securityChange.subject = {
    operation: {
      path: '/customers/{id}',
      method: 'GET',
      baselineOperationId: 'getCustomer',
      candidateOperationId: 'getCustomer',
    },
    schema: null,
    parameter: null,
    responseStatus: null,
    mediaType: null,
    enumValue: null,
    securityScheme: null,
    securityScope: null,
    metadataPointer: null,
  };
  assert.equal(validateImpactReport(security, PROJECT_ID, CHECK_ID).changes[0]?.kind, 'SECURITY_REQUIREMENT_STRENGTHENED');
  ((securityChange.subject as Record<string, unknown>).securityScheme) = 'oauth';
  assert.equal(validateImpactReport(security, PROJECT_ID, CHECK_ID).changes[0]?.subject.securityScheme, 'oauth');
  ((securityChange.subject as Record<string, unknown>).metadataPointer) = '/security';
  assert.throws(() => validateImpactReport(security, PROJECT_ID, CHECK_ID), /SECURITY_REQUIREMENT_STRENGTHENED/u);

  const analyzer = await fixture();
  const analyzerChange = (analyzer.changes as Array<Record<string, unknown>>)[0];
  assert.ok(analyzerChange);
  analyzerChange.kind = 'ANALYZER_REGRESSION';
  analyzerChange.classification = 'risky';
  analyzerChange.category = 'analyzer_regression';
  analyzerChange.potentialRisk = 'MEDIUM';
  analyzerChange.risk = 'MEDIUM';
  analyzer.breakingChanges = 0;
  analyzer.overallPotentialRisk = 'MEDIUM';
  analyzer.overallRisk = 'MEDIUM';
  assert.equal(validateImpactReport(analyzer, PROJECT_ID, CHECK_ID).changes[0]?.kind, 'ANALYZER_REGRESSION');
  ((analyzerChange.subject as Record<string, unknown>).metadataPointer) = '/regression';
  assert.throws(() => validateImpactReport(analyzer, PROJECT_ID, CHECK_ID), /ANALYZER_REGRESSION/u);
});

test('enforces directional schema qualification while allowing all Contract Guard enum and analyzer forms', async () => {
  for (const [kind, requiredUse] of [
    ['REQUEST_SCHEMA_CHANGED', 'REQUEST'],
    ['RESPONSE_SCHEMA_CHANGED', 'RESPONSE'],
  ] as const) {
    const shared = subjectForKind(kind);
    assert.ok(shared.schema);
    shared.schema.uses = ['REQUEST', 'RESPONSE'];
    assert.equal(validateImpactReport(await reportFor(kind, 'breaking', shared), PROJECT_ID, CHECK_ID).changes[0]?.kind, kind);

    for (const invalidSchema of [
      schema('strayProperty', [requiredUse]),
      schema(null, [requiredUse === 'REQUEST' ? 'RESPONSE' : 'REQUEST']),
      schema(null, ['UNKNOWN']),
    ]) {
      const invalid = subjectForKind(kind);
      invalid.schema = invalidSchema;
      const invalidReport = await reportFor(kind, 'breaking', invalid);
      assert.throws(() => validateImpactReport(invalidReport, PROJECT_ID, CHECK_ID), new RegExp(kind, 'u'));
    }
  }

  const requiredRequest = subjectForKind('REQUIRED_REQUEST_PROPERTY_ADDED');
  assert.ok(requiredRequest.schema);
  requiredRequest.schema.uses = ['REQUEST', 'RESPONSE'];
  assert.equal(
    validateImpactReport(
      await reportFor('REQUIRED_REQUEST_PROPERTY_ADDED', 'breaking', requiredRequest),
      PROJECT_ID,
      CHECK_ID,
    ).changes[0]?.kind,
    'REQUIRED_REQUEST_PROPERTY_ADDED',
  );
  for (const invalidSchema of [schema(null, ['REQUEST']), schema('firstName', ['RESPONSE']), schema('firstName', ['UNKNOWN'])]) {
    const invalid = subjectForKind('REQUIRED_REQUEST_PROPERTY_ADDED');
    invalid.schema = invalidSchema;
    const invalidReport = await reportFor('REQUIRED_REQUEST_PROPERTY_ADDED', 'breaking', invalid);
    assert.throws(() => validateImpactReport(invalidReport, PROJECT_ID, CHECK_ID), /REQUIRED_REQUEST_PROPERTY_ADDED/u);
  }

  for (const property of [null, 'status']) {
    const enumSubject = subjectForKind('ENUM_VALUE_REMOVED');
    assert.ok(enumSubject.schema);
    enumSubject.schema.property = property;
    assert.equal(
      validateImpactReport(await reportFor('ENUM_VALUE_REMOVED', 'breaking', enumSubject), PROJECT_ID, CHECK_ID)
        .changes[0]?.subject.schema?.property,
      property,
    );
  }

  for (const analyzerSubject of [
    { ...emptySubject(), operation: operation() },
    { ...emptySubject(), schema: schema(null) },
    { ...emptySubject(), metadataPointer: '/analyzer' },
  ]) {
    assert.equal(
      validateImpactReport(await reportFor('ANALYZER_REGRESSION', 'risky', analyzerSubject), PROJECT_ID, CHECK_ID)
        .changes[0]?.kind,
      'ANALYZER_REGRESSION',
    );
  }

  for (const uses of [
    ['REQUEST'], ['RESPONSE'], ['REQUEST', 'RESPONSE'], ['UNKNOWN'],
  ] as Array<Array<'REQUEST' | 'RESPONSE' | 'UNKNOWN'>>) {
    const enumSubject = subjectForKind('ENUM_VALUE_ADDED');
    assert.ok(enumSubject.schema);
    enumSubject.schema.uses = uses;
    assert.equal(validateImpactReport(await reportFor('ENUM_VALUE_ADDED', 'informational', enumSubject), PROJECT_ID, CHECK_ID)
      .changes[0]?.kind, 'ENUM_VALUE_ADDED');
  }

  for (const uses of [
    ['RESPONSE', 'REQUEST'], ['REQUEST', 'REQUEST'], ['REQUEST', 'UNKNOWN'],
  ] as Array<Array<'REQUEST' | 'RESPONSE' | 'UNKNOWN'>>) {
    const invalid = subjectForKind('ENUM_VALUE_ADDED');
    assert.ok(invalid.schema);
    invalid.schema.uses = uses;
    const invalidReport = await reportFor('ENUM_VALUE_ADDED', 'informational', invalid);
    assert.throws(
      () => validateImpactReport(invalidReport, PROJECT_ID, CHECK_ID),
      /sorted and deduplicated|mutually exclusive/u,
    );
  }
});

test('enforces delta identity, per-change risk policy, and canonical change ordering', async () => {
  const wrongIdentity = await fixture();
  const wrongIdentityChange = (wrongIdentity.changes as Array<Record<string, unknown>>)[0];
  assert.ok(wrongIdentityChange);
  wrongIdentityChange.id = 'cgdelta_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  assert.throws(() => validateImpactReport(wrongIdentity, PROJECT_ID, CHECK_ID), /does not match its delta fingerprint/u);

  const wrongRisk = await fixture();
  const wrongRiskChange = (wrongRisk.changes as Array<Record<string, unknown>>)[0];
  assert.ok(wrongRiskChange);
  wrongRiskChange.risk = 'MEDIUM';
  wrongRisk.overallRisk = 'MEDIUM';
  assert.throws(() => validateImpactReport(wrongRisk, PROJECT_ID, CHECK_ID), /engine v1 policy/u);

  const wrongPotential = await fixture();
  const wrongPotentialChange = (wrongPotential.changes as Array<Record<string, unknown>>)[0];
  assert.ok(wrongPotentialChange);
  wrongPotentialChange.potentialRisk = 'LOW';
  wrongPotential.overallPotentialRisk = 'LOW';
  assert.throws(() => validateImpactReport(wrongPotential, PROJECT_ID, CHECK_ID), /engine v1 policy/u);

  const wrongCategory = await fixture();
  const wrongCategoryChange = (wrongCategory.changes as Array<Record<string, unknown>>)[0];
  assert.ok(wrongCategoryChange);
  wrongCategoryChange.category = 'response';
  assert.throws(() => validateImpactReport(wrongCategory, PROJECT_ID, CHECK_ID), /Contract Delta engine v1/u);

  const wrongCompleteTotal = await fixture();
  wrongCompleteTotal.affectedSourceLocations = 2;
  const wrongCompleteMetadata = wrongCompleteTotal.metadata as Record<string, unknown>;
  wrongCompleteMetadata.totalAffectedSourceLocations = 2;
  assert.throws(
    () => validateImpactReport(wrongCompleteTotal, PROJECT_ID, CHECK_ID),
    /affectedSourceLocations is inconsistent with its complete change counts/u,
  );

  const ordered = await fixture();
  const first = (ordered.changes as Array<Record<string, unknown>>)[0];
  assert.ok(first);
  const second = structuredClone(first);
  second.deltaFingerprint = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  second.id = 'cgdelta_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  ordered.changes = [first, second];
  ordered.breakingChanges = 2;
  ordered.affectedSourceLocations = 2;
  const metadata = ordered.metadata as Record<string, unknown>;
  metadata.totalAffectedSourceLocations = 2;
  metadata.returnedAffectedSourceLocations = 2;
  assert.equal(validateImpactReport(ordered, PROJECT_ID, CHECK_ID).changes.length, 2);
  ordered.changes = [second, first];
  assert.throws(() => validateImpactReport(ordered, PROJECT_ID, CHECK_ID), /canonical Contract Delta ordering/u);
});

test('mirrors Contract Guard v1 HTTP-method rank and UTF-8 parameter-location ordering', async () => {
  const methods = await reportFor('ENDPOINT_REMOVED', 'breaking');
  const getChange = (methods.changes as Array<Record<string, unknown>>)[0];
  assert.ok(getChange);
  const deleteChange = structuredClone(getChange);
  const deleteSubject = deleteChange.subject as ChangeSubject;
  assert.ok(deleteSubject.operation);
  deleteSubject.operation.method = 'DELETE';
  setTwoChanges(methods, deleteChange);
  assert.equal(validateImpactReport(methods, PROJECT_ID, CHECK_ID).changes.length, 2);
  methods.changes = [deleteChange, getChange];
  assert.throws(() => validateImpactReport(methods, PROJECT_ID, CHECK_ID), /canonical Contract Delta ordering/u);

  const locations = await reportFor('PARAMETER_REMOVED', 'breaking');
  const cookieChange = (locations.changes as Array<Record<string, unknown>>)[0];
  assert.ok(cookieChange);
  const cookieSubject = cookieChange.subject as ChangeSubject;
  assert.ok(cookieSubject.parameter);
  cookieSubject.parameter.location = 'COOKIE';
  const pathChange = structuredClone(cookieChange);
  const pathSubject = pathChange.subject as ChangeSubject;
  assert.ok(pathSubject.parameter);
  pathSubject.parameter.location = 'PATH';
  setTwoChanges(locations, pathChange);
  assert.equal(validateImpactReport(locations, PROJECT_ID, CHECK_ID).changes.length, 2);
  locations.changes = [pathChange, cookieChange];
  assert.throws(() => validateImpactReport(locations, PROJECT_ID, CHECK_ID), /canonical Contract Delta ordering/u);
});

test('treats future Contract Delta category, subject qualification, and order as versioned semantics', async () => {
  const futureShape = await fixture();
  const shapeEngines = futureShape.engines as Record<string, unknown>;
  shapeEngines.contractDeltaEngineVersion = 2;
  const shapeChange = (futureShape.changes as Array<Record<string, unknown>>)[0];
  assert.ok(shapeChange);
  shapeChange.category = 'response';
  const futureSubject = shapeChange.subject as ChangeSubject;
  futureSubject.operation = operation();
  assert.equal(validateImpactReport(futureShape, PROJECT_ID, CHECK_ID).changes[0]?.category, 'response');
  shapeEngines.contractDeltaEngineVersion = 1;
  assert.throws(() => validateImpactReport(futureShape, PROJECT_ID, CHECK_ID), /Contract Delta engine v1/u);

  const futureOrder = await fixture();
  const first = (futureOrder.changes as Array<Record<string, unknown>>)[0];
  assert.ok(first);
  const second = structuredClone(first);
  setTwoChanges(futureOrder, second);
  futureOrder.changes = [second, first];
  const orderEngines = futureOrder.engines as Record<string, unknown>;
  orderEngines.contractDeltaEngineVersion = 2;
  assert.equal(validateImpactReport(futureOrder, PROJECT_ID, CHECK_ID).changes.length, 2);
  orderEngines.contractDeltaEngineVersion = 1;
  assert.throws(() => validateImpactReport(futureOrder, PROJECT_ID, CHECK_ID), /canonical Contract Delta ordering/u);
});

test('validates warning code/path ordering by serialized code text', async () => {
  const raw = await fixture();
  const metadata = raw.metadata as Record<string, unknown>;
  metadata.warnings = [
    { code: 'AFFECTED_SOURCES_TRUNCATED', message: 'Affected source locations were omitted.' },
    { code: 'EVIDENCE_TRUNCATED', message: 'Some evidence was omitted.' },
  ];
  metadata.truncated = true;
  assert.equal(validateImpactReport(raw, PROJECT_ID, CHECK_ID).metadata.warnings.length, 2);
  metadata.warnings = [...(metadata.warnings as unknown[])].reverse();
  assert.throws(() => validateImpactReport(raw, PROJECT_ID, CHECK_ID), /sorted and deduplicated by code, path, and message/u);
});

test('enforces Rust u32 fields and Standard report profile caps', async () => {
  const overLine = await fixture();
  const source = (((overLine.changes as Array<Record<string, unknown>>)[0]?.affectedSources as Array<Record<string, unknown>>)[0]);
  assert.ok(source);
  source.line = 0x1_0000_0000;
  assert.throws(() => validateImpactReport(overLine, PROJECT_ID, CHECK_ID), /bounded integer/u);

  const overRuleVersion = await fixture();
  const change = (overRuleVersion.changes as Array<Record<string, unknown>>)[0];
  assert.ok(change);
  change.ruleVersion = 0x1_0000_0000;
  assert.throws(() => validateImpactReport(overRuleVersion, PROJECT_ID, CHECK_ID), /bounded integer/u);

  const overLocations = await fixture();
  const overLocationsChange = (overLocations.changes as Array<Record<string, unknown>>)[0];
  assert.ok(overLocationsChange);
  overLocationsChange.affectedLocationCount = 50_001;
  assert.throws(() => validateImpactReport(overLocations, PROJECT_ID, CHECK_ID), /bounded integer/u);

  const overWarnings = await fixture();
  (overWarnings.metadata as Record<string, unknown>).warningsOmitted = 0x1_0000_0000;
  assert.throws(() => validateImpactReport(overWarnings, PROJECT_ID, CHECK_ID), /bounded integer/u);
});

test('rejects unknown fields and unsupported future report schemas', async () => {
  const unknown = await fixture();
  unknown.secretSource = 'must not be accepted';
  assert.throws(() => validateImpactReport(unknown, PROJECT_ID, CHECK_ID), /unknown field/u);

  const future = await fixture();
  future.schemaVersion = 'alconite.impact.report.v2';
  assert.throws(() => validateImpactReport(future, PROJECT_ID, CHECK_ID), /schemaVersion is unsupported/u);
});

test('rejects subject, count, evidence, and project binding inconsistencies', async () => {
  const wrongSubject = await fixture();
  const change = (wrongSubject.changes as Array<Record<string, unknown>>)[0];
  assert.ok(change);
  const subject = change.subject as Record<string, unknown>;
  subject.operation = {
    path: '/customers/{id}', method: 'GET', baselineOperationId: 'getCustomer', candidateOperationId: 'getCustomer',
  };
  assert.throws(() => validateImpactReport(wrongSubject, PROJECT_ID, CHECK_ID), /does not match PROPERTY_REMOVED/u);

  const wrongCount = await fixture();
  wrongCount.affectedSourceLocations = 2;
  assert.throws(() => validateImpactReport(wrongCount, PROJECT_ID, CHECK_ID), /affectedSourceLocations is inconsistent/u);

  const impossibleFileCounts = await fixture();
  const impossibleChange = (impossibleFileCounts.changes as Array<Record<string, unknown>>)[0];
  assert.ok(impossibleChange);
  impossibleChange.affectedFileCount = 0;
  impossibleChange.highConfidenceFileCount = 0;
  assert.throws(() => validateImpactReport(impossibleFileCounts, PROJECT_ID, CHECK_ID), /affected-source counts/u);

  const understatedConfidence = await fixture();
  const understatedChange = (understatedConfidence.changes as Array<Record<string, unknown>>)[0];
  assert.ok(understatedChange);
  understatedChange.confidence = 'MEDIUM';
  const understatedBasis = understatedChange.confidenceBasis as Record<string, unknown>;
  understatedBasis.level = 'MEDIUM';
  understatedBasis.conditions = ['EXACT_TYPE'];
  assert.throws(() => validateImpactReport(understatedConfidence, PROJECT_ID, CHECK_ID), /complete affected-source counts/u);

  const wrongEvidenceOrder = await fixture();
  const source = (((wrongEvidenceOrder.changes as Array<Record<string, unknown>>)[0]?.affectedSources as Array<Record<string, unknown>>)[0]);
  assert.ok(source);
  source.evidence = [...(source.evidence as unknown[])].reverse();
  assert.throws(() => validateImpactReport(wrongEvidenceOrder, PROJECT_ID, CHECK_ID), /sorted and deduplicated/u);

  const wrongProject = await fixture();
  assert.throws(() => validateImpactReport(wrongProject, 'cgprj_99999999999999999999999999999999', CHECK_ID), /identifiers do not match/u);
});

test('rejects absolute/traversing report paths and over-bound presentation values', async () => {
  for (const filename of ['../secret.ts', 'src/CON.ts', 'src/control\u0001.ts', 'src/trailing.ts.', 'src/bad:name.ts']) {
    const unsafePath = await fixture();
    const source = (((unsafePath.changes as Array<Record<string, unknown>>)[0]?.affectedSources as Array<Record<string, unknown>>)[0]);
    assert.ok(source);
    source.file = filename;
    assert.throws(() => validateImpactReport(unsafePath, PROJECT_ID, CHECK_ID), /portable path/u);
  }

  const largeSummary = await fixture();
  const change = (largeSummary.changes as Array<Record<string, unknown>>)[0];
  assert.ok(change);
  change.summary = 'x'.repeat(201);
  assert.throws(() => validateImpactReport(largeSummary, PROJECT_ID, CHECK_ID), /supported bound/u);
});

export type { ImpactReport };
