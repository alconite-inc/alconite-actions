import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

const definitions = new Map();
for (const [suffix, filename] of [['', 'action.yml'], ['/impact', 'impact/action.yml'], ['/runtime-verify', 'runtime-verify/action.yml']]) {
  definitions.set(`alconite-inc/alconite-actions${suffix}`, parse(await readFile(filename, 'utf8')));
}

function validateInputs(step) {
  if (!step.uses?.startsWith('alconite-inc/alconite-actions')) return;
  const [component, revision] = step.uses.split('@');
  assert.match(revision, /^[a-f0-9]{40}$/u);
  const definition = definitions.get(component);
  assert.ok(definition, `unknown component ${component}`);
  for (const name of Object.keys(step.with ?? {})) {
    assert.ok(definition.inputs[name], `${component} does not accept ${name}`);
  }
  for (const [name, input] of Object.entries(definition.inputs)) {
    if (input.required) assert.ok(step.with?.[name], `${component} requires ${name}`);
  }
}

test('production Sentinel examples use existing public inputs and preserve release failures', async () => {
  for (const filename of ['examples/sentinel.yml', 'examples/sentinel-provider-impact.yml']) {
    const workflow = parse(await readFile(filename, 'utf8'));
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.equal(workflow.on.pull_request_target, undefined);
    for (const job of Object.values(workflow.jobs)) {
      assert.equal(job['continue-on-error'], undefined);
      for (const step of job.steps) {
        validateInputs(step);
        assert.equal(step['continue-on-error'], undefined);
        if (step.run) assert.ok(!step.run.includes('${{'), 'pass workflow inputs through env');
      }
    }
  }
  const workflow = parse(await readFile('examples/sentinel.yml', 'utf8'));
  const steps = workflow.jobs.sentinel.steps;
  assert.equal(steps.find(step => step.id === 'guard').with['fail-on'], 'failed');
  const impact = steps.find(step => step.id === 'impact');
  assert.equal(impact.if, "${{ !cancelled() && steps.guard.outputs.check-id != '' }}");
  assert.equal(impact.with['check-id'], '${{ steps.guard.outputs.check-id }}');
  assert.equal(impact.with['fail-on-risk'], 'high');
});

test('workflow guide and copyable examples stay synchronized with public Action metadata', async () => {
  const guide = await readFile('SENTINEL-WORKFLOW.md', 'utf8');
  for (const [heading, filename] of [
    ['## Pattern 1:', 'examples/sentinel.yml'],
    ['## Pattern 3:', 'examples/sentinel-provider-impact.yml'],
  ]) {
    const section = guide.slice(guide.indexOf(heading));
    const block = /```yaml\n([\s\S]*?)```/u.exec(section)?.[1];
    assert.equal(block?.trim(), (await readFile(filename, 'utf8')).trim());
  }
  for (const match of guide.matchAll(/```yaml\n([\s\S]*?)```/gu)) {
    const parsed = parse(match[1]);
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (value.uses) validateInputs(value);
      for (const child of Object.values(value)) visit(child);
    };
    visit(parsed);
  }
});
