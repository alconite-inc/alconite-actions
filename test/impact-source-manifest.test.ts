import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { ActionDeadline } from '../src/impact/deadline';
import { ImpactActionError } from '../src/impact/errors';
import {
  collectSourceManifest,
  DEFAULT_SOURCE_COLLECTION_LIMITS,
  validateAdditionalIgnorePatterns,
  validatePortableRoot,
} from '../src/impact/source-manifest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function temporaryWorkspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'impact-source-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function deadline(): ActionDeadline {
  return new ActionDeadline(30_000);
}

test('locks the Standard Action source-collection profile', () => {
  assert.deepEqual(DEFAULT_SOURCE_COLLECTION_LIMITS, {
    maximumEntriesVisited: 20_000,
    maximumDirectoriesVisited: 5_000,
    maximumGitignoreFiles: 128,
    maximumGitignoreBytes: 512 * 1024,
    maximumGitignorePatterns: 10_000,
    maximumSubmittedFiles: 2_000,
    maximumManifestEntries: 2_500,
    maximumFileBytes: 512 * 1024,
    maximumTotalSourceBytes: 16 * 1024 * 1024,
    maximumPathBytes: 512,
    maximumDepth: 32,
  });
});

test('collects supported files once with fixed, gitignore, nested, additional, binary, and unsupported accounting', async () => {
  const workspace = await temporaryWorkspace();
  await fs.mkdir(path.join(workspace, 'nested'));
  await fs.mkdir(path.join(workspace, 'dist'));
  await fs.mkdir(path.join(workspace, 'extra'));
  await fs.writeFile(path.join(workspace, '.gitignore'), 'ignored.ts\nnested/ignored-by-root.rs\n');
  await fs.writeFile(path.join(workspace, 'kept.rs'), 'struct Customer { first_name: String }\n');
  await fs.writeFile(path.join(workspace, 'ignored.ts'), 'const ignored = true;\n');
  await fs.writeFile(path.join(workspace, 'notes.txt'), 'unsupported\n');
  await fs.writeFile(path.join(workspace, 'binary.js'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(workspace, 'dist', 'generated.ts'), 'export const generated = true;\n');
  await fs.writeFile(path.join(workspace, 'extra', 'ignored.java'), 'class Ignored {}\n');
  await fs.writeFile(path.join(workspace, 'nested', '.gitignore'), 'local.java\n');
  await fs.writeFile(path.join(workspace, 'nested', 'local.java'), 'class Local {}\n');
  await fs.writeFile(path.join(workspace, 'nested', 'ignored-by-root.rs'), 'struct Ignored;\n');
  await fs.writeFile(path.join(workspace, 'nested', 'kept.java'), 'record Customer(String firstName) {}\n');

  const result = await collectSourceManifest({
    workspace,
    sourceRoot: '.',
    includeGeneratedDirectories: false,
    additionalIgnorePatterns: ['extra/**'],
    deadline: deadline(),
  });

  assert.deepEqual(result.files.map((file) => file.path), ['kept.rs', 'nested/kept.java']);
  assert.deepEqual(result.languages, ['RUST', 'JAVA']);
  assert.equal(result.clientCollection.filesSubmitted, 2);
  assert.equal(result.clientCollection.filesDiscovered, result.clientCollection.filesSubmitted + result.clientCollection.filesSkipped);
  assert.equal(result.clientCollection.skipCounts.GITIGNORE, 3);
  assert.equal(result.clientCollection.skipCounts.UNSUPPORTED_FILE, 1);
  assert.equal(result.clientCollection.skipCounts.BINARY_FILE, 1);
});

test('keeps workspace-relative manifest paths when source-root narrows selection', async () => {
  const workspace = await temporaryWorkspace();
  await fs.mkdir(path.join(workspace, 'packages', 'client'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'packages', 'client', 'customer.ts'), 'interface Customer { firstName: string }\n');
  const result = await collectSourceManifest({
    workspace,
    sourceRoot: 'packages/client',
    includeGeneratedDirectories: false,
    additionalIgnorePatterns: [],
    deadline: deadline(),
  });
  assert.equal(result.logicalRoot, 'packages/client');
  assert.equal(result.files[0]?.path, 'packages/client/customer.ts');
});

test('fails the entire collection when a file identity changes between inspection and open', async () => {
  const workspace = await temporaryWorkspace();
  const filename = path.join(workspace, 'customer.ts');
  await fs.writeFile(filename, 'interface Customer { firstName: string }\n');
  let swapped = false;
  await assert.rejects(
    collectSourceManifest({
      workspace,
      sourceRoot: '.',
      includeGeneratedDirectories: false,
      additionalIgnorePatterns: [],
      deadline: deadline(),
      hooks: {
        beforeFileOpen: async (candidate) => {
          if (candidate === filename && !swapped) {
            swapped = true;
            await fs.rename(filename, `${filename}.original`);
            await fs.writeFile(filename, 'interface Replacement {}\n');
          }
        },
      },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'source_race_detected',
  );
});

test('detects same-inode, same-size source mutation during an open-handle read', async () => {
  const workspace = await temporaryWorkspace();
  const filename = path.join(workspace, 'customer.ts');
  await fs.writeFile(filename, 'const a = 1;\n');
  let changed = false;
  await assert.rejects(
    collectSourceManifest({
      workspace,
      sourceRoot: '.',
      includeGeneratedDirectories: false,
      additionalIgnorePatterns: [],
      deadline: deadline(),
      hooks: {
        afterFileRead: async (candidate) => {
          if (candidate === filename && !changed) {
            changed = true;
            await fs.writeFile(filename, 'const b = 2;\n');
          }
        },
      },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'source_race_detected',
  );
});

test('enforces count and byte limits without returning a partial manifest', async () => {
  const workspace = await temporaryWorkspace();
  await fs.writeFile(path.join(workspace, 'one.ts'), 'const one = 1;\n');
  await fs.writeFile(path.join(workspace, 'two.ts'), 'const two = 2;\n');
  await assert.rejects(
    collectSourceManifest({
      workspace,
      sourceRoot: '.',
      includeGeneratedDirectories: false,
      additionalIgnorePatterns: [],
      deadline: deadline(),
      limits: { maximumSubmittedFiles: 1 },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'collection_limit_exceeded',
  );

  await assert.rejects(
    collectSourceManifest({
      workspace,
      sourceRoot: '.',
      includeGeneratedDirectories: false,
      additionalIgnorePatterns: [],
      deadline: deadline(),
      limits: { maximumTotalSourceBytes: 5 },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'collection_limit_exceeded',
  );
});

test('enforces entry, directory, and gitignore budgets at their boundary', async () => {
  const workspace = await temporaryWorkspace();
  await fs.mkdir(path.join(workspace, 'nested'));
  await fs.writeFile(path.join(workspace, '.gitignore'), 'one.ts\ntwo.ts\n');
  await fs.writeFile(path.join(workspace, 'one.ts'), 'const one = 1;\n');
  await fs.writeFile(path.join(workspace, 'two.ts'), 'const two = 2;\n');
  await fs.writeFile(path.join(workspace, 'nested', '.gitignore'), 'three.ts\n');
  await fs.writeFile(path.join(workspace, 'nested', 'kept.rs'), 'struct Kept;\n');

  for (const limits of [
    { maximumEntriesVisited: 1 },
    { maximumDirectoriesVisited: 1 },
    { maximumGitignoreFiles: 1 },
    { maximumGitignoreBytes: 4 },
    { maximumGitignorePatterns: 1 },
  ]) {
    await assert.rejects(
      collectSourceManifest({
        workspace,
        sourceRoot: '.',
        includeGeneratedDirectories: false,
        additionalIgnorePatterns: [],
        deadline: deadline(),
        limits,
      }),
      (error: unknown) => error instanceof ImpactActionError && error.code === 'collection_limit_exceeded',
    );
  }
});

test('reports oversized, overlong, deep, invalid UTF-8, and generated source policy deterministically', async () => {
  const workspace = await temporaryWorkspace();
  await fs.mkdir(path.join(workspace, 'dist'));
  await fs.mkdir(path.join(workspace, 'a', 'b'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'large.ts'), '123456');
  await fs.writeFile(path.join(workspace, 'this-name-is-overlong.ts'), 'x');
  await fs.writeFile(path.join(workspace, 'invalid.js'), Buffer.from([0xc3, 0x28]));
  await fs.writeFile(path.join(workspace, 'dist', 'generated.ts'), 'export const generated = true;\n');
  await fs.writeFile(path.join(workspace, 'a', 'b', 'deep.rs'), 'struct Deep;\n');
  const restricted = await collectSourceManifest({
    workspace,
    sourceRoot: '.',
    includeGeneratedDirectories: false,
    additionalIgnorePatterns: [],
    deadline: deadline(),
    limits: { maximumFileBytes: 5, maximumPathBytes: 20, maximumDepth: 2 },
  });
  assert.deepEqual(restricted.files, []);
  assert.equal(restricted.clientCollection.skipCounts.FILE_TOO_LARGE, 1);
  assert.equal(restricted.clientCollection.skipCounts.PATH_TOO_LONG, 1);
  assert.equal(restricted.clientCollection.skipCounts.INVALID_UTF8, 1);
  assert.equal(restricted.clientCollection.skipCounts.DEPTH_EXCEEDED, 1);

  const included = await collectSourceManifest({
    workspace,
    sourceRoot: 'dist',
    includeGeneratedDirectories: true,
    additionalIgnorePatterns: [],
    deadline: deadline(),
  });
  assert.equal(included.files[0]?.path, 'dist/generated.ts');
});

test('detects directory and gitignore identity races as fatal', async () => {
  const directoryWorkspace = await temporaryWorkspace();
  const nested = path.join(directoryWorkspace, 'nested');
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'customer.ts'), 'interface Customer {}\n');
  let directorySwapped = false;
  await assert.rejects(
    collectSourceManifest({
      workspace: directoryWorkspace,
      sourceRoot: '.',
      includeGeneratedDirectories: false,
      additionalIgnorePatterns: [],
      deadline: deadline(),
      hooks: {
        beforeDirectoryRead: async (candidate) => {
          if (candidate === nested && !directorySwapped) {
            directorySwapped = true;
            await fs.rename(nested, `${nested}.original`);
            await fs.mkdir(nested);
          }
        },
      },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'source_race_detected',
  );

  const ignoreWorkspace = await temporaryWorkspace();
  const ignoreFile = path.join(ignoreWorkspace, '.gitignore');
  await fs.writeFile(ignoreFile, 'ignored.ts\n');
  await fs.writeFile(path.join(ignoreWorkspace, 'customer.ts'), 'interface Customer {}\n');
  let ignoreSwapped = false;
  await assert.rejects(
    collectSourceManifest({
      workspace: ignoreWorkspace,
      sourceRoot: '.',
      includeGeneratedDirectories: false,
      additionalIgnorePatterns: [],
      deadline: deadline(),
      hooks: {
        beforeFileOpen: async (candidate) => {
          if (candidate === ignoreFile && !ignoreSwapped) {
            ignoreSwapped = true;
            await fs.rename(ignoreFile, `${ignoreFile}.original`);
            await fs.writeFile(ignoreFile, 'replacement.ts\n');
          }
        },
      },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'source_race_detected',
  );
});

test('checks the shared monotonic deadline during collection', async () => {
  const workspace = await temporaryWorkspace();
  const filename = path.join(workspace, 'customer.ts');
  await fs.writeFile(filename, 'interface Customer {}\n');
  let now = 0;
  const expiring = new ActionDeadline(10, { now: () => now, sleep: async () => undefined });
  await assert.rejects(
    collectSourceManifest({
      workspace,
      sourceRoot: '.',
      includeGeneratedDirectories: false,
      additionalIgnorePatterns: [],
      deadline: expiring,
      hooks: { beforeFileOpen: async () => { now = 20; } },
    }),
    (error: unknown) => error instanceof ImpactActionError && error.code === 'action_deadline_exceeded',
  );
});

test('never follows a symbolic-link or junction entry', async () => {
  const workspace = await temporaryWorkspace();
  const target = path.join(workspace, 'target-source');
  const link = path.join(workspace, 'linked-source');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'customer.ts'), 'interface Customer {}\n');
  await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await collectSourceManifest({
    workspace,
    sourceRoot: '.',
    includeGeneratedDirectories: true,
    additionalIgnorePatterns: [],
    deadline: deadline(),
  });
  assert.deepEqual(result.files.map((file) => file.path), ['target-source/customer.ts']);
  assert.equal(result.clientCollection.skipCounts.SYMLINK_OR_REPARSE, 1);
});

test('does not upload multiply-linked regular files', async () => {
  const workspace = await temporaryWorkspace();
  const original = path.join(workspace, 'customer.ts');
  await fs.writeFile(original, 'interface Customer {}\n');
  await fs.link(original, path.join(workspace, 'customer-copy.ts'));
  const result = await collectSourceManifest({
    workspace,
    sourceRoot: '.',
    includeGeneratedDirectories: true,
    additionalIgnorePatterns: [],
    deadline: deadline(),
  });
  assert.deepEqual(result.files, []);
  assert.equal(result.clientCollection.skipCounts.SYMLINK_OR_REPARSE, 2);
});

test('strictly validates the source root and ignore-only patterns', () => {
  assert.equal(validatePortableRoot('.'), '.');
  assert.equal(validatePortableRoot('packages/client'), 'packages/client');
  for (const unsafe of ['../outside', '/absolute', 'C:/absolute', 'a\\b', 'a/./b']) {
    assert.throws(() => validatePortableRoot(unsafe), /source-root/u);
  }
  assert.deepEqual(validateAdditionalIgnorePatterns(['examples/**', '', ' fixtures/** ']), ['examples/**', 'fixtures/**']);
  for (const unsafe of ['!include.ts', '/rooted', '../outside', 'a\\b']) {
    assert.throws(() => validateAdditionalIgnorePatterns([unsafe]), /unsupported pattern/u);
  }
});

test('cannot bypass fixed directory denial by selecting it as source-root', async () => {
  const workspace = await temporaryWorkspace();
  await fs.mkdir(path.join(workspace, 'dist'));
  await fs.writeFile(path.join(workspace, 'dist', 'generated.ts'), 'export const generated = true;\n');
  await assert.rejects(
    collectSourceManifest({
      workspace,
      sourceRoot: 'dist',
      includeGeneratedDirectories: false,
      additionalIgnorePatterns: [],
      deadline: deadline(),
    }),
    /generated or vendor directory/u,
  );
  await fs.mkdir(path.join(workspace, '.git'));
  await assert.rejects(
    collectSourceManifest({
      workspace,
      sourceRoot: '.git',
      includeGeneratedDirectories: true,
      additionalIgnorePatterns: [],
      deadline: deadline(),
    }),
    /metadata directory/u,
  );
});
