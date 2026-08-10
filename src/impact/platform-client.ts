import { ActionDeadline } from './deadline';
import { ImpactActionError } from './errors';
import {
  MAX_REPORT_BYTES,
  validateImpactReport,
  type ImpactReport,
  type ImpactRequest,
} from './models';

export const MAX_REQUEST_BYTES = 24 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;
const RETRYABLE_CODES = new Set(['impact_analysis_busy', 'impact_storage_unavailable']);

export interface ImpactPlatformClientOptions {
  apiUrl: string;
  projectId: string;
  projectToken: string;
  checkId: string;
  attempts: number;
  deadline: ActionDeadline;
  fetchImplementation?: typeof fetch;
}

interface PlatformErrorEnvelope {
  code: string;
}

export function validateProjectId(value: string): string {
  const projectId = value.trim();
  if (!/^cgprj_[0-9a-f]{32}$/u.test(projectId)) {
    throw new ImpactActionError('invalid_input', 'project-id must be a Contract Guard identifier beginning with cgprj_.');
  }
  return projectId;
}

export function validateCheckId(value: string): string {
  const checkId = value.trim();
  if (!/^cgchk_[0-9a-f]{32}$/u.test(checkId)) {
    throw new ImpactActionError('invalid_input', 'check-id must be a Contract Guard identifier beginning with cgchk_.');
  }
  return checkId;
}

export function validateProjectToken(value: string): string {
  const token = value.trim();
  if (!token.startsWith('alc_cg_') || token.length <= 7 || token.length > 512 || /[\r\n\0]/u.test(token)) {
    throw new ImpactActionError('invalid_input', 'project-token must be a bounded Alconite project token beginning with alc_cg_.');
  }
  return token;
}

export function validateApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new ImpactActionError('invalid_input', 'api-url must be a valid absolute URL.', { cause: error });
  }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ImpactActionError('invalid_input', 'api-url must use HTTPS except for loopback testing.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ImpactActionError('invalid_input', 'api-url must not contain credentials, a query string, or a fragment.');
  }
  return url.toString().replace(/\/+$/u, '');
}

function endpoint(options: ImpactPlatformClientOptions): string {
  return `${options.apiUrl}/api/v1/contract-guard/projects/${encodeURIComponent(options.projectId)}/checks/${encodeURIComponent(options.checkId)}/impact`;
}

async function readBoundedBytes(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredRaw = response.headers.get('content-length');
  if (declaredRaw && /^\d+$/u.test(declaredRaw) && Number(declaredRaw) > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ImpactActionError('platform_contract_mismatch', 'Alconite returned an oversized Impact response.', { status: response.status });
  }
  if (!response.body) {
    throw new ImpactActionError('platform_contract_mismatch', 'Alconite returned an empty Impact response.', { status: response.status });
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ImpactActionError('platform_contract_mismatch', 'Alconite returned an oversized Impact response.', { status: response.status });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const bytes = await readBoundedBytes(response, maximumBytes);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new ImpactActionError('platform_contract_mismatch', 'Alconite returned malformed Impact JSON.', {
      status: response.status,
      cause: error,
    });
  }
}

function errorEnvelope(value: unknown): PlatformErrorEnvelope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const outer = value as Record<string, unknown>;
  if (!outer.error || typeof outer.error !== 'object' || Array.isArray(outer.error)) return undefined;
  const error = outer.error as Record<string, unknown>;
  if (typeof error.code !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/u.test(error.code)) return undefined;
  if (typeof error.message !== 'string' || [...error.message].length < 1 || [...error.message].length > 300) return undefined;
  return { code: error.code };
}

function retryAfterMilliseconds(value: string | null): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) return undefined;
  return Math.min(seconds * 1_000, 30_000);
}

function backoff(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 10_000);
}

export class ImpactPlatformClient {
  private readonly fetchImplementation: typeof fetch;

  public constructor(private readonly options: ImpactPlatformClientOptions) {
    if (!Number.isSafeInteger(options.attempts) || options.attempts < 1 || options.attempts > 5) {
      throw new ImpactActionError('invalid_input', 'attempts must be an integer from 1 through 5.');
    }
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  }

  public async analyze(request: ImpactRequest): Promise<ImpactReport> {
    this.options.deadline.throwIfExpired();
    const body = JSON.stringify(request);
    const requestBytes = Buffer.byteLength(body, 'utf8');
    if (requestBytes > MAX_REQUEST_BYTES) {
      throw new ImpactActionError('collection_limit_exceeded', `The encoded Impact request exceeds the ${MAX_REQUEST_BYTES}-byte limit.`);
    }
    this.options.deadline.throwIfExpired();
    let lastNetworkError: unknown;
    for (let attempt = 1; attempt <= this.options.attempts; attempt += 1) {
      this.options.deadline.throwIfExpired();
      let response: Response;
      try {
        response = await this.fetchImplementation(endpoint(this.options), {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${this.options.projectToken}`,
            'content-type': 'application/json',
            'user-agent': 'alconite-impact-action/2.1.2-unreleased',
          },
          body,
          redirect: 'manual',
          signal: this.options.deadline.signal(),
        });
      } catch (error) {
        lastNetworkError = error;
        try {
          this.options.deadline.throwIfExpired();
        } catch (deadlineError) {
          throw deadlineError;
        }
        if (attempt >= this.options.attempts) break;
        await this.options.deadline.wait(backoff(attempt));
        continue;
      }

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        throw new ImpactActionError('platform_request_failed', 'Alconite Impact redirects are refused to protect the project token.', {
          status: response.status,
        });
      }

      if (response.status === 200) {
        const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined);
          throw new ImpactActionError('platform_contract_mismatch', 'Alconite returned an unsupported Impact response content type.', {
            status: response.status,
          });
        }
        const raw = await readBoundedJson(response, MAX_REPORT_BYTES);
        this.options.deadline.throwIfExpired();
        const report = validateImpactReport(raw, this.options.projectId, this.options.checkId);
        this.options.deadline.throwIfExpired();
        return report;
      }

      if (response.status === 502 && attempt < this.options.attempts) {
        await response.body?.cancel().catch(() => undefined);
        await this.options.deadline.wait(retryAfterMilliseconds(response.headers.get('retry-after')) ?? backoff(attempt));
        continue;
      }

      let rawError: unknown;
      try {
        rawError = await readBoundedJson(response, MAX_ERROR_BYTES);
      } catch {
        rawError = undefined;
      }
      const envelope = errorEnvelope(rawError);
      const retryableGateway = response.status === 504 && !envelope;
      const retryableCode = envelope ? RETRYABLE_CODES.has(envelope.code) : false;
      if ((retryableGateway || retryableCode) && attempt < this.options.attempts) {
        await this.options.deadline.wait(retryAfterMilliseconds(response.headers.get('retry-after')) ?? backoff(attempt));
        continue;
      }
      const suffix = envelope ? ` (${envelope.code})` : '';
      throw new ImpactActionError(
        'platform_request_failed',
        `Alconite rejected Impact analysis with HTTP ${response.status}${suffix}.`,
        { status: response.status, platformCode: envelope?.code },
      );
    }
    throw new ImpactActionError(
      'platform_request_failed',
      `Alconite Impact network request failed after ${this.options.attempts} attempt(s).`,
      { cause: lastNetworkError },
    );
  }
}
