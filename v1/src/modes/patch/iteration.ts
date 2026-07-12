import { execFileSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { detectBlockerClaim, parseSpec, stripBlockerSection } from "../../../../shared/spec-parser.ts";
import { openSessionLog } from "../../config.ts";
import { getBaseBranch } from "../../gh.ts";
import type { LogClient } from "../../logging.ts";
import { ensureDraftPr, renderAttributionSummary } from "../../pr.ts";
import {
  HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED,
  HARNESS_IDLE_TIMEOUT_FALLBACK,
  HARNESS_NO_PROGRESS_FALLBACK,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessAuthRotateLine,
  harnessQuotaFallbackLenientLine,
  harnessTransientRetryLine,
} from "../../quota-harness-messages.ts";
import { runSummary } from "../../run-summary.ts";
import {
  appendTelemetryLine,
  type CostSource,
  type PatchTelemetryPhase,
  type TelemetryKind,
  type TelemetryRecordRole,
  type UsageSource,
} from "../../telemetry.ts";
import { extractUsageAndCost } from "../../telemetry-enrichment.ts";
import { hasUpstream, pushCurrent, worktreeCompletionBlocker } from "../../worktree.ts";
import { releaseWorktreeLock } from "../../worktree-lock.ts";
import {
  countUnchecked,
  getActiveLinkedSubspecPath,
  getFirstUncheckedTask,
} from "./completion.ts";
import {
  diffAcceptanceCriteria,
  generatePrBody,
  getCurrentBranch,
  getIndexTitle,
  tryFinishSpecIfDone,
} from "./completion-pipeline.ts";
import { commitLockfileChanges, detectDepChange, installDeps } from "./dep-install.ts";
import { evaluateIdleWatchdog, sampleFileActivityIfNeeded } from "./idle-watchdog.ts";
import {
  applyReset,
  clearDelta,
  createFreshDelta,
  loadDelta,
  recordBlocker,
  recordNewlyCheckedAc,
  saveDelta,
} from "./no-commit-delta.ts";
import { createPatchInvocationBinding } from "./patch-invocation-binding.ts";
import { findRelocatedSpecFile, refreshActiveSpecPath } from "./preflight.ts";
import { buildPrompt, readRepoGuidance } from "./prompt.ts";
import { collectSubtree, DESCENDANT_POLL_INTERVAL_MS, listProcesses } from "./reap.ts";
import type {
  IterationContext,
  IterationOutcome,
  LoggingContext,
  PatchWatchdogTiming,
  PreflightOk,
  RunCommandOptions,
  WatchdogListProcessesFn,
} from "./run.ts";
import { accumulateImplementationTouchedFiles } from "./shrink.ts";
import {
  type AcceptanceCriterion,
  commitCheckpointOnTimeout,
  commitSubspec,
  commitWipProgress,
  commitWipProgressWithBlocker,
  snapshotAcceptanceCriteria,
  snapshotCommittedAcceptanceCriteria,
} from "./subspec.ts";
import { consumeTimeoutCheckpointReceipt, writeTimeoutCheckpointReceipt } from "./timeout-checkpoint.ts";

type LogTag = "harness" | "outbound" | "inbound_stdout" | "inbound_stderr";
type LogStream = "stdout" | "stderr" | null;
type LogAnnotations = Record<string, string | number | boolean | null>;

type Fanout = (tag: LogTag, text: string, stream: LogStream, annotations?: LogAnnotations) => void;

type SendLog = (tag: LogTag, text: string, annotations?: LogAnnotations) => void;

type WriteSessionLine = (tag: LogTag, line: string) => void;

type TelemetryRecord = {
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
};

type WriteTelemetry = (record: TelemetryRecord) => void;

const CONSECUTIVE_ITERATION_TIMEOUT_BOUND = 3;

function countTrailingIterationTimeouts(telemetryPath: string | null, activeSubspecPath: string | undefined): number {
  if (telemetryPath === null || activeSubspecPath === undefined || !existsSync(telemetryPath)) return 0;
  let rows: string[];
  try {
    rows = readFileSync(telemetryPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    return 0;
  }
  let count = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    try {
      const row = JSON.parse(rows[index] ?? "") as Record<string, unknown>;
      if (row.record_role !== "run_terminal") continue;
      if (
        row.active_subspec_path !== activeSubspecPath ||
        (row.exit_reason !== "iteration-timeout" && row.exit_reason !== "watchdog-iteration-timeout")
      )
        break;
      count += 1;
    } catch {}
  }
  return count;
}

function appendTimeoutSplitBlocker(
  activeSubspecPath: string,
  telemetryPath: string | null,
  priorTimeouts: number,
): void {
  if (telemetryPath === null || priorTimeouts + 1 < CONSECUTIVE_ITERATION_TIMEOUT_BOUND) return;
  try {
    const content = readFileSync(activeSubspecPath, "utf8");
    if (parseSpec(content).blocker !== undefined) return;
    appendFileSync(
      activeSubspecPath,
      `${content.endsWith("\n") ? "" : "\n"}\n## Blocker\n\nThis subspec reached ${CONSECUTIVE_ITERATION_TIMEOUT_BOUND} consecutive iteration timeouts. Split the subspec into smaller independently runnable tasks before rerunning.\n`,
      "utf8",
    );
  } catch {
    // Timeout reporting remains best-effort, including blocker annotation.
  }
}

const realPatchWatchdogTiming: PatchWatchdogTiming = {
  nowMs: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

function formatWatchdogDiagnosticsSuffix(
  lastOutputAgeMs: number | null,
  lastFileActivityAgeMs: number | null,
  descendantsAlive: boolean | undefined,
): string {
  let suffix = ` last_output_age_ms=${lastOutputAgeMs === null ? "null" : String(lastOutputAgeMs)}`;
  suffix += ` last_file_activity_age_ms=${lastFileActivityAgeMs === null ? "null" : String(lastFileActivityAgeMs)}`;
  if (descendantsAlive !== undefined) {
    suffix += ` watchdog_descendants_alive=${descendantsAlive}`;
  }
  return suffix;
}

function snapshotWatchdogDescendantsAlive(agentRootPid: number, listProcessesFn?: WatchdogListProcessesFn): boolean {
  const procs = listProcessesFn ? listProcessesFn(agentRootPid) : listProcesses();
  if (procs.length === 0) {
    return false;
  }
  return collectSubtree(agentRootPid, procs).length > 0;
}

function hasTrackedWorktreeChanges(cwd: string): boolean {
  try {
    const porcelain = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      stdio: "pipe",
    })
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
    return porcelain.some((line) => !line.startsWith("?? "));
  } catch {
    return false;
  }
}

function killWatchdogWithDescendants(
  pgid: number,
  reason: string,
  fanout: Fanout,
  killGraceMs: number,
  lastOutputAgeMs: number | null,
  lastFileActivityAgeMs: number | null,
  listProcessesFn?: WatchdogListProcessesFn,
): { descendantsAlive: boolean; killHandle: NodeJS.Timeout } {
  const descendantsAlive = snapshotWatchdogDescendantsAlive(pgid, listProcessesFn);
  const watchdogLine =
    `[watchdog] ${reason}; killing agent pgid ${pgid}` +
    formatWatchdogDiagnosticsSuffix(lastOutputAgeMs, lastFileActivityAgeMs, descendantsAlive);
  fanout("harness", `${watchdogLine}\n`, "stderr");
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    // best-effort, spawn-layer abort handler still runs.
  }
  const killHandle = setTimeout(() => {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      // best-effort
    }
  }, killGraceMs);
  killHandle.unref();
  return { descendantsAlive, killHandle };
}

