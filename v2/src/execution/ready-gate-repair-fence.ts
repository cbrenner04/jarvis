import { existsSync, rmSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { normalizePublicationSpecPath } from "./publication-spec-path.ts";
import { parseGitNameStatusZ, type ReadyGateScopeInput, validateRepoRelativePath } from "./ready-finalize.ts";

export type RepairAllowset = {
  exactPaths: ReadonlySet<string>;
  specScopePrefixes: readonly string[];
};

type RepairSpecScope = { kind: "descendants"; prefix: string } | { kind: "file-only"; path: string };

export type RepairFenceViolation = {
  error: Error;
  offender?: string;
};

/** Durable ready-gate repair fence persisted on a run for restart-safe recovery. */
export type PersistedReadyGateRepairFence = {
  exactPaths: string[];
  specScopePrefixes: string[];
  rejectedPath?: string;
  outcomeKind?: "completion_commit_failed";
};

const READY_GATE_REPAIR_MAX_BUFFER = 10 * 1024 * 1024;

function resolveRepairSpecScope(worktreePath: string, specPath: string): RepairSpecScope | undefined {
  const resolvedSpecPath = isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
  try {
    if (statSync(resolvedSpecPath).isDirectory()) {
      const rel = relative(worktreePath, resolvedSpecPath).replace(/\\/g, "/");
      const prefix = validateRepoRelativePath(rel);
      return prefix === undefined ? undefined : { kind: "descendants", prefix };
    }
  } catch {
    // fall through to file-based resolution
  }

  const normalized = normalizePublicationSpecPath(worktreePath, specPath);
  const validated = validateRepoRelativePath(normalized);
  if (validated === undefined) {
    return undefined;
  }

  if (basename(validated) === "index.md") {
    const parent = dirname(validated);
    if (parent === ".") {
      return { kind: "descendants", prefix: "" };
    }
    const prefix = validateRepoRelativePath(parent);
    return prefix === undefined ? undefined : { kind: "descendants", prefix };
  }

  return { kind: "file-only", path: validated };
}

export function isGitBackedWorktree(worktreePath: string): boolean {
  const gitPath = join(worktreePath, ".git");
  if (!existsSync(gitPath)) {
    return false;
  }
  try {
    return statSync(gitPath).isFile() || existsSync(join(gitPath, "HEAD"));
  } catch {
    return false;
  }
}

export function isRepairPathAllowed(path: string, allowset: RepairAllowset): boolean {
  if (allowset.exactPaths.has(path)) {
    return true;
  }
  for (const prefix of allowset.specScopePrefixes) {
    if (prefix === "") {
      return true;
    }
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

export function compareRepoRelativePathsByteOrder(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** Byte-sort normalized candidates and return the first path outside the frozen allowset. */
export function findFirstOutOfScopeRepairCandidate(
  candidates: readonly string[],
  allowset: RepairAllowset,
): string | undefined {
  const normalized: string[] = [];
  for (const raw of candidates) {
    const path = validateRepoRelativePath(raw);
    if (path === undefined) {
      return raw;
    }
    normalized.push(path);
  }
  normalized.sort(compareRepoRelativePathsByteOrder);
  for (const path of normalized) {
    if (!isRepairPathAllowed(path, allowset)) {
      return path;
    }
  }
  return undefined;
}

export function formatReadyGateRepairFenceFailure(path: string): string {
  return `ready-gate repair completion stages path outside the run diff and spec tree: ${JSON.stringify(path)}`;
}

export function repairAllowsetToPersisted(
  allowset: RepairAllowset,
): Pick<PersistedReadyGateRepairFence, "exactPaths" | "specScopePrefixes"> {
  return {
    exactPaths: [...allowset.exactPaths].sort(compareRepoRelativePathsByteOrder),
    specScopePrefixes: [...allowset.specScopePrefixes],
  };
}

export function persistedToRepairAllowset(fence: PersistedReadyGateRepairFence): RepairAllowset {
  return {
    exactPaths: new Set(fence.exactPaths),
    specScopePrefixes: fence.specScopePrefixes,
  };
}

export function isPersistedReadyGateRepairFence(value: unknown): value is PersistedReadyGateRepairFence {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.exactPaths) || !record.exactPaths.every((path) => typeof path === "string")) {
    return false;
  }
  if (
    !Array.isArray(record.specScopePrefixes) ||
    !record.specScopePrefixes.every((prefix) => typeof prefix === "string")
  ) {
    return false;
  }
  if (record.rejectedPath !== undefined && typeof record.rejectedPath !== "string") {
    return false;
  }
  if (record.outcomeKind !== undefined && record.outcomeKind !== "completion_commit_failed") {
    return false;
  }
  return true;
}

export function parsePersistedReadyGateRepairFence(json: string): PersistedReadyGateRepairFence | null {
  try {
    const value: unknown = JSON.parse(json);
    return isPersistedReadyGateRepairFence(value) ? value : null;
  } catch {
    return null;
  }
}

/** Derive the frozen repair allowset from committed run diff paths plus resolved spec scope. */
export async function deriveRepairAllowset(
  scope: ReadyGateScopeInput,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<RepairAllowset | undefined> {
  let diffOutput: string | null;
  try {
    diffOutput = await runner.runAsync(
      "git",
      ["diff", "--name-status", "-z", "--diff-filter=ACDMRTUXB", `${scope.baseRef}...HEAD`],
      scope.worktreePath,
      { maxBuffer: READY_GATE_REPAIR_MAX_BUFFER },
    );
  } catch {
    return undefined;
  }
  if (diffOutput === null) {
    return undefined;
  }

  const diffPaths = parseGitNameStatusZ(diffOutput);
  if (diffPaths === undefined) {
    return undefined;
  }

  const exactPaths = new Set<string>();
  for (const rawPath of diffPaths) {
    const normalized = validateRepoRelativePath(rawPath);
    if (normalized === undefined) {
      return undefined;
    }
    exactPaths.add(normalized);
  }

  const specScope = resolveRepairSpecScope(scope.worktreePath, scope.specPath);
  if (specScope === undefined) {
    return undefined;
  }

  const specScopePrefixes: string[] = [];
  if (specScope.kind === "descendants") {
    specScopePrefixes.push(specScope.prefix);
  } else {
    exactPaths.add(specScope.path);
  }

  return { exactPaths, specScopePrefixes };
}

/** Enumerate paths a repair completion commit would stage (`read-tree HEAD` + `add -A`). */
export async function listRepairCompletionCandidatePaths(
  worktreePath: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string[] | undefined> {
  if (!existsSync(join(worktreePath, ".git"))) {
    return [];
  }

  const gitDirValue = (await runner.runAsync("git", ["rev-parse", "--git-dir"], worktreePath)).trim();
  const gitDir = isAbsolute(gitDirValue) ? gitDirValue : resolve(worktreePath, gitDirValue);
  const head = (await runner.runAsync("git", ["rev-parse", "HEAD"], worktreePath)).trim();
  const indexPath = join(tmpdir(), `jarvis-repair-candidates-${randomUUID()}`);
  const indexEnv = { ...process.env, GIT_INDEX_FILE: indexPath, GIT_DIR: gitDir };
  try {
    await runner.runAsync("git", ["read-tree", head], worktreePath, {
      env: indexEnv,
    });
    await runner.runAsync("git", ["add", "-A"], worktreePath, {
      env: indexEnv,
    });
    const output = await runner.runAsync(
      "git",
      ["diff-index", "--name-status", "-z", "-M", head],
      worktreePath,
      { env: indexEnv, maxBuffer: READY_GATE_REPAIR_MAX_BUFFER },
    );
    return parseGitNameStatusZ(output);
  } catch {
    return undefined;
  } finally {
    try {
      rmSync(indexPath, { force: true });
    } catch {
      // best-effort temp index cleanup
    }
  }
}

export async function validateReadyGateRepairCompletion(
  worktreePath: string,
  allowset: RepairAllowset,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<RepairFenceViolation | undefined> {
  const candidates = await listRepairCompletionCandidatePaths(worktreePath, runner);
  if (candidates === undefined) {
    return { error: new Error("ready-gate repair completion could not enumerate staged paths") };
  }
  const offender = findFirstOutOfScopeRepairCandidate(candidates, allowset);
  if (offender === undefined) {
    return undefined;
  }
  return { error: new Error(formatReadyGateRepairFenceFailure(offender)), offender };
}
