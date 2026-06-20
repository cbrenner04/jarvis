import { execFileSync } from "node:child_process";
import { closeSync, existsSync, readFileSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseSpec } from "../../../../shared/spec-parser.ts";
import type { Agent } from "../../agents/types.ts";
import { readGitOriginUrl } from "../../commands/init.ts";
import { type Config, effectiveGit, openSessionLog, type ProjectMatch, resolveReviewPasses } from "../../config.ts";
import { assertGhReady, getBaseBranch } from "../../gh.ts";
import type { LogClient } from "../../logging.ts";
import { checkPrExists, ensureDraftPr, readBranchCommits, renderAttributionSummary } from "../../pr.ts";
import { generateTemplateNarrative } from "../../pr-shared.ts";
import {
  HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessQuotaFallbackLenientLine,
} from "../../quota-harness-messages.ts";
import { runReadyAndCommit } from "../../ready-gate.ts";
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
import {
  bestEffortFetch,
  createWorktreeSymlinks,
  ensureWorktree,
  getSpecName,
  hasUpstream,
  pushCurrent,
  worktreeCompletionBlocker,
} from "../../worktree.ts";
import { acquireWorktreeLock, releaseWorktreeLock } from "../../worktree-lock.ts";
import {
  countUnchecked,
  findBlockerInLinkedSubspecs,
  getActiveLinkedSubspecPath,
  getFirstUncheckedTask,
} from "./completion.ts";
import {
  type CompletionLoopbackSignal,
  diffAcceptanceCriteria,
  generatePrBody,
  getCurrentBranch,
  getIndexTitle,
  lookupPrUrl,
  tryFinishSpecIfDone,
} from "./completion-pipeline.ts";
import { createPatchInvocationBinding } from "./patch-invocation-binding.ts";
import { buildPrBody, generatePrDescription, maybeMarkReady, updatePrBody } from "./pr.ts";
import { findRelocatedSpecFile, refreshActiveSpecPath } from "./preflight.ts";
import { buildFixupPrompt, buildPrompt, readRepoGuidance } from "./prompt.ts";
import { collectSubtree, DESCENDANT_POLL_INTERVAL_MS, type DescendantTracker, listProcesses } from "./reap.ts";
import type {
  CompletionReadyGateResult,
  IterationContext,
  IterationOutcome,
  LoggingContext,
  PreflightOk,
  RunCommandOptions,
  RunIo,
} from "./run.ts";
import { accumulateImplementationTouchedFiles } from "./shrink.ts";
import {
  type AcceptanceCriterion,
  commitSubspec,
  commitWipProgress,
  commitWipProgressWithBlocker,
  snapshotAcceptanceCriteria,
  snapshotCommittedAcceptanceCriteria,
} from "./subspec.ts";

type LogTag = "harness" | "outbound" | "inbound_stdout" | "inbound_stderr";
type LogStream = "stdout" | "stderr" | null;
type LogAnnotations = Record<string, string | number | boolean | null>;

type Fanout = (tag: LogTag, text: string, stream: LogStream, annotations?: LogAnnotations) => void;

type SendLog = (tag: LogTag, text: string, annotations?: LogAnnotations) => void;

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
  watchdog_descendants_alive?: boolean;
}) => void;

type PreflightResult = PreflightOk | { kind: "error"; exitCode: number } | { kind: "exit"; exitCode: number };

function formatWatchdogDiagnosticsSuffix(
  lastOutputAgeMs: number | null,
  descendantsAlive: boolean | undefined,
): string {
  let suffix = ` last_output_age_ms=${lastOutputAgeMs === null ? "null" : String(lastOutputAgeMs)}`;
  if (descendantsAlive !== undefined) {
    suffix += ` watchdog_descendants_alive=${descendantsAlive}`;
  }
  return suffix;
}

function snapshotWatchdogDescendantsAlive(agentRootPid: number): boolean {
  const procs = listProcesses();
  if (procs.length === 0) {
    return false;
  }
  return collectSubtree(agentRootPid, procs).length > 0;
}

function killWatchdogWithDescendants(
  pgid: number,
  reason: string,
  fanout: Fanout,
  killGraceMs: number,
  lastOutputAgeMs: number | null,
): { descendantsAlive: boolean; killHandle: NodeJS.Timeout } {
  const descendantsAlive = snapshotWatchdogDescendantsAlive(pgid);
  const watchdogLine =
    `[watchdog] ${reason}; killing agent pgid ${pgid}` +
    formatWatchdogDiagnosticsSuffix(lastOutputAgeMs, descendantsAlive);
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
  let telemetryWrites = false;
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
        ...(record.watchdog_descendants_alive !== undefined
          ? { watchdog_descendants_alive: record.watchdog_descendants_alive }
          : {}),
      });
      telemetryWrites = true;
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
    patchIterationsCompletedForSummary: () => patchIterationsCompletedForSummary,
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

