import { boundedText, sha256, stableJson } from './redaction';

export type FindingClassification = 'failure' | 'warning';

export interface RuntimeFinding {
  fingerprint: string;
  operationId?: string;
  method?: 'GET' | 'HEAD';
  pathTemplate?: string;
  classification: FindingClassification;
  ruleId: string;
  summary: string;
  explanation: string;
  guidance: string;
  location?: string;
  expected?: string;
  actual?: string;
  durationMilliseconds?: number;
}

export function finding(input: Omit<RuntimeFinding, 'fingerprint'>): RuntimeFinding {
  const normalized = {
    ...input,
    ...(input.operationId === undefined ? {} : { operationId: boundedText(input.operationId, 200) }),
    ...(input.pathTemplate === undefined ? {} : { pathTemplate: boundedText(input.pathTemplate, 500) }),
    ruleId: boundedText(input.ruleId, 100),
    summary: boundedText(input.summary, 240),
    explanation: boundedText(input.explanation, 1_000),
    guidance: boundedText(input.guidance, 1_000),
    ...(input.location === undefined ? {} : { location: boundedText(input.location, 300) }),
    ...(input.expected === undefined ? {} : { expected: boundedText(input.expected, 300) }),
    ...(input.actual === undefined ? {} : { actual: boundedText(input.actual, 300) }),
    ...(input.durationMilliseconds === undefined ? {} : {
      durationMilliseconds: Math.max(0, Math.min(3_600_000, Math.round(input.durationMilliseconds)))
    })
  };
  const fingerprint = sha256(stableJson({
    version: 1,
    ruleId: normalized.ruleId,
    operationId: normalized.operationId ?? null,
    method: normalized.method ?? null,
    pathTemplate: normalized.pathTemplate ?? null,
    location: normalized.location ?? null
  }));
  return { fingerprint, ...normalized };
}
