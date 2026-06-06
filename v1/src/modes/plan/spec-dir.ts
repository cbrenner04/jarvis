import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Resolve the directory holding plan spec files for a phase. */
export function resolvePlanSpecDirPath(
  worktreePath: string,
  specDirBasename: string,
  specDirPath?: string,
  targetDir: string = "spec",
): string {
  return specDirPath ?? join(worktreePath, targetDir, specDirBasename);
}

/** Basenames of files directly under a spec directory. */
export function snapshotSpecDirFiles(specDirPath: string): Set<string> {
  if (!existsSync(specDirPath)) {
    return new Set();
  }
  return new Set(readdirSync(specDirPath));
}

export function hasSpecDirChanges(specDirPath: string, before: Set<string>): boolean {
  const after = snapshotSpecDirFiles(specDirPath);
  if (after.size !== before.size) {
    return true;
  }
  for (const name of after) {
    if (!before.has(name)) {
      return true;
    }
  }
  return false;
}
