import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

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

function matchesExternalSpecCopy(worktreePath: string, path: string, specReadRoot: string): boolean {
  const externalPath = resolve(specReadRoot, path);
  if (!isWithin(specReadRoot, externalPath)) return false;
  try {
    return readFileSync(resolve(worktreePath, path)).equals(readFileSync(externalPath));
  } catch {
    return false;
  }
}

/** Removes admitted external-spec paths and worktree symlink shadows from Git-facing inventories. */
export function excludeExternalSpecGitPaths(
  worktreePath: string,
  paths: readonly string[],
  scope: ExternalSpecGitScope,
): string[] {
  if (scope.externalPlanSpec !== true || scope.specReadRoot === undefined) return [...paths];
  const specReadRoot = realpathSync(scope.specReadRoot);
  return paths.filter(
    (path) =>
      !resolvesUnderExternalSpecRoot(worktreePath, path, specReadRoot) &&
      !matchesExternalSpecCopy(worktreePath, path, specReadRoot),
  );
}
