import { performance } from 'node:perf_hooks';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { ActionDeadline } from './deadline';
import { ImpactActionError } from './errors';
import { hasPortableRelativePathSyntax } from './portable-path';
import {
  CLIENT_COLLECTION_SCHEMA_VERSION,
  SKIP_CODES,
  SOURCE_LANGUAGES,
  type ClientCollectionMetadata,
  type InlineSourceFile,
  type SkipCode,
  type SourceLanguage,
} from './models';
import {
  inspectEntry,
  isContained,
  readVerifiedDirectory,
  readVerifiedFile,
  verifyAbsoluteDirectory,
  type SourceRaceHooks,
  type VerifiedDirectory,
} from './secure-filesystem';

export interface SourceCollectionLimits {
  maximumEntriesVisited: number;
  maximumDirectoriesVisited: number;
  maximumGitignoreFiles: number;
  maximumGitignoreBytes: number;
  maximumGitignorePatterns: number;
  maximumSubmittedFiles: number;
  maximumManifestEntries: number;
  maximumFileBytes: number;
  maximumTotalSourceBytes: number;
  maximumPathBytes: number;
  maximumDepth: number;
}

export const DEFAULT_SOURCE_COLLECTION_LIMITS: SourceCollectionLimits = {
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
};

export interface SourceCollectionOptions {
  workspace: string;
  sourceRoot: string;
  includeGeneratedDirectories: boolean;
  additionalIgnorePatterns: string[];
  deadline: ActionDeadline;
  limits?: Partial<SourceCollectionLimits>;
  hooks?: SourceRaceHooks;
}

export interface SourceCollectionResult {
  logicalRoot: string;
  files: InlineSourceFile[];
  clientCollection: ClientCollectionMetadata;
  languages: SourceLanguage[];
}

interface IgnoreLayer {
  base: string;
  matcher: Ignore;
}

const FIXED_DIRECTORIES = new Set(['target', 'node_modules', 'dist', 'build', '.gradle', '.idea', '.vscode', 'coverage', 'vendor']);
const EXTENSIONS = new Map<string, SourceLanguage>([
  ['.rs', 'RUST'],
  ['.java', 'JAVA'],
  ['.ts', 'TYPESCRIPT'],
  ['.tsx', 'TYPESCRIPT'],
  ['.js', 'JAVASCRIPT'],
  ['.jsx', 'JAVASCRIPT'],
]);

function invalid(message: string): never {
  throw new ImpactActionError('invalid_input', message);
}

function complexity(message: string): never {
  throw new ImpactActionError('collection_limit_exceeded', message);
}

export function validatePortableRoot(value: string): string {
  const candidate = value.trim() === '' ? '.' : value;
  if (Buffer.byteLength(candidate, 'utf8') > 512) {
    invalid('source-root must be a portable path relative to GITHUB_WORKSPACE');
  }
  if (candidate === '.') return candidate;
  if (!hasPortableRelativePathSyntax(candidate)) {
    invalid('source-root must contain only normalized path components below GITHUB_WORKSPACE');
  }
  return candidate;
}

export function validateAdditionalIgnorePatterns(patterns: string[]): string[] {
  const result: string[] = [];
  for (const original of patterns) {
    const pattern = original.trim();
    if (!pattern) continue;
    const bytes = Buffer.byteLength(pattern, 'utf8');
    if (
      bytes > 256 || pattern.startsWith('!') || pattern.startsWith('/') || pattern.includes('\\') ||
      pattern.includes('\0') || pattern.includes('..')
    ) {
      invalid('additional-ignore contains an unsupported pattern; only bounded ignore-only workspace patterns are accepted');
    }
    result.push(pattern);
  }
  if (result.length > 20) invalid('additional-ignore accepts at most 20 non-empty patterns');
  return result;
}

function portable(workspace: string, filename: string): string {
  return path.relative(workspace, filename).split(path.sep).join('/');
}

function pathDepth(root: string, filename: string): number {
  const relative = path.relative(root, filename);
  return relative ? relative.split(path.sep).filter(Boolean).length : 0;
}

