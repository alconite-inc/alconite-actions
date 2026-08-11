import type { RuntimeDefaults } from './configuration';
import { RUNTIME_VERIFY_USER_AGENT } from '../release';
import type { RuntimeFinding } from './findings';
import { finding } from './findings';
import type { ApprovedContract } from './openapi';
import type { PlannedOperation } from './operation-plan';
import type { RuntimeObservation } from './report';
import { validateResponse } from './response-validator';

export interface TargetExecutionResult {
  observations: RuntimeObservation[];
  findings: RuntimeFinding[];
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CONTENT_ENCODINGS = new Set(['', 'identity', 'gzip', 'deflate', 'br']);

export async function executePlan(
  contract: ApprovedContract,
  plan: PlannedOperation[],
  baseUrl: URL,
  defaults: RuntimeDefaults,
  totalSignal?: AbortSignal
): Promise<TargetExecutionResult> {
  const observations: RuntimeObservation[] = [];
  const findings: RuntimeFinding[] = [];
  for (const operation of plan) {
    if (totalSignal?.aborted) {
      const operationFindings = [transportFinding(operation, 0, 'runtime.transport.timeout', 'The Runtime Verify action timeout was reached.',
        'The total runner deadline expired before this operation could complete.', 'Increase timeout-seconds or reduce the configured operation set.')];
      findings.push(...operationFindings);
      observations.push(observation(operation, 0, 0, operationFindings));
      continue;
    }
    const result = await executeOperation(contract, operation, baseUrl, defaults, totalSignal);
    observations.push(result.observation);
    findings.push(...result.findings);
  }
  return { observations, findings };
}

async function executeOperation(
  contract: ApprovedContract,
  plan: PlannedOperation,
  baseUrl: URL,
  defaults: RuntimeDefaults,
  totalSignal?: AbortSignal
): Promise<{ observation: RuntimeObservation; findings: RuntimeFinding[] }> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), defaults.timeoutSeconds * 1_000);
  const abortFromTotal = () => controller.abort();
  totalSignal?.addEventListener('abort', abortFromTotal, { once: true });
  let response: Response | undefined;
  let current = new URL(plan.requestPath, baseUrl);
  try {
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      response = await fetch(current, {
        method: plan.method,
        headers: { ...plan.headers, 'User-Agent': RUNTIME_VERIFY_USER_AGENT, Accept: 'application/json, application/problem+json, */*;q=0.1' },
        redirect: 'manual', signal: controller.signal
      });
      if (!REDIRECT_STATUSES.has(response.status)) break;
      if (!defaults.followRedirects) {
        const duration = elapsed(started);
        const values = [transportFinding(plan, duration, 'runtime.transport.redirect-rejected', 'The target returned a redirect.',
          'Redirect following is disabled by the Runtime Verify configuration.', 'Return the final response directly or explicitly enable same-origin redirects.')];
        return { observation: observation(plan, duration, 0, values, response.status), findings: values };
      }
      if (redirect === 3) {
        const duration = elapsed(started);
        const values = [transportFinding(plan, duration, 'runtime.transport.redirect-rejected', 'The target exceeded the redirect limit.',
          'Runtime Verify follows at most three same-origin redirects.', 'Reduce the redirect chain to three hops or fewer.')];
        return { observation: observation(plan, duration, 0, values, response.status), findings: values };
      }
      const location = response.headers.get('location');
      if (!location) break;
      const next = new URL(location, current);
      if (next.origin !== baseUrl.origin) {
        const duration = elapsed(started);
        const values = [transportFinding(plan, duration, 'runtime.transport.redirect-rejected', 'The target attempted a cross-origin redirect.',
          'Runtime Verify never forwards configured target headers to another origin.', 'Return a same-origin location or the final response directly.')];
        return { observation: observation(plan, duration, 0, values, response.status), findings: values };
      }
      current = next;
    }
    if (!response) throw new Error('no response');
    const contentEncoding = (response.headers.get('content-encoding') ?? '').trim().toLowerCase();
    if (!CONTENT_ENCODINGS.has(contentEncoding)) {
      const duration = elapsed(started);
      const values = [transportFinding(plan, duration, 'runtime.response.content-encoding-invalid', 'The target used an unsupported content encoding.',
        'Runtime Verify accepts identity, gzip, deflate, and Brotli response encodings.', 'Return a response using a supported content encoding.')];
      return { observation: observation(plan, duration, 0, values, response.status), findings: values };
    }
    const bodyResult = plan.method === 'HEAD' ? { body: Buffer.alloc(0), size: 0, exceeded: false } : await readBoundedBody(response, defaults.maximumResponseBytes);
    const duration = elapsed(started);
    if (bodyResult.exceeded) {
      const values = [transportFinding(plan, duration, 'runtime.response.too-large', 'The target response exceeded the configured size limit.',
        'The response was aborted after the decompressed byte limit was exceeded.', 'Reduce the response size or increase maximumResponseBytes within the allowed bound.')];
      return { observation: observation(plan, duration, bodyResult.size, values, response.status), findings: values };
    }
    const validation = validateResponse({ contract, plan, statusCode: response.status, headers: response.headers, body: bodyResult.body, durationMilliseconds: duration });
    return {
      observation: observation(plan, duration, bodyResult.size, validation.findings, response.status, validation.contentType),
      findings: validation.findings
    };
  } catch (error) {
    const duration = elapsed(started);
    const timedOut = controller.signal.aborted;
    const values = [transportFinding(plan, duration, timedOut ? 'runtime.transport.timeout' : 'runtime.transport.unreachable',
      timedOut ? 'The target request timed out.' : 'The target could not be reached.',
      timedOut ? 'The target did not complete within the configured operation deadline.' : 'The runner could not establish or complete the target connection.',
      timedOut ? 'Improve target responsiveness or increase the bounded operation timeout.' : 'Confirm target availability, DNS, TLS, and runner network access.')];
    return { observation: observation(plan, duration, 0, values), findings: values };
  } finally {
    clearTimeout(timeout);
    totalSignal?.removeEventListener('abort', abortFromTotal);
  }
}

async function readBoundedBody(response: Response, maximum: number): Promise<{ body: Buffer; size: number; exceeded: boolean }> {
  if (!response.body) return { body: Buffer.alloc(0), size: 0, exceeded: false };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel().catch(() => undefined);
      return { body: Buffer.alloc(0), size, exceeded: true };
    }
    chunks.push(Buffer.from(value));
  }
  return { body: Buffer.concat(chunks, size), size, exceeded: false };
}

function observation(
  plan: PlannedOperation, duration: number, responseBytes: number, findings: RuntimeFinding[],
  statusCode?: number, contentType?: string
): RuntimeObservation {
  const hasFailure = findings.some(value => value.classification === 'failure');
  const hasWarning = findings.some(value => value.classification === 'warning');
  return {
    operationId: plan.operationId, method: plan.method, pathTemplate: plan.pathTemplate,
    outcome: hasFailure ? 'failed' : hasWarning ? 'warning' : 'passed',
    ...(statusCode === undefined ? {} : { statusCode }), ...(contentType ? { contentType } : {}),
    durationMilliseconds: duration, responseBytes
  };
}

function transportFinding(plan: PlannedOperation, duration: number, ruleId: string, summary: string, explanation: string, guidance: string): RuntimeFinding {
  return finding({ operationId: plan.operationId, method: plan.method, pathTemplate: plan.pathTemplate,
    classification: 'failure', ruleId, summary, explanation, guidance, location: '$transport', durationMilliseconds: duration });
}
function elapsed(started: number): number { return Math.max(0, Math.round(performance.now() - started)); }
