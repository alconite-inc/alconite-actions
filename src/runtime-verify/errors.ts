export type RuntimeErrorCode =
  | 'invalid_input'
  | 'invalid_configuration'
  | 'invalid_openapi'
  | 'unsupported_openapi'
  | 'operation_plan_invalid'
  | 'platform_contract_mismatch'
  | 'platform_error'
  | 'runner_internal_error';

export class RuntimeVerifyError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    readonly causeValue?: unknown
  ) {
    super(message);
    this.name = 'RuntimeVerifyError';
  }
}

export function safeError(error: unknown): RuntimeVerifyError {
  if (error instanceof RuntimeVerifyError) return error;
  return new RuntimeVerifyError('runner_internal_error', 'Runtime Verify encountered an unexpected runner error.');
}
