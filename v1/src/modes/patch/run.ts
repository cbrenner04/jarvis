import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { PatchTier } from "../../../../shared/spec-parser.ts";
import type { Agent } from "../../agents/types.ts";
import type { Io } from "../../cli.ts";
import type { AgentEntry, AgentName, Config, ConfigOptions, ProjectMatch } from "../../config.ts";
import type { LogClient } from "../../logging.ts";
import type {
  CostSource,
  PatchTelemetryPhase,
  TelemetryKind,
  TelemetryRecordRole,
  UsageSource,
} from "../../telemetry.ts";
import { type DisambiguateFn, runSharedPreflight, type SharedPreflightOpts } from "../shared-entry.ts";
import { runBaseRefTests as runBaseRefTestsImpl } from "./base-ref-test-runner.ts";
import { finalize, runIteration, setupLogging } from "./iteration.ts";
import type { DeltaRecord } from "./no-commit-delta.ts";
import { warnAboutPoolContentionIfDetected } from "./pool-contention.ts";
import {
  buildActiveAgents,
  maybeWarnAboutUnmergedPlanBranch,
  prepareActiveSpecPath,
  resolveModeSpecificPreflight,
} from "./preflight.ts";
import { DescendantTracker, type ProcInfo } from "./reap.ts";
import { runSnapshotUpdateRetest as runSnapshotUpdateRetestImpl } from "./snapshot-update-retest-runner.ts";

export type PreflightOk = {
  kind: "ok";
  project: ProjectMatch;
  projectMode: "registered" | "ad-hoc";
  cfg: Config;
  /** Pre-override config for review/shrink sub-role resolution when `agentOrderOverride` is set. */
  subRoleResolutionCfg: Config;
  gitEnabled: boolean;
  agentWorkingDir: string;
  worktreeLocked: boolean;
  stalepidRecovered: number | undefined;
  specPath: string;
  additionalReadDirs: string[] | undefined;
  patchTier: PatchTier;
  trackSourceSpecDelta: boolean;
  specIsExternal: boolean;
};

export type CompletionReadyGateResult =
  | { kind: "green" }
  | { kind: "red"; failureText: string; retryable?: boolean; verificationRed?: boolean };

type LogTag = "harness" | "outbound" | "inbound_stdout" | "inbound_stderr";
type LogStream = "stdout" | "stderr" | null;
type LogAnnotations = Record<string, string | number | boolean | null>;

type Fanout = (tag: LogTag, text: string, stream: LogStream, annotations?: LogAnnotations) => void;

export type SendLog = (tag: LogTag, text: string, annotations?: LogAnnotations) => void;

type WriteSessionLine = (tag: LogTag, line: string) => void;

type WriteTelemetry = (record: {
  agent: string;
  iteration: number;
  durationMs: number;
  kind: TelemetryKind;
  exitReason: string;
  record_role?: TelemetryRecordRole;
  configured_model?: string;
  patch_phase?: PatchTelemetryPhase;
  usage?: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
  usage_source?: UsageSource;
  cost_usd?: number | null;
  cost_source?: CostSource;
  warnings?: string[];
  watchdog_pgid?: number;
  last_output_age_ms?: number | null;
  last_file_activity_age_ms?: number | null;
  watchdog_descendants_alive?: boolean;
  active_subspec_path?: string;
}) => void;

export type LoggingContext = {
  fanout: Fanout;
  sendLog: SendLog;
  writeSessionLine: WriteSessionLine;
  writeTelemetry: WriteTelemetry;
  sessionFd: number;
  logClient: LogClient;
  runNamespace: string;
  specDisplayName: string;
  hasTelemetryWrites: () => boolean;
  hasRunTerminalRecord: () => boolean;
  patchIterationsCompletedForSummary: () => number;
  priorIterationTimeouts: number;
  activeSubspecPath: string | undefined;
  implementationTouchedFiles: Set<string>;
};