export function setupLogging(opts: RunCommandOptions, preflight: PreflightOk, logClient: LogClient): LoggingContext {
  const cfg = preflight.cfg;

  const specDisplayName = getSpecDisplayName(preflight.specPath);
  const runNamespace = `${preflight.project.key}:${specDisplayName}`;
  const telemetryPath = cfg.telemetryPath ?? null;
  const activeSubspecPath = getActiveLinkedSubspecPath(preflight.specPath);
  const priorIterationTimeouts = countTrailingIterationTimeouts(telemetryPath, activeSubspecPath);
  let telemetryWrites = false;
  let runTerminalRecorded = false;
  let patchIterationsCompletedForSummary = 0;
  const implementationTouchedFiles = new Set<string>();

  const writeTelemetry: WriteTelemetry = (record) => {
    try {
      appendTelemetryLine(telemetryPath, {
        ts: new Date().toISOString(),
        namespace: runNamespace,
        mode: "patch",
        agent: record.agent,
        iteration: record.iteration,
        duration_ms: record.durationMs,
        kind: record.kind,
        exit_reason: record.exitReason,
        ...(record.usage !== undefined ? { usage: record.usage } : {}),
        ...(record.usage_source !== undefined ? { usage_source: record.usage_source } : {}),
        ...(record.cost_usd !== undefined ? { cost_usd: record.cost_usd } : {}),
        ...(record.cost_source !== undefined ? { cost_source: record.cost_source } : {}),
        ...(record.warnings !== undefined ? { warnings: record.warnings } : {}),
        ...(record.record_role !== undefined ? { record_role: record.record_role } : {}),
        ...(record.configured_model !== undefined ? { configured_model: record.configured_model } : {}),
        ...(record.patch_phase !== undefined ? { patch_phase: record.patch_phase } : {}),
        ...(record.watchdog_pgid !== undefined ? { watchdog_pgid: record.watchdog_pgid } : {}),
        ...(record.last_output_age_ms !== undefined ? { last_output_age_ms: record.last_output_age_ms } : {}),
        ...(record.last_file_activity_age_ms !== undefined
          ? { last_file_activity_age_ms: record.last_file_activity_age_ms }
          : {}),
        ...(record.watchdog_descendants_alive !== undefined
          ? { watchdog_descendants_alive: record.watchdog_descendants_alive }
          : {}),
        ...(record.active_subspec_path !== undefined ? { active_subspec_path: record.active_subspec_path } : {}),
      });
      telemetryWrites = true;
      if (record.record_role === "run_terminal") {
        runTerminalRecorded = true;
      }
      if (
        record.kind === "ok" &&
        record.agent !== "harness" &&
        record.record_role !== "run_terminal" &&
        record.patch_phase !== "review" &&
        record.patch_phase !== "shrink"
      ) {
        patchIterationsCompletedForSummary += 1;
      }
    } catch {
      // best-effort
    }
  };

  const sendLog: SendLog = (tag, text, annotations) => {
    const message = {
      namespace: runNamespace,
      text,
      tag,
      ...(annotations === undefined ? {} : { annotations }),
    };
    // Fire-and-forget after initial mandatory connectivity check. Log
    // server is observability only; the on-disk session log is the
    // authoritative record. Awaiting here would let a slow log server
    // backpressure the iteration.
    void Promise.resolve()
      .then(() => logClient.send(message))
      .catch(() => {});
  };

  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const sessionFd = openSessionLog(runNamespace, timestamp, opts.config);

  const writeSessionLine: WriteSessionLine = (tag, line) => {
    const stamped = `${new Date().toISOString()} [${tag}] ${line}\n`;
    writeSync(sessionFd, stamped, undefined, "utf8");
  };

  const writeLog = (tag: LogTag, text: string, annotations?: LogAnnotations): void => {
    for (const line of splitLines(text)) {
      writeSessionLine(tag, line);
      sendLog(tag, line, annotations);
    }
  };

  const writeTerminal = (stream: "stdout" | "stderr", text: string): void => {
    if (stream === "stdout") {
      opts.io.stdout(text);
    } else if (stream === "stderr") {
      opts.io.stderr(text);
    }
  };

  const fanout: Fanout = (tag, text, stream, annotations) => {
    if (stream !== null) {
      writeTerminal(stream, text);
    }
    writeLog(tag, text, annotations);
  };

  return {
    fanout,
    sendLog,
    writeSessionLine,
    writeTelemetry,
    sessionFd,
    logClient,
    runNamespace,
    specDisplayName,
    hasTelemetryWrites: () => telemetryWrites,
    hasRunTerminalRecord: () => runTerminalRecorded,
    patchIterationsCompletedForSummary: () => patchIterationsCompletedForSummary,
    priorIterationTimeouts,
    activeSubspecPath,
    implementationTouchedFiles,
  };
}

export function finalize(
  ctx: IterationContext,
  globalTimeoutHandle: NodeJS.Timeout | null,
  onSigint: () => void,
  runStartedAt: Date,
  runStartedMs: number,
  runExitReason: string,
): void {
  const hadIterations = ctx.logging.hasTelemetryWrites();
  if (hadIterations) {
    const summary = runSummary({
      telemetryPath: ctx.preflight.cfg.telemetryPath ?? null,
      namespace: ctx.logging.runNamespace,
      startTs: runStartedAt.toISOString(),
      exitReason: runExitReason,
      iterations: ctx.logging.patchIterationsCompletedForSummary(),
      durationMs: Date.now() - runStartedMs,
      specPath: getSpecDisplayName(ctx.preflight.specPath),
    });
    if (summary.trim().length > 0) {
      ctx.opts.io.stdout(`\n${summary}`);
    }
  }

  if (globalTimeoutHandle) {
    clearTimeout(globalTimeoutHandle);
  }
  if (ctx.preflight.worktreeLocked) {
    releaseWorktreeLock(ctx.preflight.agentWorkingDir);
  }
  if (ctx.preflight.stalepidRecovered !== undefined) {
    ctx.logging.sendLog(
      "harness",
      `recovered stale worktree lock (pid ${ctx.preflight.stalepidRecovered} no longer running)`,
    );
  }
  closeSync(ctx.logging.sessionFd);
  if (ctx.opts.handleSignals !== false) {
    process.removeListener("SIGINT", onSigint);
  }

  // Reap any agent descendants that escaped the process group and outlived
  // their iteration (covers the SIGINT and direct-`process.exit` paths).
  // Best-effort: never throws, never affects the exit code.
  try {
    (ctx.opts.__testReapFn ?? (() => ctx.descendantTracker.reap()))();
  } catch {
    // best-effort
  }
}

function onlyHumanOnlyRemain(criteria: AcceptanceCriterion[]): boolean {
  const uncheckedNonHumanOnly = criteria.filter((c) => !c.humanOnly && !c.checked);
  const hasHumanOnlyCriteria = criteria.some((c) => c.humanOnly);
  return uncheckedNonHumanOnly.length === 0 && hasHumanOnlyCriteria;
}

function stripBlockerAndContinueFile(path: string): void {
  const currentContent = readFileSync(path, "utf8");
  const strippedContent = stripBlockerSection(currentContent);
  writeFileSync(path, strippedContent, "utf8");
}

