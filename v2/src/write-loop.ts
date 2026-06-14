import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { loadPromptRegistry } from "../../shared/prompts/registry.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { type OutcomeKind, openStateStore, type RunStatus, type StateStore } from "./state-store.ts";
import type { StepRunResult } from "./step-runner.ts";
import { executeWrite, type WriteExecuteInput } from "./write.ts";

/** Classification of a loop outcome. */
export type WriteLoopOutcomeKind =
  | "complete"
  | "progress"
  | "blocked"
  | "contract_miss"
  | "invocation_failure"
  | "budget-exhausted";

/** Result of a write loop invocation. */
export type WriteLoopResult = {
  kind: WriteLoopOutcomeKind;
  runId: string;
  iterationsConsumed: number;
  resumable: boolean;
};

/** Re-run the project test suite after shrink; test seam defaults to `bun test`. */
export type SuiteRunner = (cwd: string) => boolean;

/** Input for the write loop. Run identity derives from `worktree` (project, branch, base). */
export type WriteLoopInput = WriteExecuteInput & {
  maxIterations?: number;
  stateStore?: StateStore;
  suiteRunner?: SuiteRunner;
};

const DEFAULT_MAX_ITERATIONS = 10;
type StoredRun = NonNullable<ReturnType<StateStore["loadRun"]>>;
type PreparedRun =
  | { runId: string; worktreePath: string; resumedAttemptId: string | null }
  | { result: WriteLoopResult };

/**
 * Execute a resumable write loop: repeatedly call executeWrite until work is
 * done, blocked, or budget runs out, persisting run + per-iteration attempt
 * rows through the state store.
 */
export async function executeWriteLoop(args: WriteLoopInput): Promise<WriteLoopResult> {
  const store = args.stateStore ?? openStateStore();
  const maxIterations = args.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  try {
    const prepared = prepareRun(args, store);
    if ("result" in prepared) return prepared.result;
    const { runId, worktreePath } = prepared;
    let iterationsConsumed = 0;
    let resumedAttemptId = prepared.resumedAttemptId;

    store.setRunStatus(runId, "in-progress");

    while (iterationsConsumed < maxIterations) {
      if (args.signal?.aborted) {
        return { kind: "progress", runId, iterationsConsumed, resumable: true };
      }

      const attemptId = resumedAttemptId ?? store.recordAttemptStart(runId);
      resumedAttemptId = null;
      const { result } = await executeWrite(args);
      iterationsConsumed += 1;

      if (result.kind === "progress") {
        store.commitCompletionBoundary({ attemptId, runStatus: "in-progress", outcomeKind: "progress" });
        continue;
      }

      if (result.kind === "contract_miss") {
        appendBlockerToSpec(resolveSpecPath(worktreePath, args.specPath), result.failedContractId);
      }

      const terminal = terminalMapping(result);
      store.commitCompletionBoundary({ attemptId, runStatus: terminal.runStatus, outcomeKind: terminal.outcomeKind });

      if (terminal.kind !== "complete") {
        return { kind: terminal.kind, runId, iterationsConsumed, resumable: false };
      }

      await runShrinkStep(args, worktreePath);
      return { kind: "complete", runId, iterationsConsumed, resumable: false };
    }

    store.setRunStatus(runId, "budget-soft-stopped");
    return { kind: "budget-exhausted", runId, iterationsConsumed, resumable: true };
  } finally {
    if (!args.stateStore) {
      store.close();
    }
  }
}

function prepareRun(args: WriteLoopInput, store: StateStore): PreparedRun {
  const worktreePath = getExternalWorktreePath(args.worktree);
  const existingRun = store.findRunByProjectBranch({
    project: args.worktree.projectName,
    branch: args.worktree.branchName,
  });

  if (existingRun === null) {
    const runId = store.createRun({
      project: args.worktree.projectName,
      specRef: args.worktree.baseRef,
      worktreePath,
      branch: args.worktree.branchName,
      specPath: args.specPath,
    });
    return { runId, worktreePath, resumedAttemptId: null };
  }

  const lastAttempt = existingRun.attempts[existingRun.attempts.length - 1];
  if (lastAttempt?.status === "in-progress") {
    // Interrupted mid-step: re-run that iteration over the dirty worktree.
    return { runId: existingRun.id, worktreePath, resumedAttemptId: lastAttempt.id };
  }

  const committed = committedResult(existingRun, worktreePath);
  return committed === null ? { runId: existingRun.id, worktreePath, resumedAttemptId: null } : { result: committed };
}

function terminalMapping(result: Exclude<StepRunResult, { kind: "progress" }>): {
  kind: WriteLoopOutcomeKind;
  runStatus: RunStatus;
  outcomeKind: OutcomeKind;
} {
  if (result.kind === "complete") return { kind: "complete", runStatus: "completed", outcomeKind: result.token };
  if (result.kind === "blocked") return { kind: "blocked", runStatus: "blocked", outcomeKind: "blocked" };
  if (result.kind === "contract_miss") {
    return { kind: "contract_miss", runStatus: "blocked", outcomeKind: "contract_miss" };
  }
  return { kind: "invocation_failure", runStatus: "failed", outcomeKind: "invocation_failure" };
}

