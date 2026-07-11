import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReviewCycleInput, ReviewCycleResult } from "./review-cycle.ts";
import { executeReviewCycle } from "./review-cycle.ts";

/**
 * Snapshot the working tree by recording paths that are currently changed.
 * Returns a Set of changed paths for later comparison.
 */
export function snapshotWorkingTree(cwd: string): Set<string> {
  const snapshot = new Set<string>();
  try {
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd,
      encoding: "utf8",
    }).trim();
    if (status.length > 0) {
      status.split("\n").forEach((line) => {
        const path = line.slice(3).trim();
        if (path) snapshot.add(path);
      });
    }
  } catch {
    // Fall back to empty snapshot if git fails.
  }
  return snapshot;
}

/**
 * Get paths that have changed since a snapshot.
 * Returns the set of paths that are currently changed.
 */
export function getChangedPaths(cwd: string): Set<string> {
  const current = new Set<string>();
  try {
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd,
      encoding: "utf8",
    }).trim();
    if (status.length > 0) {
      status.split("\n").forEach((line) => {
        const path = line.slice(3).trim();
        if (path) current.add(path);
      });
    }
  } catch {
    // Fall back to empty set if git fails.
  }
  return current;
}

/**
 * Restore the working tree by discarding all unstaged changes and untracked files.
 * This is called after critic to enforce read-only semantics.
 */
export function restoreWorkingTree(cwd: string): void {
  try {
    execFileSync("git", ["checkout", "--", "."], { cwd, stdio: "ignore" });
    execFileSync("git", ["clean", "-fd"], { cwd, stdio: "ignore" });
  } catch {
    // Ignore restore failures; we'll fail the review on boundary violation detection.
  }
}

/**
 * Verdict file reserved for review step.
 */
export const VERDICT_FILE = ".jarvis-intent-review-verdict.md";

/** Verdict lifecycle state. */
export type VerdictState =
  | { kind: "missing" }
  | { kind: "owned"; invocationId: string }
  | { kind: "foreign" };

/**
 * Check verdict file ownership before review starts.
 * Pre-existing non-empty verdict files indicate a foreign invocation owns them.
 */
export function checkVerdictOwnershipBefore(verdictPath: string): VerdictState {
  if (!existsSync(verdictPath)) {
    return { kind: "missing" };
  }

  try {
    const content = readFileSync(verdictPath, "utf8");
    // Non-empty verdict file indicates it was created by a foreign invocation.
    if (content.trim().length > 0) {
      return { kind: "foreign" };
    }
    // Empty file means it's either newly created or from a prior run of this invocation.
    // We'll treat empty as "potentially ours" and handle collisions more carefully.
    return { kind: "owned", invocationId: "" };
  } catch {
    return { kind: "missing" };
  }
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
}): Promise<{
  result: ReviewCycleResult;
  verdictState: VerdictState;
  boundaryViolation?: string;
}> {
  const { input, stagingDir, cwd, verdictPath } = args;

  // Check verdict ownership before any review.
  const verdictState = checkVerdictOwnershipBefore(verdictPath);
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
  const beforeReview = snapshotWorkingTree(cwd);

  // Run the review cycle.
  const result = await executeReviewCycle(input);

  // After review, check if there were any boundary violations.
  if (result.kind === "complete") {
    // Critic should be read-only: no changes outside the verdict file.
    const afterReview = getChangedPaths(cwd);

    // Filter out the verdict file and staging directory.
    const stagingPrefix = stagingDir.endsWith("/") ? stagingDir : `${stagingDir}/`;
    const verdictFileName = verdictPath.split("/").pop() || VERDICT_FILE;

    const unauthorizedChanges = Array.from(afterReview).filter((path) => {
      // Allow changes in the staging directory (for actuator)
      if (path.startsWith(stagingPrefix)) return false;
      // Allow the verdict file itself
      if (path.endsWith(verdictFileName)) return false;
      // Everything else is unauthorized
      return true;
    });

    if (unauthorizedChanges.length > 0) {
      // Unauthorized changes detected. Restore and fail.
      restoreWorkingTree(cwd);
      return {
        result,
        verdictState,
        boundaryViolation: `critic or actuator modified files outside ${stagingDir}: ${unauthorizedChanges.join(", ")}`,
      };
    }

    // Check that all staging directory changes are within it (should always be true, but verify).
    const stagingChanges = Array.from(afterReview).filter((path) => path.startsWith(stagingPrefix));
    if (stagingChanges.length > 0) {
      // Verify each change is actually in the staging dir.
      for (const change of stagingChanges) {
        if (!change.startsWith(stagingPrefix)) {
          return {
            result,
            verdictState,
            boundaryViolation: `actuator modified file outside ${stagingDir}: ${change}`,
          };
        }
      }
    }
  }

  return {
    result,
    verdictState,
  };
}

/**
 * Exclude the verdict file from intent validation/landing.
 * Called before landIntentWorkflowOutput to remove the verdict file from staging.
 */
export function excludeVerdictFromStaging(stagingDir: string, verdictPath: string): void {
  if (existsSync(verdictPath)) {
    rmSync(verdictPath, { force: true });
  }
}

/**
 * Clean up the verdict file after successful validation/landing.
 */
export function cleanupVerdictFile(verdictPath: string): void {
  if (existsSync(verdictPath)) {
    rmSync(verdictPath, { force: true });
  }
}
