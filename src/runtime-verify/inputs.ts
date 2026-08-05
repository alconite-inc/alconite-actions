import { getInput } from '../github';
import { parseBoundedInteger, parseFailOn, type FailOn } from '../contract-guard';
import { RuntimeVerifyError } from './errors';
import { sha256 } from './redaction';

export interface RuntimeVerifyInputs {
  projectId: string;
  projectToken: string;
  environmentId: string;
  checkId: string;
  baseUrl: URL;
  contractPath: string;
  configurationPath: string;
  displayName?: string;
  deploymentId?: string;
  apiUrl: URL;
  idempotencyKey?: string;
  timeoutSeconds: number;
  retryAttempts: number;
  failOn: FailOn;
  reportPath?: string;
}

const IDENTIFIERS = {
  projectId: /^cgprj_[A-Za-z0-9_-]{1,73}$/,
  environmentId: /^rtvenv_[A-Za-z0-9_-]{1,72}$/,
  checkId: /^cgchk_[A-Za-z0-9_-]{1,73}$/
};

export function readInputs(): RuntimeVerifyInputs {
  const projectId = identifier(getInput('project-id', { required: true }), 'project ID', IDENTIFIERS.projectId);
  const projectToken = getInput('project-token', { required: true });
  if (!/^alc_cg_[A-Za-z0-9_-]{1,240}$/.test(projectToken)) throw inputError('Project token must be a bounded alc_cg_ token.');
  const environmentId = identifier(getInput('environment-id', { required: true }), 'environment ID', IDENTIFIERS.environmentId);
  const checkId = identifier(getInput('check-id', { required: true }), 'check ID', IDENTIFIERS.checkId);
  const displayName = optionalBounded(getInput('display-name'), 'Display name', 160);
  const deploymentId = optionalBounded(getInput('deployment-id'), 'Deployment ID', 200);
  const idempotencyKey = optionalBounded(getInput('idempotency-key'), 'Idempotency key', 200);
  return {
    projectId,
    projectToken,
    environmentId,
    checkId,
    baseUrl: validateOrigin(getInput('base-url', { required: true }), 'Target base URL'),
    contractPath: getInput('contract-path') || 'openapi.yaml',
    configurationPath: getInput('configuration-path') || '.alconite/runtime-verify.yaml',
    ...(displayName ? { displayName } : {}),
    ...(deploymentId ? { deploymentId } : {}),
    apiUrl: validateOrigin(getInput('api-url') || 'https://alconite.com', 'Alconite API URL'),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    timeoutSeconds: parseBoundedInteger(getInput('timeout-seconds') || '120', 'timeout-seconds', 1, 3_600),
    retryAttempts: parseBoundedInteger(getInput('retry-attempts') || '3', 'retry-attempts', 1, 5),
    failOn: parseFailOn(getInput('fail-on') || 'failed'),
    ...(getInput('report-path') ? { reportPath: getInput('report-path') } : {})
  };
}

export function validateOrigin(raw: string, label: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw inputError(`${label} must be an absolute URL.`); }
  if (url.username || url.password) throw inputError(`${label} must not contain embedded credentials.`);
  if (url.search || url.hash) throw inputError(`${label} must not contain query parameters or a fragment.`);
  if (url.pathname !== '/' && url.pathname !== '') throw inputError(`${label} must identify an origin without a path.`);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw inputError(`${label} must use HTTPS except for loopback testing.`);
  url.pathname = '/';
  return url;
}

export function deriveIdempotencyKey(inputs: RuntimeVerifyInputs, contractHash: string, configurationHash: string, environment = process.env): string {
  if (inputs.idempotencyKey) return inputs.idempotencyKey;
  const material = [
    'runtime-gh-v1', environment.GITHUB_REPOSITORY ?? 'local', environment.GITHUB_RUN_ID ?? 'local',
    environment.GITHUB_RUN_ATTEMPT ?? '1', inputs.projectId, inputs.environmentId, inputs.checkId,
    contractHash, configurationHash, inputs.deploymentId ?? ''
  ].join('\n');
  return `runtime-gh-v1-${sha256(material).slice('sha256:'.length)}`;
}

function identifier(raw: string, label: string, pattern: RegExp): string {
  if (!pattern.test(raw) || raw.includes('/') || raw.includes('\\')) throw inputError(`The ${label} has an invalid format.`);
  return raw;
}
function optionalBounded(raw: string, label: string, maximum: number): string | undefined {
  if (!raw) return undefined;
  if (raw.length > maximum || /[\r\n]/.test(raw)) throw inputError(`${label} is invalid or too long.`);
  return raw;
}
function inputError(message: string): RuntimeVerifyError { return new RuntimeVerifyError('invalid_input', message); }
