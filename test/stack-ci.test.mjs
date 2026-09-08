import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';

const readYaml = (path) => parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const workflow = readYaml('../.github/workflows/stack-ci.yml');
const dockerAction = readYaml('../docker-ci/action.yaml');
const caller = readYaml('../examples/docker-publish.yml');

// These workflow expressions use boolean/string operations shared with JS.
// Bracket access preserves GitHub's support for hyphens in context keys.
function evaluate(expression, context) {
  assert.match(expression, /^\$\{\{[\s\S]*\}\}$/u);
  const source = expression.slice(3, -2)
    .replace(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/gu, '["$1"]');
  return runInNewContext(source, { always: () => true, ...context }, { timeout: 1000 });
}

function publishContext() {
  return {
    inputs: { 'docker-push': true },
    github: { event_name: 'push' },
    needs: {
      detect: { outputs: { docker: 'true' } },
      java: { result: 'success' },
      node: { result: 'success' },
      rust: { result: 'success' },
      'docker-build': { result: 'success' },
      'contract-guard': { result: 'success' },
    },
  };
}

test('the documented publishing caller satisfies every stack job without attestation permissions', () => {
  const granted = caller.jobs.stack.permissions;
  assert.deepEqual(granted, { contents: 'read', packages: 'write' });
  const rank = { none: 0, read: 1, write: 2 };
  for (const [name, job] of Object.entries(workflow.jobs)) {
    for (const [scope, access] of Object.entries(job.permissions ?? workflow.permissions)) {
      assert.ok(rank[access] <= rank[granted[scope] ?? 'none'], `${name} exceeds the caller's ${scope} grant`);
    }
  }
  assert.deepEqual(workflow.jobs['docker-publish'].permissions, granted);

  const consumerSteps = [
    ...Object.values(workflow.jobs).flatMap((job) => job.steps ?? []),
    ...dockerAction.runs.steps,
  ];
  for (const step of consumerSteps) {
    assert.doesNotMatch(step.uses ?? '', /^actions\/attest(?:@|-)/iu);
  }
  const publish = workflow.jobs['docker-publish'].steps.find((step) => step.id === 'image');
  assert.equal(publish.with.push, 'true');
  assert.equal(publish.with.sbom, 'true');
  assert.equal(publish.with.provenance, 'mode=max');
  assert.equal(dockerAction.inputs.sbom.default, 'false');
  assert.equal(dockerAction.inputs.provenance.default, 'false');
});

test('image publication requires opt-in, Docker detection, and a successful build', () => {
  const condition = workflow.jobs['docker-publish'].if;
  assert.equal(evaluate(condition, publishContext()), true);
  assert.equal(workflow.on.workflow_call.inputs['docker-push'].default, false);

  const noPush = publishContext();
  noPush.inputs['docker-push'] = false;
  assert.equal(evaluate(condition, noPush), false);

  const noDocker = publishContext();
  noDocker.needs.detect.outputs.docker = 'false';
  assert.equal(evaluate(condition, noDocker), false);

  for (const result of ['failure', 'cancelled', 'skipped']) {
    const context = publishContext();
    context.needs['docker-build'].result = result;
    assert.equal(evaluate(condition, context), false, `Docker build ${result} prevents publishing`);
  }
});

test('image publication cannot bypass failed or cancelled language and contract gates', () => {
  const condition = workflow.jobs['docker-publish'].if;
  for (const gate of ['java', 'node', 'rust', 'contract-guard']) {
    assert.ok(workflow.jobs['docker-publish'].needs.includes(gate), `${gate} is a publication dependency`);
    for (const result of ['failure', 'cancelled']) {
      const context = publishContext();
      context.needs[gate].result = result;
      assert.equal(evaluate(condition, context), false, `${gate} ${result} prevents publishing`);
    }
  }
  const optionalGates = publishContext();
  for (const gate of ['java', 'node', 'rust', 'contract-guard']) {
    optionalGates.needs[gate].result = 'skipped';
  }
  assert.equal(evaluate(condition, optionalGates), true);
});

test('pull requests never publish even when publication is requested and every gate passed', () => {
  for (const repository of ['alconite-inc/application', 'contributor/application']) {
    const context = publishContext();
    context.github = {
      event_name: 'pull_request',
      repository: 'alconite-inc/application',
      event: { pull_request: { head: { repo: { full_name: repository } } } },
    };
    assert.equal(evaluate(workflow.jobs['docker-publish'].if, context), false);
  }
});

test('private dependency tokens are withheld on pull requests even when the secret is available', () => {
  for (const jobName of ['java', 'node']) {
    const action = workflow.jobs[jobName].steps.find((step) => step.with?.['packages-token']);
    const expression = action.with['packages-token'];
    const secret = 'private-dependency-token-fixture';
    for (const repository of ['alconite-inc/application', 'contributor/application']) {
      assert.equal(evaluate(expression, {
        github: {
          event_name: 'pull_request',
          repository: 'alconite-inc/application',
          event: { pull_request: { head: { repo: { full_name: repository } } } },
        },
        secrets: { 'packages-token': secret },
      }), '', `${jobName} must withhold the token from ${repository}'s PR`);
    }
    assert.equal(evaluate(expression, {
      github: { event_name: 'push' },
      secrets: { 'packages-token': secret },
    }), secret);
    assert.equal(evaluate(expression, {
      github: { event_name: 'push' },
      secrets: { 'packages-token': '' },
    }), '');
  }
});
