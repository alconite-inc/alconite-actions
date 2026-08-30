export type SentinelCommand = 'contract-guard' | 'impact' | 'runtime-verify';

export interface ParsedExecution {
  command: SentinelCommand;
  inputs: Readonly<Record<string, string>>;
}

interface OptionDefinition {
  input: string;
  required?: boolean;
  repeatable?: boolean;
  defaultValue?: string;
  values?: readonly string[];
  integer?: readonly [number, number];
  reportsPath?: boolean;
}

const COMMON = {
  '--project-id': { input: 'project-id', required: true },
  '--api-url': { input: 'api-url', defaultValue: 'https://alconite.com' },
} satisfies Record<string, OptionDefinition>;

const DEFINITIONS: Record<SentinelCommand, Readonly<Record<string, OptionDefinition>>> = {
  'contract-guard': {
    ...COMMON,
    '--candidate-path': { input: 'candidate-path', defaultValue: 'openapi.yaml' },
    '--display-name': { input: 'display-name', defaultValue: '' },
    '--idempotency-key': { input: 'idempotency-key', defaultValue: '' },
    '--timeout-seconds': { input: 'timeout-seconds', defaultValue: '120', integer: [1, 600] },
    '--retry-attempts': { input: 'retry-attempts', defaultValue: '3', integer: [1, 5] },
    '--fail-on': { input: 'fail-on', defaultValue: 'failed', values: ['failed', 'warnings', 'never'] },
    '--report-path': { input: 'report-path', defaultValue: '', reportsPath: true },
  },
  impact: {
    ...COMMON,
    '--check-id': { input: 'check-id', required: true },
    '--source-root': { input: 'source-root', defaultValue: '.' },
    '--additional-ignore': { input: 'additional-ignore', repeatable: true, defaultValue: '' },
    '--include-generated-directories': { input: 'include-generated-directories', defaultValue: 'false', values: ['true', 'false'] },
    '--timeout-seconds': { input: 'timeout-seconds', defaultValue: '120', integer: [1, 600] },
    '--attempts': { input: 'attempts', defaultValue: '3', integer: [1, 5] },
    '--fail-on-risk': { input: 'fail-on-risk', defaultValue: 'never', values: ['never', 'low', 'medium', 'high', 'critical'] },
    '--fail-on-potential-risk': { input: 'fail-on-potential-risk', defaultValue: 'never', values: ['never', 'low', 'medium', 'high', 'critical'] },
  },
  'runtime-verify': {
    ...COMMON,
    '--environment-id': { input: 'environment-id', required: true },
    '--base-url': { input: 'base-url', required: true },
    '--check-id': { input: 'check-id', defaultValue: '' },
    '--contract-path': { input: 'contract-path', defaultValue: 'openapi.yaml' },
    '--configuration-path': { input: 'configuration-path', defaultValue: '.alconite/runtime-verify.yaml' },
    '--display-name': { input: 'display-name', defaultValue: '' },
    '--deployment-id': { input: 'deployment-id', defaultValue: '' },
    '--idempotency-key': { input: 'idempotency-key', defaultValue: '' },
    '--timeout-seconds': { input: 'timeout-seconds', defaultValue: '120', integer: [1, 3_600] },
    '--retry-attempts': { input: 'retry-attempts', defaultValue: '3', integer: [1, 5] },
    '--fail-on': { input: 'fail-on', defaultValue: 'failed', values: ['failed', 'warnings', 'never'] },
    '--report-path': { input: 'report-path', defaultValue: 'alconite-runtime-verify-report.json', reportsPath: true },
  },
};

export function parseExecutionArguments(argv: readonly string[]): ParsedExecution {
  const command = argv[0];
  if (!isCommand(command)) throw new Error(`Unknown command: ${command ?? '(missing)'}.`);
  const definitions = DEFINITIONS[command];
  const collected = new Map<string, string[]>();
  for (let index = 1; index < argv.length; index += 2) {
    const option = argv[index];
    if (!option?.startsWith('--')) throw new Error(`Unexpected positional argument: ${option ?? '(missing)'}.`);
    if (option === '--project-token' || option.includes('token')) throw new Error('The project token must be supplied only through ALCONITE_PROJECT_TOKEN.');
    const definition = definitions[option];
    if (!definition) throw new Error(`Unknown option for ${command}: ${option}.`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${option}.`);
    const values = collected.get(option) ?? [];
    if (values.length > 0 && !definition.repeatable) throw new Error(`Duplicate option: ${option}.`);
    values.push(validateValue(option, value, definition));
    collected.set(option, values);
  }
  const inputs: Record<string, string> = {};
  for (const [option, definition] of Object.entries(definitions)) {
    const values = collected.get(option);
    if (definition.required && !values?.[0]) throw new Error(`Required option is missing: ${option}.`);
    inputs[definition.input] = values ? values.join('\n') : (definition.defaultValue ?? '');
  }
  return { command, inputs };
}

function validateValue(option: string, value: string, definition: OptionDefinition): string {
  if (value.length === 0 || value.includes('\0')) throw new Error(`${option} requires a non-empty value.`);
  if (definition.values && !definition.values.includes(value)) throw new Error(`${option} has an invalid value.`);
  if (definition.integer) {
    if (!/^\d+$/u.test(value)) throw new Error(`${option} must be an integer.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < definition.integer[0] || parsed > definition.integer[1]) {
      throw new Error(`${option} is outside its supported range.`);
    }
  }
  if (definition.reportsPath) validateReportsRelativePath(value, option);
  return value;
}

export function validateReportsRelativePath(value: string, option = '--report-path'): void {
  if (value === '') return;
  if (value.length > 1_024 || value.startsWith('/') || value.includes('\\') || value.includes('//') || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${option} must be a safe path relative to /reports.`);
  }
  const components = value.split('/');
  if (components.some((component) => component === '' || component === '.' || component === '..')) {
    throw new Error(`${option} must be a safe path relative to /reports.`);
  }
}

function isCommand(value: string | undefined): value is SentinelCommand {
  return value === 'contract-guard' || value === 'impact' || value === 'runtime-verify';
}
