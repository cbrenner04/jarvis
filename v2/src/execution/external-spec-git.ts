import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type ExternalSpecGitScope = {
  externalPlanSpec?: true;
  specReadRoot?: string;
};

export function externalSpecGitScope(input: ExternalSpecGitScope): ExternalSpecGitScope {
  return input.externalPlanSpec === true && input.specReadRoot !== undefined
    ? { externalPlanSpec: true, specReadRoot: input.specReadRoot }
    : {};
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function resolvesUnderExternalSpecRoot(worktreePath: string, path: string, specReadRoot: string): boolean {
  const absolute = resolve(worktreePath, path);
  if (isWithin(specReadRoot, absolute)) return true;
  try {
    return isWithin(specReadRoot, realpathSync(absolute));
  } catch {
    return false;
  }
}

function listExternalSpecArtifacts(specReadRoot: string): string[] {
  if (!existsSync(specReadRoot)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(specReadRoot, { withFileTypes: true })) {
    const path = join(specReadRoot, entry.name);
    if (entry.isDirectory()) files.push(...listExternalSpecArtifacts(path));
    else if (entry.isFile() && path.endsWith(".md")) files.push(path);
  }
  return files;
}

function matchesExternalSpecCopy(worktreePath: string, path: string, externalArtifacts: readonly string[]): boolean {
  if (!path.endsWith(".md")) return false;
  try {
    const candidate = readFileSync(resolve(worktreePath, path));
    return externalArtifacts.some((externalPath) => candidate.equals(readFileSync(externalPath)));
  } catch {
    return false;
  }
}

export type ExternalSpecTreeSnapshot = {
  root: string;
  files: Map<string, Buffer>;
  allowedArtifacts: Set<string>;
};

/** Captures external markdown that post-implement roles must not mutate. */
export function captureExternalSpecTree(
  scope: ExternalSpecGitScope,
  allowedArtifacts: readonly string[] = [],
): ExternalSpecTreeSnapshot | undefined {
  if (scope.externalPlanSpec !== true || scope.specReadRoot === undefined) return undefined;
  const root = realpathSync(scope.specReadRoot);
  const allowed = new Set(allowedArtifacts.map((path) => resolve(path)));
  const files = new Map<string, Buffer>();
  for (const path of listExternalSpecArtifacts(root)) {
    if (!allowed.has(resolve(path))) files.set(path, readFileSync(path));
  }
  return { root, files, allowedArtifacts: allowed };
}

/** Restores and reports any forbidden external-spec markdown drift. */
export function restoreExternalSpecTree(snapshot: ExternalSpecTreeSnapshot | undefined): string[] {
  if (snapshot === undefined) return [];
  if (!existsSync(snapshot.root)) mkdirSync(snapshot.root, { recursive: true });
  const current = new Set(listExternalSpecArtifacts(snapshot.root));
  const changed = new Set<string>();
  for (const [path, content] of snapshot.files) {
    current.delete(path);
    if (!existsSync(path) || !readFileSync(path).equals(content)) {
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(path, content);
      changed.add(path);
    }
  }
  for (const path of current) {
    if (!snapshot.allowedArtifacts.has(resolve(path))) {
      rmSync(path, { force: true });
      changed.add(path);
    }
  }
  return [...changed].sort();
}

/** Runs a post-implement role while restoring any forbidden external-spec mutation. */
export async function withExternalSpecTreeReadOnly<T>(
  scope: ExternalSpecGitScope,
  allowedArtifacts: readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  const snapshot = captureExternalSpecTree(scope, allowedArtifacts);
  let result: T | undefined;
  let failure: unknown;
  try {
    result = await run();
  } catch (error) {
    failure = error;
  }
  const changed = restoreExternalSpecTree(snapshot);
  if (changed.length > 0) {
    throw new Error(`external spec mutation blocked: ${changed.join(", ")}`);
  }
  if (failure !== undefined) throw failure;
  return result as T;
}

/** Removes admitted external-spec paths and worktree symlink shadows from Git-facing inventories. */
export function excludeExternalSpecGitPaths(
  worktreePath: string,
  paths: readonly string[],
  scope: ExternalSpecGitScope,
): string[] {
  if (scope.externalPlanSpec !== true || scope.specReadRoot === undefined) return [...paths];
  const specReadRoot = realpathSync(scope.specReadRoot);
  const externalArtifacts = listExternalSpecArtifacts(specReadRoot);
  return paths.filter(
    (path) =>
      !resolvesUnderExternalSpecRoot(worktreePath, path, specReadRoot) &&
      !matchesExternalSpecCopy(worktreePath, path, externalArtifacts),
  );
}
