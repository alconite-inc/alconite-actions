import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  IMPACT_REPORT_SCHEMA_VERSION,
  validateImpactReport,
  type ImpactReport,
} from '../src/impact/models';

const PROJECT_ID = 'cgprj_11111111111111111111111111111111';
const CHECK_ID = 'cgchk_22222222222222222222222222222222';

async function fixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.resolve('test/fixtures/impact-report-v1.json'), 'utf8')) as Record<string, unknown>;
}

test('strictly validates the synchronized Impact report v1 fixture', async () => {
  const report = validateImpactReport(await fixture(), PROJECT_ID, CHECK_ID);
  assert.equal(report.schemaVersion, IMPACT_REPORT_SCHEMA_VERSION);
  assert.equal(report.overallRisk, 'HIGH');
  assert.equal(report.changes[0]?.subject.schema?.property, 'firstName');
  assert.equal(report.changes[0]?.affectedSources[0]?.evidence.length, 2);
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

  const wrongEvidenceOrder = await fixture();
  const source = (((wrongEvidenceOrder.changes as Array<Record<string, unknown>>)[0]?.affectedSources as Array<Record<string, unknown>>)[0]);
  assert.ok(source);
  source.evidence = [...(source.evidence as unknown[])].reverse();
  assert.throws(() => validateImpactReport(wrongEvidenceOrder, PROJECT_ID, CHECK_ID), /sorted and deduplicated/u);

  const wrongProject = await fixture();
  assert.throws(() => validateImpactReport(wrongProject, 'cgprj_99999999999999999999999999999999', CHECK_ID), /identifiers do not match/u);
});

test('rejects absolute/traversing report paths and over-bound presentation values', async () => {
  const unsafePath = await fixture();
  const source = (((unsafePath.changes as Array<Record<string, unknown>>)[0]?.affectedSources as Array<Record<string, unknown>>)[0]);
  assert.ok(source);
  source.file = '../secret.ts';
  assert.throws(() => validateImpactReport(unsafePath, PROJECT_ID, CHECK_ID), /portable path/u);

  const largeSummary = await fixture();
  const change = (largeSummary.changes as Array<Record<string, unknown>>)[0];
  assert.ok(change);
  change.summary = 'x'.repeat(201);
  assert.throws(() => validateImpactReport(largeSummary, PROJECT_ID, CHECK_ID), /supported bound/u);
});

export type { ImpactReport };
