import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent } from "../../agents/types.ts";
import type { Io } from "../../cli.ts";
import { readGitOriginUrl } from "../../commands/init.ts";
import {
  type AgentName,
  type Config,
  type ConfigOptions,
  effectiveGit,
  findProjectMatchForPath,
  openSessionLog,
  type ProjectMatch,
  resolveReviewPasses,
  setProjectOrigin,
} from "../../config.ts";
import { assertGhReady, getBaseBranch } from "../../gh.ts";
import type { LogClient } from "../../logging.ts";
import { checkPrExists, ensureDraftPr, renderAttributionSummary } from "../../pr.ts";
import {
  HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessQuotaFallbackLenientLine,
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
import {
  createWorktreeSymlinks,
  ensureWorktree,
  hasUpstream,
  pushCurrent,
  worktreeCompletionBlocker,
} from "../../worktree.ts";
import { acquireWorktreeLock, releaseWorktreeLock } from "../../worktree-lock.ts";
import { type DisambiguateFn, runSharedPreflight, type SharedPreflightOpts } from "../shared-entry.ts";
import { countUnchecked, getActiveLinkedSubspecPath, getFirstUncheckedTask } from "./completion.ts";
import { buildPrBody, generatePrDescription, maybeMarkReady, updatePrBody } from "./pr.ts";
import { buildPrompt } from "./prompt.ts";
import { runPatchReviewPhase } from "./review.ts";
import { accumulateImplementationTouchedFiles, runPatchShrinkPhase } from "./shrink.ts";
import { parsePatchSpec } from "./spec.ts";
import {
  type AcceptanceCriterion,
  commitSubspec,
  commitWipProgress,
  commitWipProgressWithBlocker,
  snapshotAcceptanceCriteria,
} from "./subspec.ts";

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
  /**
   * Test-only override for the watchdog/abort SIGKILL grace period in
   * milliseconds. Lets timing tests bound their wall-clock cost without
   * waiting the full 5s grace for SIGTERM-ignoring grandchildren. Defaults
   * to 5000ms; production callers must not set this.
   */
  __testKillGraceMs?: number;
};

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
}) => void;

type PreflightOk = {
  kind: "ok";
  project: ProjectMatch;
  projectMode: "registered" | "ad-hoc";
  cfg: Config;
  gitEnabled: boolean;
  agentWorkingDir: string;
  worktreeLocked: boolean;
  stalepidRecovered: number | undefined;
  specPath: string;
  isIndexSpec: boolean;
  additionalReadDirs: string[] | undefined;
};

type PreflightResult = PreflightOk | { kind: "error"; exitCode: number } | { kind: "exit"; exitCode: number };

type LoggingContext = {
  fanout: Fanout;
  sendLog: SendLog;
  writeSessionLine: WriteSessionLine;
  writeTelemetry: WriteTelemetry;
  sessionFd: number;
  logClient: LogClient;
  runNamespace: string;
  specDisplayName: string;
  hasTelemetryWrites: () => boolean;
  patchIterationsCompletedForSummary: () => number;
  implementationTouchedFiles: Set<string>;
};

type IterationContext = {
  preflight: PreflightOk;
  logging: LoggingContext;
  opts: RunCommandOptions;
  activeAgents: Agent[];
  state: {
    iteration: number;
    latestIterationStdout: string[];
    latestIterationStderr: string[];
    draftPrEnsured: boolean;
    opencodeUnavailableNoted: boolean;
    cursorUnavailableNoted: boolean;
    currentController: AbortController | null;
  };
};

