import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const actionFiles = [
  'action.yml',
  'discord-notify/action.yaml',
  'docker-ci/action.yaml',
  'java-ci/action.yaml',
  'java-publish/action.yaml',
  'node-ci/action.yaml',
  'rust-ci/action.yaml',
  'runtime-verify/action.yml',
  'impact/action.yml',
];
const immutableAction = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[a-f0-9]{40}$/u;
const packageManifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
assert.equal(typeof packageManifest.version, 'string', 'package.json must declare a version');
const currentSelfRelease = `v${packageManifest.version}`;

for (const filename of actionFiles) {
  const source = await fs.readFile(filename, 'utf8');
  const action = parse(source);
  assert.equal(typeof action?.name, 'string', `${filename} must declare name`);
  assert.equal(typeof action?.description, 'string', `${filename} must declare description`);
  assert.ok(action?.runs && typeof action.runs.using === 'string', `${filename} must declare runs.using`);

  for (const [name, input] of Object.entries(action.inputs || {})) {
    assert.equal(typeof input.description, 'string', `${filename} input ${name} must have a description`);
    assert.equal(typeof input.required, 'boolean', `${filename} input ${name} must explicitly declare required`);
  }
  for (const [name, output] of Object.entries(action.outputs || {})) {
    assert.equal(typeof output.description, 'string', `${filename} output ${name} must have a description`);
  }

  for (const step of action.runs.steps || []) {
    if (typeof step.run === 'string') {
      assert.ok(!step.run.includes('${{'), `${filename} step '${step.name}' embeds an expression directly in executable code`);
    }
    if (typeof step.uses === 'string' && !step.uses.startsWith('./') && !step.uses.startsWith('docker://')) {
      const normalized = step.uses.replace(/\s+#.*$/u, '');
      assert.match(normalized, immutableAction, `${filename} step '${step.name}' must pin uses to a full commit SHA`);
    }
  }
}

const root = parse(await fs.readFile(path.resolve('action.yml'), 'utf8'));
assert.equal(root.runs.using, 'node24', 'the public Contract Guard action must use the Node 24 runtime');
assert.equal(root.runs.main, 'dist/index.js', 'the public action entry point must use checked-in build output');
const runtime = parse(await fs.readFile(path.resolve('runtime-verify/action.yml'), 'utf8'));
assert.equal(runtime.runs.using, 'node24', 'the Runtime Verify component must use the Node 24 runtime');
assert.equal(runtime.runs.main, 'dist/index.js', 'the Runtime Verify entry point must use checked-in build output');
await fs.access(path.resolve('runtime-verify', runtime.runs.main));
const runtimeRequiredInputs = ['project-id', 'project-token', 'environment-id', 'base-url'];
for (const name of runtimeRequiredInputs) assert.equal(runtime.inputs[name].required, true, `Runtime Verify input ${name} must remain required`);
assert.equal(runtime.inputs['check-id'].required, false, 'Runtime Verify check-id must support automatic exact-contract resolution');
const runtimeOutputs = [
  'run-id', 'project-id', 'environment-id', 'check-id', 'deployment-id', 'status', 'gate-result', 'report-url', 'report-path',
  'contract-content-hash', 'configured-operations', 'executed-operations', 'passed-operations', 'failed-operations',
  'warning-operations', 'finding-count', 'replayed',
];
for (const name of runtimeOutputs) assert.ok(runtime.outputs[name], `Runtime Verify output ${name} is missing`);

const impact = parse(await fs.readFile(path.resolve('impact/action.yml'), 'utf8'));
assert.equal(impact.runs.using, 'node24', 'the Impact component must use the Node 24 runtime');
assert.equal(impact.runs.main, 'dist/index.js', 'the Impact entry point must use checked-in build output');
await fs.access(path.resolve('impact', impact.runs.main));
for (const name of ['project-id', 'project-token', 'check-id']) {
  assert.equal(impact.inputs[name].required, true, `Impact input ${name} must remain required`);
}
assert.equal(impact.inputs['report-path'], undefined, 'Impact must not accept a caller-controlled report path');
const impactInputs = [
  'project-id', 'project-token', 'check-id', 'source-root', 'api-url', 'additional-ignore',
  'include-generated-directories', 'timeout-seconds', 'attempts', 'fail-on-risk', 'fail-on-potential-risk',
];
assert.deepEqual(Object.keys(impact.inputs), impactInputs, 'Impact inputs must remain synchronized with its public contract');
const impactDefaults = {
  'source-root': '.',
  'api-url': 'https://alconite.com',
  'additional-ignore': '',
  'include-generated-directories': 'false',
  'timeout-seconds': '120',
  attempts: '3',
  'fail-on-risk': 'never',
  'fail-on-potential-risk': 'never',
};
for (const [name, expected] of Object.entries(impactDefaults)) {
  assert.equal(String(impact.inputs[name].default), expected, `Impact input ${name} has an unexpected default`);
}
const impactOutputs = [
  'check-id', 'overall-risk', 'overall-potential-risk', 'breaking-changes', 'affected-files',
  'affected-source-locations', 'files-scanned', 'files-skipped', 'client-entries-visited',
  'client-files-discovered', 'client-files-submitted', 'client-files-skipped', 'report-path',
  'report-truncated', 'analysis-fingerprint',
];
assert.deepEqual(Object.keys(impact.outputs), impactOutputs, 'Impact outputs must remain synchronized with its public contract');

const impactExample = parse(await fs.readFile(path.resolve('examples/impact.yml'), 'utf8'));
const impactSteps = impactExample.jobs?.impact?.steps ?? [];
const contractStep = impactSteps.find((step) => step.id === 'contract_guard');
const impactStep = impactSteps.find((step) => step.id === 'impact');
assert.ok(contractStep, 'the Impact workflow example must include the root Contract Guard step');
assert.ok(impactStep, 'the Impact workflow example must include the additive Impact step');
assert.equal(
  impactStep.if,
  "steps.contract_guard.outcome == 'success'",
  'the recommended Impact example must follow a successful Contract Guard PR check',
);
assert.equal(
  impactStep.with['check-id'],
  '${{ steps.contract_guard.outputs.check-id }}',
  'the Impact example must chain the root Action check ID',
);

for (const filename of ['examples/runtime-verify-deployment.yml', 'examples/runtime-verify-manual.yml']) {
  const example = parse(await fs.readFile(path.resolve(filename), 'utf8'));
  assert.ok(example.jobs && typeof example.jobs === 'object', `${filename} must define jobs`);
}

const workflowFiles = (await fs.readdir('.github/workflows'))
  .filter((filename) => filename.endsWith('.yml') || filename.endsWith('.yaml'))
  .map((filename) => path.join('.github/workflows', filename));
const selfRelease = /^alconite-inc\/alconite-actions(?:\/[A-Za-z0-9_.-]+)*@(v[0-9]+\.[0-9]+\.[0-9]+)$/u;
for (const filename of workflowFiles) {
  const workflow = parse(await fs.readFile(filename, 'utf8'));
  for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
    const usesValues = [job.uses, ...(job.steps || []).map((step) => step.uses)].filter((value) => typeof value === 'string');
    for (const uses of usesValues) {
      if (uses.startsWith('./') || uses.startsWith('docker://')) continue;
      const normalized = uses.replace(/\s+#.*$/u, '');
      const selfVersion = selfRelease.exec(normalized)?.[1];
      assert.ok(
        immutableAction.test(normalized) || selfVersion === currentSelfRelease,
        `${filename} job ${jobName} must use an immutable SHA or the current ${currentSelfRelease} self release`,
      );
    }
  }
}
process.stdout.write(`Validated ${actionFiles.length} action metadata files.\n`);
