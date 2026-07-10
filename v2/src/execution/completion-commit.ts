import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type CompletionCommitInput = { worktreePath: string; baseRef: string; specPath: string; agent: string };
export type CompletionCommitResult = { commitSha?: string };
export type CompletionCommitter = (input: CompletionCommitInput) => CompletionCommitResult;
type Git = (cwd: string, args: readonly string[], env?: Record<string, string>) => string;
type PendingCommit = {
  baseHead: string;
  tree: string;
  branchRef: string;
  message: string;
  agent: string;
  timestamp: string;
  commitSha?: string;
};

function git(cwd: string, args: readonly string[], env?: Record<string, string>): string {
  return execFileSync("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
}

/** Captures and publishes one completion snapshot; hooks are bypassed by design. */
export function createCompletionCommitter(runGit: Git = git): CompletionCommitter {
  return (input) => {
    const agent = input.agent.trim();
    if (!agent) throw new Error("completion attribution is missing");
    if (!existsSync(join(input.worktreePath, ".git"))) return {};
    const index = join(tmpdir(), `jarvis-index-${crypto.randomUUID()}`);
    const gitDirValue = runGit(input.worktreePath, ["rev-parse", "--git-dir"]);
    const gitDir = isAbsolute(gitDirValue) ? gitDirValue : resolve(input.worktreePath, gitDirValue);
    const pendingPath = join(gitDir, "jarvis-completion-pending.json");
    try {
      let pending: PendingCommit | undefined;
      if (existsSync(pendingPath)) {
        pending = JSON.parse(readFileSync(pendingPath, "utf8")) as PendingCommit;
      } else {
        const head = runGit(input.worktreePath, ["rev-parse", "HEAD"]);
        runGit(input.worktreePath, ["read-tree", head], { GIT_INDEX_FILE: index });
        runGit(input.worktreePath, ["add", "-A"], { GIT_INDEX_FILE: index });
        const tree = runGit(input.worktreePath, ["write-tree"], { GIT_INDEX_FILE: index });
        const baseTree = runGit(input.worktreePath, ["rev-parse", `${head}^{tree}`]);
        if (tree === baseTree) return {};
        pending = {
          baseHead: head,
          tree,
          branchRef: runGit(input.worktreePath, ["symbolic-ref", "HEAD"]),
          message: `jarvis: complete run\n\nSpec: ${input.specPath}\n\nJarvis-Agent: ${agent}`,
          agent,
          timestamp: new Date().toISOString(),
        };
        writeFileSync(pendingPath, `${JSON.stringify(pending)}\n`, "utf8");
      }

      const currentHead = runGit(input.worktreePath, ["rev-parse", "HEAD"]);
      if (pending.commitSha !== undefined && currentHead === pending.commitSha) {
        runGit(input.worktreePath, ["reset", "--mixed", pending.commitSha]);
        unlinkSync(pendingPath);
        return { commitSha: pending.commitSha };
      }

      const commit =
        pending.commitSha ??
        runGit(input.worktreePath, ["commit-tree", pending.tree, "-p", pending.baseHead, "-m", pending.message], {
          GIT_AUTHOR_DATE: pending.timestamp,
          GIT_COMMITTER_DATE: pending.timestamp,
        });
      if (pending.commitSha === undefined) {
        pending = { ...pending, commitSha: commit };
        writeFileSync(pendingPath, `${JSON.stringify(pending)}\n`, "utf8");
      }
      runGit(input.worktreePath, ["update-ref", pending.branchRef, commit, pending.baseHead]);
      runGit(input.worktreePath, ["reset", "--mixed", commit]);
      unlinkSync(pendingPath);
      return { commitSha: commit };
    } finally {
      try {
        rmSync(index, { force: true });
      } catch {
        /* retry keeps the worktree content */
      }
    }
  };
}
