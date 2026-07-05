import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realSubprocessRunner, type SubprocessRunner } from "../../../../shared/subprocess.ts";

export type BoundaryCheckResult = { ok: true } | { ok: false; offendingPaths: string[] };

const GIT_UNKNOWN_PATH_MESSAGE = "did not match any file(s) known to git";

/**
 * Check that all modified files in the worktree are within <targetDir>/<name>/
 * or within the allowed list (e.g., the worktree's .gitignore).
 *
 * Returns { ok: true } if all changes are in-bounds, or
 * { ok: false, offendingPaths: [...] } if any files were modified outside the boundary.
 */
export function assertPlanWriteBoundary(
  worktreePath: string,
  specDirBasename: string,
  targetDir: string = "spec",
  runner: SubprocessRunner = realSubprocessRunner,
): BoundaryCheckResult {
  // Use git status --porcelain=v1 -z to get null-terminated output
  let output: string;
  try {
    output = runner.run("git", ["status", "--porcelain=v1", "-z"], worktreePath);
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

    // Check if path is within <targetDir>/<name>/
    const isInSpec = path.startsWith(`${targetDir}/${specDirBasename}/`);

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
  runner: SubprocessRunner = realSubprocessRunner,
): BoundaryCheckResult {
  // If projectRoot is not a git repository, no git-based boundary check is needed
  if (!existsSync(join(projectRoot, ".git"))) {
    return { ok: true };
  }

  let output: string;
  try {
    output = runner.run("git", ["status", "--porcelain=v1", "-z"], projectRoot);
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
 * Revert modified files by path using `git checkout --` and remove untracked
 * additions with `git clean -fd`.
 */
export function revertPaths(worktreePath: string, paths: string[], runner: SubprocessRunner = realSubprocessRunner): void {
  if (paths.length === 0) {
    return;
  }

  for (const path of paths) {
    try {
      runner.run("git", ["checkout", "--", path], worktreePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes(GIT_UNKNOWN_PATH_MESSAGE)) {
        console.error(`warning: failed to revert ${path}: ${message}`);
      }
    }
    try {
      runner.run("git", ["clean", "-fd", "--", path], worktreePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`warning: failed to clean ${path}: ${message}`);
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
  targetDir: string = "spec",
): void {
  const intentPath = join(specDirPath, "intent.md");

  const pathList = offendingPaths.map((p) => `  - \`${p}\``).join("\n");
  const blockerSection = `## Blocker

Out-of-bounds write detected. The following paths were modified outside \`${targetDir}/${specDirBasename}/\` and have been reverted:

${pathList}

Spec-file write boundary is enforced: only files under \`${targetDir}/${specDirBasename}/\` may be modified.`;

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