export type IterationContext = {
  preflight: PreflightOk;
  logging: LoggingContext;
  opts: RunCommandOptions;
  activeAgents: Agent[];
  descendantTracker: DescendantTracker;
  state: {
    iteration: number;
    latestIterationStdout: string[];
    latestIterationStderr: string[];
    draftPrEnsured: boolean;
    opencodeUnavailableNoted: boolean;
    cursorUnavailableNoted: boolean;
    currentController: AbortController | null;
    completionLoopbackSignal: { failureText: string } | null;
    previousCompletionFailureText: string | null;
    consecutiveRedFixups: number;
    acProgressSinceLastGate: boolean;
    firstRedBaselineSha?: string;
    completionTransitionReadyResult?: {
      headSha: string;
    };
    consecutiveEditedUnticked: number;
    consecutiveEditedUntickedSubspecPath: string | null;
    consecutiveBlockerClaimRejections: number;
    consecutiveBlockerClaimRejectionsSubspecPath: string | null;
    noCommitDelta: DeltaRecord | null;
    noCommitResetAppliedThisRun: boolean;
    runStartHead: string | null;
  };
};

export type IterationOutcome =
  | { kind: "continue" }
  | { kind: "return"; exitCode: number }
  | { kind: "exit"; exitCode: number };
// Re-export externally-consumed symbols
export { maybeWarnAboutUnmergedPlanBranch, prepareActiveSpecPath };

export type RunIo = Io;

export type ConfirmRun = (prompt: string) => string | Promise<string>;

/** Test-only seam for patch preflight `.active-spec-path` marker writes. */
export type WriteActiveSpecPathMarkerFn = (worktreeDir: string, activeSpecPath: string) => void;

/** Test/production seam for patch-watchdog descendant snapshots at timeout fire. */
export type WatchdogListProcessesFn = (rootPid: number) => ProcInfo[];

/** Timer handle shape used only by the patch-iteration watchdog timing test seam. */
export type PatchWatchdogTimerHandle = {
  unref?: () => void;
};

/**
 * Test-only patch-iteration watchdog clock/scheduler seam.
 * Limited to iteration-timeout scheduling and the paired last-output age
 * measurement on the patch run path; production callers must not set it.
 */