class CollectionAccounting {
  public entriesVisited = 0;
  public directoriesVisited = 0;
  public gitignoreFiles = 0;
  public gitignoreBytes = 0;
  public gitignorePatterns = 0;
  public filesDiscovered = 0;
  public filesSubmitted = 0;
  public filesSkipped = 0;
  public totalSourceBytes = 0;
  public readonly skipCounts = new Map<SkipCode, number>();

  public constructor(private readonly limits: SourceCollectionLimits) {}

  public visitEntry(): void {
    this.entriesVisited += 1;
    if (this.entriesVisited > this.limits.maximumEntriesVisited) complexity('Source collection exceeded the entry-visit limit.');
  }

  public remainingEntries(): number {
    return this.limits.maximumEntriesVisited - this.entriesVisited;
  }

  public visitDirectory(): void {
    this.directoriesVisited += 1;
    if (this.directoriesVisited > this.limits.maximumDirectoriesVisited) complexity('Source collection exceeded the directory-visit limit.');
  }

  public discoverFile(): void {
    this.filesDiscovered += 1;
  }

  public skip(code: SkipCode): void {
    this.filesSkipped += 1;
    this.skipCounts.set(code, (this.skipCounts.get(code) ?? 0) + 1);
  }

  public submit(size: number): void {
    if (this.filesSubmitted + 1 > this.limits.maximumSubmittedFiles || this.filesSubmitted + 1 > this.limits.maximumManifestEntries) {
      complexity('Source collection exceeded the submitted-file limit.');
    }
    if (this.totalSourceBytes + size > this.limits.maximumTotalSourceBytes) {
      complexity('Source collection exceeded the aggregate source-byte limit.');
    }
    this.filesSubmitted += 1;
    this.totalSourceBytes += size;
  }

  public countGitignore(bytes: number, patterns: number): void {
    this.gitignoreFiles += 1;
    this.gitignoreBytes += bytes;
    this.gitignorePatterns += patterns;
    if (
      this.gitignoreFiles > this.limits.maximumGitignoreFiles ||
      this.gitignoreBytes > this.limits.maximumGitignoreBytes ||
      this.gitignorePatterns > this.limits.maximumGitignorePatterns
    ) complexity('Source collection exceeded the .gitignore complexity limit.');
  }

  public metadata(duration: number): ClientCollectionMetadata {
    if (this.filesDiscovered !== this.filesSubmitted + this.filesSkipped) {
      throw new ImpactActionError('source_race_detected', 'Source collection accounting became inconsistent.');
    }
    const skipCounts: Partial<Record<SkipCode, number>> = {};
    for (const code of SKIP_CODES) {
      const count = this.skipCounts.get(code);
      if (count) skipCounts[code] = count;
    }
    return {
      schemaVersion: CLIENT_COLLECTION_SCHEMA_VERSION,
      entriesVisited: this.entriesVisited,
      directoriesVisited: this.directoriesVisited,
      filesDiscovered: this.filesDiscovered,
      filesSubmitted: this.filesSubmitted,
      filesSkipped: this.filesSkipped,
      skipCounts,
      collectionDurationMs: Math.max(0, Math.floor(duration)),
    };
  }
}

function meaningfulPatternCount(contents: string): number {
  let count = 0;
  for (const line of contents.split(/\r?\n/u)) {
    if (!line || (line.startsWith('#') && !line.startsWith('\\#'))) continue;
    count += 1;
  }
  return count;
}

