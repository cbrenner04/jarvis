import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getGitStatusInventory } from "../../../shared/git.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { DEFAULT_ITERATION_TIMEOUT_MS } from "../config/machine-config-loader.ts";
import { isMaterializedNodeModulesPath, MATERIALIZED_NODE_MODULES_PATH } from "./external-worktree.ts";
import { normalizePublicationSpecPath } from "./publication-spec-path.ts";

/** Workflow purpose classification rendered as the `Jarvis-Step` trailer. Defaults to `write`
 * when the caller omits it; a pass number is a positive decimal (review cycle count). */
export type CompletionStepMetadata =
  | { kind: "write" }
  | { kind: "review"; pass: number }
  | { kind: "review-debate"; pass: number }
  | { kind: "mutation-repair" }
  | { kind: "ready-gate" };

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
  /** `checkpoint` runs best-effort scoped `biome format --write`; default `strict` fail-closes on `biome check --write`. */
  formatMode?: "checkpoint" | "strict";
  /** Workflow step for the `Jarvis-Step` trailer; defaults to `write`. Only consulted while
   * preparing a new pending commit — a retry of an already-prepared pending commit ignores
   * this and keeps the stored message's own step classification. */
  step?: CompletionStepMetadata;
};
export type CompletionCommitResult = { commitSha?: string; filesChanged?: number };
export type CompletionCommitter = (input: CompletionCommitInput) => Promise<CompletionCommitResult>;
type Git = (cwd: string, args: readonly string[], env?: Record<string, string>) => Promise<string>;

type CompletionFormatOpts = {
  cwd: string;
  paths: readonly string[];
  timeoutMs: number;
};

/** Biome only processes a fixed set of extensions. A changed set that is markdown-only or
 * deletion-only yields no eligible files, and `biome check` would exit non-zero ("No files
 * were processed") — that is a skip, not a completion-commit failure. */
const BIOME_FORMATTABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
]);

function biomeEligiblePaths(cwd: string, paths: readonly string[]): string[] {
  return paths.filter((path) => {
    const dot = path.lastIndexOf(".");
    if (dot < 0) return false;
    if (!BIOME_FORMATTABLE_EXTENSIONS.has(path.slice(dot).toLowerCase())) return false;
    return existsSync(join(cwd, path));
  });
}

