import { boundedText } from './redaction';

export type FindingClassification = 'failure' | 'warning';

export interface RuntimeFinding {
  operationId: string;
  method: 'GET' | 'HEAD' | 'CONTRACT';
  pathTemplate: string;
  classification: FindingClassification;
  ruleId: string;
  summary: string;
  explanation: string;
  guidance: string;
  location: string;
  expected?: string;
  actual?: string;
  durationMilliseconds: number;
}

export function finding(input: RuntimeFinding): RuntimeFinding {
  return {
    ...input,
    operationId: boundedText(input.operationId, 160),
    pathTemplate: boundedText(input.pathTemplate, 600),
    ruleId: boundedText(input.ruleId, 100),
    summary: boundedText(input.summary, 300),
    explanation: boundedText(input.explanation, 1_200),
    guidance: boundedText(input.guidance, 1_200),
    location: boundedText(input.location, 1_000),
    ...(input.expected === undefined ? {} : { expected: boundedText(input.expected, 300) }),
    ...(input.actual === undefined ? {} : { actual: boundedText(input.actual, 300) }),
    durationMilliseconds: Math.max(0, Math.min(3_600_000, Math.round(input.durationMilliseconds)))
  };
}

export function contractHashMismatch(expected: string, actual: string): RuntimeFinding {
  return finding({
    operationId: '$contract', method: 'CONTRACT', pathTemplate: '$contract', classification: 'failure',
    ruleId: 'runtime.contract.hash-mismatch', summary: 'The local contract does not match the approved contract.',
    explanation: 'Runtime requests were skipped because the exact local contract bytes have a different SHA-256 hash than the approved Contract Guard candidate.',
    guidance: 'Use the exact contract approved by the referenced Contract Guard check and retry the deployment verification.',
    location: '$contract', expected, actual, durationMilliseconds: 0
  });
}
