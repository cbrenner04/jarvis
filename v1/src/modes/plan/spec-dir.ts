import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
export type SpecDirSnapshot = Map<string, string>;

export function snapshotSpecDirFiles(specDirPath: string): SpecDirSnapshot {
  if (!existsSync(specDirPath)) {
    return new Map();
  }
  const snapshot: SpecDirSnapshot = new Map();
  for (const entry of readdirSync(specDirPath, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    snapshot.set(entry.name, readFileSync(join(specDirPath, entry.name), "utf8"));
  }
  return snapshot;
}

export function hasSpecDirChanges(specDirPath: string, before: SpecDirSnapshot): boolean {
  const after = snapshotSpecDirFiles(specDirPath);
  if (after.size !== before.size) {
    return true;
  }
  for (const [name, content] of after) {
    if (before.get(name) !== content) {
      return true;
    }
  }
  return false;
}

export function listSpecDirChanges(specDirPath: string, before: SpecDirSnapshot): string[] {
  const after = snapshotSpecDirFiles(specDirPath);
  const changed = new Set<string>();
  for (const name of before.keys()) {
    if (after.get(name) !== before.get(name)) {
      changed.add(name);
    }
  }
  for (const name of after.keys()) {
    if (after.get(name) !== before.get(name)) {
      changed.add(name);
    }
  }
  return [...changed].sort();
}

export function restoreSpecDirSnapshot(specDirPath: string, before: SpecDirSnapshot): void {
  const after = snapshotSpecDirFiles(specDirPath);
  for (const name of after.keys()) {
    if (!before.has(name)) {
      rmSync(join(specDirPath, name), { force: true });
    }
  }
  for (const [name, content] of before) {
    writeFileSync(join(specDirPath, name), content, "utf8");
  }
}
