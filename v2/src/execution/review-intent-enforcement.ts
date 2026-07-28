import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { isGitRepoAsync } from "../../../shared/git.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { ReviewCycleInput, ReviewCycleResult } from "./review-cycle.ts";
import { executeReviewCycle } from "./review-cycle.ts";

/** Directory names never considered part of the enforced tree. */
const EXCLUDED_DIR_NAMES = new Set([".git"]);

/** Recursively copy `src` to `dest`, skipping {@link EXCLUDED_DIR_NAMES}. */
function copyTree(src: string, dest: string): void {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(to, { recursive: true });
      copyTree(from, to);
    } else if (entry.isFile()) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
}

/** Remove every entry directly under `dir` except {@link EXCLUDED_DIR_NAMES}. */
function clearTree(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    rmSync(join(dir, entry.name), { recursive: true, force: true });
  }
}

/** Relative file paths currently present under `root`, skipping {@link EXCLUDED_DIR_NAMES}. */
function listFiles(root: string, dir: string = root, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(root, full, out);
    } else if (entry.isFile()) {
      out.push(relative(root, full).replace(/\\/g, "/"));
    }
  }
  return out;
}

function pathFromPorcelainLine(line: string): string | undefined {
  if (line.endsWith("\r")) line = line.slice(0, -1);
  if (line.length < 3) return undefined;
  let path = line.slice(3);
  const arrow = path.indexOf(" -> ");
  if (arrow >= 0) path = path.slice(arrow + 4);
  return path.length > 0 ? path : undefined;
}

async function gitStatusPaths(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<Set<string>> {
  const current = new Set<string>();
  const raw = await runner.runAsync("git", ["status", "--porcelain", "--untracked-files=all"], cwd);
  if (raw.length === 0) return current;
  const lines = raw.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const path = pathFromPorcelainLine(line);
    if (path !== undefined) current.add(path);
  }
  return current;
}

/**
 * Working-tree state captured before a review cycle, used to detect and undo unauthorized
 * changes afterward. Git-enabled repos are diffed via `git status`; a plain (git-disabled)
 * directory is backed up in full since there is no VCS history to restore from.
 */
export type TreeSnapshot = { kind: "git" } | { kind: "fs"; backupDir: string; files: Set<string> };

/**
 * Snapshot the working tree so later changes can be detected and, if unauthorized, undone.
 */
export async function snapshotWorkingTree(cwd: string): Promise<TreeSnapshot> {
  if (await isGitRepoAsync(cwd)) return { kind: "git" };
  const backupDir = mkdtempSync(join(tmpdir(), "jarvis-review-backup-"));
  copyTree(cwd, backupDir);
  return { kind: "fs", backupDir, files: new Set(listFiles(cwd)) };
}

/**
 * Get paths that have changed since `before` was captured.
 */
