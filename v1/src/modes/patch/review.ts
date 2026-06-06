import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import { pushCurrent } from "../../worktree.ts";
import { updatePrBody } from "./pr.ts";

/** Sentinel file a review agent writes (at the repo root) to signal a blocker. */
export const REVIEW_BLOCKER_FILE = ".jarvis-review-blocker";

export function detectSpecTreeEdits(specDir: string, cwd: string): string[] {
  // Return spec files modified or newly created since the last commit. Uses
  // porcelain status (not `git diff`) so untracked additions are caught too.
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });

    const specRelPath = relative(cwd, specDir);
    return (
      output
        .split("\n")
        .filter((line) => line.length > 3)
        // Porcelain lines are `XY <path>`; drop the two status columns + space.
        .map((line) => line.slice(3).trim())
        .filter((file) => file === specRelPath || file.startsWith(`${specRelPath}/`))
    );
  } catch {
    return [];
  }
}

export function revertSpecTreeEdits(specDir: string, cwd: string): void {
  const editedFiles = detectSpecTreeEdits(specDir, cwd);
  if (editedFiles.length === 0) {
    return;
  }

  // Restore tracked files; `git clean` drops any untracked additions.
  try {
    for (const file of editedFiles) {
      try {
        execFileSync("git", ["checkout", "HEAD", "--", file], {
          cwd,
          stdio: "pipe",
        });
      } catch {
        // Untracked file: nothing to restore from HEAD; clean handles it below.
      }
    }
    execFileSync("git", ["clean", "-fd", "--", relative(cwd, specDir)], {
      cwd,
      stdio: "pipe",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to revert spec-tree edits: ${message}`);
  }
}

// Read and remove the review-blocker sentinel file if the agent wrote one.
// Returns the blocker description, or null when no blocker was signalled. The
// file is deleted so it is never committed and does not leak into later passes.
export function consumeReviewBlocker(cwd: string): string | null {
  const sentinel = join(cwd, REVIEW_BLOCKER_FILE);
  if (!existsSync(sentinel)) {
    return null;
  }
  let content = "";
  try {
    content = readFileSync(sentinel, "utf8").trim();
  } catch {
    content = "";
  }
  try {
    rmSync(sentinel, { force: true });
  } catch {
    // best-effort
  }
  return content.length > 0 ? content : "(no blocker detail provided)";
}

export function commitReviewPass(
  passNumber: number,
  agentLabel: string,
  cwd: string,
  opts?: { branch?: string; base?: string; specPath?: string },
): void {
  // Check if there are any changes to commit
  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

  if (porcelain === "") {
    // No changes, skip commit
    return;
  }

  // Stage all changes
  execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });

  // Create commit message
  const commitMessage = appendAgentTrailer(`review: pass ${passNumber}`, agentLabel);

  // Commit
  execFileSync("git", ["commit", "-F", "-"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: commitMessage,
  });

  // Push
  pushCurrent({ cwd, firstPush: false });

  // Refresh PR footer if spec path is provided
  if (opts?.specPath && opts?.branch && opts?.base) {
    try {
      updatePrBody({
        indexPath: opts.specPath,
        branch: opts.branch,
        base: opts.base,
        cwd,
      });
    } catch {
      // Ignore footer refresh errors, they're not critical
    }
  }
}