async function addGitignore(
  directory: string,
  workspace: VerifiedDirectory,
  layers: IgnoreLayer[],
  accounting: CollectionAccounting,
  limits: SourceCollectionLimits,
  deadline: ActionDeadline,
  hooks: SourceRaceHooks,
): Promise<void> {
  deadline.throwIfExpired();
  const filename = path.join(directory, '.gitignore');
  let stats;
  try {
    stats = await inspectEntry(filename);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw new ImpactActionError('source_file_read_failed', 'A repository .gitignore could not be inspected securely.', { cause: error });
  }
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1n) {
    throw new ImpactActionError('source_race_detected', 'A repository .gitignore is a link or is not a regular file.');
  }
  const size = Number(stats.size);
  if (!Number.isSafeInteger(size) || size > limits.maximumGitignoreBytes - accounting.gitignoreBytes) {
    complexity('Source collection exceeded the .gitignore byte limit.');
  }
  const verified = await readVerifiedFile(filename, workspace, size, deadline, hooks);
  let contents: string;
  try {
    contents = new TextDecoder('utf-8', { fatal: true }).decode(verified.bytes);
  } catch (error) {
    throw new ImpactActionError('source_file_read_failed', 'A repository .gitignore is not valid UTF-8.', { cause: error });
  }
  const patternCount = meaningfulPatternCount(contents);
  accounting.countGitignore(verified.size, patternCount);
  let matcher: Ignore;
  try {
    matcher = ignore().add(contents);
  } catch (error) {
    throw new ImpactActionError('source_file_read_failed', 'A repository .gitignore could not be parsed safely.', { cause: error });
  }
  layers.push({ base: portable(workspace.path, directory), matcher });
}

function ignoredByLayers(relativePath: string, isDirectory: boolean, layers: readonly IgnoreLayer[]): SkipCode | undefined {
  let ignored: SkipCode | undefined;
  for (const layer of layers) {
    const fromBase = layer.base === '' ? relativePath : relativePath === layer.base ? '' : relativePath.startsWith(`${layer.base}/`)
      ? relativePath.slice(layer.base.length + 1)
      : undefined;
    if (!fromBase) continue;
    const result = layer.matcher.test(isDirectory ? `${fromBase}/` : fromBase);
    if (result.ignored) ignored = 'GITIGNORE';
    if (result.unignored) ignored = undefined;
  }
  return ignored;
}

function ignoredByAdditional(relativeFromRoot: string, isDirectory: boolean, matcher: Ignore | undefined): boolean {
  if (!matcher || !relativeFromRoot) return false;
  return matcher.ignores(isDirectory ? `${relativeFromRoot}/` : relativeFromRoot);
}

function fixedIgnore(name: string, includeGeneratedDirectories: boolean): boolean {
  return name === '.git' || (!includeGeneratedDirectories && FIXED_DIRECTORIES.has(name));
}

function mergedLimits(overrides: Partial<SourceCollectionLimits> | undefined): SourceCollectionLimits {
  const limits = { ...DEFAULT_SOURCE_COLLECTION_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_SOURCE_COLLECTION_LIMITS[name as keyof SourceCollectionLimits]) {
      invalid(`The source collection limit ${name} is invalid.`);
    }
  }
  return limits;
}

