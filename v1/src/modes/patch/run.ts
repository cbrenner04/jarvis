import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Io } from "../../cli.ts";
import {
  type AgentName,
  type ConfigOptions,
} from "../../config.ts";
import type { LogClient } from "../../logging.ts";
import type { Agent } from "../../agents/types.ts";
import { type DisambiguateFn, runSharedPreflight, type SharedPreflightOpts } from "../shared-entry.ts";
import {
  buildActiveAgents,
  maybeWarnAboutUnmergedPlanBranch,
  prepareActiveSpecPath,
  resolveModeSpecificPreflight,
} from "./preflight.ts";
import {
  type CompletionReadyGateResult,
} from "./completion-pipeline.ts";
import {
  finalize,
  setupLogging,
  runIteration,
  type IterationContext,
} from "./iteration.ts";
import { DescendantTracker } from "./reap.ts";

// Re-export externally-consumed symbols
export { maybeWarnAboutUnmergedPlanBranch, prepareActiveSpecPath };
export type { IterationContext, PreflightOk } from "./iteration.ts";

export type RunIo = Io;

export type ConfirmRun = (prompt: string) => string | Promise<string>;

export type RunCommandOptions = {
  specPath: string;
  io: RunIo;
  config?: ConfigOptions;
  agents?: Partial<Record<AgentName, Agent>>;
  logClient?: LogClient;
  confirmRun?: ConfirmRun;
  handleSignals?: boolean;
  skipGhCheck?: boolean;
  /** Value of the `--repo` CLI flag, if given. */
  repoFlag?: string;
  /** Value of the `--cwd` CLI flag, if given. Only valid when effective `git` is false. */
  cwdFlag?: string;
  /** Override the disambiguation prompt (for tests). */
  disambiguate?: DisambiguateFn;
  /** Value of the `--review-passes` CLI flag, if given. */
  reviewPasses?: number;
  /** True if `--resume-review` was passed; runs review on an already-complete spec. */
  resumeReview?: boolean;
  /**
   * Test seam for the completion `ready` gate. Replaces the real `bun run
   * ready` + `check:fix` commit run in `runCompletionReadyGate`. Return
   * `{ kind: "green" }` to proceed into the post-completion phases, or
   * `{ kind: "red", failureText }` to drive the loop-back fix-up iteration.
   * Production callers must not set this.
   */
  runCompletionReadyGate?: (cwd: string) => CompletionReadyGateResult;
  /**
   * Test-only override for the watchdog/abort SIGKILL grace period in
   * milliseconds. Lets timing tests bound their wall-clock cost without
   * waiting the full 5s grace for SIGTERM-ignoring grandchildren. Defaults
   * to 5000ms; production callers must not set this.
   */
  __testKillGraceMs?: number;
  /**
   * Test-only override for the orphan-reap entry point. Lets an induced reap
   * failure be injected deterministically to prove the run's exit code is
   * unaffected. Production callers must not set this.
   */
  __testReapFn?: () => void;
};

export async function runCommand(opts: RunCommandOptions): Promise<number> {
  const runStartedAt = new Date();
  const runStartedMs = Date.now();
  const initialSpecPath = resolve(opts.specPath);
  if (!existsSync(initialSpecPath)) {
    opts.io.stderr(`spec path does not exist: ${initialSpecPath}\n`);
    return 1;
  }

  // Run shared preflight (target-repo resolution and log-server reachability)
  const sharedPreflightOpts: SharedPreflightOpts = {
    specPath: initialSpecPath,
    io: opts.io,
  };
  if (opts.repoFlag !== undefined) {
    sharedPreflightOpts.repoFlag = opts.repoFlag;
  }
  if (opts.config !== undefined) {
    sharedPreflightOpts.config = opts.config;
  }
  if (opts.disambiguate !== undefined) {
    sharedPreflightOpts.disambiguate = opts.disambiguate;
  }
  if (opts.logClient !== undefined) {
    sharedPreflightOpts.logClient = opts.logClient;
  }

  const sharedPreflight = await runSharedPreflight(sharedPreflightOpts);

  if (sharedPreflight.kind === "error") {
    return sharedPreflight.exitCode;
  }

  // Run mode-specific preflight (worktree, git, spec prep, etc.)
  const preflight = await resolveModeSpecificPreflight(
    opts,
    initialSpecPath,
    sharedPreflight.project,
    sharedPreflight.projectMode,
    sharedPreflight.cfg,
  );
  if (preflight.kind === "error") {
    return preflight.exitCode;
  }
  if (preflight.kind === "exit") {
    return preflight.exitCode;
  }

  const activeAgents = buildActiveAgents(opts, preflight.cfg);

  const loggingSetup = setupLogging(opts, preflight, sharedPreflight.logClient);
  const logging = loggingSetup;
  let runExitReason = "error";

  // Tracks agent descendant PIDs across iterations so orphans that escape the
  // process group can be reaped at iteration end and at finalize.
  const descendantTracker = new DescendantTracker();

  const state: IterationContext["state"] = {
    iteration: 1,
    latestIterationStdout: [],
    latestIterationStderr: [],
    draftPrEnsured: false,
    opencodeUnavailableNoted: false,
    cursorUnavailableNoted: false,
    currentController: null,
    completionLoopbackSignal: null,
    previousCompletionFailureText: null,
  };

  const onSigint = () => {
    logging.writeSessionLine("harness", "interrupted");
    opts.io.stderr("interrupted\n");
    if (state.currentController) {
      state.currentController.abort("sigint");
    } else {
      process.exit(130);
    }
  };
  if (opts.handleSignals !== false) {
    process.once("SIGINT", onSigint);
  }

  let globalTimeoutHandle: NodeJS.Timeout | null = null;
  if (preflight.cfg.runTimeoutMs !== undefined) {
    globalTimeoutHandle = setTimeout(() => {
      if (state.currentController) {
        state.currentController.abort("run-timeout");
      }
    }, preflight.cfg.runTimeoutMs);
  }

  const ctx: IterationContext = {
    preflight,
    logging,
    opts,
    activeAgents,
    descendantTracker,
    state,
  };

  try {
    while (true) {
      const outcome = await runIteration(ctx);
      if (outcome.kind === "return") {
        runExitReason = mapExitCodeToReason(outcome.exitCode);
        return outcome.exitCode;
      }
      if (outcome.kind === "exit") {
        runExitReason = mapExitCodeToReason(outcome.exitCode);
        process.exit(outcome.exitCode);
      }
      // continue
    }
  } finally {
    finalize(ctx, globalTimeoutHandle, onSigint, runStartedAt, runStartedMs, runExitReason);
  }
}

function mapExitCodeToReason(exitCode: number): string {
  switch (exitCode) {
    case 0:
      return "criteria-complete";
    case 1:
      return "error";
    case 2:
      return "quota-exhausted";
    case 3:
      return "agent-error";
    case 4:
      return "no-progress";
    case 5:
      return "max-iterations";
    case 6:
      return "dirty-worktree";
    case 7:
      return "blocked";
    case 8:
      return "timeout";
    case 9:
      return "worktree-locked";
    case 10:
      return "ready-stuck-red";
    case 130:
      return "sigint";
    default:
      return `exit-${exitCode}`;
  }
}