export type PatchWatchdogTiming = {
  /** Returns the current patch-watchdog timestamp in milliseconds. */
  nowMs: () => number;
  /** Schedules the patch iteration-timeout callback on the injected clock. */
  setTimeout: (callback: () => void, delayMs: number) => PatchWatchdogTimerHandle;
  /** Cancels a timer created by this seam's `setTimeout`. */
  clearTimeout: (handle: PatchWatchdogTimerHandle) => void;
};

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
  /** One-run patch ladder override from `jarvis1 run --tier`. */
  tierOverride?: PatchTier;
  /** One-run patch implementation ladder from repeatable `jarvis1 run --agent`. */
  agentOrderOverride?: AgentEntry[];
  /**
   * Test seam for the completion `ready` gate. Replaces the real fix → commit-if-dirty →
   * `bun run ready` sequence in `runCompletionReadyGate`. Return
   * `{ kind: "green" }` to proceed into the post-completion phases, or
   * `{ kind: "red", failureText }` to drive the loop-back fix-up iteration if
   * every bounded retry stays red. The seam may be invoked up to the retry
   * bound per completion-gate check. Production callers must not set this.
   */
  runCompletionReadyGate?: (cwd: string) => CompletionReadyGateResult;
  /**
   * Test/production seam for base-ref blocker-claim validation.
   * When a blocker body contains pre-existing-failure language,
   * runBaseRefTests is invoked with the base ref name.
   * Returns true if base-ref tests are green (cited failures don't reproduce),
   * false if red or validation fails. Default when absent = fail-safe (blocker stands).
   */
  runBaseRefTests?: (baseRef: string) => Promise<boolean>;
  /**
   * Test/production seam for snapshot-update re-test blocker-claim rejection.
   * When a claim blocker is not rejected by base-ref validation,
   * runSnapshotUpdateRetest is invoked to run an update-snapshots pass and re-test.
   * Returns true if re-test is green (failures were outdated snapshots),
   * false if red or validation fails. Default when absent = fail-safe (blocker stands).
   */
  runSnapshotUpdateRetest?: () => Promise<boolean>;
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
  /**
   * Test-only override for patch preflight `.active-spec-path` marker writes.
   * Production callers must not set this.
   */
  __testWriteActiveSpecPathMarker?: WriteActiveSpecPathMarkerFn;
  /**
   * Test-only override for the watchdog descendant-liveness process-table snapshot.
   * When set, the watchdog uses this injected listProcesses instead of reading the real OS table.
   * Production callers must not set this.
   */
  __testWatchdogListProcesses?: WatchdogListProcessesFn;
  /**
   * Test-only override for patch-iteration watchdog time. Replaces the
   * iteration-timeout scheduler plus the observed-output/output-age clock with
   * one caller-owned source so patch watchdog timing tests can advance both
   * deterministically through the real stdout/stderr observation path.
   * Production callers must not set this.
   */
  __testPatchWatchdogTiming?: PatchWatchdogTiming;
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

  const subRoleResolutionCfg = sharedPreflight.cfg;
  let runCfg = sharedPreflight.cfg;
  if (opts.agentOrderOverride !== undefined) {
    runCfg = {
      ...sharedPreflight.cfg,
      modes: {
        ...sharedPreflight.cfg.modes,
        patch: {
          ...sharedPreflight.cfg.modes.patch,
          agentOrder: opts.agentOrderOverride,
        },
      },
    };
  }

  // Run mode-specific preflight (worktree, git, spec prep, etc.)
  const preflight = await resolveModeSpecificPreflight(
    opts,
    initialSpecPath,
    sharedPreflight.project,
    sharedPreflight.projectMode,
    runCfg,
  );
  if (preflight.kind === "error") {
    return preflight.exitCode;
  }
  if (preflight.kind === "exit") {
    return preflight.exitCode;
  }
  preflight.subRoleResolutionCfg = subRoleResolutionCfg;

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
    consecutiveRedFixups: 0,
    acProgressSinceLastGate: false,
    consecutiveEditedUnticked: 0,
    consecutiveEditedUntickedSubspecPath: null,
    consecutiveBlockerClaimRejections: 0,
    consecutiveBlockerClaimRejectionsSubspecPath: null,
    noCommitDelta: null,
    noCommitResetAppliedThisRun: false,
    runStartHead: null,
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

  // Wire the default base-ref test runner if no seam is provided
  if (opts.runBaseRefTests === undefined) {
    opts.runBaseRefTests = async (baseBranch: string): Promise<boolean> => {
      return runBaseRefTestsImpl(preflight.agentWorkingDir, baseBranch);
    };
  }

  // Wire the default snapshot-update re-test runner if no seam is provided
  if (opts.runSnapshotUpdateRetest === undefined) {
    opts.runSnapshotUpdateRetest = async (): Promise<boolean> => {
      const project = preflight.cfg.projects[preflight.project.key];
      const configCommand = project?.updateSnapshotsCommand;
      return runSnapshotUpdateRetestImpl(preflight.agentWorkingDir, preflight.project.root, configCommand);
    };
  }

  const activeAgents = buildActiveAgents(opts, preflight.cfg, preflight.patchTier);

  const ctx: IterationContext = {
    preflight,
    logging,
    opts,
    activeAgents,
    descendantTracker,
    state,
  };

  try {
    // Warn about Claude pool contention if the selected primary agent is Claude
    // and there are live Jarvis-owned operator/orchestration sessions using Claude.
    const [primaryAgent] = activeAgents;
    if (primaryAgent !== undefined) {
      warnAboutPoolContentionIfDetected(primaryAgent, logging.sendLog);
    }

    while (true) {
      const outcome = await runIteration(ctx);
      if (outcome.kind === "return") {
        if (logging.hasTelemetryWrites() && !logging.hasRunTerminalRecord()) {
          logging.writeTelemetry({
            agent: "harness",
            iteration: state.iteration,
            durationMs: Date.now() - runStartedMs,
            kind: "ok",
            exitReason: mapExitCodeToReason(outcome.exitCode),
            record_role: "run_terminal",
            ...(logging.activeSubspecPath !== undefined ? { active_subspec_path: logging.activeSubspecPath } : {}),
          });
        }
        runExitReason = `${mapExitCodeToReason(outcome.exitCode)} (exit code ${outcome.exitCode})`;
        return outcome.exitCode;
      }
      if (outcome.kind === "exit") {
        runExitReason = `${mapExitCodeToReason(outcome.exitCode)} (exit code ${outcome.exitCode})`;
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
    case 11:
      return "review-incomplete";
    case 130:
      return "sigint";
    default:
      return `exit-${exitCode}`;
  }
}
