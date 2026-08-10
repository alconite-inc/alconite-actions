export type ImpactActionErrorCode =
  | 'invalid_input'
  | 'collection_limit_exceeded'
  | 'source_race_detected'
  | 'unsupported_secure_source_filesystem'
  | 'unsupported_secure_report_filesystem'
  | 'source_file_read_failed'
  | 'action_deadline_exceeded'
  | 'platform_request_failed'
  | 'platform_contract_mismatch'
  | 'report_write_failed';

export class ImpactActionError extends Error {
  public readonly code: ImpactActionErrorCode;
  public readonly status?: number;
  public readonly platformCode?: string;

  public constructor(
    code: ImpactActionErrorCode,
    message: string,
    options: { status?: number; platformCode?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ImpactActionError';
    this.code = code;
    this.status = options.status;
    this.platformCode = options.platformCode;
  }
}

