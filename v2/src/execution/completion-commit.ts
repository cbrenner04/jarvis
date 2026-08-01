import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { normalizePublicationSpecPath } from "./publication-spec-path.ts";

export type CompletionCommitInput = {
  worktreePath: string;
  baseRef: string;
  specPath: string;
  agent: string;
  /** Authoritative commit subject, resolved by the caller that owns workflow context. */
  title: string;
  /** Terminal completion: create a new commit even when the index tree matches HEAD. */
  forceDistinctCommit?: boolean;
  /** Ready-gate attribution trailer when autofix commits in-scope repair output. */
  readyGateAttribution?: "autofix";
};
export type CompletionCommitResult = { commitSha?: string; filesChanged?: number };
export type CompletionCommitter = (input: CompletionCommitInput) => Promise<CompletionCommitResult>;
type Git = (cwd: string, args: readonly string[], env?: Record<string, string>) => Promise<string>;
type PendingCommit = {
  baseHead: string;
  tree: string;
  branchRef: string;
  message: string;
  agent: string;
  timestamp: string;
  commitSha?: string;
};

function git(cwd: string, args: readonly string[], env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

/** When true, the committer reuses HEAD without creating a commit (iteration materialization no-op). */
export function shouldReuseHeadWithoutNewCommit(
  indexTree: string,
  headTree: string,
  forceDistinctCommit: boolean,
): boolean {
  return indexTree === headTree && !forceDistinctCommit;
}

async function countFilesChanged(runGit: Git, cwd: string, baseTree: string, completionTree: string): Promise<number> {
  const output = await runGit(cwd, ["diff-tree", "--no-renames", "--name-only", baseTree, completionTree]);
  if (!output) return 0;
  return output.split("\n").filter((line) => line.length > 0).length;
}

/**
 * Snapshots the worktree into a fresh pending commit, or settles early when HEAD is already the
 * completion commit. `settled` short-circuits the caller with its result.
 */
async function preparePendingCommit(
  runGit: Git,
  input: CompletionCommitInput,
  ctx: { agent: string; subject: string; index: string; pendingPath: string },
): Promise<{ kind: "pending"; pending: PendingCommit } | { kind: "settled"; result: CompletionCommitResult }> {
  const { agent, subject, index, pendingPath } = ctx;
  const head = await runGit(input.worktreePath, ["rev-parse", "HEAD"]);
  await runGit(input.worktreePath, ["read-tree", head], { GIT_INDEX_FILE: index });
  await runGit(input.worktreePath, ["add", "-A"], { GIT_INDEX_FILE: index });
  const tree = await runGit(input.worktreePath, ["write-tree"], { GIT_INDEX_FILE: index });
  const baseTree = await runGit(input.worktreePath, ["rev-parse", `${head}^{tree}`]);
  if (shouldReuseHeadWithoutNewCommit(tree, baseTree, input.forceDistinctCommit === true)) {
    // HEAD may already be a completion commit whose publish previously failed;
    // report its sha so the caller retries publication instead of no-op'ing.
    const headMessage = await runGit(input.worktreePath, ["log", "-1", "--format=%B", head]);
    return {
      kind: "settled",
      result: headMessage.includes("Jarvis-Agent:")
        ? {
            commitSha: head,
            filesChanged: await countFilesChanged(runGit, input.worktreePath, `${head}^^{tree}`, `${head}^{tree}`),
          }
        : {},
    };
  }
  const pending: PendingCommit = {
    baseHead: head,
    tree,
    branchRef: await runGit(input.worktreePath, ["symbolic-ref", "HEAD"]),
    message: `${subject}\n\nSpec: ${normalizePublicationSpecPath(input.worktreePath, input.specPath)}\n\nJarvis-Agent: ${agent}${
      input.readyGateAttribution === "autofix" ? "\n\nJarvis-Ready-Gate: autofix" : ""
    }`,
    agent,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(pendingPath, `${JSON.stringify(pending)}\n`, "utf8");
  return { kind: "pending", pending };
}

/** Captures and publishes one completion snapshot; hooks are bypassed by design. */
export function createCompletionCommitter(runGit: Git = git): CompletionCommitter {
  return async (input) => {
    const agent = input.agent.trim();
    if (!agent) throw new Error("completion attribution is missing");
    const subject = input.title.trim();
    if (!subject) throw new Error("completion title is missing");
    if (!existsSync(join(input.worktreePath, ".git"))) return {};
    const index = join(tmpdir(), `jarvis-index-${crypto.randomUUID()}`);
    const gitDirValue = await runGit(input.worktreePath, ["rev-parse", "--git-dir"]);
    const gitDir = isAbsolute(gitDirValue) ? gitDirValue : resolve(input.worktreePath, gitDirValue);
    const pendingPath = join(gitDir, "jarvis-completion-pending.json");
    try {
      let pending: PendingCommit;
      if (existsSync(pendingPath)) {
        pending = JSON.parse(readFileSync(pendingPath, "utf8")) as PendingCommit;
      } else {
        const prepared = await preparePendingCommit(runGit, input, { agent, subject, index, pendingPath });
        if (prepared.kind === "settled") return prepared.result;
        pending = prepared.pending;
      }

      const currentHead = await runGit(input.worktreePath, ["rev-parse", "HEAD"]);
      if (pending.commitSha !== undefined && currentHead === pending.commitSha) {
        await runGit(input.worktreePath, ["reset", "--mixed", pending.commitSha]);
        unlinkSync(pendingPath);
        return {
          commitSha: pending.commitSha,
          filesChanged: await countFilesChanged(runGit, input.worktreePath, `${pending.baseHead}^{tree}`, pending.tree),
        };
      }

      const commit =
        pending.commitSha ??
        (await runGit(
          input.worktreePath,
          ["commit-tree", pending.tree, "-p", pending.baseHead, "-m", pending.message],
          {
            GIT_AUTHOR_DATE: pending.timestamp,
            GIT_COMMITTER_DATE: pending.timestamp,
          },
        ));
      if (pending.commitSha === undefined) {
        pending = { ...pending, commitSha: commit };
        writeFileSync(pendingPath, `${JSON.stringify(pending)}\n`, "utf8");
      }
      await runGit(input.worktreePath, ["update-ref", pending.branchRef, commit, pending.baseHead]);
      await runGit(input.worktreePath, ["reset", "--mixed", commit]);
      unlinkSync(pendingPath);
      return {
        commitSha: commit,
        filesChanged: await countFilesChanged(runGit, input.worktreePath, `${pending.baseHead}^{tree}`, pending.tree),
      };
    } finally {
      try {
        rmSync(index, { force: true });
      } catch {
        /* retry keeps the worktree content */
      }
    }
  };
}