/** Terminal result already committed by a prior invocation, returned idempotently; null when resumable. */
function committedResult(run: StoredRun, worktreePath: string): WriteLoopResult | null {
  if (run.status === "completed") {
    restoreWorktreeToHead(worktreePath);
    return { kind: "complete", runId: run.id, iterationsConsumed: 0, resumable: false };
  }
  if (run.status === "failed") {
    return { kind: "invocation_failure", runId: run.id, iterationsConsumed: 0, resumable: false };
  }
  if (run.status === "blocked") {
    const lastOutcome = run.attempts[run.attempts.length - 1]?.outcomeKind;
    return {
      kind: lastOutcome === "contract_miss" ? "contract_miss" : "blocked",
      runId: run.id,
      iterationsConsumed: 0,
      resumable: false,
    };
  }
  return null; // in-progress or budget-soft-stopped: resume
}

/**
 * One post-complete shrink invocation outside the iteration budget. Commits the
 * complete boundary first; discard-on-miss restores to that commit without
 * changing run status.
 */
async function runShrinkStep(args: WriteLoopInput, worktreePath: string): Promise<void> {
  gitCommitAll(worktreePath, "jarvis: complete boundary");

  const baseRef = args.worktree.baseRef;
  if (!gitDiffExists(worktreePath, baseRef)) return;

  const preShrinkHead = gitHead(worktreePath);
  const diffBase = gitDiffBase(worktreePath, baseRef);
  const shrinkRules = loadShrinkStepRules(diffBase);

  const { result } = await executeWrite({ ...args, stepRules: shrinkRules });

  if (!isShrinkSuccess(result, args, worktreePath, preShrinkHead)) {
    gitRestoreHead(worktreePath, preShrinkHead);
  }
}

function isShrinkSuccess(
  result: StepRunResult,
  args: WriteLoopInput,
  worktreePath: string,
  preShrinkHead: string,
): boolean {
  if (result.kind !== "complete") return false;

  const suiteRunner = args.suiteRunner ?? defaultSuiteRunner;
  if (!suiteRunner(worktreePath)) return false;
  if (shrinkDiffDeletesTestFiles(worktreePath, preShrinkHead)) return false;

  return true;
}

/** Load `write.shrink` and inject the run-start base ref for `base..HEAD` scope. */
export function loadShrinkStepRules(baseRef: string): string {
  const shrinkBody = loadPromptRegistry().getById("write.shrink").body;
  return shrinkBody.replaceAll("<BASE_REF>", baseRef).trim();
}

function defaultSuiteRunner(projectRoot: string): boolean {
  try {
    execFileSync("bun", ["test"], { cwd: projectRoot, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function gitDiffBase(cwd: string, baseRef: string): string {
  return execFileSync("git", ["merge-base", baseRef, "HEAD"], { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function gitDiffExists(cwd: string, baseRef: string): boolean {
  const diffBase = gitDiffBase(cwd, baseRef);
  try {
    execFileSync("git", ["diff", "--quiet", diffBase, "HEAD"], { cwd, stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}

function gitCommitAll(cwd: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });
  const status = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8", stdio: "pipe" });
  if (status.trim().length === 0) return;
  execFileSync("git", ["commit", "-m", message], { cwd, stdio: "pipe" });
}

function gitHead(cwd: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function gitRestoreHead(cwd: string, head: string): void {
  execFileSync("git", ["reset", "--hard", head], { cwd, stdio: "pipe" });
  execFileSync("git", ["clean", "-fd"], { cwd, stdio: "pipe" });
}

function restoreWorktreeToHead(worktreePath: string): void {
  if (!existsSync(worktreePath)) return;
  try {
    gitRestoreHead(worktreePath, gitHead(worktreePath));
  } catch {
    // Missing or invalid worktree — nothing to reset.
  }
}

function shrinkDiffDeletesTestFiles(cwd: string, preShrinkHead: string): boolean {
  const output = execFileSync("git", ["diff", "--name-status", preShrinkHead], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  for (const line of output.split("\n")) {
    const match = /^D\t(.+)$/.exec(line.trim());
    if (match?.[1] !== undefined && isTestFile(match[1])) return true;
  }
  return false;
}

function isTestFile(path: string): boolean {
  return path.endsWith(".test.ts") || path.endsWith(".test.tsx");
}

function resolveSpecPath(worktreePath: string, specPath: string): string {
  return isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
}

function appendBlockerToSpec(specPath: string, failedContractId: string): void {
  appendFileSync(specPath, `\n## Blocker\n\nArtifact contract check failed: ${failedContractId}\n`, "utf8");
}