export async function runIteration(ctx: IterationContext): Promise<IterationOutcome> {
  const { preflight, logging, opts, activeAgents, state } = ctx;
  const { specPath, gitEnabled, agentWorkingDir, cfg, specIsExternal } = preflight;
  const { fanout, writeTelemetry, specDisplayName } = logging;
  const iteration = state.iteration;
  const iterationStartedAt = Date.now();
  const iterationDurationMs = (): number => Date.now() - iterationStartedAt;

  // Mutations are untracked when git can't revert them: either git is off, or the spec is outside the worktree
  const hasUntrackedMutations = !gitEnabled || specIsExternal;

  // Helper to capture delta on interrupt/timeout: diff current spec against pre-iteration state
  function captureInterruptedDelta(
    activeSubspecPath: string | undefined,
    beforeCriteria: AcceptanceCriterion[],
    hasBlockerBefore: boolean,
  ): void {
    if (!activeSubspecPath || state.noCommitDelta === null) {
      return;
    }
    try {
      if (!existsSync(activeSubspecPath)) {
        return;
      }
      const afterCriteria = snapshotAcceptanceCriteria(activeSubspecPath);
      const newlyChecked = diffAcceptanceCriteria(beforeCriteria, afterCriteria);
      for (const ac of newlyChecked) {
        recordNewlyCheckedAc(state.noCommitDelta, ac.text);
      }

      const afterParse = parseSpec(readFileSync(activeSubspecPath, "utf8"));
      const hasBlockerNow = afterParse.blocker !== undefined;
      if (hasBlockerNow && !hasBlockerBefore) {
        const blockerBody = afterParse.blocker;
        if (blockerBody) {
          recordBlocker(state.noCommitDelta, blockerBody);
        }
      }
    } catch {
      // Best effort: if we can't capture the delta, just continue
    }
  }

  // Helper to check for dep changes after commit and run install if needed
  function maybeInstallDeps(agentLabel: string): void {
    if (!gitEnabled) {
      return; // Only run install in git-enabled mode
    }

    try {
      if (!detectDepChange(agentWorkingDir)) {
        return; // No dep changes detected
      }

      fanout("harness", "[dep-install] detected package.json or bun.lock change\n", "stderr");

      // Get the install command from config
      const project = cfg.projects[preflight.project.key];
      const installCommand = project?.installCommand ?? "bun install";

      fanout("harness", `[dep-install] running: ${installCommand}\n`, "stderr");

      const result = installDeps(agentWorkingDir, installCommand);
      if (result.kind === "error") {
        fanout("harness", `[dep-install] install failed: ${result.message}\n`, "stderr");
        return; // Continue run on install failure
      }

      fanout("harness", "[dep-install] install succeeded\n", "stderr");

      // Try to commit regenerated lockfile
      try {
        commitLockfileChanges(agentWorkingDir, agentLabel);
        fanout("harness", "[dep-install] committed regenerated lockfile\n", "stderr");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        fanout("harness", `[dep-install] failed to commit lockfile: ${message}\n`, "stderr");
        // Continue even if commit fails
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fanout("harness", `[dep-install] unexpected error: ${message}\n`, "stderr");
      // Continue on any error
    }
  }

  if (iteration > cfg.maxIterations) {
    printBoundedTail(opts, [...state.latestIterationStdout, ...state.latestIterationStderr]);
    fanout("harness", `max iterations (${cfg.maxIterations}) reached; stopping\n`, "stderr");
    writeTelemetry({
      agent: "harness",
      iteration,
      durationMs: iterationDurationMs(),
      kind: "ok",
      exitReason: "max-iterations",
    });
    return { kind: "return", exitCode: 5 };
  }

  state.latestIterationStdout = [];
  state.latestIterationStderr = [];
  const before = countUnchecked(specPath);
  if (before === 0) {
    const done = (await tryFinishSpecIfDone(ctx)) ?? 0;
    if (done === 0 && hasUntrackedMutations) {
      const activeSubspecToClean = getActiveLinkedSubspecPath(specPath);
      if (activeSubspecToClean !== undefined) {
        clearDelta(activeSubspecToClean);
      }
    }
    return { kind: "return", exitCode: done };
  }

  const agent = activeAgents[0];
  if (agent === undefined) {
    fanout("harness", `${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`, "stderr");
    writeTelemetry({
      agent: "harness",
      iteration,
      durationMs: iterationDurationMs(),
      kind: "quota",
      exitReason: "quota-exhausted",
    });
    return { kind: "return", exitCode: 2 };
  }

  const configuredPatchModelEntry = cfg.modes.patch.agentOrder.find((entry) => entry.agent === agent.name);
  const configuredPatchModel = configuredPatchModelEntry?.model;
  const telemetryMeta = configuredPatchModel !== undefined ? { configured_model: configuredPatchModel } : {};

  const task = getFirstUncheckedTask(specPath);
  const taskExcerpt = task?.line.slice(0, 140);
  const activeSubspecPath = getActiveLinkedSubspecPath(specPath);
  let timeoutCheckpointContext: string | undefined;
  if (activeSubspecPath !== undefined && gitEnabled) {
    try {
      const receipt = consumeTimeoutCheckpointReceipt(agentWorkingDir, activeSubspecPath, (message) => {
        fanout("harness", `warning: ${message}\n`, "stderr");
      });
      if (receipt !== null) {
        timeoutCheckpointContext =
          "Partial implementation from the previous iteration-timeout checkpoint is present. Inspect the existing changes and continue that implementation; do not redo work that is already complete.";
      }
    } catch (err) {
      fanout(
        "harness",
        `warning: could not inspect timeout checkpoint receipt: ${err instanceof Error ? err.message : String(err)}\n`,
        "stderr",
      );
    }
  }
  // Capture runStartHead on first iteration for all-human-only guard
  if (gitEnabled && existsSync(join(agentWorkingDir, ".git")) && state.runStartHead === null) {
    state.runStartHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: agentWorkingDir,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  }

  const preIterationHead =
    gitEnabled && existsSync(join(agentWorkingDir, ".git"))
      ? execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: agentWorkingDir,
          encoding: "utf8",
          stdio: "pipe",
        }).trim()
      : null;

  // For no-commit runs, load and apply any prior-attempt delta before the blocker check
  // This resets any stale AC ticks and blockers from a prior incomplete run
  // Only apply reset once per run (iteration 1), never on subsequent iterations
  if (
    activeSubspecPath !== undefined &&
    hasUntrackedMutations &&
    !state.noCommitResetAppliedThisRun
  ) {
    const priorDelta = loadDelta(activeSubspecPath);
    if (priorDelta !== null) {
      applyReset(activeSubspecPath, priorDelta);
    }
    // Create a fresh delta for this attempt (first run or re-run after reset)
    state.noCommitDelta = createFreshDelta(activeSubspecPath);
    state.noCommitResetAppliedThisRun = true;
  } else if (hasUntrackedMutations && activeSubspecPath !== undefined && state.noCommitDelta === null) {
    // Subsequent iterations: create delta if needed
    state.noCommitDelta = createFreshDelta(activeSubspecPath);
  }

  // Check if the active subspec already has a blocker at the start.
  if (activeSubspecPath !== undefined) {
    const parsedSubspec = parseSpec(readFileSync(activeSubspecPath, "utf8"));
    if (parsedSubspec.blocker !== undefined) {
      if (onlyHumanOnlyRemain(parsedSubspec.acceptanceCriteria)) {
        // Only human-only criteria remain: strip blocker and continue
        stripBlockerAndContinueFile(activeSubspecPath);
        fanout("harness", `blocker stripped: only human-only acceptance criteria remain\n`, "stderr");
        // Continue without exiting; don't increment iteration, re-check for other conditions
      } else {
        // Automated criteria remain: honor the blocker
        const blockerBody = parsedSubspec.blocker;
        const blockerText = blockerBody ? `${activeSubspecPath}\n\n${blockerBody}` : activeSubspecPath;
        fanout("harness", `${blockerText}\n`, "stderr");
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "blocked",
          exitReason: "blocker-detected",
          ...telemetryMeta,
        });
        return { kind: "return", exitCode: 7 };
      }
    }
  }

  // Handle uncommitted ticks at iteration start: if acceptance criteria are ticked
  // in the working tree but absent from committed HEAD, commit them as progress
  // and loop back without spawning the agent
  if (activeSubspecPath !== undefined && gitEnabled) {
    const workingTreeCriteria = snapshotAcceptanceCriteria(activeSubspecPath);
    const committedCriteria = snapshotCommittedAcceptanceCriteria(activeSubspecPath, {
      cwd: agentWorkingDir,
    });
    const uncommittedTicks = diffAcceptanceCriteria(committedCriteria, workingTreeCriteria);
    if (uncommittedTicks.length > 0) {
      const nonHumanOnlyCriteria = workingTreeCriteria.filter((c) => !c.humanOnly);
      const allNonHumanOnlyChecked = nonHumanOnlyCriteria.length > 0 && nonHumanOnlyCriteria.every((c) => c.checked);
      const allHumanOnly = workingTreeCriteria.length > 0 && workingTreeCriteria.every((c) => c.humanOnly);
      const checkedTotal = workingTreeCriteria.filter((c) => c.checked).length;
      const humanOnlyUnchecked = workingTreeCriteria.filter((c) => c.humanOnly && !c.checked);

      try {
        if (allNonHumanOnlyChecked) {
          // All non-human-only criteria are checked
          if (allHumanOnly) {
            // All criteria are human-only: can only complete if there are code changes
            const currentHead = execFileSync("git", ["rev-parse", "HEAD"], {
              cwd: agentWorkingDir,
              encoding: "utf8",
              stdio: "pipe",
            }).trim();
            const hasCodeChanges = state.runStartHead !== null && state.runStartHead !== currentHead;
            if (!hasCodeChanges) {
              // No code changes for all-human-only subspec, don't auto-complete
              state.iteration += 1;
              return { kind: "continue" };
            }
          }
          commitSubspec(activeSubspecPath, {
            cwd: agentWorkingDir,
            agentLabel: agent.attributionLabel(),
            ...(allHumanOnly ? { humanOnlyCount: humanOnlyUnchecked.length, total: workingTreeCriteria.length } : {}),
          });
        } else {
          commitWipProgress(activeSubspecPath, {
            cwd: agentWorkingDir,
            newlyChecked: uncommittedTicks,
            checkedTotal,
            total: workingTreeCriteria.length,
            humanOnlyCount: humanOnlyUnchecked.length,
            agentLabel: agent.attributionLabel(),
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        fanout("harness", `failed to commit uncommitted ticks for ${activeSubspecPath}: ${message}\n`, "stderr");
        return { kind: "return", exitCode: 1 };
      }

      if (!opts.skipGhCheck && allNonHumanOnlyChecked) {
        try {
          const firstPush = !hasUpstream(agentWorkingDir);
          pushCurrent({ cwd: agentWorkingDir, firstPush });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          fanout("harness", `failed to push uncommitted-ticks commit for ${activeSubspecPath}: ${message}\n`, "stderr");
          return { kind: "return", exitCode: 1 };
        }
      }

      // Try to install deps if they changed
      maybeInstallDeps(agent.attributionLabel());

      if (allNonHumanOnlyChecked) {
        state.iteration += 1;
        const done = await tryFinishSpecIfDone(ctx);
        // Subspec AC complete ≠ index complete; null means linked subspecs remain (before===0/after===0 coalesce null→0 because countUnchecked was already 0).
        if (done === null) {
          return { kind: "continue" };
        }
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "ok",
          exitReason: "completed-spec",
          record_role: "run_terminal",
          ...telemetryMeta,
        });
        return { kind: "return", exitCode: done };
      }

      state.iteration += 1;
      return { kind: "continue" };
    }
  }

  let beforeCriteria: AcceptanceCriterion[] = [];
  let hasBlockerBefore = false;
  if (activeSubspecPath !== undefined) {
    const beforeParse = parseSpec(readFileSync(activeSubspecPath, "utf8"));
    hasBlockerBefore = beforeParse.blocker !== undefined;
    beforeCriteria = snapshotAcceptanceCriteria(activeSubspecPath);
    if (beforeCriteria.length === 0) {
      const warningsSuffix =
        beforeParse.warnings.length === 0
          ? ""
          : ` Parser warnings:\n- ${beforeParse.warnings.map((w) => w.message).join("\n- ")}`;
      fanout(
        "harness",
        `active subspec ${activeSubspecPath} has no \`## Acceptance criteria\` checkboxes; jarvis cannot detect completion. Add an acceptance-criteria checklist to the subspec and rerun.${warningsSuffix}\n`,
        "stderr",
      );
      return { kind: "return", exitCode: 1 };
    }
  }
  const banner = `project: ${preflight.project.key} | spec: ${specDisplayName} | iteration: ${iteration} | current-task: ${task?.ordinal}/${task?.total} ${taskExcerpt} | agent: ${agent.name}\n`;
  const bannerAnnotations: LogAnnotations = {
    project: preflight.project.key,
    spec: specDisplayName,
    iteration,
    agent: agent.name,
  };
  if (taskExcerpt !== undefined) {
    bannerAnnotations.currentTask = taskExcerpt;
  }
  if (task?.ordinal !== undefined) {
    bannerAnnotations.currentTaskOrdinal = task.ordinal;
  }
  if (task?.total !== undefined) {
    bannerAnnotations.currentTaskTotal = task.total;
  }
  fanout("harness", banner, "stdout", bannerAnnotations);
  const projectSiblings = preflight.cfg.projects[preflight.project.key]?.siblings;
  const prompt = buildPrompt(specPath, projectSiblings, {
    repoGuidance: readRepoGuidance(preflight.project.root),
    activeSubspecPath: activeSubspecPath ?? "",
    activeSubspecBody:
      activeSubspecPath !== undefined && existsSync(activeSubspecPath) ? readFileSync(activeSubspecPath, "utf8") : "",
    ...(timeoutCheckpointContext === undefined ? {} : { timeoutCheckpointContext }),
  });
  fanout("outbound", prompt, null, {
    iteration,
    agent: agent.name,
  });

  // Create per-iteration abort controller
  state.currentController = new AbortController();
  const iterationController = state.currentController;
  const killGraceMs = opts.__testKillGraceMs ?? 5000;
  const patchWatchdogTiming = opts.__testPatchWatchdogTiming ?? realPatchWatchdogTiming;
  let watchdogPgid: number | null = null;
  let watchdogFired = false;
  let watchdogKillHandle: NodeJS.Timeout | null = null;
  let watchdogLastOutputAgeMs: number | null = null;
  let watchdogLastFileActivityAgeMs: number | null = null;
  let watchdogDescendantsAlive: boolean | undefined;
  let idleTimeoutHandle: NodeJS.Timeout | null = null;
  let idleWatchdogLastOutputAgeMs: number | null = null;
  let idleWatchdogLastFileActivityAgeMs: number | null = null;
  let idleWatchdogDescendantsAlive: boolean | undefined;
  const lastOutputAtMs = { current: null as number | null };
  let lastFileActivityAtMs: number | null = null;
  // Poll the agent's process subtree while it is alive so descendants that
  // later escape the process group (via setsid) and re-parent to init can be
  // reaped after the agent exits, when no live lineage to them remains.
  let descendantPollHandle: NodeJS.Timeout | null = null;
  const iterationTimeoutHandle = patchWatchdogTiming.setTimeout(() => {
    watchdogFired = true;
    const snapshotAt = patchWatchdogTiming.nowMs();
    watchdogLastOutputAgeMs = lastOutputAtMs.current === null ? null : snapshotAt - lastOutputAtMs.current;
    watchdogLastFileActivityAgeMs = lastFileActivityAtMs === null ? null : snapshotAt - lastFileActivityAtMs;
    const pgid = watchdogPgid;
    if (pgid !== null) {
      const result = killWatchdogWithDescendants(
        pgid,
        `iteration timeout fired after ${cfg.iterationTimeoutMs}ms`,
        fanout,
        killGraceMs,
        watchdogLastOutputAgeMs,
        watchdogLastFileActivityAgeMs,
        opts.__testWatchdogListProcesses,
      );
      watchdogDescendantsAlive = result.descendantsAlive;
      watchdogKillHandle = result.killHandle;
    }
    state.currentController?.abort("iteration-timeout");
  }, cfg.iterationTimeoutMs);

  // Arm idle watchdog if configured (default 600000 when unset)
  const armedAt = Date.now();
  const idleOutputTimeoutMs = cfg.idleOutputTimeoutMs ?? 600000;
  if (idleOutputTimeoutMs > 0) {
    const scheduleIdleCheck = () => {
      idleTimeoutHandle = setTimeout(() => {
        const snapshotAt = Date.now();
        const lastOutputAgeMs = lastOutputAtMs.current === null ? null : snapshotAt - lastOutputAtMs.current;

        // Sample file activity only on the cheap path — when output is already stale
        // and watchdog is about to fire
        const sampledFileActivityAt = sampleFileActivityIfNeeded({
          lastOutputAgeMs,
          idleOutputTimeoutMs,
          now: snapshotAt,
          armedAt,
          workingDir: agentWorkingDir,
        });

        if (sampledFileActivityAt !== null) {
          lastFileActivityAtMs = sampledFileActivityAt;
        }

        // Evaluate watchdog: fire only if both output AND file activity are stale
        const { shouldFire, lastFileActivityAgeMs } = evaluateIdleWatchdog({
          now: snapshotAt,
          lastOutputAt: lastOutputAtMs.current,
          lastFileActivityAt: lastFileActivityAtMs,
          armedAt,
          idleOutputTimeoutMs,
        });

        if (shouldFire) {
          idleWatchdogLastOutputAgeMs = lastOutputAgeMs;
          idleWatchdogLastFileActivityAgeMs = lastFileActivityAgeMs;
          const pgid = watchdogPgid;
          if (pgid !== null) {
            const result = killWatchdogWithDescendants(
              pgid,
              `idle timeout fired after ${idleOutputTimeoutMs}ms`,
              fanout,
              killGraceMs,
              idleWatchdogLastOutputAgeMs,
              idleWatchdogLastFileActivityAgeMs,
              opts.__testWatchdogListProcesses,
            );
            idleWatchdogDescendantsAlive = result.descendantsAlive;
            watchdogKillHandle = result.killHandle;
          }
          state.currentController?.abort("idle-timeout");
        } else {
          // Reschedule for next check
          scheduleIdleCheck();
        }
      }, 100); // Poll every 100ms, configurable granularity
      idleTimeoutHandle?.unref?.();
    };
    scheduleIdleCheck();
  }

  const binding = createPatchInvocationBinding({
    agentName: agent.name,
    configuredModel: configuredPatchModel,
    createAgent: (_name, _model) => agent,
    config: cfg,
    abortKillGraceMs: killGraceMs,
  });

  try {
    const result = await binding.spawn({
      prompt,
      cwd: agentWorkingDir,
      signal: state.currentController.signal,
      ...(preflight.additionalReadDirs !== undefined ? { additionalReadDirs: preflight.additionalReadDirs } : {}),
      lastOutputAtMs,
      lastOutputNowMs: () => patchWatchdogTiming.nowMs(),
      onSpawned: ({ pid }: { pid: number }) => {
        watchdogPgid = pid;
        // Clear any prior descendantPollHandle before assigning the new one (re-entry-safe for retries)
        if (descendantPollHandle !== null) {
          clearInterval(descendantPollHandle);
          descendantPollHandle = null;
        }
        // Record descendants immediately, then keep sampling while the agent
        // runs so escapees are captured before their lineage is severed.
        ctx.descendantTracker.poll(pid);
        descendantPollHandle = setInterval(() => {
          ctx.descendantTracker.poll(pid);
        }, DESCENDANT_POLL_INTERVAL_MS);
        descendantPollHandle?.unref?.();
      },
      onTransientRetry: ({ attempt, cap, exitCode }) => {
        fanout("harness", `${harnessTransientRetryLine(exitCode, attempt, cap)}\n`, "stderr");
      },
    });

    // Disarm idle watchdog immediately after agent returns, before post-processing begins
    if (idleTimeoutHandle !== null) {
      clearTimeout(idleTimeoutHandle);
      idleTimeoutHandle = null;
    }

    // Check for idle timeout
    if (result.kind === "error" && result.stderr.includes("aborted: idle-timeout")) {
      const idleTelemetryRecord: TelemetryRecord = {
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "timeout",
        exitReason: "watchdog-idle-timeout",
        last_output_age_ms: idleWatchdogLastOutputAgeMs,
        last_file_activity_age_ms: idleWatchdogLastFileActivityAgeMs,
        ...telemetryMeta,
      };
      if (watchdogPgid !== null) {
        idleTelemetryRecord.watchdog_pgid = watchdogPgid;
      }
      if (idleWatchdogDescendantsAlive !== undefined) {
        idleTelemetryRecord.watchdog_descendants_alive = idleWatchdogDescendantsAlive;
      }

      if (activeAgents.length > 1) {
        activeAgents.shift();
        fanout("harness", `${agent.name}: ${HARNESS_IDLE_TIMEOUT_FALLBACK}\n`, "stderr");
        idleTelemetryRecord.exitReason = "watchdog-idle-timeout-fallback";
        writeTelemetry(idleTelemetryRecord);
        state.iteration += 1;
        return { kind: "continue" };
      }

      fanout("harness", `iteration ${iteration} exceeded idle timeout of ${cfg.idleOutputTimeoutMs}ms\n`, "stderr");
      captureInterruptedDelta(activeSubspecPath, beforeCriteria, hasBlockerBefore);
      writeTelemetry(idleTelemetryRecord);
      return { kind: "return", exitCode: 8 };
    }

    // Check for iteration timeout
    if (result.kind === "error" && result.stderr.includes("aborted: iteration-timeout")) {
      fanout("harness", `iteration ${iteration} exceeded timeout of ${cfg.iterationTimeoutMs}ms\n`, "stderr");
      captureInterruptedDelta(activeSubspecPath, beforeCriteria, hasBlockerBefore);
      if (!hasUntrackedMutations) {
        try {
          // Checkpoint any partial progress regardless of spec shape; only an
          // active subspec gets a resume receipt to surface on the next prompt.
          if (
            commitCheckpointOnTimeout(activeSubspecPath, agentWorkingDir, agent.attributionLabel()) &&
            activeSubspecPath !== undefined
          ) {
            try {
              writeTimeoutCheckpointReceipt(agentWorkingDir, activeSubspecPath);
            } catch (err) {
              fanout(
                "harness",
                `failed to write timeout checkpoint receipt: ${err instanceof Error ? err.message : String(err)}\n`,
                "stderr",
              );
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          fanout("harness", `failed to commit checkpoint on iteration-timeout: ${message}\n`, "stderr");
        }
      }
      const iterationTelemetryRecord: TelemetryRecord = {
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "timeout",
        exitReason: watchdogFired ? "watchdog-iteration-timeout" : "iteration-timeout",
      };
      if (configuredPatchModelEntry?.model !== undefined) {
        iterationTelemetryRecord.configured_model = configuredPatchModelEntry.model;
      }
      if (watchdogPgid !== null) {
        iterationTelemetryRecord.watchdog_pgid = watchdogPgid;
      }
      if (watchdogFired) {
        iterationTelemetryRecord.last_output_age_ms = watchdogLastOutputAgeMs;
        iterationTelemetryRecord.last_file_activity_age_ms = watchdogLastFileActivityAgeMs;
      }
      if (watchdogFired && watchdogDescendantsAlive !== undefined) {
        iterationTelemetryRecord.watchdog_descendants_alive = watchdogDescendantsAlive;
      }
      iterationTelemetryRecord.record_role = "run_terminal";
      if (activeSubspecPath !== undefined) {
        iterationTelemetryRecord.active_subspec_path = activeSubspecPath;
        appendTimeoutSplitBlocker(
          activeSubspecPath,
          ctx.preflight.cfg.telemetryPath ?? null,
          ctx.logging.priorIterationTimeouts,
        );
      }
      writeTelemetry(iterationTelemetryRecord);
      return { kind: "return", exitCode: 8 };
    }

    // Check for global run timeout
    if (result.kind === "error" && result.stderr.includes("aborted: run-timeout")) {
      fanout(
        "harness",
        cfg.runTimeoutMs ? `run exceeded timeout of ${cfg.runTimeoutMs}ms\n` : "run timeout\n",
        "stderr",
      );
      captureInterruptedDelta(activeSubspecPath, beforeCriteria, hasBlockerBefore);
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "timeout",
        exitReason: "run-timeout",
        ...telemetryMeta,
      });
      return { kind: "return", exitCode: 8 };
    }

    // Check for SIGINT
    if (result.kind === "error" && result.stderr.includes("aborted: sigint")) {
      captureInterruptedDelta(activeSubspecPath, beforeCriteria, hasBlockerBefore);
      return { kind: "exit", exitCode: 130 };
    }

    const afterSpecPath = refreshActiveSpecPath(preflight);
    const afterSubspecPath =
      activeSubspecPath === undefined ? undefined : findRelocatedSpecFile(activeSubspecPath, agentWorkingDir);

    if (result.kind === "ok") {
      // Extract usage and cost data from the agent result
      const usageCost = extractUsageAndCost(result, agent.name, configuredPatchModel);
      const iterationWarnings =
        result.warnings !== undefined && result.warnings.length > 0 ? result.warnings : undefined;
      if (agent.name === "opencode" && usageCost.usage_source === "unavailable" && !state.opencodeUnavailableNoted) {
        fanout(
          "harness",
          "opencode: token usage not available for this CLI version (recording usage as unavailable)\n",
          "stderr",
        );
        state.opencodeUnavailableNoted = true;
      }
      if (agent.name === "cursor" && usageCost.usage_source === "unavailable" && !state.cursorUnavailableNoted) {
        fanout(
          "harness",
          "cursor: token usage not available for this CLI version (recording usage as unavailable)\n",
          "stderr",
        );
        state.cursorUnavailableNoted = true;
      }

      // Forward any agent warnings through the harness log
      if (result.warnings !== undefined && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          fanout("harness", `${agent.name}: ${warning}\n`, "stderr");
        }
      }

      if (result.stdout.length > 0) {
        state.latestIterationStdout.push(...splitLines(result.stdout));
        fanout("inbound_stdout", result.stdout, null, {
          iteration,
          agent: agent.name,
        });
      }
      if (result.stderr.length > 0) {
        state.latestIterationStderr.push(...splitLines(result.stderr));
        fanout("inbound_stderr", result.stderr, null, {
          iteration,
          agent: agent.name,
        });
      }
      let subspecCompleted = false;
      let subspecProgressed = false;
      if (afterSubspecPath !== undefined) {
        const afterCriteria = snapshotAcceptanceCriteria(afterSubspecPath);
        const newlyChecked = diffAcceptanceCriteria(beforeCriteria, afterCriteria);
        const nonHumanOnlyCriteria = afterCriteria.filter((c) => !c.humanOnly);
        const allNonHumanOnlyChecked =
          nonHumanOnlyCriteria.length === 0 || nonHumanOnlyCriteria.every((c) => c.checked);
        const allHumanOnly = afterCriteria.length > 0 && afterCriteria.every((c) => c.humanOnly);
        const checkedTotal = afterCriteria.filter((c) => c.checked).length;
        const humanOnlyUnchecked = afterCriteria.filter((c) => c.humanOnly && !c.checked);

        // Record newly checked AC in no-commit delta
        if (state.noCommitDelta !== null && newlyChecked.length > 0) {
          for (const ac of newlyChecked) {
            recordNewlyCheckedAc(state.noCommitDelta, ac.text);
          }
        }

        if (allNonHumanOnlyChecked || newlyChecked.length > 0) {
          state.consecutiveEditedUnticked = 0;
          state.consecutiveEditedUntickedSubspecPath = null;
        }

        // Check if a blocker was added during this iteration
        const afterParse = parseSpec(readFileSync(afterSubspecPath, "utf8"));
        const hasBlockerNow = afterParse.blocker !== undefined;
        if (hasBlockerNow && !hasBlockerBefore) {
          const blockerBody = afterParse.blocker;
          if (!blockerBody) {
            throw new Error(`Blocker section added but body is missing in ${afterSubspecPath}`);
          }

          if (onlyHumanOnlyRemain(afterParse.acceptanceCriteria)) {
            // Only human-only criteria remain: strip blocker and continue
            stripBlockerAndContinueFile(afterSubspecPath);
            fanout("harness", `blocker stripped: only human-only acceptance criteria remain\n`, "stderr");
            writeTelemetry({
              agent: agent.name,
              iteration,
              durationMs: iterationDurationMs(),
              kind: "blocker-rejected",
              exitReason: "blocker-stripped-human-only",
              ...telemetryMeta,
              ...usageCost,
              ...(iterationWarnings !== undefined ? { warnings: iterationWarnings } : {}),
            });
            // Continue processing: treat as no blocker and check for completion
          } else {
            // Automated criteria remain: process the blocker normally
            // Record blocker in no-commit delta
            if (state.noCommitDelta !== null) {
              recordBlocker(state.noCommitDelta, blockerBody);
            }

            // Check if blocker is a claim about pre-existing failures
            const isClaim = detectBlockerClaim(blockerBody);
            const BLOCKER_CLAIM_REJECTION_BOUND = 2;
            const resetRejectionCounter = () => {
              if (state.consecutiveBlockerClaimRejectionsSubspecPath !== afterSubspecPath) {
                state.consecutiveBlockerClaimRejections = 0;
                state.consecutiveBlockerClaimRejectionsSubspecPath = afterSubspecPath;
              }
            };

            if (
              isClaim &&
              gitEnabled &&
              opts.runBaseRefTests !== undefined &&
              (state.consecutiveBlockerClaimRejectionsSubspecPath !== afterSubspecPath ||
                state.consecutiveBlockerClaimRejections < BLOCKER_CLAIM_REJECTION_BOUND)
            ) {
              // Validate the claim against base ref
              let baseRefGreen = false;
              try {
                // Resolve the actual base branch name (offline-first, then fallback)
                let baseBranch = "main"; // default fallback
                try {
                  // Try to get current branch name
                  const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
                    cwd: agentWorkingDir,
                    encoding: "utf8",
                    stdio: "pipe",
                  }).trim();
                  if (currentBranch && currentBranch !== "HEAD") {
                    // Try to get tracking branch from git config (local, no network)
                    try {
                      const trackingBranch = execFileSync("git", ["config", `branch.${currentBranch}.merge`], {
                        cwd: agentWorkingDir,
                        encoding: "utf8",
                        stdio: "pipe",
                      }).trim();
                      if (trackingBranch?.startsWith("refs/heads/")) {
                        baseBranch = trackingBranch.substring("refs/heads/".length);
                      }
                    } catch {
                      // Tracking info not available, use default
                    }
                  }
                } catch {
                  // Fall through: couldn't determine branch, use default
                }
                // Use local merge-base to resolve the base ref (offline, no network calls)
                baseRefGreen = await opts.runBaseRefTests(baseBranch);
              } catch (_err) {
                // Validation failure: fail-safe, blocker stands
                baseRefGreen = false;
              }

              if (baseRefGreen) {
                // Base ref is green: reject the claim blocker
                const currentSpecContent = readFileSync(afterSubspecPath, "utf8");
                const strippedContent = stripBlockerSection(currentSpecContent);
                writeFileSync(afterSubspecPath, strippedContent, "utf8");

                // Update rejection tracking
                resetRejectionCounter();
                state.consecutiveBlockerClaimRejections += 1;

                // Emit rejection telemetry
                fanout(
                  "harness",
                  `blocker claim rejected: base ref validates green; cited failures do not reproduce\n`,
                  "stderr",
                );
                writeTelemetry({
                  agent: agent.name,
                  iteration,
                  durationMs: iterationDurationMs(),
                  kind: "blocker-rejected",
                  exitReason: "base-ref-green",
                  ...telemetryMeta,
                });

                // Continue the loop (do not exit 7, do not commit blocker)
                state.iteration += 1;
                return { kind: "continue" };
              } else {
                // Base ref is red or validation failed: check snapshot-churn gate
                resetRejectionCounter();

                if (opts.runSnapshotUpdateRetest !== undefined) {
                  // Invoke snapshot-update re-test seam
                  let snapshotRetest = false;
                  try {
                    snapshotRetest = await opts.runSnapshotUpdateRetest();
                  } catch (_err) {
                    // Seam error: fail-safe, blocker stands
                    snapshotRetest = false;
                  }

                  if (snapshotRetest) {
                    // Re-test green: snapshot churn detected, reject the blocker
                    const currentSpecContent = readFileSync(afterSubspecPath, "utf8");
                    const strippedContent = stripBlockerSection(currentSpecContent);
                    writeFileSync(afterSubspecPath, strippedContent, "utf8");

                    // Increment rejection counter (reset already happened above)
                    state.consecutiveBlockerClaimRejections += 1;

                    // Emit rejection telemetry
                    fanout(
                      "harness",
                      `blocker claim rejected (snapshot-churn): snapshot-update re-test passes; failures were outdated snapshots\n`,
                      "stderr",
                    );
                    writeTelemetry({
                      agent: agent.name,
                      iteration,
                      durationMs: iterationDurationMs(),
                      kind: "blocker-rejected",
                      exitReason: "snapshot-churn",
                      ...telemetryMeta,
                    });

                    // Continue the loop (do not exit 7, do not commit blocker)
                    state.iteration += 1;
                    return { kind: "continue" };
                  }
                }
              }
            } else {
              // Non-claim blocker or bound hit: reset rejection counter
              resetRejectionCounter();
            }

            // Commit and exit 7 for blockers that stand
            if (gitEnabled) {
              try {
                commitWipProgressWithBlocker(afterSubspecPath, {
                  cwd: agentWorkingDir,
                  newlyChecked,
                  checkedTotal,
                  total: afterCriteria.length,
                  blockerBody,
                  agentLabel: agent.attributionLabel(),
                });
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                fanout("harness", `failed to commit blocker for ${afterSubspecPath}: ${message}\n`, "stderr");
                return { kind: "return", exitCode: 1 };
              }

              // Try to install deps if they changed (before push so lockfile commit gets pushed)
              maybeInstallDeps(agent.attributionLabel());

              if (!opts.skipGhCheck) {
                try {
                  const firstPush = !hasUpstream(agentWorkingDir);
                  pushCurrent({ cwd: agentWorkingDir, firstPush });
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  fanout("harness", `failed to push blocker commit for ${afterSubspecPath}: ${message}\n`, "stderr");
                  return { kind: "return", exitCode: 1 };
                }
              }
            }

            const blockerText = `${afterSubspecPath}\n\n${blockerBody}`;
            fanout("harness", `${blockerText}\n`, "stderr");
            writeTelemetry({
              agent: agent.name,
              iteration,
              durationMs: iterationDurationMs(),
              kind: "blocked",
              exitReason: "blocker-detected",
              ...telemetryMeta,
            });
            // Record this run's delta on incomplete exit to overwrite any prior delta
            if (state.noCommitDelta !== null && afterSubspecPath !== undefined) {
              saveDelta(state.noCommitDelta);
            }
            return { kind: "return", exitCode: 7 };
          }
        }

        if (allNonHumanOnlyChecked) {
          // Check for all-human-only edit signal guard
          if (allHumanOnly) {
            // All criteria are human-only: can only complete if there are code changes
            const currentHead = execFileSync("git", ["rev-parse", "HEAD"], {
              cwd: agentWorkingDir,
              encoding: "utf8",
              stdio: "pipe",
            }).trim();
            const hasCodeChanges = state.runStartHead !== null && state.runStartHead !== currentHead;
            if (!hasCodeChanges) {
              // No code changes for all-human-only subspec, don't auto-complete
              subspecProgressed = false;
              // Fall through to the "no progress" logic below
            } else if (gitEnabled) {
              try {
                commitSubspec(afterSubspecPath, {
                  cwd: agentWorkingDir,
                  agentLabel: agent.attributionLabel(),
                  ...(allHumanOnly ? { humanOnlyCount: humanOnlyUnchecked.length, total: afterCriteria.length } : {}),
                });
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                fanout("harness", `failed to commit completed subspec ${afterSubspecPath}: ${message}\n`, "stderr");
                return { kind: "return", exitCode: 1 };
              }

              // Try to install deps if they changed (before push so lockfile commit gets pushed)
              maybeInstallDeps(agent.attributionLabel());

              if (!opts.skipGhCheck) {
                try {
                  const firstPush = !hasUpstream(agentWorkingDir);
                  pushCurrent({ cwd: agentWorkingDir, firstPush });
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  fanout("harness", `failed to push completed subspec ${afterSubspecPath}: ${message}\n`, "stderr");
                  return { kind: "return", exitCode: 1 };
                }

                try {
                  let _createdThisIteration = false;
                  const base = await getBaseBranch(agentWorkingDir);
                  const branch = getCurrentBranch(agentWorkingDir);
                  if (!state.draftPrEnsured) {
                    const prBody = async (): Promise<string> =>
                      generatePrBody(
                        afterSpecPath,
                        agent,
                        agentWorkingDir,
                        cfg.modes.patch.prNarrative ?? "template",
                        base,
                        {
                          signal: iterationController.signal,
                          abortKillGraceMs: killGraceMs,
                          onSpawned: ({ pid }) => {
                            watchdogPgid = pid;
                          },
                        },
                      );
                    const footer = renderAttributionSummary({
                      cwd: agentWorkingDir,
                      base,
                    });
                    const ensured = await ensureDraftPr({
                      branch,
                      base,
                      title: getIndexTitle(afterSpecPath),
                      bodyGenerator: prBody,
                      footer,
                      cwd: agentWorkingDir,
                    });
                    _createdThisIteration = ensured.created;
                    state.draftPrEnsured = true;
                  }
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  fanout(
                    "harness",
                    `failed to update PR for completed subspec ${afterSubspecPath}: ${message}\n`,
                    "stderr",
                  );
                  return { kind: "return", exitCode: 1 };
                }
              }
              subspecCompleted = true;
            }
          } else if (gitEnabled) {
            try {
              commitSubspec(afterSubspecPath, {
                cwd: agentWorkingDir,
                agentLabel: agent.attributionLabel(),
                ...(humanOnlyUnchecked.length > 0
                  ? { humanOnlyCount: humanOnlyUnchecked.length, total: afterCriteria.length }
                  : {}),
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              fanout("harness", `failed to commit completed subspec ${afterSubspecPath}: ${message}\n`, "stderr");
              return { kind: "return", exitCode: 1 };
            }

            // Try to install deps if they changed (before push so lockfile commit gets pushed)
            maybeInstallDeps(agent.attributionLabel());

            if (!opts.skipGhCheck) {
              try {
                const firstPush = !hasUpstream(agentWorkingDir);
                pushCurrent({ cwd: agentWorkingDir, firstPush });
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                fanout("harness", `failed to push completed subspec ${afterSubspecPath}: ${message}\n`, "stderr");
                return { kind: "return", exitCode: 1 };
              }

              try {
                let _createdThisIteration = false;
                const base = await getBaseBranch(agentWorkingDir);
                const branch = getCurrentBranch(agentWorkingDir);
                if (!state.draftPrEnsured) {
                  const prBody = async (): Promise<string> =>
                    generatePrBody(
                      afterSpecPath,
                      agent,
                      agentWorkingDir,
                      cfg.modes.patch.prNarrative ?? "template",
                      base,
                      {
                        signal: iterationController.signal,
                        abortKillGraceMs: killGraceMs,
                        onSpawned: ({ pid }) => {
                          watchdogPgid = pid;
                        },
                      },
                    );
                  const footer = renderAttributionSummary({
                    cwd: agentWorkingDir,
                    base,
                  });
                  const ensured = await ensureDraftPr({
                    branch,
                    base,
                    title: getIndexTitle(afterSpecPath),
                    bodyGenerator: prBody,
                    footer,
                    cwd: agentWorkingDir,
                  });
                  _createdThisIteration = ensured.created;
                  state.draftPrEnsured = true;
                }
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                fanout(
                  "harness",
                  `failed to update PR for completed subspec ${afterSubspecPath}: ${message}\n`,
                  "stderr",
                );
                return { kind: "return", exitCode: 1 };
              }
            }
            subspecCompleted = true;
          }
        } else if (newlyChecked.length > 0) {
          subspecProgressed = true;
          if (gitEnabled) {
            try {
              commitWipProgress(afterSubspecPath, {
                cwd: agentWorkingDir,
                newlyChecked,
                checkedTotal,
                total: afterCriteria.length,
                humanOnlyCount: humanOnlyUnchecked.length,
                agentLabel: agent.attributionLabel(),
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              fanout("harness", `failed to commit WIP progress for ${afterSubspecPath}: ${message}\n`, "stderr");
              return { kind: "return", exitCode: 1 };
            }

            // Try to install deps if they changed
            maybeInstallDeps(agent.attributionLabel());
          }
        } else {
          if (gitEnabled) {
            const blocker = worktreeCompletionBlocker(agentWorkingDir);
            if (blocker !== undefined) {
              const EDITED_UNTICKED_BOUND = 2;
              if (activeSubspecPath !== undefined) {
                if (activeSubspecPath !== state.consecutiveEditedUntickedSubspecPath) {
                  state.consecutiveEditedUnticked = 0;
                  state.consecutiveEditedUntickedSubspecPath = activeSubspecPath;
                }
                state.consecutiveEditedUnticked += 1;
                if (state.consecutiveEditedUnticked < EDITED_UNTICKED_BOUND) {
                  state.iteration += 1;
                  return { kind: "continue" };
                }
              }
              const unchecked = afterCriteria.filter((c) => !c.checked);
              const unmetList = unchecked.map((c) => `  - ${c.text}`).join("\n");
              const worktreeName = basename(agentWorkingDir);
              fanout(
                "harness",
                `iteration ${iteration} edited files but checked no new acceptance criteria for ${afterSubspecPath}; ${blocker}\n\nUnmet acceptance criteria:\n${unmetList}\n\nInspect the dirty worktree, then tick satisfied acceptance criteria, fix, or revert before rerunning. Worktree: ${agentWorkingDir}\n\nRun \`jarvis1 triage ${worktreeName}\` to inspect state and see suggested next moves.\n`,
                "stderr",
              );
              // Record this run's delta on incomplete exit to overwrite any prior delta
              if (state.noCommitDelta !== null && afterSubspecPath !== undefined) {
                saveDelta(state.noCommitDelta);
              }
              return { kind: "return", exitCode: 6 };
            }
          }
        }
      }

      if (preIterationHead !== null) {
        accumulateImplementationTouchedFiles(
          agentWorkingDir,
          dirname(afterSpecPath),
          preIterationHead,
          logging.implementationTouchedFiles,
        );
      }
      const after = countUnchecked(afterSpecPath);
      if (after === 0) {
        // tryFinishSpecIfDone returns null only when countUnchecked !== 0;
        // we just observed after === 0 so it returns 0 (spec complete) or 6
        // (worktree blocker). Default to 0 if it ever races to null.
        const done = (await tryFinishSpecIfDone(ctx)) ?? 0;
        if (done !== 10) {
          writeTelemetry({
            agent: agent.name,
            iteration,
            durationMs: iterationDurationMs(),
            kind: "ok",
            exitReason: "criteria-complete",
            ...telemetryMeta,
            ...usageCost,
            ...(iterationWarnings !== undefined ? { warnings: iterationWarnings } : {}),
          });
        }
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "ok",
          exitReason: done === 10 ? "ready-gate-failed" : "completed-spec",
          record_role: "run_terminal",
          ...telemetryMeta,
        });
        // Clear no-commit delta on clean completion
        if (done === 0 && hasUntrackedMutations && afterSubspecPath !== undefined) {
          clearDelta(afterSubspecPath);
        }
        return { kind: "return", exitCode: done };
      }
      if (after === before && !subspecCompleted && !subspecProgressed) {
        activeAgents.shift();
        if (activeAgents.length > 0) {
          fanout("harness", `${agent.name}: ${HARNESS_NO_PROGRESS_FALLBACK}\n`, "stderr");
          writeTelemetry({
            agent: agent.name,
            iteration,
            durationMs: iterationDurationMs(),
            kind: "ok",
            exitReason: "no-progress-fallback",
            ...telemetryMeta,
            ...usageCost,
            ...(iterationWarnings !== undefined ? { warnings: iterationWarnings } : {}),
          });
          state.iteration += 1;
          return { kind: "continue" };
        }

        printBoundedTail(opts, [...state.latestIterationStdout, ...state.latestIterationStderr]);
        fanout("harness", `iteration ${iteration} made no progress; stopping\n`, "stderr");

        if (afterSubspecPath !== undefined) {
          const untickedCriteria = snapshotAcceptanceCriteria(afterSubspecPath).filter((c) => !c.checked);
          if (untickedCriteria.length > 0) {
            const criteriaList = untickedCriteria.map((c) => `  - ${c.text}`).join("\n");
            fanout(
              "harness",
              `\nUnticked acceptance criteria:\n${criteriaList}\n\nIf the work is done, tick the satisfied acceptance criteria and rerun.\n`,
              "stderr",
            );
          }
        }

        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "ok",
          exitReason: "no-progress",
          ...telemetryMeta,
          ...usageCost,
          ...(iterationWarnings !== undefined ? { warnings: iterationWarnings } : {}),
        });
        // Record this run's delta on incomplete exit to overwrite any prior delta
        if (state.noCommitDelta !== null && activeSubspecPath !== undefined) {
          saveDelta(state.noCommitDelta);
        }
        return { kind: "return", exitCode: 4 };
      }
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "ok",
        exitReason: "criteria-progress",
        ...telemetryMeta,
        ...usageCost,
        ...(iterationWarnings !== undefined ? { warnings: iterationWarnings } : {}),
      });
      // Record this run's delta on incomplete loopback to overwrite any prior delta
      if (state.noCommitDelta !== null && activeSubspecPath !== undefined) {
        saveDelta(state.noCommitDelta);
      }
      state.iteration += 1;
      return { kind: "continue" };
    }
    if (result.kind === "quota") {
      activeAgents.shift();
      if (result.authFailure === true) {
        fanout("harness", `${agent.name}: ${harnessAuthRotateLine(agent.name)}\n`, "stderr");
      } else {
        fanout("harness", `${agent.name}: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`, "stderr");
      }
      if (activeAgents.length === 0) {
        fanout("harness", `${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`, "stderr");
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "quota",
          exitReason: "quota-exhausted",
          ...telemetryMeta,
        });
        return { kind: "return", exitCode: 2 };
      }
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "quota",
        exitReason: "quota-fallback",
        ...telemetryMeta,
      });
      state.iteration += 1;
      return { kind: "continue" };
    }
    if (result.kind === "model_config") {
      const entry = cfg.modes.patch.agentOrder.find((e) => e.agent === agent.name);
      const configErr = `${agent.name}: configured patch model ${JSON.stringify(entry?.model)} is not supported by this CLI/account\n`;
      fanout("harness", configErr, "stderr");
      if (result.stderr.length > 0) {
        const stderr = result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`;
        fanout("harness", stderr, "stderr");
      }
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "model_config",
        exitReason: "model-config",
        ...telemetryMeta,
      });
      return { kind: "return", exitCode: 3 };
    }

    let newlyCheckedCriteria: AcceptanceCriterion[] = [];
    if (afterSubspecPath !== undefined) {
      const afterCriteria = snapshotAcceptanceCriteria(afterSubspecPath);
      newlyCheckedCriteria = diffAcceptanceCriteria(beforeCriteria, afterCriteria);
    }
    const isGitWorktree = existsSync(join(agentWorkingDir, ".git"));
    const checkedAnyCriteria = newlyCheckedCriteria.length > 0;
    const editedTrackedFiles = isGitWorktree ? hasTrackedWorktreeChanges(agentWorkingDir) : false;
    const noIterationProgress = !checkedAnyCriteria && !editedTrackedFiles;
    const classified = binding.classify(result, noIterationProgress);
    if (classified.kind === "quota") {
      activeAgents.shift();
      fanout("harness", `${agent.name}: ${harnessQuotaFallbackLenientLine(result.exitCode)}\n`, "stderr");
      if (result.stderr.length > 0) {
        const stderr = result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`;
        fanout("harness", stderr, "stderr");
      }
      if (activeAgents.length === 0) {
        fanout("harness", `${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`, "stderr");
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "quota",
          exitReason: "quota-exhausted",
          ...telemetryMeta,
        });
        return { kind: "return", exitCode: 2 };
      }
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "quota",
        exitReason: "probable-quota-fallback",
        ...telemetryMeta,
      });
      state.iteration += 1;
      return { kind: "continue" };
    }

    if (result.stderr.length > 0) {
      const stderr = result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`;
      fanout("harness", stderr, "stderr");
    }
    if (isGitWorktree && !noIterationProgress) {
      if (afterSubspecPath !== undefined) {
        const afterCriteria = snapshotAcceptanceCriteria(afterSubspecPath);
        const humanOnlyUnchecked = afterCriteria.filter((c) => c.humanOnly && !c.checked);
        const checkedTotal = afterCriteria.filter((c) => c.checked).length;
        try {
          commitWipProgress(afterSubspecPath, {
            cwd: agentWorkingDir,
            newlyChecked: newlyCheckedCriteria,
            checkedTotal,
            total: afterCriteria.length,
            humanOnlyCount: humanOnlyUnchecked.length,
            agentLabel: agent.attributionLabel(),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          fanout(
            "harness",
            `failed to commit agent-error WIP progress for ${afterSubspecPath}: ${message}\n`,
            "stderr",
          );
          return { kind: "return", exitCode: 1 };
        }
      }
    }
    writeTelemetry({
      agent: agent.name,
      iteration,
      durationMs: iterationDurationMs(),
      kind: "error",
      exitReason: "agent-error",
      ...telemetryMeta,
    });
    return { kind: "return", exitCode: 3 };
  } finally {
    patchWatchdogTiming.clearTimeout(iterationTimeoutHandle);
    if (idleTimeoutHandle !== null) {
      clearTimeout(idleTimeoutHandle);
    }
    if (watchdogKillHandle !== null) {
      clearTimeout(watchdogKillHandle);
    }
    // Stop sampling, take one final snapshot, and reap descendants that escaped
    // the process group kill. Best-effort: never throws, never affects the exit
    // code or stop reason.
    if (descendantPollHandle !== null) {
      clearInterval(descendantPollHandle);
    }
    if (watchdogPgid !== null) {
      ctx.descendantTracker.poll(watchdogPgid);
    }
    try {
      (opts.__testReapFn ?? (() => ctx.descendantTracker.reap()))();
    } catch {
      // best-effort
    }
  }
}

function printBoundedTail(opts: RunCommandOptions, lines: string[]): void {
  const tail = lines.slice(-40);
  for (const line of tail) {
    opts.io.stdout(`${line}\n`);
  }
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

async function _confirmFromStdin(_prompt: string): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const newline = buffer.indexOf(10);
    if (newline !== -1) {
      chunks.push(buffer.subarray(0, newline));
      break;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function getSpecDisplayName(specPath: string): string {
  if (basename(specPath) === "index.md") {
    return basename(dirname(specPath));
  }
  return basename(specPath);
}
