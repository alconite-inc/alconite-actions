"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/sentinel-executor/index.ts
var index_exports = {};
__export(index_exports, {
  main: () => main
});
module.exports = __toCommonJS(index_exports);

// src/release.ts
var ACTION_RELEASE_VERSION = "2.4.1";
var CONTRACT_GUARD_USER_AGENT = `alconite-contract-guard-action/${ACTION_RELEASE_VERSION}`;
var IMPACT_USER_AGENT = `alconite-impact-action/${ACTION_RELEASE_VERSION}`;
var RUNTIME_VERIFY_USER_AGENT = `alconite-runtime-verify-action/${ACTION_RELEASE_VERSION}`;

// src/sentinel-executor/arguments.ts
var COMMON = {
  "--project-id": { input: "project-id", required: true },
  "--api-url": { input: "api-url", defaultValue: "https://alconite.com" }
};
var DEFINITIONS = {
  "contract-guard": {
    ...COMMON,
    "--candidate-path": { input: "candidate-path", defaultValue: "openapi.yaml" },
    "--display-name": { input: "display-name", defaultValue: "" },
    "--idempotency-key": { input: "idempotency-key", defaultValue: "" },
    "--timeout-seconds": { input: "timeout-seconds", defaultValue: "120", integer: [1, 600] },
    "--retry-attempts": { input: "retry-attempts", defaultValue: "3", integer: [1, 5] },
    "--fail-on": { input: "fail-on", defaultValue: "failed", values: ["failed", "warnings", "never"] },
    "--report-path": { input: "report-path", defaultValue: "", reportsPath: true }
  },
  impact: {
    ...COMMON,
    "--check-id": { input: "check-id", required: true },
    "--source-root": { input: "source-root", defaultValue: "." },
    "--additional-ignore": { input: "additional-ignore", repeatable: true, defaultValue: "" },
    "--include-generated-directories": { input: "include-generated-directories", defaultValue: "false", values: ["true", "false"] },
    "--timeout-seconds": { input: "timeout-seconds", defaultValue: "120", integer: [1, 600] },
    "--attempts": { input: "attempts", defaultValue: "3", integer: [1, 5] },
    "--fail-on-risk": { input: "fail-on-risk", defaultValue: "never", values: ["never", "low", "medium", "high", "critical"] },
    "--fail-on-potential-risk": { input: "fail-on-potential-risk", defaultValue: "never", values: ["never", "low", "medium", "high", "critical"] }
  },
  "runtime-verify": {
    ...COMMON,
    "--environment-id": { input: "environment-id", required: true },
    "--base-url": { input: "base-url", required: true },
    "--check-id": { input: "check-id", defaultValue: "" },
    "--contract-path": { input: "contract-path", defaultValue: "openapi.yaml" },
    "--configuration-path": { input: "configuration-path", defaultValue: ".alconite/runtime-verify.yaml" },
    "--display-name": { input: "display-name", defaultValue: "" },
    "--deployment-id": { input: "deployment-id", defaultValue: "" },
    "--idempotency-key": { input: "idempotency-key", defaultValue: "" },
    "--timeout-seconds": { input: "timeout-seconds", defaultValue: "120", integer: [1, 3600] },
    "--retry-attempts": { input: "retry-attempts", defaultValue: "3", integer: [1, 5] },
    "--fail-on": { input: "fail-on", defaultValue: "failed", values: ["failed", "warnings", "never"] },
    "--report-path": { input: "report-path", defaultValue: "alconite-runtime-verify-report.json", reportsPath: true }
  }
};
function parseExecutionArguments(argv) {
  const command = argv[0];
  if (!isCommand(command)) throw new Error(`Unknown command: ${command ?? "(missing)"}.`);
  const definitions = DEFINITIONS[command];
  const collected = /* @__PURE__ */ new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const option = argv[index];
    if (!option?.startsWith("--")) throw new Error(`Unexpected positional argument: ${option ?? "(missing)"}.`);
    if (option === "--project-token" || option.includes("token")) throw new Error("The project token must be supplied only through ALCONITE_PROJECT_TOKEN.");
    const definition = definitions[option];
    if (!definition) throw new Error(`Unknown option for ${command}: ${option}.`);
    const value = argv[index + 1];
    if (value === void 0 || value.startsWith("--")) throw new Error(`Missing value for ${option}.`);
    const values = collected.get(option) ?? [];
    if (values.length > 0 && !definition.repeatable) throw new Error(`Duplicate option: ${option}.`);
    values.push(validateValue(option, value, definition));
    collected.set(option, values);
  }
  const inputs = {};
  for (const [option, definition] of Object.entries(definitions)) {
    const values = collected.get(option);
    if (definition.required && !values?.[0]) throw new Error(`Required option is missing: ${option}.`);
    inputs[definition.input] = values ? values.join("\n") : definition.defaultValue ?? "";
  }
  return { command, inputs };
}
function validateValue(option, value, definition) {
  if (value.length === 0 || value.includes("\0")) throw new Error(`${option} requires a non-empty value.`);
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
function validateReportsRelativePath(value, option = "--report-path") {
  if (value === "") return;
  if (value.length > 1024 || value.startsWith("/") || value.includes("\\") || value.includes("//") || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${option} must be a safe path relative to /reports.`);
  }
  const components = value.split("/");
  if (components.some((component) => component === "" || component === "." || component === "..")) {
    throw new Error(`${option} must be a safe path relative to /reports.`);
  }
}
function isCommand(value) {
  return value === "contract-guard" || value === "impact" || value === "runtime-verify";
}

// src/sentinel-executor/action-process.ts
var import_node_child_process = require("node:child_process");
var import_node_fs2 = require("node:fs");
var import_node_path = __toESM(require("node:path"));

// src/sentinel-executor/output.ts
var import_node_fs = require("node:fs");
var OUTPUTS = {
  "contract-guard": /* @__PURE__ */ new Set(["check-id", "project-id", "status", "gate-result", "report-url", "report-path", "baseline-content-hash", "candidate-content-hash", "uploaded-content-hash", "breaking-changes", "risky-changes", "policy-failures", "policy-warnings"]),
  impact: /* @__PURE__ */ new Set(["check-id", "overall-risk", "overall-potential-risk", "breaking-changes", "affected-files", "affected-source-locations", "files-scanned", "files-skipped", "client-entries-visited", "client-files-discovered", "client-files-submitted", "client-files-skipped", "report-path", "report-truncated", "analysis-fingerprint"]),
  "runtime-verify": /* @__PURE__ */ new Set(["run-id", "project-id", "environment-id", "check-id", "deployment-id", "status", "gate-result", "report-url", "report-path", "contract-content-hash", "configured-operations", "executed-operations", "passed-operations", "failed-operations", "warning-operations", "finding-count", "replayed"])
};
function readPortableOutputs(command, descriptor, stats) {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > 1024 * 1024 || (stats.mode & 511) !== 384) {
    throw new Error("Portable output file failed its identity, mode, or size check.");
  }
  const buffer = Buffer.alloc(stats.size);
  let offset = 0;
  while (offset < buffer.length) {
    const count = (0, import_node_fs.readSync)(descriptor, buffer, offset, buffer.length - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  const text = buffer.subarray(0, offset).toString("utf8");
  const allowed = OUTPUTS[command];
  if (!allowed) throw new Error("Portable output command is invalid.");
  const result = {};
  for (const line of text.split("\n")) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error("Portable output channel contains invalid JSON.");
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Portable output record is invalid.");
    const keys = Object.keys(record);
    const value = record;
    if (keys.length !== 2 || !keys.includes("name") || !keys.includes("value") || typeof value.name !== "string" || typeof value.value !== "string") {
      throw new Error("Portable output record has an invalid grammar.");
    }
    if (!allowed.has(value.name) || value.name.length > 80 || value.value.length > 262144) throw new Error("Portable output record exceeds its contract.");
    if (Object.hasOwn(result, value.name)) throw new Error(`Portable output ${value.name} was emitted more than once.`);
    result[value.name] = value.value;
  }
  return result;
}

// src/sentinel-executor/action-process.ts
var ENTRY_POINTS = {
  "contract-guard": "dist/index.js",
  impact: "impact/dist/index.js",
  "runtime-verify": "runtime-verify/dist/index.js"
};
var MAX_REPORT_BYTES = 16 * 1024 * 1024;
async function runAction(parsed, token, roots, hooks = {}) {
  if (Object.values(parsed.inputs).some((value) => value.includes(token))) {
    throw new Error("Sentinel option values must not contain protected token material.");
  }
  validateRootsAndReportDestination(parsed, roots);
  const directory = (0, import_node_fs2.mkdtempSync)(import_node_path.default.join(roots.temporary, "alconite-sentinel-"));
  (0, import_node_fs2.chmodSync)(directory, 448);
  const filename = import_node_path.default.join(directory, "outputs.jsonl");
  const stagedReport = parsed.command === "impact" ? void 0 : import_node_path.default.join(directory, "report.json");
  let descriptor;
  try {
    descriptor = (0, import_node_fs2.openSync)(filename, import_node_fs2.constants.O_CREAT | import_node_fs2.constants.O_EXCL | import_node_fs2.constants.O_RDWR | import_node_fs2.constants.O_NOFOLLOW, 384);
    const opened = (0, import_node_fs2.fstatSync)(descriptor);
    assertSameFile(opened, (0, import_node_fs2.lstatSync)(filename), filename);
    const inheritedEnvironment = { ...process.env };
    delete inheritedEnvironment.ALCONITE_PROJECT_TOKEN;
    delete inheritedEnvironment.GITHUB_OUTPUT;
    delete inheritedEnvironment.GITHUB_STEP_SUMMARY;
    const environment = {
      ...inheritedEnvironment,
      ALCONITE_EXECUTION_MODE: "portable",
      ALCONITE_PORTABLE_OUTPUT_FD: "3",
      GITHUB_WORKSPACE: roots.workspace,
      RUNNER_TEMP: parsed.command === "impact" ? roots.reports : directory,
      "INPUT_PROJECT-TOKEN": token
    };
    for (const [name, value] of Object.entries(parsed.inputs)) {
      environment[`INPUT_${name.toUpperCase()}`] = name === "report-path" && stagedReport ? stagedReport : value;
    }
    const child = (0, import_node_child_process.spawn)(process.execPath, [import_node_path.default.join(roots.actionRoot, ENTRY_POINTS[parsed.command])], {
      cwd: roots.workspace,
      env: environment,
      stdio: ["ignore", "pipe", "pipe", descriptor]
    });
    const stdout = [];
    const stderr = [];
    let total = 0;
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      total += chunk.length;
      if (total > 256 * 1024) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(chunk);
      total += chunk.length;
      if (total > 256 * 1024) child.kill("SIGKILL");
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve(code === 0 && !signal && total <= 256 * 1024 ? 0 : 1));
    });
    const unexpectedStdout = Buffer.concat(stdout).toString("utf8").trim();
    if (unexpectedStdout) throw new Error("Portable Action child wrote unexpected stdout.");
    const diagnostic = Buffer.concat(stderr).toString("utf8").replaceAll(token, "[REDACTED]");
    if (diagnostic) process.stderr.write(diagnostic.slice(0, 256 * 1024));
    const after = (0, import_node_fs2.fstatSync)(descriptor);
    assertSameFile(opened, after, filename);
    assertSameFile(opened, (0, import_node_fs2.lstatSync)(filename), filename);
    if ((0, import_node_fs2.realpathSync)(filename) !== filename) throw new Error("Portable output path was replaced.");
    const outputs = readPortableOutputs(parsed.command, descriptor, after);
    if (Object.values(outputs).some((value) => value.includes(token))) throw new Error("Portable output contained protected token material.");
    if (stagedReport) await persistActionReport(parsed, outputs, stagedReport, roots, hooks);
    else validateImpactReportOutput(outputs, roots);
    return { command: parsed.command, exitCode, outputs };
  } finally {
    if (descriptor !== void 0) (0, import_node_fs2.closeSync)(descriptor);
    (0, import_node_fs2.rmSync)(directory, { recursive: true, force: true });
  }
}
function assertSameFile(expected, actual, filename) {
  if (!actual.isFile() || actual.isSymbolicLink() || actual.nlink !== 1 || expected.dev !== actual.dev || expected.ino !== actual.ino || (actual.mode & 511) !== 384) {
    throw new Error(`Portable output file changed while processing ${import_node_path.default.basename(filename)}.`);
  }
}
function defaultRoots() {
  return {
    workspace: "/workspace",
    reports: "/reports",
    temporary: "/tmp",
    actionRoot: import_node_path.default.resolve(__dirname, "../..")
  };
}
function validateRootsAndReportDestination(parsed, roots) {
  for (const [label, root] of [["workspace", roots.workspace], ["reports", roots.reports], ["temporary", roots.temporary]]) {
    const stats = (0, import_node_fs2.lstatSync)(root);
    if (!stats.isDirectory() || stats.isSymbolicLink() || (0, import_node_fs2.realpathSync)(root) !== import_node_path.default.resolve(root)) {
      throw new Error(`The ${label} root must be an existing link-free directory.`);
    }
  }
  const relative = parsed.inputs["report-path"];
  if (relative) reportDestination(relative, roots);
}
async function persistActionReport(parsed, outputs, stagedReport, roots, hooks) {
  const reportedPath = outputs["report-path"];
  if (!reportedPath) {
    if ((0, import_node_fs2.existsSync)(stagedReport)) throw new Error("The Action wrote a report without emitting its report-path output.");
    return;
  }
  if (import_node_path.default.resolve(reportedPath) !== stagedReport) throw new Error("The Action emitted an unexpected staged report path.");
  let relative = parsed.inputs["report-path"];
  if (!relative && parsed.command === "contract-guard") {
    const checkId = outputs["check-id"];
    if (!checkId || !/^cgchk_[A-Za-z0-9_-]{1,73}$/u.test(checkId)) {
      throw new Error("Contract Guard did not emit a valid check ID for its default report path.");
    }
    relative = `contract-guard-${checkId}.json`;
  }
  if (!relative) throw new Error("The Action report destination could not be resolved.");
  const intended = import_node_path.default.join(roots.reports, ...relative.split("/"));
  await hooks.beforeReportPersist?.(intended);
  const destination = reportDestination(relative, roots);
  copyPrivateReport(stagedReport, destination, roots);
  outputs["report-path"] = destination.destination;
}
function validateImpactReportOutput(outputs, roots) {
  const reportPath = outputs["report-path"];
  if (!reportPath) return;
  const reportsReal = (0, import_node_fs2.realpathSync)(roots.reports);
  const resolved = import_node_path.default.resolve(reportPath);
  const stats = (0, import_node_fs2.lstatSync)(resolved);
  const real = (0, import_node_fs2.realpathSync)(resolved);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || (stats.mode & 511) !== 384 || real !== reportsReal && !real.startsWith(`${reportsReal}${import_node_path.default.sep}`)) {
    throw new Error("Impact emitted an unsafe report path.");
  }
}
function reportDestination(relative, roots) {
  validateReportsRelativePath(relative);
  const destination = import_node_path.default.join(roots.reports, ...relative.split("/"));
  const parent = import_node_path.default.dirname(destination);
  if (!(0, import_node_fs2.existsSync)(parent)) throw new Error("The report destination parent directory must already exist below /reports.");
  let component = roots.reports;
  for (const name of import_node_path.default.relative(roots.reports, parent).split(import_node_path.default.sep).filter(Boolean)) {
    component = import_node_path.default.join(component, name);
    const componentStats = (0, import_node_fs2.lstatSync)(component);
    if (!componentStats.isDirectory() || componentStats.isSymbolicLink()) {
      throw new Error("The report destination must not traverse links or non-directories.");
    }
  }
  const parentStats = (0, import_node_fs2.lstatSync)(parent);
  const reportsReal = (0, import_node_fs2.realpathSync)(roots.reports);
  const parentReal = (0, import_node_fs2.realpathSync)(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink() || parentReal !== reportsReal && !parentReal.startsWith(`${reportsReal}${import_node_path.default.sep}`)) {
    throw new Error("The report destination parent must be a link-free directory below /reports.");
  }
  if ((0, import_node_fs2.existsSync)(destination)) throw new Error("The report destination must not already exist.");
  return { destination, parent, basename: import_node_path.default.basename(destination), reportsReal, parentReal };
}
function copyPrivateReport(stagedReport, destination, roots) {
  let sourceDescriptor;
  let reportsDescriptor;
  let parentDescriptor;
  let destinationDescriptor;
  try {
    sourceDescriptor = (0, import_node_fs2.openSync)(stagedReport, import_node_fs2.constants.O_RDONLY | import_node_fs2.constants.O_NOFOLLOW);
    const sourceStats = (0, import_node_fs2.fstatSync)(sourceDescriptor);
    const sourcePathStats = (0, import_node_fs2.lstatSync)(stagedReport);
    if (!sourceStats.isFile() || sourceStats.nlink !== 1 || sourceStats.size > MAX_REPORT_BYTES || (sourceStats.mode & 511) !== 384 || sourceStats.dev !== sourcePathStats.dev || sourceStats.ino !== sourcePathStats.ino || (0, import_node_fs2.realpathSync)(stagedReport) !== stagedReport) {
      throw new Error("The staged Action report failed its identity, mode, or size check.");
    }
    reportsDescriptor = openVerifiedDirectory(roots.reports, destination.reportsReal);
    parentDescriptor = openVerifiedDirectory(destination.parent, destination.parentReal);
    destinationDescriptor = (0, import_node_fs2.openSync)(
      `/proc/self/fd/${parentDescriptor}/${destination.basename}`,
      import_node_fs2.constants.O_CREAT | import_node_fs2.constants.O_EXCL | import_node_fs2.constants.O_NOFOLLOW | import_node_fs2.constants.O_WRONLY,
      384
    );
    const created = (0, import_node_fs2.fstatSync)(destinationDescriptor);
    assertPrivateDestination(created, (0, import_node_fs2.lstatSync)(destination.destination), destination.destination);
    copyDescriptors(sourceDescriptor, destinationDescriptor, sourceStats.size);
    (0, import_node_fs2.fsyncSync)(destinationDescriptor);
    const completed = (0, import_node_fs2.fstatSync)(destinationDescriptor);
    const anchored = (0, import_node_fs2.lstatSync)(`/proc/self/fd/${parentDescriptor}/${destination.basename}`);
    const ambient = (0, import_node_fs2.lstatSync)(destination.destination);
    if (completed.size !== sourceStats.size) throw new Error("The durable report size changed while it was written.");
    assertPrivateDestination(completed, anchored, destination.destination);
    assertPrivateDestination(completed, ambient, destination.destination);
    if ((0, import_node_fs2.realpathSync)(destination.destination) !== import_node_path.default.join(destination.parentReal, destination.basename)) {
      throw new Error("The durable report path changed while it was written.");
    }
    assertDirectoryDescriptor(reportsDescriptor, roots.reports, destination.reportsReal);
    assertDirectoryDescriptor(parentDescriptor, destination.parent, destination.parentReal);
  } catch (error) {
    if (destinationDescriptor !== void 0) {
      try {
        (0, import_node_fs2.ftruncateSync)(destinationDescriptor, 0);
        (0, import_node_fs2.fsyncSync)(destinationDescriptor);
      } catch {
      }
    }
    throw error;
  } finally {
    if (destinationDescriptor !== void 0) (0, import_node_fs2.closeSync)(destinationDescriptor);
    if (parentDescriptor !== void 0) (0, import_node_fs2.closeSync)(parentDescriptor);
    if (reportsDescriptor !== void 0) (0, import_node_fs2.closeSync)(reportsDescriptor);
    if (sourceDescriptor !== void 0) (0, import_node_fs2.closeSync)(sourceDescriptor);
  }
}
function openVerifiedDirectory(directory, expectedReal) {
  const descriptor = (0, import_node_fs2.openSync)(directory, import_node_fs2.constants.O_RDONLY | import_node_fs2.constants.O_DIRECTORY | import_node_fs2.constants.O_NOFOLLOW);
  try {
    assertDirectoryDescriptor(descriptor, directory, expectedReal);
    return descriptor;
  } catch (error) {
    (0, import_node_fs2.closeSync)(descriptor);
    throw error;
  }
}
function assertDirectoryDescriptor(descriptor, directory, expectedReal) {
  const opened = (0, import_node_fs2.fstatSync)(descriptor);
  const ambient = (0, import_node_fs2.lstatSync)(directory);
  if (!opened.isDirectory() || !ambient.isDirectory() || ambient.isSymbolicLink() || opened.dev !== ambient.dev || opened.ino !== ambient.ino || (0, import_node_fs2.realpathSync)(directory) !== expectedReal || (0, import_node_fs2.realpathSync)(`/proc/self/fd/${descriptor}`) !== expectedReal) {
    throw new Error("The report destination directory changed during persistence.");
  }
}
function assertPrivateDestination(expected, actual, filename) {
  if (!expected.isFile() || expected.nlink !== 1 || (expected.mode & 511) !== 384 || !actual.isFile() || actual.isSymbolicLink() || actual.nlink !== 1 || expected.dev !== actual.dev || expected.ino !== actual.ino || (actual.mode & 511) !== 384) {
    throw new Error(`The durable report changed while processing ${import_node_path.default.basename(filename)}.`);
  }
}
function copyDescriptors(source, destination, size) {
  const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(size, 1)));
  let readOffset = 0;
  while (readOffset < size) {
    const count = (0, import_node_fs2.readSync)(source, buffer, 0, Math.min(buffer.length, size - readOffset), readOffset);
    if (count === 0) throw new Error("The staged Action report ended before its verified size.");
    let written = 0;
    while (written < count) written += (0, import_node_fs2.writeSync)(destination, buffer, written, count - written);
    readOffset += count;
  }
}

// src/sentinel-executor/index.ts
var HELP = `Alconite Sentinel executor ${ACTION_RELEASE_VERSION}

Usage:
  sentinel --help
  sentinel --version
  sentinel contract-guard [options]
  sentinel impact [options]
  sentinel runtime-verify [options]

Supply the project token only with ALCONITE_PROJECT_TOKEN.
Mount customer files read-only at /workspace and reports writable at /reports.`;
var SUBCOMMAND_HELP = {
  "contract-guard": `Usage: sentinel contract-guard --project-id <cgprj_...> [options]

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
  "runtime-verify": `Usage: sentinel runtime-verify --project-id <cgprj_...> --environment-id <rtvenv_...> --base-url <origin> [options]

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
  --report-path <path>          relative to /reports; default: alconite-runtime-verify-report.json`
};
async function main(argv = process.argv.slice(2)) {
  const token = process.env.ALCONITE_PROJECT_TOKEN;
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    process.stdout.write(`${HELP}
`);
    return 0;
  }
  if (argv.length === 1 && argv[0] === "--version") {
    process.stdout.write(`${ACTION_RELEASE_VERSION}
`);
    return 0;
  }
  const requestedCommand = argv[0];
  if (argv.length === 2 && argv[1] === "--help" && (requestedCommand === "contract-guard" || requestedCommand === "impact" || requestedCommand === "runtime-verify")) {
    process.stdout.write(`${SUBCOMMAND_HELP[requestedCommand]}
`);
    return 0;
  }
  try {
    const parsed = parseExecutionArguments(argv);
    if (!token) throw new Error("ALCONITE_PROJECT_TOKEN is required.");
    const result = await runAction(parsed, token, defaultRoots());
    process.stdout.write(`${JSON.stringify({ schema: "alconite.sentinel-executor.result.v1", ...result })}
`);
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sentinel executor failed.";
    process.stderr.write(`${token ? message.replaceAll(token, "[REDACTED]") : message}
`);
    const command = argv[0];
    if (command === "contract-guard" || command === "impact" || command === "runtime-verify") {
      process.stdout.write(`${JSON.stringify({
        schema: "alconite.sentinel-executor.result.v1",
        command,
        exitCode: 1,
        outputs: {}
      })}
`);
    }
    return 1;
  }
}
void main().then((code) => {
  process.exitCode = code;
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
