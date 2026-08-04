"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInput = getInput;
exports.setSecret = setSecret;
exports.setOutput = setOutput;
exports.info = info;
exports.notice = notice;
exports.warning = warning;
exports.error = error;
exports.setFailed = setFailed;
exports.markdownTable = markdownTable;
exports.writeJobSummary = writeJobSummary;
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
function commandEscape(value) {
    return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}
function propertyEscape(value) {
    return commandEscape(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}
function command(name, message, properties = {}) {
    const serialized = Object.entries(properties)
        .map(([key, value]) => `${key}=${propertyEscape(value)}`)
        .join(',');
    process.stdout.write(`::${name}${serialized ? ` ${serialized}` : ''}::${commandEscape(message)}\n`);
}
function getInput(name, options = {}) {
    const key = `INPUT_${name.replaceAll(' ', '_').toUpperCase()}`;
    const value = (process.env[key] || '').trim();
    if (options.required && !value)
        throw new Error(`Input required and not supplied: ${name}`);
    return value;
}
function setSecret(value) {
    if (value)
        command('add-mask', value);
}
function setOutput(name, value) {
    const outputFile = process.env.GITHUB_OUTPUT;
    if (!outputFile) {
        command('set-output', value, { name });
        return;
    }
    const delimiter = `ghadelimiter_${(0, node_crypto_1.randomUUID)()}`;
    (0, node_fs_1.appendFileSync)(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, { encoding: 'utf8' });
}
function info(message) {
    process.stdout.write(`${message}\n`);
}
function notice(message, title) {
    command('notice', message, title ? { title } : {});
}
function warning(message, title) {
    command('warning', message, title ? { title } : {});
}
function error(message, title) {
    command('error', message, title ? { title } : {});
}
function setFailed(message) {
    error(message);
    process.exitCode = 1;
}
function markdownCell(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('|', '\\|')
        .replaceAll('\r', ' ')
        .replaceAll('\n', '<br>');
}
function markdownTable(headers, rows) {
    return [
        `| ${headers.map(markdownCell).join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`),
    ].join('\n');
}
function writeJobSummary(markdown) {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile)
        (0, node_fs_1.appendFileSync)(summaryFile, markdown, { encoding: 'utf8' });
}
//# sourceMappingURL=github.js.map