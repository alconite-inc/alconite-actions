import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function commandEscape(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function propertyEscape(value: string): string {
  return commandEscape(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

function command(name: string, message: string, properties: Record<string, string> = {}): void {
  const serialized = Object.entries(properties)
    .map(([key, value]) => `${key}=${propertyEscape(value)}`)
    .join(',');
  process.stdout.write(`::${name}${serialized ? ` ${serialized}` : ''}::${commandEscape(message)}\n`);
}

export function getInput(name: string, options: { required?: boolean } = {}): string {
  const key = `INPUT_${name.replaceAll(' ', '_').toUpperCase()}`;
  const value = (process.env[key] || '').trim();
  if (options.required && !value) throw new Error(`Input required and not supplied: ${name}`);
  return value;
}

export function setSecret(value: string): void {
  if (value) command('add-mask', value);
}

export function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    command('set-output', value, { name });
    return;
  }
  const delimiter = `ghadelimiter_${randomUUID()}`;
  appendFileSync(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, { encoding: 'utf8' });
}

export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function notice(message: string, title?: string): void {
  command('notice', message, title ? { title } : {});
}

export function warning(message: string, title?: string): void {
  command('warning', message, title ? { title } : {});
}

export function error(message: string, title?: string): void {
  command('error', message, title ? { title } : {});
}

export function setFailed(message: string): void {
  error(message);
  process.exitCode = 1;
}

function markdownCell(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replaceAll('\r', ' ')
    .replaceAll('\n', '<br>');
}

export function markdownTable(headers: string[], rows: Array<Array<string | number>>): string {
  return [
    `| ${headers.map(markdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`),
  ].join('\n');
}

export function writeJobSummary(markdown: string): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, markdown, { encoding: 'utf8' });
}