/** Scoped format-only pass on enumerated changed paths; distinct from ready-gate `fixCommand` autofix. */
async function runCompletionFormat(
  opts: CompletionFormatOpts,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<void> {
  if (!existsSync(join(opts.cwd, "biome.json"))) return;
  const eligible = biomeEligiblePaths(opts.cwd, opts.paths);
  if (eligible.length === 0) return;
  const displayCmd = `bun biome check --write ${eligible.join(" ")}`;
  try {
    await runner.runAsync("bun", ["biome", "check", "--write", ...eligible], opts.cwd, {
      timeoutMs: opts.timeoutMs,
      env: process.env,
    });
  } catch (err) {
    if (err instanceof AsyncSubprocessError && err.code === "ETIMEDOUT") {
      throw new Error(`${displayCmd} exceeded ${opts.timeoutMs}ms budget`);
    }
    // Best-effort, like the checkpoint format pass: `biome check --write` applies every safe fix, but a
    // non-autofixable finding (cognitive-complexity, non-null assertion) exits non-zero. A durability
    // commit is never gated by lint — the completion commit takes the autofixed tree as-is, and the
    // ready gate + CI remain the lint enforcers (with bounded repair). This stops the recurring
    // `completion_commit_failed`-on-lint strand that left correct, complete work uncommitted.
    // A genuine timeout still throws above (a hang is not a lint result).
  }
}

/** Scoped format-only pass on enumerated changed paths; checkpoint durability never gates on failure. */
async function runCheckpointFormat(
  opts: CompletionFormatOpts,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<void> {
  if (!existsSync(join(opts.cwd, "biome.json"))) return;
  const eligible = biomeEligiblePaths(opts.cwd, opts.paths);
  if (eligible.length === 0) return;
  try {
    await runner.runAsync("bun", ["biome", "format", "--write", ...eligible], opts.cwd, {
      timeoutMs: opts.timeoutMs,
      env: process.env,
    });
  } catch {
    /* best-effort: non-zero exit or timeout never blocks checkpoint commit */
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
  formatMode?: "checkpoint" | "strict";
};

function renderJarvisStepTrailer(step: CompletionStepMetadata): string {
  switch (step.kind) {
    case "write":
      return "Jarvis-Step: write";
    case "review":
      return `Jarvis-Step: review ${step.pass}`;
    case "review-debate":
      return `Jarvis-Step: review-debate ${step.pass}`;
    case "mutation-repair":
      return "Jarvis-Step: mutation-repair";
    case "ready-gate":
      return "Jarvis-Step: ready-gate";
  }
}

/** Commit subject prefix matching `step`'s `Jarvis-Step` trailer; a write step keeps the bare title. */
export function renderStepCommitTitle(step: CompletionStepMetadata, title: string): string {
  switch (step.kind) {
    case "write":
      return title;
    case "review":
      return `review(${step.pass}): ${title}`;
    case "review-debate":
      return `review-debate(${step.pass}): ${title}`;
    case "mutation-repair":
      return `mutation-repair: ${title}`;
    case "ready-gate":
      return `ready-gate: ${title}`;
  }
}

const JARVIS_STEP_TRAILER_PRESENT = /^Jarvis-Step: /m;

/** Legacy pending messages predate the `Jarvis-Step` trailer. Upgrade them once by appending
 * `Jarvis-Step: write`; a message that already carries any `Jarvis-Step` trailer is a prepared
 * message and is authoritative on retry — it is returned untouched, never re-rendered from
 * retry-time input. */
function upgradeLegacyPendingStepTrailer(pending: PendingCommit, pendingPath: string): PendingCommit {
  if (JARVIS_STEP_TRAILER_PRESENT.test(pending.message)) return pending;
  // Single newline joins the existing trailer paragraph, same as a freshly prepared message.
  const upgraded: PendingCommit = { ...pending, message: `${pending.message}\nJarvis-Step: write` };
  writeFileSync(pendingPath, `${JSON.stringify(upgraded)}\n`, "utf8");
  return upgraded;
}

function git(cwd: string, args: readonly string[], env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(args.includes("-z") ? stdout : stdout.trim());
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

const ADD_ALL_ARGS = ["add", "-A"] as const;
// Excludes the harness-materialized node_modules symlink from `add -A`, never `git rm --cached`
// an already-tracked entry: narrowing the stage pathspec can't turn a poisoned repo's next
// commit into an unrequested deletion. The trailing character is wrapped in a `[…]` class (not
// spelled as a literal) so git classifies the pathspec element as a glob — a literal excluded
// path that also matches `.gitignore` hard-fails `add -A` ("paths are ignored"; a target repo
// that already gitignores node_modules would otherwise break every completion commit). Only the
// bare-entry pattern is needed: this list is appended only when the path is a symlink, and git
// never descends into a symlink to stage its target's contents.
const NODE_MODULES_GLOB = `${MATERIALIZED_NODE_MODULES_PATH.slice(0, -1)}[${MATERIALIZED_NODE_MODULES_PATH.slice(-1)}]`;
const EXCLUDE_MATERIALIZED_NODE_MODULES = ["--", ".", `:(exclude)${NODE_MODULES_GLOB}`] as const;

/** `git add -A` pathspec for a completion commit; excludes the materialized node_modules
 * symlink when present so no harness completion commit ever stages it. */
export function completionStageArgs(worktreePath: string): string[] {
  if (!isMaterializedNodeModulesPath(worktreePath, MATERIALIZED_NODE_MODULES_PATH)) return [...ADD_ALL_ARGS];
  return [...ADD_ALL_ARGS, ...EXCLUDE_MATERIALIZED_NODE_MODULES];
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
  const inventory = await getGitStatusInventory(input.worktreePath, {
    async runAsync(command, args, cwd) {
      if (command !== "git") throw new Error(`Unsupported completion inventory command: ${command}`);
      return runGit(cwd, args);
    },
  });
  const changedPaths = inventory.map((entry) => entry.currentPath);
  const timeoutMs = input.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS;
  const formatMode = input.formatMode ?? "strict";
  if (formatMode === "checkpoint") {
    await runCheckpointFormat({ cwd: input.worktreePath, paths: changedPaths, timeoutMs }, subprocessRunner);
  } else {
    await runCompletionFormat({ cwd: input.worktreePath, paths: changedPaths, timeoutMs }, subprocessRunner);
  }
  const head = await runGit(input.worktreePath, ["rev-parse", "HEAD"]);
  await runGit(input.worktreePath, ["read-tree", head], { GIT_INDEX_FILE: index });
  await runGit(input.worktreePath, completionStageArgs(input.worktreePath), { GIT_INDEX_FILE: index });
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
  const step = input.step ?? { kind: "write" as const };
  const pending: PendingCommit = {
    baseHead: head,
    tree,
    branchRef: await runGit(input.worktreePath, ["symbolic-ref", "HEAD"]),
    // Jarvis-Step joins the same trailer paragraph as Jarvis-Agent (single newline, no blank
    // line) — git's `%(trailers:...)` only recognizes the message's final contiguous paragraph
    // as the trailer block, so a blank line here would hide Jarvis-Agent from attribution.
    message: `${subject}\n\nSpec: ${normalizePublicationSpecPath(input.worktreePath, input.specPath)}\n\nJarvis-Agent: ${agent}${
      input.readyGateAttribution === "autofix" ? "\n\nJarvis-Ready-Gate: autofix" : ""
    }\n${renderJarvisStepTrailer(step)}`,
    agent,
    timestamp: new Date().toISOString(),
    formatMode,
  };
  writeFileSync(pendingPath, `${JSON.stringify(pending)}\n`, "utf8");
  return { kind: "pending", pending };
}

async function restagePendingTreeAfterStrictFormat(
  runGit: Git,
  input: CompletionCommitInput,
  subprocessRunner: AsyncSubprocessRunner,
  index: string,
  pending: PendingCommit,
  pendingPath: string,
): Promise<PendingCommit> {
  const inventory = await getGitStatusInventory(input.worktreePath, {
    async runAsync(command, args, cwd) {
      if (command !== "git") throw new Error(`Unsupported completion inventory command: ${command}`);
      return runGit(cwd, args);
    },
  });
  const changedPaths = inventory.map((entry) => entry.currentPath);
  const timeoutMs = input.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS;
  await runCompletionFormat({ cwd: input.worktreePath, paths: changedPaths, timeoutMs }, subprocessRunner);
  const head = await runGit(input.worktreePath, ["rev-parse", "HEAD"]);
  await runGit(input.worktreePath, ["read-tree", head], { GIT_INDEX_FILE: index });
  await runGit(input.worktreePath, completionStageArgs(input.worktreePath), { GIT_INDEX_FILE: index });
  const tree = await runGit(input.worktreePath, ["write-tree"], { GIT_INDEX_FILE: index });
  // Drop any checkpoint-stage commitSha so the strict boundary re-commits the re-formatted tree
  // instead of reusing the stale checkpoint-tree commit object.
  const { commitSha: _priorCheckpointSha, ...pendingWithoutSha } = pending;
  const upgraded: PendingCommit = { ...pendingWithoutSha, tree, formatMode: "strict" };
  writeFileSync(pendingPath, `${JSON.stringify(upgraded)}\n`, "utf8");
  return upgraded;
}

/** Captures and publishes one completion snapshot; hooks are bypassed by design. */
export function createCompletionCommitter(
  runGit: Git = git,
  subprocessRunner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): CompletionCommitter {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one committer closure coordinates snapshot capture, checkpoint-vs-strict format-mode selection, staging, and the compare-and-swap commit; off-by-one (25) after adding the durability best-effort-format branch, and splitting it would fragment the atomic commit sequence.
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
        pending = upgradeLegacyPendingStepTrailer(
          JSON.parse(readFileSync(pendingPath, "utf8")) as PendingCommit,
          pendingPath,
        );
        const requestedFormatMode = input.formatMode ?? "strict";
        if (pending.formatMode === "checkpoint" && requestedFormatMode === "strict") {
          pending = await restagePendingTreeAfterStrictFormat(
            runGit,
            input,
            subprocessRunner,
            index,
            pending,
            pendingPath,
          );
        }
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
