import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type BoundaryCheckResult =
  | { ok: true }
  | { ok: false; offendingPaths: string[] };

/**
 * Check that all modified files in the worktree are within spec/<name>/
 * or within the allowed list (e.g., the worktree's .gitignore).
 *
 * Returns { ok: true } if all changes are in-bounds, or
 * { ok: false, offendingPaths: [...] } if any files were modified outside the boundary.
 */
export function assertPlanWriteBoundary(
  worktreePath: string,
  specDirBasename: string,
): BoundaryCheckResult {
  // Use git status --porcelain=v1 -z to get null-terminated output
  let output: string;
  try {
    output = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (_err) {
    // If git status fails, treat it as a blocker rather than crashing
    return { ok: false, offendingPaths: ["(git status failed)"] };
  }

  if (!output) {
    // Clean working tree
    return { ok: true };
  }

  // Parse null-terminated records: "XY PATH\0XY PATH\0..."
  const records = output.split("\0").filter((r) => r.length > 0);
  const offendingPaths: string[] = [];

  for (const record of records) {
    // Format is "XY PATH" where XY is two status characters
    const path = record.slice(3); // Skip "XY "

    // Check if path is within spec/<name>/
    const isInSpec = path.startsWith(`spec/${specDirBasename}/`);

    if (!isInSpec) {
      offendingPaths.push(path);
    }
  }

  if (offendingPaths.length === 0) {
    return { ok: true };
  }

  return { ok: false, offendingPaths };
}

/**
 * For no-commit plan runs: ensure the target repo checkout was not modified
 * under `spec/` while the agent worked in Jarvis-owned external storage.
 * 
 * When the project root is not a git repository, returns { ok: true }
 * without invoking git, since the boundary is enforced by the agent's cwd.
 */
export function assertTargetRepoPlanBoundary(
  projectRoot: string,
): BoundaryCheckResult {
  // If projectRoot is not a git repository, no git-based boundary check is needed
  if (!existsSync(join(projectRoot, ".git"))) {
    return { ok: true };
  }

  let output: string;
  try {
    output = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (_err) {
    return { ok: false, offendingPaths: ["(git status failed)"] };
  }

  if (!output) {
    return { ok: true };
  }

  const records = output.split("\0").filter((r) => r.length > 0);
  const offendingPaths: string[] = [];

  for (const record of records) {
    const path = record.slice(3);
    if (path.startsWith("spec/")) {
      offendingPaths.push(path);
    }
  }

  if (offendingPaths.length === 0) {
    return { ok: true };
  }

  return { ok: false, offendingPaths };
}

/**
 * Revert modified files by path using `git checkout --`.
 */
export function revertPaths(worktreePath: string, paths: string[]): void {
  if (paths.length === 0) {
    return;
  }

  for (const path of paths) {
    try {
      execFileSync("git", ["checkout", "--", path], {
        cwd: worktreePath,
        stdio: "pipe",
      });
    } catch (err) {
      // Log but continue with other paths
      console.error(`warning: failed to revert ${path}: ${err}`);
    }
  }
}

/**
 * Append a blocker section to intent.md describing the out-of-bounds write violation.
 */
export function appendBoundaryBlocker(
  specDirPath: string,
  specDirBasename: string,
  offendingPaths: string[],
): void {
  const intentPath = join(specDirPath, "intent.md");

  const pathList = offendingPaths.map((p) => `  - \`${p}\``).join("\n");
  const blockerSection = `## Blocker

Out-of-bounds write detected. The following paths were modified outside \`spec/${specDirBasename}/\` and have been reverted:

${pathList}

Spec-file write boundary is enforced: only files under \`spec/${specDirBasename}/\` may be modified.`;

  try {
    const currentContent = readFileSync(intentPath, "utf8");
    // Check if a blocker section already exists and remove it
    const withoutBlocker = currentContent.split("\n## Blocker")[0];
    const newContent = `${withoutBlocker}\n\n${blockerSection}`;
    writeFileSync(intentPath, newContent, "utf8");
  } catch (err) {
    throw new Error(`failed to append blocker section to intent.md: ${err}`);
  }
}