export async function collectSourceManifest(options: SourceCollectionOptions): Promise<SourceCollectionResult> {
  const started = performance.now();
  options.deadline.throwIfExpired();
  const logicalRoot = validatePortableRoot(options.sourceRoot);
  const rootComponents = logicalRoot === '.' ? [] : logicalRoot.split('/');
  if (rootComponents.includes('.git')) invalid('source-root cannot select the repository metadata directory');
  if (!options.includeGeneratedDirectories && rootComponents.some((component) => FIXED_DIRECTORIES.has(component))) {
    invalid('source-root selects a generated or vendor directory that is disabled by default');
  }
  const patterns = validateAdditionalIgnorePatterns(options.additionalIgnorePatterns);
  const limits = mergedLimits(options.limits);
  const hooks = options.hooks ?? {};
  const workspace = await verifyAbsoluteDirectory(options.workspace, 'source', options.deadline);
  const requestedRoot = logicalRoot === '.'
    ? workspace.path
    : path.resolve(workspace.path, ...logicalRoot.split('/'));
  const root = await verifyAbsoluteDirectory(requestedRoot, 'source', options.deadline);
  if (!isContained(workspace.realPath, root.realPath)) invalid('source-root must remain inside GITHUB_WORKSPACE');

  const accounting = new CollectionAccounting(limits);
  const layers: IgnoreLayer[] = [];
  const files: InlineSourceFile[] = [];
  const detected = new Set<SourceLanguage>();
  const additionalMatcher = patterns.length > 0 ? ignore().add(patterns) : undefined;

  // Repository root and every source-root ancestor contribute normal Git ignore semantics.
  const relativeRoot = path.relative(workspace.path, root.path);
  const ancestorParts = relativeRoot ? relativeRoot.split(path.sep) : [];
  let ancestor = workspace.path;
  for (let index = 0; index < ancestorParts.length; index += 1) {
    await addGitignore(ancestor, workspace, layers, accounting, limits, options.deadline, hooks);
    const part = ancestorParts[index];
    if (part !== undefined) ancestor = path.join(ancestor, part);
  }

  const walk = async (directory: string): Promise<void> => {
    options.deadline.throwIfExpired();
    accounting.visitDirectory();
    const entries = await readVerifiedDirectory(directory, workspace, options.deadline, hooks, accounting.remainingEntries());
    await addGitignore(directory, workspace, layers, accounting, limits, options.deadline, hooks);
    for (const entry of entries) {
      options.deadline.throwIfExpired();
      accounting.visitEntry();
      if (entry.name === '.gitignore') continue;
      const absolute = path.join(directory, entry.name);
      const relativeWorkspace = portable(workspace.path, absolute);
      const relativeSource = portable(root.path, absolute);
      if (!hasPortableRelativePathSyntax(relativeWorkspace) || !hasPortableRelativePathSyntax(relativeSource)) {
        invalid('The selected workspace contains a path that cannot be represented safely in an Impact manifest.');
      }
      const depth = pathDepth(root.path, absolute);
      const pathTooLong = Buffer.byteLength(relativeWorkspace, 'utf8') > limits.maximumPathBytes;
      const stats = await inspectEntry(absolute).catch((error: unknown) => {
        throw new ImpactActionError('source_file_read_failed', 'A source entry could not be inspected securely.', { cause: error });
      });
      const isDirectory = stats.isDirectory() && !stats.isSymbolicLink();

      if (stats.isSymbolicLink()) {
        accounting.discoverFile();
        accounting.skip('SYMLINK_OR_REPARSE');
        continue;
      }
      if (fixedIgnore(entry.name, options.includeGeneratedDirectories)) {
        if (!isDirectory) { accounting.discoverFile(); accounting.skip('FIXED_IGNORE'); }
        continue;
      }
      const ignored = ignoredByLayers(relativeWorkspace, isDirectory, layers);
      if (ignored) {
        if (!isDirectory) { accounting.discoverFile(); accounting.skip(ignored); }
        continue;
      }
      if (ignoredByAdditional(relativeSource, isDirectory, additionalMatcher)) {
        if (!isDirectory) { accounting.discoverFile(); accounting.skip('ADDITIONAL_IGNORE'); }
        continue;
      }
      if (pathTooLong) {
        if (!isDirectory) { accounting.discoverFile(); accounting.skip('PATH_TOO_LONG'); }
        continue;
      }
      if (depth > limits.maximumDepth) {
        if (!isDirectory) { accounting.discoverFile(); accounting.skip('DEPTH_EXCEEDED'); }
        continue;
      }
      if (isDirectory) {
        await walk(absolute);
        continue;
      }
      accounting.discoverFile();
      if (!stats.isFile() || stats.nlink !== 1n) {
        accounting.skip('SYMLINK_OR_REPARSE');
        continue;
      }
      const language = EXTENSIONS.get(path.extname(entry.name).toLowerCase());
      if (!language) {
        accounting.skip('UNSUPPORTED_FILE');
        continue;
      }
      const size = Number(stats.size);
      if (!Number.isSafeInteger(size) || size > limits.maximumFileBytes) {
        accounting.skip('FILE_TOO_LARGE');
        continue;
      }
      const verified = await readVerifiedFile(absolute, workspace, limits.maximumFileBytes, options.deadline, hooks);
      if (verified.bytes.includes(0)) {
        accounting.skip('BINARY_FILE');
        continue;
      }
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(verified.bytes);
      } catch {
        accounting.skip('INVALID_UTF8');
        continue;
      }
      accounting.submit(verified.size);
      detected.add(language);
      files.push({ path: relativeWorkspace, content });
    }
  };

  await walk(root.path);
  files.sort((left, right) => Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8')));
  const languages = SOURCE_LANGUAGES.filter((language) => detected.has(language));
  return {
    logicalRoot,
    files,
    clientCollection: accounting.metadata(performance.now() - started),
    languages,
  };
}