type IterationOutcome =
  | { kind: "continue" }
  | { kind: "return"; exitCode: number }
  | { kind: "exit"; exitCode: number };

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

  const state = {
    iteration: 1,
    latestIterationStdout: [] as string[],
    latestIterationStderr: [] as string[],
    draftPrEnsured: false,
    opencodeUnavailableNoted: false,
    cursorUnavailableNoted: false,
    currentController: null as AbortController | null,
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

async function resolveModeSpecificPreflight(
  opts: RunCommandOptions,
  initialSpecPath: string,
  project: ProjectMatch,
  projectMode: "registered" | "ad-hoc",
  cfg: Config,
): Promise<PreflightResult> {
  const gitEnabled = effectiveGit(cfg, projectMode === "registered" ? project.key : undefined);

  if (opts.cwdFlag !== undefined && gitEnabled) {
    opts.io.stderr(
      'error: --cwd is only valid when effective `git` is false; set "git": false in config to use --cwd\n',
    );
    return { kind: "error", exitCode: 1 };
  }
  let cwdOverride: string | undefined;
  if (opts.cwdFlag !== undefined) {
    cwdOverride = resolve(opts.cwdFlag);
    if (!existsSync(cwdOverride)) {
      opts.io.stderr(`error: --cwd directory does not exist: ${cwdOverride}\n`);
      return { kind: "error", exitCode: 1 };
    }
  }
  if (gitEnabled && !opts.skipGhCheck && !existsSync(join(project.root, ".git"))) {
    opts.io.stderr(
      'error: target is not a git checkout; set "git": false in config or pass --repo to a git checkout\n',
    );
    return { kind: "error", exitCode: 1 };
  }

  // Lazily populate `origin` for a registered project whose record is missing
  // it. Failures here do not block the run. Skipped in ad-hoc mode.
  if (projectMode === "registered") {
    try {
      const match = findProjectMatchForPath(project.root, opts.config);
      if (match !== undefined && match.origin === undefined) {
        const origin = readGitOriginUrl(match.root);
        if (origin !== undefined) {
          setProjectOrigin(match.key, origin, opts.config);
        }
      }
    } catch {
      // best-effort
    }
  }

  if (!opts.skipGhCheck && gitEnabled) {
    try {
      await assertGhReady();
    } catch (err) {
      opts.io.stderr(`${(err as Error).message}\n`);
      return { kind: "error", exitCode: 1 };
    }
  }

  let agentWorkingDir = cwdOverride ?? project.root;
  let worktreeLocked = false;
  let stalepidRecovered: number | undefined;
  if (!opts.skipGhCheck && gitEnabled) {
    try {
      agentWorkingDir = await ensureWorktree(project.root, initialSpecPath);
      createWorktreeSymlinks(project.root, agentWorkingDir, cfg.worktreeSymlinks);

      const lockResult = acquireWorktreeLock(agentWorkingDir);
      if (lockResult.kind === "busy") {
        const lockInfo = lockResult.existingLock;
        opts.io.stderr(`worktree is in use by process ${lockInfo.pid} (started at ${lockInfo.started_at})\n`);
        return { kind: "error", exitCode: 9 };
      }
      if (lockResult.kind === "recovered") {
        stalepidRecovered = lockResult.stalepid;
      }
      worktreeLocked = true;
    } catch (err) {
      opts.io.stderr(`failed to create or resume worktree: ${(err as Error).message}\n`);
      return { kind: "error", exitCode: 1 };
    }
  }
  let specPath = prepareActiveSpecPath({
    projectRoot: project.root,
    agentWorkingDir,
    specPath: initialSpecPath,
  });
  const specDirs = specOutsideWorktreeReadDirs({
    specPath,
    agentWorkingDir,
  });
  const projectSiblings = cfg.projects[project.key]?.siblings ?? [];
  for (const sibling of projectSiblings) {
    if (!existsSync(sibling)) {
      opts.io.stderr(
        `error: configured sibling ${JSON.stringify(sibling)} does not exist for project ${JSON.stringify(project.key)}\n`,
      );
      return { kind: "error", exitCode: 1 };
    }
  }
  const additionalReadDirs =
    specDirs !== undefined || projectSiblings.length > 0
      ? [...new Set([...(specDirs ?? []), ...projectSiblings])]
      : undefined;

  let isIndexSpec = basename(specPath) === "index.md";
  if (!isIndexSpec) {
    const specDir = dirname(specPath);
    const siblingIndex = resolve(specDir, "index.md");
    const hasSiblingIndex = existsSync(siblingIndex);

    const promptLines = [
      `${specPath} is not an index spec.`,
      ...(hasSiblingIndex ? ["  [s] switch to ./index.md and run normally"] : []),
      "  [e] exit",
      "Choice [e]: ",
    ];
    const promptText = promptLines.join("\n");
    opts.io.stdout(promptText);
    const answer = (await (opts.confirmRun ?? confirmFromStdin)(promptText)).trim().toLowerCase();

    if (answer === "s" && hasSiblingIndex) {
      specPath = siblingIndex;
      isIndexSpec = true;
    } else {
      // e, empty input, or unrecognized
      return { kind: "exit", exitCode: 0 };
    }
  }

  maybeWarnAboutUnmergedPlanBranch({
    io: opts.io,
    projectRoot: project.root,
    specPath,
    gitEnabled,
  });

  return {
    kind: "ok",
    project,
    projectMode,
    cfg,
    gitEnabled,
    agentWorkingDir,
    worktreeLocked,
    stalepidRecovered,
    specPath,
    isIndexSpec,
    additionalReadDirs,
  };
}

function deriveSpecNameFromPath(specPath: string): string {
  return basename(dirname(resolve(specPath)));
}

function readRemoteHeadBranch(projectRoot: string): string | null {
  try {
    const output = execFileSync("git", ["ls-remote", "--symref", "origin", "HEAD"], {
      cwd: projectRoot,
      env: process.env,
      stdio: "pipe",
      encoding: "utf8",
    });
    for (const line of output.split("\n")) {
      const match = /^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/.exec(line.trim());
      if (match?.[1]) {
        return match[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function readRemoteHeadSha(projectRoot: string, ref: string): string | null {
  try {
    const output = execFileSync("git", ["ls-remote", "--heads", "origin", ref], {
      cwd: projectRoot,
      env: process.env,
      stdio: "pipe",
      encoding: "utf8",
    });
    const firstLine = output
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (firstLine === undefined) {
      return null;
    }
    const sha = firstLine.split(/\s+/)[0];
    return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export function maybeWarnAboutUnmergedPlanBranch(args: {
  io: RunIo;
  projectRoot: string;
  specPath: string;
  gitEnabled: boolean;
}): void {
  if (!args.gitEnabled) {
    return;
  }
  const specName = deriveSpecNameFromPath(args.specPath);
  const planRef = `plan/${specName}`;
  const planSha = readRemoteHeadSha(args.projectRoot, planRef);
  if (planSha === null) {
    return;
  }

  const defaultBranch = readRemoteHeadBranch(args.projectRoot);
  if (defaultBranch === null) {
    return;
  }
  const defaultSha = readRemoteHeadSha(args.projectRoot, defaultBranch);
  if (defaultSha === null) {
    return;
  }

  const mergeCheck = spawnSync("git", ["merge-base", "--is-ancestor", planSha, defaultSha], {
    cwd: args.projectRoot,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (mergeCheck.status !== 1) {
    return;
  }
  args.io.stderr(
    `warning: a plan branch ${planRef} exists on origin and has not been merged. Run \`jarvis1 run\` after merging the plan PR to avoid drift between the spec on disk and the merged spec.\n`,
  );
}

function buildActiveAgents(opts: RunCommandOptions, cfg: Config): Agent[] {
  const overrides = opts.agents;
  const agents: Agent[] = [];
  for (const entry of cfg.modes.patch.agentOrder) {
    const override = overrides?.[entry.agent];
    if (override !== undefined) {
      agents.push(override);
      continue;
    }
    agents.push(createAgent(entry.agent, entry.model));
  }
  return agents;
}

function setupLogging(opts: RunCommandOptions, preflight: PreflightOk, logClient: LogClient): LoggingContext {
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

function finalize(
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
    case 130:
      return "sigint";
    default:
      return `exit-${exitCode}`;
  }
}

async function runIteration(ctx: IterationContext): Promise<IterationOutcome> {
  const { preflight, logging, opts, activeAgents, state } = ctx;
  const { specPath, isIndexSpec, gitEnabled, agentWorkingDir, cfg } = preflight;
  const { fanout, writeTelemetry, specDisplayName } = logging;
  const iteration = state.iteration;
  const iterationStartedAt = Date.now();
  const iterationDurationMs = (): number => Date.now() - iterationStartedAt;

  if (isIndexSpec && iteration > cfg.maxIterations) {
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
    // tryFinishSpecIfDone returns null only when countUnchecked !== 0; since
    // we just observed before === 0 it returns either 0 (spec complete) or 6
    // (worktree blocker). Default to 0 if it ever races to null.
    const done = (await tryFinishSpecIfDone(ctx)) ?? 0;
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
  const telemetryMeta =
    configuredPatchModelEntry?.model !== undefined ? { configured_model: configuredPatchModelEntry.model } : {};
  const configuredPatchModel = configuredPatchModelEntry?.model;

  const task = getFirstUncheckedTask(specPath);
  const taskExcerpt = task.line.slice(0, 140);
  const activeSubspecPath = isIndexSpec ? getActiveLinkedSubspecPath(specPath) : undefined;
  const preIterationHead =
    gitEnabled && existsSync(join(agentWorkingDir, ".git"))
      ? execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: agentWorkingDir,
          encoding: "utf8",
          stdio: "pipe",
        }).trim()
      : null;

  // Check if the active subspec already has a blocker at the start
  if (activeSubspecPath !== undefined) {
    const parsedSubspec = parsePatchSpec(readFileSync(activeSubspecPath, "utf8"));
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

  let beforeCriteria: AcceptanceCriterion[] = [];
  let hasBlockerBefore = false;
  if (activeSubspecPath !== undefined) {
    const beforeParse = parsePatchSpec(readFileSync(activeSubspecPath, "utf8"));
    hasBlockerBefore = beforeParse.blocker !== undefined;
    beforeCriteria = snapshotAcceptanceCriteria(activeSubspecPath);
    if (beforeCriteria.length === 0) {
      const warningsSuffix =
        beforeParse.warnings.length === 0 ? "" : ` Parser warnings:\n- ${beforeParse.warnings.join("\n- ")}`;
      fanout(
        "harness",
        `active subspec ${activeSubspecPath} has no \`## Acceptance criteria\` checkboxes; jarvis cannot detect completion. Add an acceptance-criteria checklist to the subspec and rerun.${warningsSuffix}\n`,
        "stderr",
      );
      return { kind: "return", exitCode: 1 };
    }
  }
  const banner = `project: ${preflight.project.key} | spec: ${specDisplayName} | iteration: ${iteration} | current-task: ${task.ordinal}/${task.total} ${taskExcerpt} | agent: ${agent.name}\n`;
  fanout("harness", banner, "stdout", {
    project: preflight.project.key,
    spec: specDisplayName,
    iteration,
    currentTask: taskExcerpt,
    currentTaskOrdinal: task.ordinal,
    currentTaskTotal: task.total,
    agent: agent.name,
  });
  const projectSiblings = preflight.cfg.projects[preflight.project.key]?.siblings;
  const prompt = buildPrompt(specPath, projectSiblings);
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
  const iterationTimeoutHandle = setTimeout(() => {
    watchdogFired = true;
    const pgid = watchdogPgid;
    if (pgid !== null) {
      const watchdogLine = `[watchdog] iteration timeout fired after ${cfg.iterationTimeoutMs}ms; killing agent pgid ${pgid}`;
      fanout("harness", `${watchdogLine}\n`, "stderr");
      try {
        process.kill(-pgid, "SIGTERM");
      } catch {
        // best-effort, spawn-layer abort handler still runs.
      }
      watchdogKillHandle = setTimeout(() => {
        try {
          process.kill(-pgid, "SIGKILL");
        } catch {
          // best-effort
        }
      }, killGraceMs);
      watchdogKillHandle.unref();
    }
    state.currentController?.abort("iteration-timeout");
  }, cfg.iterationTimeoutMs);

  try {
    const result = await agent.run(prompt, {
      cwd: agentWorkingDir,
      ...(preflight.additionalReadDirs === undefined ? {} : { additionalReadDirs: preflight.additionalReadDirs }),
      signal: state.currentController.signal,
      abortKillGraceMs: killGraceMs,
      onSpawned: ({ pid }) => {
        watchdogPgid = pid;
      },
    });

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

        // Check if a blocker was added during this iteration
        const afterParse = parsePatchSpec(readFileSync(afterSubspecPath, "utf8"));
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
                let createdThisIteration = false;
                const base = await getBaseBranch(agentWorkingDir);
                const branch = getCurrentBranch(agentWorkingDir);
                if (!state.draftPrEnsured) {
                  const prBody = async (): Promise<string> =>
                    generatePrBody(afterSpecPath, agent, agentWorkingDir, {
                      signal: iterationController.signal,
                      abortKillGraceMs: killGraceMs,
                      onSpawned: ({ pid }) => {
                        watchdogPgid = pid;
                      },
                    });
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
                  createdThisIteration = ensured.created;
                  state.draftPrEnsured = true;
                }
                if (!createdThisIteration) {
                  try {
                    await updatePrBody({
                      indexPath: afterSpecPath,
                      branch,
                      base,
                      cwd: agentWorkingDir,
                      agent,
                      runOptions: {
                        signal: iterationController.signal,
                        abortKillGraceMs: killGraceMs,
                        onSpawned: ({ pid }) => {
                          watchdogPgid = pid;
                        },
                      },
                    });
                  } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    fanout("harness", `failed to update PR body for ${afterSubspecPath}: ${message}\n`, "stderr");
                  }
                }
                // When post-completion shrink or review will run, defer PR
                // readiness to those phases.
                const implementationIterations = logging.patchIterationsCompletedForSummary() + 1;
                const willRunShrink = gitEnabled && implementationIterations > 0;
                const willRunReview =
                  gitEnabled && resolveReviewPasses(cfg, opts.reviewPasses) > 0 && implementationIterations > 0;
                if (!willRunReview && !willRunShrink) {
                  maybeMarkReady({
                    indexPath: afterSpecPath,
                    cwd: agentWorkingDir,
                    agentLabel: agent.attributionLabel(),
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
        } else {
          if (gitEnabled) {
            const blocker = worktreeCompletionBlocker(agentWorkingDir);
            if (blocker !== undefined) {
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
      if (!isIndexSpec) {
        fanout("harness", "one-iteration run finished with unchecked tasks remaining\n", "stdout");
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
        return { kind: "return", exitCode: 0 };
      }
      if (after === before && !subspecCompleted && !subspecProgressed) {
        printBoundedTail(opts, [...state.latestIterationStdout, ...state.latestIterationStderr]);
        fanout("harness", `iteration ${iteration} made no progress; stopping\n`, "stderr");

        // If active subspec is resolvable, name its unticked criteria for operator recovery
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

    let checkedAnyCriteria = false;
    if (afterSubspecPath !== undefined) {
      const afterCriteria = snapshotAcceptanceCriteria(afterSubspecPath);
      checkedAnyCriteria = diffAcceptanceCriteria(beforeCriteria, afterCriteria).length > 0;
    }
    const isGitWorktree = existsSync(join(agentWorkingDir, ".git"));
    const editedFiles = isGitWorktree ? worktreeCompletionBlocker(agentWorkingDir) !== undefined : false;
    const noIterationProgress = !checkedAnyCriteria && !editedFiles;
    const classified = applyQuotaFallbackWhenAllowed(
      agent.name,
      result,
      {
        quotaFallback: cfg.quotaFallback,
        weakQuotaExitCodes: cfg.weakQuotaExitCodes,
      },
      noIterationProgress,
    );
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
    if (watchdogKillHandle !== null) {
      clearTimeout(watchdogKillHandle);
    }
  }
}

async function tryFinishSpecIfDone(ctx: IterationContext): Promise<number | null> {
  const { preflight, logging } = ctx;
  if (countUnchecked(preflight.specPath) !== 0) {
    return null;
  }
  if (preflight.gitEnabled) {
    const blocker = worktreeCompletionBlocker(preflight.agentWorkingDir);
    if (blocker !== undefined) {
      const worktreeName = basename(preflight.agentWorkingDir);
      logging.fanout(
        "harness",
        `spec checklists are complete, but ${blocker}\n\nCommit and push from the worktree so the PR updates. Worktree: ${preflight.agentWorkingDir}\n\nRun \`jarvis1 triage ${worktreeName}\` to inspect state and see suggested next moves.\n`,
        "stderr",
      );
      return 6;
    }
  }
  logging.fanout("harness", "spec complete\n", "stdout");

  const reviewPasses = resolveReviewPasses(preflight.cfg, ctx.opts.reviewPasses);
  const implementationIterations = logging.patchIterationsCompletedForSummary();
  const shouldRunShrink = preflight.gitEnabled && implementationIterations > 0;
  const shouldRunReview = preflight.gitEnabled && reviewPasses > 0 && implementationIterations > 0;

  if (shouldRunShrink) {
    const { fanout, writeTelemetry } = ctx.logging;
    try {
      await runPatchShrinkPhase({
        config: preflight.cfg,
        cwd: preflight.agentWorkingDir,
        specPath: preflight.specPath,
        allowlist: logging.implementationTouchedFiles,
        fanout,
        writeTelemetry,
        ...(ctx.opts.agents !== undefined ? { agents: ctx.opts.agents } : {}),
        iterationTimeoutMs: preflight.cfg.iterationTimeoutMs,
        ...(ctx.opts.__testKillGraceMs !== undefined ? { __testKillGraceMs: ctx.opts.__testKillGraceMs } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fanout("harness", `shrink phase error: ${message}\n`, "stderr");
    }
  }

  if (shouldRunReview) {
    const { fanout, writeTelemetry } = ctx.logging;
    let reviewExitCode: number;
    try {
      reviewExitCode = await runPatchReviewPhase({
        config: preflight.cfg,
        cwd: preflight.agentWorkingDir,
        specPath: preflight.specPath,
        ...(ctx.opts.reviewPasses !== undefined ? { reviewPassesOverride: ctx.opts.reviewPasses } : {}),
        fanout,
        writeTelemetry,
        ...(ctx.opts.agents !== undefined ? { agents: ctx.opts.agents } : {}),
        iterationTimeoutMs: preflight.cfg.iterationTimeoutMs,
        ...(ctx.opts.__testKillGraceMs !== undefined ? { __testKillGraceMs: ctx.opts.__testKillGraceMs } : {}),
        actuatorAgents: ctx.activeAgents,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fanout("harness", `review phase error: ${message}\n`, "stderr");
      reviewExitCode = 1;
    }
    if (reviewExitCode !== 0) {
      return reviewExitCode;
    }
  } else if (preflight.gitEnabled) {
    try {
      maybeMarkReady({
        indexPath: preflight.specPath,
        cwd: preflight.agentWorkingDir,
        agentLabel: "patch-complete",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logging.fanout("harness", `warning: failed to mark PR ready: ${message}\n`, "stderr");
    }
  }

  // Try to look up and print the PR URL
  if (preflight.gitEnabled) {
    try {
      const branch = getCurrentBranch(preflight.agentWorkingDir);
      const url = lookupPrUrl(branch, preflight.agentWorkingDir);
      if (url) {
        logging.fanout("harness", `${url}\n`, "stdout");
      }
    } catch (error) {
      logging.fanout(
        "harness",
        `warning: failed to look up PR URL: ${error instanceof Error ? error.message : String(error)}\n`,
        "stdout",
      );
    }
  }

  return 0;
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

function getSpecDisplayName(specPath: string): string {
  if (basename(specPath) === "index.md") {
    return basename(dirname(specPath));
  }
  return basename(specPath);
}

function getIndexTitle(indexPath: string): string {
  const content = readFileSync(indexPath, "utf8");
  const match = content.match(/^#\s+(.+)$/m);
  if (!match?.[1]) {
    return getSpecDisplayName(indexPath);
  }
  return match[1].trim();
}

async function generatePrBody(
  specPath: string,
  agent: Agent,
  cwd: string,
  runOptions?: Parameters<typeof generatePrDescription>[0]["runOptions"],
): Promise<string> {
  const narrative = await generatePrDescription({
    specPath,
    agent,
    cwd,
    ...(runOptions === undefined ? {} : { runOptions }),
  });
  return buildPrBody({
    indexPath: specPath,
    narrative: narrative ?? "Auto-generated by jarvis",
    generatedNarrative: true,
  });
}

function diffAcceptanceCriteria(before: AcceptanceCriterion[], after: AcceptanceCriterion[]): AcceptanceCriterion[] {
  const beforeByText = new Map(before.map((c) => [c.text, c.checked]));
  const newlyChecked: AcceptanceCriterion[] = [];
  for (const c of after) {
    if (c.checked && beforeByText.get(c.text) === false) {
      newlyChecked.push(c);
    }
  }
  return newlyChecked;
}

function getCurrentBranch(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function lookupPrUrl(branch: string, cwd: string): string | null {
  // First check if a PR exists; if not, return null silently
  const prNumber = checkPrExists(branch, cwd);
  if (!prNumber) {
    return null;
  }

  // PR exists, so look up the URL
  const output = execFileSync("gh", ["pr", "view", branch, "--json", "url", "-q", ".url"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  const url = output.trim();
  return url || null;
}

export function specOutsideWorktreeReadDirs(opts: { specPath: string; agentWorkingDir: string }): string[] | undefined {
  const agentWorkingDir = resolve(opts.agentWorkingDir);
  const specPath = resolve(opts.specPath);
  const rel = relative(agentWorkingDir, specPath);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return undefined;
  }
  return [dirname(specPath)];
}

function refreshActiveSpecPath(preflight: PreflightOk): string {
  const activeSpecPath = findRelocatedSpecFile(preflight.specPath, preflight.agentWorkingDir);
  preflight.specPath = activeSpecPath;
  return activeSpecPath;
}

function findRelocatedSpecFile(previousPath: string, searchRoot: string): string {
  if (existsSync(previousPath)) {
    return previousPath;
  }

  const previousDirName = basename(dirname(previousPath));
  const previousFileName = basename(previousPath);
  const matches: string[] = [];
  findRelocatedSpecFileMatches(resolve(searchRoot), previousDirName, previousFileName, matches);

  return matches.length === 1 ? (matches[0] ?? previousPath) : previousPath;
}

function findRelocatedSpecFileMatches(dir: string, parentName: string, fileName: string, matches: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      findRelocatedSpecFileMatches(entryPath, parentName, fileName, matches);
      continue;
    }

    if (entry.isFile() && entry.name === fileName && basename(dirname(entryPath)) === parentName) {
      matches.push(entryPath);
    }
  }
}

export function prepareActiveSpecPath(opts: {
  projectRoot: string;
  agentWorkingDir: string;
  specPath: string;
}): string {
  const projectRoot = resolve(opts.projectRoot);
  const agentWorkingDir = resolve(opts.agentWorkingDir);
  const specPath = resolve(opts.specPath);
  if (projectRoot === agentWorkingDir) {
    return specPath;
  }

  const relativeSpecPath = relative(projectRoot, specPath);
  if (relativeSpecPath.startsWith("..") || relativeSpecPath.startsWith("/")) {
    return specPath;
  }

  const activeSpecPath = resolve(agentWorkingDir, relativeSpecPath);
  if (!existsSync(activeSpecPath)) {
    copyMissingRecursive(dirname(specPath), dirname(activeSpecPath));
  }
  return activeSpecPath;
}

function copyMissingRecursive(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (existsSync(targetPath)) {
      if (entry.isDirectory()) {
        copyMissingRecursive(sourcePath, targetPath);
      }
      continue;
    }

    cpSync(sourcePath, targetPath, {
      recursive: entry.isDirectory(),
      force: false,
      errorOnExist: false,
    });
  }
}