export async function runIteration(ctx: IterationContext): Promise<IterationOutcome> {
  const { preflight, logging, opts, activeAgents, state } = ctx;
  const { specPath, gitEnabled, agentWorkingDir, cfg } = preflight;
  const { fanout, writeTelemetry, specDisplayName } = logging;
  const iteration = state.iteration;
  const iterationStartedAt = Date.now();
  const iterationDurationMs = (): number => Date.now() - iterationStartedAt;

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
  let isFixupIteration = false;
  if (before === 0) {
    if (state.completionLoopbackSignal === null) {
      // Normal completion flow: tryFinishSpecIfDone returns null only when countUnchecked !== 0; since
      // we just observed before === 0 it returns either 0 (spec complete) or 6
      // (worktree blocker). Default to 0 if it ever races to null.
      const done = (await tryFinishSpecIfDone(ctx)) ?? 0;
      if (state.completionLoopbackSignal !== null) {
        // Red completion gate set a loop-back signal: run a fix-up iteration in
        // this same iteration (fall through to build the fix-up prompt below).
        isFixupIteration = true;
      } else {
        return { kind: "return", exitCode: done };
      }
    } else {
      // A loop-back signal carried over from a prior iteration's red completion
      // gate: run another fix-up iteration. The post-fix-up gate re-check (and
      // any completion) happens in the after === 0 block once the agent returns.
      isFixupIteration = true;
    }
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

  const configuredPatchModelEntry = cfg.modes.patch.agentOrder.find((entry: any) => entry.agent === agent.name);
  const telemetryMeta =
    configuredPatchModelEntry?.model !== undefined ? { configured_model: configuredPatchModelEntry.model } : {};
  const configuredPatchModel = configuredPatchModelEntry?.model;

  // For fix-up iterations, we don't get a task from the spec; instead we use the captured failure text
  const task = isFixupIteration ? null : getFirstUncheckedTask(specPath);
  const taskExcerpt = isFixupIteration ? "ready: fix bun run ready failure" : task?.line.slice(0, 140);
  const activeSubspecPath = isFixupIteration ? undefined : getActiveLinkedSubspecPath(specPath);
  const preIterationHead =
    gitEnabled && existsSync(join(agentWorkingDir, ".git"))
      ? execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: agentWorkingDir,
          encoding: "utf8",
          stdio: "pipe",
        }).trim()
      : null;

  // Check if the active subspec already has a blocker at the start
  // Skip for fix-up iterations since there's no active unchecked subspec
  if (!isFixupIteration && activeSubspecPath !== undefined) {
    const parsedSubspec = parseSpec(readFileSync(activeSubspecPath, "utf8"));
    if (parsedSubspec.blocker !== undefined) {
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

  // Handle uncommitted ticks at iteration start: if acceptance criteria are ticked
  // in the working tree but absent from committed HEAD, commit them as progress
  // and loop back without spawning the agent
  if (!isFixupIteration && activeSubspecPath !== undefined && gitEnabled) {
    const workingTreeCriteria = snapshotAcceptanceCriteria(activeSubspecPath);
    const committedCriteria = snapshotCommittedAcceptanceCriteria(activeSubspecPath, {
      cwd: agentWorkingDir,
    });
    const uncommittedTicks = diffAcceptanceCriteria(committedCriteria, workingTreeCriteria);
    if (uncommittedTicks.length > 0) {
      const allChecked = workingTreeCriteria.length > 0 && workingTreeCriteria.every((c) => c.checked);
      const checkedTotal = workingTreeCriteria.filter((c) => c.checked).length;
      try {
        if (allChecked) {
          commitSubspec(activeSubspecPath, {
            cwd: agentWorkingDir,
            agentLabel: agent.attributionLabel(),
          });
        } else {
          commitWipProgress(activeSubspecPath, {
            cwd: agentWorkingDir,
            newlyChecked: uncommittedTicks,
            checkedTotal,
            total: workingTreeCriteria.length,
            agentLabel: agent.attributionLabel(),
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        fanout("harness", `failed to commit uncommitted ticks for ${activeSubspecPath}: ${message}\n`, "stderr");
        return { kind: "return", exitCode: 1 };
      }

      if (!opts.skipGhCheck && allChecked) {
        try {
          const firstPush = !hasUpstream(agentWorkingDir);
          pushCurrent({ cwd: agentWorkingDir, firstPush });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          fanout("harness", `failed to push uncommitted-ticks commit for ${activeSubspecPath}: ${message}\n`, "stderr");
          return { kind: "return", exitCode: 1 };
        }
      }

      if (allChecked) {
        state.iteration += 1;
        const done = (await tryFinishSpecIfDone(ctx)) ?? 0;
        if (state.completionLoopbackSignal !== null) {
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
  if (!isFixupIteration && activeSubspecPath !== undefined) {
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
  const banner = isFixupIteration
    ? `project: ${preflight.project.key} | spec: ${specDisplayName} | iteration: ${iteration} | fix-up: ready failure | agent: ${agent.name}\n`
    : `project: ${preflight.project.key} | spec: ${specDisplayName} | iteration: ${iteration} | current-task: ${task?.ordinal}/${task?.total} ${taskExcerpt} | agent: ${agent.name}\n`;
  const bannerAnnotations: LogAnnotations = {
    project: preflight.project.key,
    spec: specDisplayName,
    iteration,
    agent: agent.name,
  };
  if (!isFixupIteration) {
    if (taskExcerpt !== undefined) {
      bannerAnnotations.currentTask = taskExcerpt;
    }
    if (task?.ordinal !== undefined) {
      bannerAnnotations.currentTaskOrdinal = task.ordinal;
    }
    if (task?.total !== undefined) {
      bannerAnnotations.currentTaskTotal = task.total;
    }
  }
  fanout("harness", banner, "stdout", bannerAnnotations);
  const projectSiblings = preflight.cfg.projects[preflight.project.key]?.siblings;
  const prompt = isFixupIteration
    ? buildFixupPrompt(specPath, state.completionLoopbackSignal?.failureText ?? "", projectSiblings)
    : buildPrompt(specPath, projectSiblings, {
        repoGuidance: readRepoGuidance(preflight.project.root),
        activeSubspecPath: activeSubspecPath ?? "",
        activeSubspecBody:
          activeSubspecPath !== undefined && existsSync(activeSubspecPath)
            ? readFileSync(activeSubspecPath, "utf8")
            : "",
      });
  fanout("outbound", prompt, null, {
    iteration,
    agent: agent.name,
  });

  // Create per-iteration abort controller
  state.currentController = new AbortController();
  const iterationController = state.currentController;
  const killGraceMs = opts.__testKillGraceMs ?? 5000;
  let watchdogPgid: number | null = null;
  let watchdogFired = false;
  let watchdogKillHandle: NodeJS.Timeout | null = null;
  let watchdogLastOutputAgeMs: number | null = null;
  let watchdogDescendantsAlive: boolean | undefined;
  let idleTimeoutHandle: NodeJS.Timeout | null = null;
  let idleWatchdogLastOutputAgeMs: number | null = null;
  let idleWatchdogDescendantsAlive: boolean | undefined;
  const lastOutputAtMs = { current: null as number | null };
  // Poll the agent's process subtree while it is alive so descendants that
  // later escape the process group (via setsid) and re-parent to init can be
  // reaped after the agent exits, when no live lineage to them remains.
  let descendantPollHandle: NodeJS.Timeout | null = null;
  const iterationTimeoutHandle = setTimeout(() => {
    watchdogFired = true;
    const snapshotAt = Date.now();
    watchdogLastOutputAgeMs = lastOutputAtMs.current === null ? null : snapshotAt - lastOutputAtMs.current;
    const pgid = watchdogPgid;
    if (pgid !== null) {
      const result = killWatchdogWithDescendants(
        pgid,
        `iteration timeout fired after ${cfg.iterationTimeoutMs}ms`,
        fanout,
        killGraceMs,
        watchdogLastOutputAgeMs,
      );
      watchdogDescendantsAlive = result.descendantsAlive;
      watchdogKillHandle = result.killHandle;
    }
    state.currentController?.abort("iteration-timeout");
  }, cfg.iterationTimeoutMs);

  // Arm idle watchdog if configured
  const armedAt = Date.now();
  const idleOutputTimeoutMs = cfg.idleOutputTimeoutMs;
  if (idleOutputTimeoutMs !== undefined) {
    const scheduleIdleCheck = () => {
      idleTimeoutHandle = setTimeout(() => {
        const snapshotAt = Date.now();
        const lastOutputAt = lastOutputAtMs.current ?? armedAt;
        const idleAgeMs = snapshotAt - lastOutputAt;
        if (idleAgeMs >= idleOutputTimeoutMs) {
          idleWatchdogLastOutputAgeMs = lastOutputAtMs.current === null ? null : snapshotAt - lastOutputAtMs.current;
          const pgid = watchdogPgid;
          if (pgid !== null) {
            const result = killWatchdogWithDescendants(
              pgid,
              `idle timeout fired after ${idleOutputTimeoutMs}ms`,
              fanout,
              killGraceMs,
              idleWatchdogLastOutputAgeMs,
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
      idleTimeoutHandle.unref();
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
      onSpawned: ({ pid }: { pid: number }) => {
        watchdogPgid = pid;
        // Record descendants immediately, then keep sampling while the agent
        // runs so escapees are captured before their lineage is severed.
        ctx.descendantTracker.poll(pid);
        descendantPollHandle = setInterval(() => {
          ctx.descendantTracker.poll(pid);
        }, DESCENDANT_POLL_INTERVAL_MS);
        descendantPollHandle.unref();
      },
    });

    // Disarm idle watchdog immediately after agent returns, before post-processing begins
    if (idleTimeoutHandle !== null) {
      clearTimeout(idleTimeoutHandle);
      idleTimeoutHandle = null;
    }

    // Check for idle timeout
    if (result.kind === "error" && result.stderr.includes("aborted: idle-timeout")) {
      fanout(
        "harness",
        `iteration ${iteration} exceeded idle timeout of ${cfg.idleOutputTimeoutMs ?? "?"}ms\n`,
        "stderr",
      );
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "timeout",
        exitReason: "watchdog-idle-timeout",
        ...telemetryMeta,
        ...(watchdogPgid !== null ? { watchdog_pgid: watchdogPgid } : {}),
        last_output_age_ms: idleWatchdogLastOutputAgeMs,
        ...(idleWatchdogDescendantsAlive !== undefined
          ? { watchdog_descendants_alive: idleWatchdogDescendantsAlive }
          : {}),
      });
      return { kind: "return", exitCode: 8 };
    }

    // Check for iteration timeout
    if (result.kind === "error" && result.stderr.includes("aborted: iteration-timeout")) {
      fanout("harness", `iteration ${iteration} exceeded timeout of ${cfg.iterationTimeoutMs}ms\n`, "stderr");
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "timeout",
        exitReason: watchdogFired ? "watchdog-iteration-timeout" : "iteration-timeout",
        ...telemetryMeta,
        ...(watchdogPgid !== null ? { watchdog_pgid: watchdogPgid } : {}),
        ...(watchdogFired ? { last_output_age_ms: watchdogLastOutputAgeMs } : {}),
        ...(watchdogFired && watchdogDescendantsAlive !== undefined
          ? { watchdog_descendants_alive: watchdogDescendantsAlive }
          : {}),
      });
      return { kind: "return", exitCode: 8 };
    }

    // Check for global run timeout
    if (result.kind === "error" && result.stderr.includes("aborted: run-timeout")) {
      fanout(
        "harness",
        cfg.runTimeoutMs ? `run exceeded timeout of ${cfg.runTimeoutMs}ms\n` : "run timeout\n",
        "stderr",
      );
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
        const allChecked = afterCriteria.length > 0 && afterCriteria.every((c) => c.checked);
        const checkedTotal = afterCriteria.filter((c) => c.checked).length;

        if (allChecked || newlyChecked.length > 0) {
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
          return { kind: "return", exitCode: 7 };
        }

        if (allChecked) {
          if (gitEnabled) {
            try {
              commitSubspec(afterSubspecPath, {
                cwd: agentWorkingDir,
                agentLabel: agent.attributionLabel(),
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              fanout("harness", `failed to commit completed subspec ${afterSubspecPath}: ${message}\n`, "stderr");
              return { kind: "return", exitCode: 1 };
            }

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
                // When post-completion shrink or review will run, defer PR
                // readiness to those phases.
                const implementationIterations = logging.patchIterationsCompletedForSummary() + 1;
                const willRunShrink = gitEnabled && implementationIterations > 0 && cfg.modes.patch.shrink !== "off";
                const willRunReview =
                  gitEnabled && resolveReviewPasses(cfg, opts.reviewPasses) > 0 && implementationIterations > 0;
                if (!willRunReview && !willRunShrink) {
                  maybeMarkReady({
                    indexPath: afterSpecPath,
                    cwd: agentWorkingDir,
                    agentLabel: agent.attributionLabel(),
                    ...(ctx.state.completionTransitionReadyResult !== undefined
                      ? { recordedGreenResult: ctx.state.completionTransitionReadyResult }
                      : {}),
                    refreshRecordedGreenResult: (headSha: string) => {
                      ctx.state.completionTransitionReadyResult = { headSha };
                    },
                  });
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
          }
          subspecCompleted = true;
        } else if (newlyChecked.length > 0) {
          subspecProgressed = true;
          if (gitEnabled) {
            try {
              commitWipProgress(afterSubspecPath, {
                cwd: agentWorkingDir,
                newlyChecked,
                checkedTotal,
                total: afterCriteria.length,
                agentLabel: agent.attributionLabel(),
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              fanout("harness", `failed to commit WIP progress for ${afterSubspecPath}: ${message}\n`, "stderr");
              return { kind: "return", exitCode: 1 };
            }
          }
          ctx.state.acProgressSinceLastGate = true;
        } else {
          if (gitEnabled) {
            const blocker = worktreeCompletionBlocker(agentWorkingDir);
            if (blocker !== undefined) {
              const EDITED_UNTICKED_BOUND = 2;
              if (!isFixupIteration && activeSubspecPath !== undefined) {
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
              return { kind: "return", exitCode: 6 };
            }
          }
        }
      }

      // For fix-up iterations, check for a blocker added during the iteration
      // without depending on an unchecked linked subspec (which doesn't exist at full completion).
      // The blocker check takes precedence over other completion processing.
      if (isFixupIteration) {
        const blockerInfo = findBlockerInLinkedSubspecs(afterSpecPath);
        if (blockerInfo !== undefined) {
          if (gitEnabled) {
            try {
              // For fix-up iterations, we don't have granular before/after criteria,
              // so we commit with empty checkedTotal
              commitWipProgressWithBlocker(blockerInfo.path, {
                cwd: agentWorkingDir,
                newlyChecked: [],
                checkedTotal: 0,
                total: 0,
                blockerBody: blockerInfo.body,
                agentLabel: agent.attributionLabel(),
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              fanout("harness", `failed to commit blocker for ${blockerInfo.path}: ${message}\n`, "stderr");
              return { kind: "return", exitCode: 1 };
            }

            if (!opts.skipGhCheck) {
              try {
                const firstPush = !hasUpstream(agentWorkingDir);
                pushCurrent({ cwd: agentWorkingDir, firstPush });
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                fanout("harness", `failed to push blocker commit for ${blockerInfo.path}: ${message}\n`, "stderr");
                return { kind: "return", exitCode: 1 };
              }
            }
          }

          const blockerText = `${blockerInfo.path}\n\n${blockerInfo.body}`;
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
        // tryFinishSpecIfDone returns null only when countUnchecked !== 0;
        // we just observed after === 0 so it returns 0 (spec complete) or 6
        // (worktree blocker). Default to 0 if it ever races to null.
        const done = (await tryFinishSpecIfDone(ctx)) ?? 0;
        // Check if a loop-back signal was set (red completion gate)
        if (state.completionLoopbackSignal !== null) {
          // Loop back for fix-up iteration: don't write the completion telemetry,
          // just continue to the next iteration
          state.iteration += 1;
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
      // For fix-up iterations, we don't check no-progress since all boxes are already checked;
      // instead we re-check ready at the start of the next iteration
      if (!isFixupIteration && after === before && !subspecCompleted && !subspecProgressed) {
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
      state.iteration += 1;
      return { kind: "continue" };
    }
    if (result.kind === "quota") {
      activeAgents.shift();
      fanout("harness", `${agent.name}: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`, "stderr");
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
      const entry = cfg.modes.patch.agentOrder.find((e: any) => e.agent === agent.name);
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

    let checkedAnyCriteria = false;
    if (afterSubspecPath !== undefined) {
      const afterCriteria = snapshotAcceptanceCriteria(afterSubspecPath);
      checkedAnyCriteria = diffAcceptanceCriteria(beforeCriteria, afterCriteria).length > 0;
    }
    const isGitWorktree = existsSync(join(agentWorkingDir, ".git"));
    const editedFiles = isGitWorktree ? worktreeCompletionBlocker(agentWorkingDir) !== undefined : false;
    const noIterationProgress = !checkedAnyCriteria && !editedFiles;
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
    clearTimeout(iterationTimeoutHandle);
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

async function confirmFromStdin(_prompt: string): Promise<string> {
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
