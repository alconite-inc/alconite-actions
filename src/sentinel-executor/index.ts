import { ACTION_RELEASE_VERSION } from '../release';
import { parseExecutionArguments } from './arguments';
import { defaultRoots, runAction } from './action-process';

const HELP = `Alconite Sentinel executor ${ACTION_RELEASE_VERSION}

Usage:
  sentinel --help
  sentinel --version
  sentinel contract-guard [options]
  sentinel impact [options]
  sentinel runtime-verify [options]

Supply the project token only with ALCONITE_PROJECT_TOKEN.
Mount customer files read-only at /workspace and reports writable at /reports.`;

const SUBCOMMAND_HELP = {
  'contract-guard': `Usage: sentinel contract-guard --project-id <cgprj_...> [options]

  --candidate-path <path>       default: openapi.yaml
  --display-name <text>         default: local Action identity
  --api-url <origin>            default: https://alconite.com
  --idempotency-key <text>      default: deterministic local key
  --timeout-seconds <1..600>    default: 120
  --retry-attempts <1..5>       default: 3
  --fail-on <threshold>         failed, warnings, or never; default: failed
  --report-path <path>          relative to /reports; default: check-specific`,
  impact: `Usage: sentinel impact --project-id <cgprj_...> --check-id <cgchk_...> [options]

  --source-root <path>          default: .
  --api-url <origin>            default: https://alconite.com
  --additional-ignore <pattern> repeatable
  --include-generated-directories <true|false>  default: false
  --timeout-seconds <1..600>    default: 120
  --attempts <1..5>             default: 3
  --fail-on-risk <threshold>    never, low, medium, high, or critical; default: never
  --fail-on-potential-risk <threshold>  same values; default: never`,
  'runtime-verify': `Usage: sentinel runtime-verify --project-id <cgprj_...> --environment-id <rtvenv_...> --base-url <origin> [options]

  --check-id <cgchk_...>        default: automatic exact-contract resolution
  --contract-path <path>        default: openapi.yaml
  --configuration-path <path>   default: .alconite/runtime-verify.yaml
  --display-name <text>         default: none
  --deployment-id <text>        default: none
  --api-url <origin>            default: https://alconite.com
  --idempotency-key <text>      default: deterministic local key
  --timeout-seconds <1..3600>   default: 120
  --retry-attempts <1..5>       default: 3
  --fail-on <threshold>         failed, warnings, or never; default: failed
  --report-path <path>          relative to /reports; default: alconite-runtime-verify-report.json`,
} as const;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const token = process.env.ALCONITE_PROJECT_TOKEN;
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (argv.length === 1 && argv[0] === '--version') {
    process.stdout.write(`${ACTION_RELEASE_VERSION}\n`);
    return 0;
  }
  const requestedCommand = argv[0];
  if (argv.length === 2 && argv[1] === '--help' &&
      (requestedCommand === 'contract-guard' || requestedCommand === 'impact' || requestedCommand === 'runtime-verify')) {
    process.stdout.write(`${SUBCOMMAND_HELP[requestedCommand]}\n`);
    return 0;
  }
  try {
    const parsed = parseExecutionArguments(argv);
    if (!token) throw new Error('ALCONITE_PROJECT_TOKEN is required.');
    const result = await runAction(parsed, token, defaultRoots());
    process.stdout.write(`${JSON.stringify({ schema: 'alconite.sentinel-executor.result.v1', ...result })}\n`);
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sentinel executor failed.';
    process.stderr.write(`${token ? message.replaceAll(token, '[REDACTED]') : message}\n`);
    const command = argv[0];
    if (command === 'contract-guard' || command === 'impact' || command === 'runtime-verify') {
      process.stdout.write(`${JSON.stringify({
        schema: 'alconite.sentinel-executor.result.v1', command, exitCode: 1, outputs: {},
      })}\n`);
    }
    return 1;
  }
}

void main().then((code) => { process.exitCode = code; });
