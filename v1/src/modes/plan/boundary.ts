import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type BoundaryCheckResult = { ok: true } | { ok: false; offendingPaths: string[] };

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
export function assertTargetRepoPlanBoundary(projectRoot: string): BoundaryCheckResult {
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
 * Revert modified files by path using `git checkout --` and remove untracked
 * additions with `git clean -fd`.
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
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("did not match any file(s) known to git")) {
        console.error(`warning: failed to revert ${path}: ${message}`);
      }
    }
    try {
      execFileSync("git", ["clean", "-fd", "--", path], {
        cwd: worktreePath,
        stdio: "pipe",
      });
    } catch (err) {
      console.error(`warning: failed to clean ${path}: ${err}`);
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

/**
 * For no-commit plan runs: check that the agent wrote only under the expected
 * spec directory within the external storage root, not to sibling directories.
 *
 * Flags only top-level entries created during this run: those that are neither
 * the active spec dir nor in the pre-existing set. Allows legitimate siblings
 * like ready-intents/ and prior spec dirs that existed before this run.
 */
export function assertNoCommitExternalSpecBoundary(
  externalSpecRoot: string,
  specDirBasename: string,
  preExistingSiblings?: Set<string>,
): BoundaryCheckResult {
  // Check that the directory exists
  if (!existsSync(externalSpecRoot)) {
    return { ok: true };
  }

  let entries: string[];
  try {
    entries = readdirSync(externalSpecRoot);
  } catch (_err) {
    return {
      ok: false,
      offendingPaths: [`(failed to read ${externalSpecRoot})`],
    };
  }

  const offendingPaths: string[] = [];
  for (const entry of entries) {
    // Skip the active spec dir and any pre-existing siblings
    if (entry === specDirBasename || preExistingSiblings?.has(entry)) {
      continue;
    }
    offendingPaths.push(join(externalSpecRoot, entry));
  }

  if (offendingPaths.length === 0) {
    return { ok: true };
  }

  return { ok: false, offendingPaths };
}
