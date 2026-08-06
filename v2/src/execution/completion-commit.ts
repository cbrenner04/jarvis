import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { DEFAULT_ITERATION_TIMEOUT_MS } from "../config/machine-config-loader.ts";
import {
  clearUnrestoredDirectives,
  describeStrandedMutation,
  isStrandedMutationContent,
  loadUnrestoredDirectives,
  type MutateDirective,
} from "./mutation-checkpoint-verifier.ts";
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
  /** Formatter wall-clock budget; callers pass write-loop `iterationTimeoutMs` when known. */
  iterationTimeoutMs?: number;
  /** Test seam: verify-run unrestored directives; when absent, loaded from git state. */
  unrestoredDirectives?: readonly MutateDirective[];
};
export type CompletionCommitResult = { commitSha?: string; filesChanged?: number };
export type CompletionCommitter = (input: CompletionCommitInput) => Promise<CompletionCommitResult>;
type Git = (cwd: string, args: readonly string[], env?: Record<string, string>) => Promise<string>;

type CompletionFormatOpts = {
  cwd: string;
  paths: readonly string[];
  timeoutMs: number;
};

function pathFromPorcelainLine(line: string): string | undefined {
  if (line.endsWith("\r")) line = line.slice(0, -1);
  if (line.length < 2) return undefined;
  let path: string;
  if (line.length >= 3 && line[2] === " ") {
    path = line.slice(3);
  } else if (line[1] === " ") {
    path = line.slice(2);
  } else {
    return undefined;
  }
  const arrow = path.indexOf(" -> ");
  if (arrow >= 0) path = path.slice(arrow + 4);
  return path.length > 0 ? path : undefined;
}

/** Scoped format-only pass on enumerated changed paths; distinct from ready-gate `fixCommand` autofix. */
async function runCompletionFormat(
  opts: CompletionFormatOpts,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<void> {
  if (opts.paths.length === 0) return;
  if (!existsSync(join(opts.cwd, "biome.json"))) return;
  const displayCmd = `bun biome check --write ${opts.paths.join(" ")}`;
  try {
    await runner.runAsync("bun", ["biome", "check", "--write", ...opts.paths], opts.cwd, {
      timeoutMs: opts.timeoutMs,
      env: process.env,
    });
  } catch (err) {
    if (err instanceof AsyncSubprocessError && err.code === "ETIMEDOUT") {
      throw new Error(`${displayCmd} exceeded ${opts.timeoutMs}ms budget`);
    }
    const captured =
      err instanceof AsyncSubprocessError
        ? [err.stdout, err.stderr].filter(Boolean).join("\n").trim()
        : err instanceof Error
          ? err.message
          : String(err);
    throw new Error(captured ? `${displayCmd} failed:\n${captured}` : `${displayCmd} failed`);
  }
}

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

async function readGitBlob(runGit: Git, cwd: string, object: string, env?: Record<string, string>): Promise<string> {
  try {
    return await runGit(cwd, ["show", object], env);
  } catch {
    return "";
  }
}

/** Refuse completion when verify-run directives survive in staged-tree or committed content. */
export async function refuseStrandedMutationsInTrees(
  runGit: Git,
  worktreePath: string,
  stagedTree: string,
  head: string,
  unrestored: readonly MutateDirective[],
): Promise<void> {
  for (const directive of unrestored) {
    const staged = await readGitBlob(runGit, worktreePath, `${stagedTree}:${directive.targetPath}`);
    if (isStrandedMutationContent(staged, directive)) {
      throw new Error(describeStrandedMutation(directive));
    }
    const headContent = await readGitBlob(runGit, worktreePath, `${head}:${directive.targetPath}`);
    if (isStrandedMutationContent(headContent, directive)) {
      throw new Error(describeStrandedMutation(directive));
    }
  }
}

/** Refuse completion when verify-run directives survive in the temp index or committed content. */
export async function refuseStrandedMutationsBeforeCommit(
  runGit: Git,
  worktreePath: string,
  index: string,
  head: string,
  unrestored: readonly MutateDirective[],
): Promise<void> {
  const stagedTree = await runGit(worktreePath, ["write-tree"], { GIT_INDEX_FILE: index });
  await refuseStrandedMutationsInTrees(runGit, worktreePath, stagedTree, head, unrestored);
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
  subprocessRunner: AsyncSubprocessRunner,
  ctx: { agent: string; subject: string; index: string; pendingPath: string },
): Promise<{ kind: "pending"; pending: PendingCommit } | { kind: "settled"; result: CompletionCommitResult }> {
  const { agent, subject, index, pendingPath } = ctx;
  const raw = await runGit(input.worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
  const changedPaths: string[] = [];
  if (raw) {
    const lines = raw.split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const line of lines) {
      const path = pathFromPorcelainLine(line);
      if (path !== undefined) changedPaths.push(path);
    }
  }
  const timeoutMs = input.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS;
  await runCompletionFormat({ cwd: input.worktreePath, paths: changedPaths, timeoutMs }, subprocessRunner);
  const head = await runGit(input.worktreePath, ["rev-parse", "HEAD"]);
  await runGit(input.worktreePath, ["read-tree", head], { GIT_INDEX_FILE: index });
  await runGit(input.worktreePath, ["add", "-A"], { GIT_INDEX_FILE: index });
  await refuseStrandedMutationsBeforeCommit(
    runGit,
    input.worktreePath,
    index,
    head,
    input.unrestoredDirectives !== undefined
      ? [...input.unrestoredDirectives]
      : loadUnrestoredDirectives(input.worktreePath),
  );
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
export function createCompletionCommitter(
  runGit: Git = git,
  subprocessRunner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): CompletionCommitter {
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
      const unrestored =
        input.unrestoredDirectives !== undefined
          ? [...input.unrestoredDirectives]
          : loadUnrestoredDirectives(input.worktreePath);
      let pending: PendingCommit;
      if (existsSync(pendingPath)) {
        pending = JSON.parse(readFileSync(pendingPath, "utf8")) as PendingCommit;
        await refuseStrandedMutationsInTrees(runGit, input.worktreePath, pending.tree, pending.baseHead, unrestored);
      } else {
        const prepared = await preparePendingCommit(runGit, input, subprocessRunner, {
          agent,
          subject,
          index,
          pendingPath,
        });
        if (prepared.kind === "settled") return prepared.result;
        pending = prepared.pending;
      }

      const currentHead = await runGit(input.worktreePath, ["rev-parse", "HEAD"]);
      if (pending.commitSha !== undefined && currentHead === pending.commitSha) {
        await runGit(input.worktreePath, ["reset", "--mixed", pending.commitSha]);
        unlinkSync(pendingPath);
        clearUnrestoredDirectives(input.worktreePath);
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
      clearUnrestoredDirectives(input.worktreePath);
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
