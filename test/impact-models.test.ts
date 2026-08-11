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
  type ImpactReport,
} from '../src/impact/models';

const PROJECT_ID = 'cgprj_11111111111111111111111111111111';
const CHECK_ID = 'cgchk_22222222222222222222222222222222';
const PLATFORM_PROJECT_ID = 'cgprj_00000000000000000000000000000000';
const PLATFORM_CHECK_ID = 'cgchk_11111111111111111111111111111111';

async function fixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.resolve('test/fixtures/impact-report-v1-single-file.json'), 'utf8')) as Record<string, unknown>;
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
  assert.throws(() => validateImpactReport(nonDestructive, PROJECT_ID, CHECK_ID), /not a valid destructive-removal elevation/u);

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
  assert.throws(() => validateImpactReport(wrongRisk, PROJECT_ID, CHECK_ID), /risk does not match its potential risk/u);

  const wrongCategory = await fixture();
  const wrongCategoryChange = (wrongCategory.changes as Array<Record<string, unknown>>)[0];
  assert.ok(wrongCategoryChange);
  wrongCategoryChange.category = 'response';
  assert.throws(() => validateImpactReport(wrongCategory, PROJECT_ID, CHECK_ID), /category does not match its semantic kind/u);

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