export async function getChangedPaths(
  cwd: string,
  before: TreeSnapshot,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<Set<string>> {
  if (before.kind === "git") {
    return await gitStatusPaths(cwd, runner);
  }
  const after = new Set(listFiles(cwd));
  const changed = new Set<string>();
  for (const path of after) {
    if (!before.files.has(path)) {
      changed.add(path);
      continue;
    }
    const beforeContent = readFileSafely(join(before.backupDir, path));
    const afterContent = readFileSafely(join(cwd, path));
    if (beforeContent === undefined || afterContent === undefined || !beforeContent.equals(afterContent)) {
      changed.add(path);
    }
  }
  for (const path of before.files) {
    if (!after.has(path)) changed.add(path);
  }
  return changed;
}

function readFileSafely(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Restore the working tree to `before`, discarding all changes made since. Called after
 * critic or actuator boundary violations to enforce read-only/staging-only semantics.
 */
export async function restoreWorkingTree(
  cwd: string,
  before: TreeSnapshot,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<void> {
  if (before.kind === "git") {
    try {
      await runner.runAsync("git", ["checkout", "--", "."], cwd, { stdio: "ignore" });
      await runner.runAsync("git", ["clean", "-fd"], cwd, { stdio: "ignore" });
    } catch {
      // Ignore restore failures; we'll fail the review on boundary violation detection.
    }
    return;
  }
  try {
    clearTree(cwd);
    copyTree(before.backupDir, cwd);
  } catch {
    // Ignore restore failures; we'll fail the review on boundary violation detection.
  }
}

/** Release resources captured by {@link snapshotWorkingTree} once no longer needed. */
export function discardSnapshot(before: TreeSnapshot): void {
  if (before.kind === "fs") {
    rmSync(before.backupDir, { recursive: true, force: true });
  }
}

/**
 * Verdict file reserved for review step.
 */
export const VERDICT_FILE = ".jarvis-intent-review-verdict.md";

function ownerMarkerPath(verdictPath: string): string {
  return `${verdictPath}.owner`;
}

/** Verdict lifecycle state. */
export type VerdictState = { kind: "missing" } | { kind: "owned"; invocationId: string } | { kind: "foreign" };

/**
 * Check verdict file ownership before review starts, tying ownership to `invocationId` via a
 * sibling marker file. A pre-existing verdict whose marker matches this invocation (or that has
 * no marker and no content, i.e. predates the marker convention) is ours to resume; anything else
 * pre-existing is a foreign collision.
 */
export function checkVerdictOwnershipBefore(verdictPath: string, invocationId: string): VerdictState {
  const markerPath = ownerMarkerPath(verdictPath);
  if (!existsSync(verdictPath)) {
    writeFileSync(markerPath, invocationId, "utf8");
    return { kind: "owned", invocationId };
  }

  const owner = existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : undefined;
  if (owner === invocationId) {
    return { kind: "owned", invocationId };
  }
  if (owner !== undefined) {
    return { kind: "foreign" };
  }

  try {
    const content = readFileSync(verdictPath, "utf8");
    if (content.trim().length === 0) {
      writeFileSync(markerPath, invocationId, "utf8");
      return { kind: "owned", invocationId };
    }
  } catch {
    return { kind: "missing" };
  }
  return { kind: "foreign" };
}

/**
 * Enforce reviewer read-only and actuator staging-only boundaries.
 * Wraps executeReviewCycle to snapshot, run, and validate filesystem changes.
 */
export async function executeReviewCycleEnforced(args: {
  input: ReviewCycleInput;
  invocationId: string;
  stagingDir: string;
  cwd: string;
  verdictPath: string;
  runner?: AsyncSubprocessRunner;
}): Promise<{
  result: ReviewCycleResult;
  verdictState: VerdictState;
  boundaryViolation?: string;
}> {
  const { input, invocationId, stagingDir, cwd, verdictPath, runner } = args;

  // Check verdict ownership before any review.
  const verdictState = checkVerdictOwnershipBefore(verdictPath, invocationId);
  if (verdictState.kind === "foreign") {
    return {
      result: {
        kind: "invocation_failure",
        failureKind: "error",
        cycles: [],
      },
      verdictState,
      boundaryViolation: `verdict file ${VERDICT_FILE} is owned by a different invocation`,
    };
  }

  // Snapshot before any review cycle.
  const beforeReview = await snapshotWorkingTree(cwd);

  // Run the review cycle.
  const result = await executeReviewCycle(input);

  // After review, check if there were any boundary violations.
  if (result.kind === "complete") {
    // Critic should be read-only: no changes outside the verdict file.
    let afterReview: Set<string>;
    try {
      afterReview = await getChangedPaths(cwd, beforeReview, runner);
    } catch (error) {
      discardSnapshot(beforeReview);
      return {
        result,
        verdictState,
        boundaryViolation: `intent review boundary inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Filter out the verdict file, its owner marker, and the staging directory.
    const stagingPath = relative(cwd, stagingDir).replace(/\\/g, "/");
    const stagingPrefix = stagingPath.endsWith("/") ? stagingPath : `${stagingPath}/`;
    const verdictFileName = verdictPath.split("/").pop() || VERDICT_FILE;
    const ownerMarkerName = `${verdictFileName}.owner`;

    const unauthorizedChanges = Array.from(afterReview).filter((path) => {
      // Allow changes in the staging directory (for actuator)
      if (path.startsWith(stagingPrefix)) return false;
      // Allow the verdict file and its ownership marker
      if (path.endsWith(verdictFileName) || path.endsWith(ownerMarkerName)) return false;
      // Everything else is unauthorized
      return true;
    });

    if (unauthorizedChanges.length > 0) {
      // Unauthorized changes detected. Restore and fail.
      const verdict = readFileSafely(verdictPath);
      const owner = readFileSafely(ownerMarkerPath(verdictPath));
      await restoreWorkingTree(cwd, beforeReview, runner);
      if (verdict !== undefined) writeFileSync(verdictPath, verdict);
      if (owner !== undefined) writeFileSync(ownerMarkerPath(verdictPath), owner);
      discardSnapshot(beforeReview);
      return {
        result,
        verdictState,
        boundaryViolation: `critic or actuator modified files outside ${stagingDir}: ${unauthorizedChanges.join(", ")}`,
      };
    }
  }

  discardSnapshot(beforeReview);
  return {
    result,
    verdictState,
  };
}

/**
 * Exclude the verdict file from intent validation/landing.
 * Called before landIntentWorkflowOutput to remove the verdict file from staging.
 */
export function excludeVerdictFromStaging(_stagingDir: string, verdictPath: string): void {
  if (existsSync(verdictPath)) {
    rmSync(verdictPath, { force: true });
  }
}

/**
 * Clean up the verdict file and its ownership marker after successful validation/landing.
 */
export function cleanupVerdictFile(verdictPath: string): void {
  if (existsSync(verdictPath)) {
    rmSync(verdictPath, { force: true });
  }
  const markerPath = ownerMarkerPath(verdictPath);
  if (existsSync(markerPath)) {
    rmSync(markerPath, { force: true });
  }
}
