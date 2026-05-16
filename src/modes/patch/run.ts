import { execFileSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { ClaudeAgent } from "../../agents/claude.ts";
import { CodexAgent } from "../../agents/codex.ts";
import { CursorAgent } from "../../agents/cursor.ts";
import { OpencodeAgent } from "../../agents/opencode.ts";
import { isWeakQuotaSignal } from "../../agents/quota.ts";
import type { Agent } from "../../agents/types.ts";
import type { Io } from "../../cli.ts";
import { readGitOriginUrl } from "../../commands/init.ts";
import {
  type AgentName,
  type Config,
  type ConfigOptions,
  effectiveGit,
  findProjectMatchForPath,
  getClaudeOutputFormat,
  openSessionLog,
  type ProjectMatch,
  setProjectOrigin,
} from "../../config.ts";
import { assertGhReady, getBaseBranch } from "../../gh.ts";
import type { LogClient } from "../../logging.ts";
import { checkPrExists, ensureDraftPr, renderAttribution } from "../../pr.ts";
import { computeCost } from "../../prices/cost.ts";
import { loadPrices } from "../../prices/load.ts";
import { appendTelemetryLine, type TelemetryKind } from "../../telemetry.ts";
import {
  createWorktreeSymlinks,
  ensureWorktree,
  pushCurrent,
  worktreeCompletionBlocker,
} from "../../worktree.ts";
import {
  acquireWorktreeLock,
  releaseWorktreeLock,
} from "../../worktree-lock.ts";
import {
  type DisambiguateFn,
  runSharedPreflight,
  type SharedPreflightOpts,
} from "../shared-entry.ts";
import {
  countUnchecked,
  getActiveLinkedSubspecPath,
  getFirstUncheckedTask,
} from "./completion.ts";
import {
  buildPrBody,
  generatePrBodyFromSpec,
  maybeMarkReady,
  updatePrBody,
} from "./pr.ts";
import { buildPrompt } from "./prompt.ts";
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
};

type LogTag = "harness" | "outbound" | "inbound_stdout" | "inbound_stderr";
type LogStream = "stdout" | "stderr" | null;
type LogAnnotations = Record<string, string | number | boolean | null>;

type Fanout = (
  tag: LogTag,
  text: string,
  stream: LogStream,
  annotations?: LogAnnotations,
) => void;

type SendLog = (
  tag: LogTag,
  text: string,
  annotations?: LogAnnotations,
) => void;

type WriteSessionLine = (tag: LogTag, line: string) => void;

type WriteTelemetry = (record: {
  agent: string;
  iteration: number;
  durationMs: number;
  kind: TelemetryKind;
  exitReason: string;
  usage?: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
  usage_source?: "agent" | "unavailable";
  cost_usd?: number | null;
  cost_source?: "agent" | "computed" | "no-price" | "no-usage";
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

type PreflightResult =
  | PreflightOk
  | { kind: "error"; exitCode: number }
  | { kind: "exit"; exitCode: number };

type LoggingContext = {
  fanout: Fanout;
  sendLog: SendLog;
  writeSessionLine: WriteSessionLine;
  writeTelemetry: WriteTelemetry;
  sessionFd: number;
  logClient: LogClient;
  runNamespace: string;
  specDisplayName: string;
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
        return outcome.exitCode;
      }
      if (outcome.kind === "exit") {
        process.exit(outcome.exitCode);
      }
      // continue
    }
  } finally {
    finalize(ctx, globalTimeoutHandle, onSigint);
  }
}

async function resolveModeSpecificPreflight(
  opts: RunCommandOptions,
  initialSpecPath: string,
  project: ProjectMatch,
  projectMode: "registered" | "ad-hoc",
  cfg: Config,
): Promise<PreflightResult> {
  const gitEnabled = effectiveGit(
    cfg,
    projectMode === "registered" ? project.key : undefined,
  );

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
  if (
    gitEnabled &&
    !opts.skipGhCheck &&
    !existsSync(join(project.root, ".git"))
  ) {
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
      createWorktreeSymlinks(
        project.root,
        agentWorkingDir,
        cfg.worktreeSymlinks,
      );

      const lockResult = acquireWorktreeLock(agentWorkingDir);
      if (lockResult.kind === "busy") {
        const lockInfo = lockResult.existingLock;
        opts.io.stderr(
          `worktree is in use by process ${lockInfo.pid} (started at ${lockInfo.started_at})\n`,
        );
        return { kind: "error", exitCode: 9 };
      }
      if (lockResult.kind === "recovered") {
        stalepidRecovered = lockResult.stalepid;
      }
      worktreeLocked = true;
    } catch (err) {
      opts.io.stderr(
        `failed to create or resume worktree: ${(err as Error).message}\n`,
      );
      return { kind: "error", exitCode: 1 };
    }
  }
  let specPath = prepareActiveSpecPath({
    projectRoot: project.root,
    agentWorkingDir,
    specPath: initialSpecPath,
  });
  const additionalReadDirs = specOutsideWorktreeReadDirs({
    specPath,
    agentWorkingDir,
  });

  let isIndexSpec = basename(specPath) === "index.md";
  if (!isIndexSpec) {
    const specDir = dirname(specPath);
    const siblingIndex = resolve(specDir, "index.md");
    const hasSiblingIndex = existsSync(siblingIndex);

    const promptLines = [
      `${specPath} is not an index spec.`,
      ...(hasSiblingIndex
        ? ["  [s] switch to ./index.md and run normally"]
        : []),
      "  [e] exit",
      "Choice [e]: ",
    ];
    const promptText = promptLines.join("\n");
    opts.io.stdout(promptText);
    const answer = (await (opts.confirmRun ?? confirmFromStdin)(promptText))
      .trim()
      .toLowerCase();

    if (answer === "s" && hasSiblingIndex) {
      specPath = siblingIndex;
      isIndexSpec = true;
    } else {
      // e, empty input, or unrecognized
      return { kind: "exit", exitCode: 0 };
    }
  }

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

function buildActiveAgents(opts: RunCommandOptions, cfg: Config): Agent[] {
  const overrides = opts.agents;
  const agents: Agent[] = [];
  for (const entry of cfg.modes.patch.agentOrder) {
    const override = overrides?.[entry.agent];
    if (override !== undefined) {
      agents.push(override);
      continue;
    }
    agents.push(makeAgent(entry.agent, entry.model, cfg));
  }
  return agents;
}

function makeAgent(name: AgentName, model: string, cfg: Config): Agent {
  switch (name) {
    case "claude":
      return new ClaudeAgent({
        model,
        outputFormat: getClaudeOutputFormat(cfg),
      });
    case "codex":
      return new CodexAgent({ model });
    case "cursor":
      return new CursorAgent({ model });
    case "opencode":
      return new OpencodeAgent({ model });
  }
}

function setupLogging(
  opts: RunCommandOptions,
  preflight: PreflightOk,
  logClient: LogClient,
): LoggingContext {
  const cfg = preflight.cfg;

  const specDisplayName = getSpecDisplayName(preflight.specPath);
  const runNamespace = `${preflight.project.key}:${specDisplayName}`;
  const telemetryPath = cfg.telemetryPath ?? null;

  const writeTelemetry: WriteTelemetry = (record) => {
    try {
      appendTelemetryLine(telemetryPath, {
        ts: new Date().toISOString(),
        namespace: runNamespace,
        agent: record.agent,
        iteration: record.iteration,
        duration_ms: record.durationMs,
        kind: record.kind,
        exit_reason: record.exitReason,
        ...(record.usage !== undefined ? { usage: record.usage } : {}),
        ...(record.usage_source !== undefined
          ? { usage_source: record.usage_source }
          : {}),
        ...(record.cost_usd !== undefined ? { cost_usd: record.cost_usd } : {}),
        ...(record.cost_source !== undefined
          ? { cost_source: record.cost_source }
          : {}),
      });
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

  const writeLog = (
    tag: LogTag,
    text: string,
    annotations?: LogAnnotations,
  ): void => {
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
  };
}

function finalize(
  ctx: IterationContext,
  globalTimeoutHandle: NodeJS.Timeout | null,
  onSigint: () => void,
): void {
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

type UsageCostData = {
  usage?: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
  usage_source?: "agent" | "unavailable";
  cost_usd?: number | null;
  cost_source?: "agent" | "computed" | "no-price" | "no-usage";
};

function extractUsageAndCost(
  result: {
    usage_source?: "agent" | "unavailable";
    usage?: {
      input_tokens: number | null;
      output_tokens: number | null;
      cache_read_input_tokens: number | null;
      cache_creation_input_tokens: number | null;
    };
    cost_usd?: number | null;
  },
  agentName: string,
): UsageCostData {
  const output: UsageCostData = {};
  if (result.usage_source === "unavailable") {
    output.usage = {
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    };
    output.usage_source = "unavailable";
    output.cost_usd = null;
    output.cost_source = "no-usage";
    return output;
  }

  if (result.cost_usd !== undefined && result.cost_usd !== null) {
    // Agent provided cost directly (e.g., Claude with total_cost_usd)
    if (result.usage !== undefined) {
      output.usage = result.usage;
      output.usage_source = "agent";
    }
    output.cost_usd = result.cost_usd;
    output.cost_source = "agent";
    return output;
  }

  // If there's usage data but no cost, compute it
  if (result.usage !== undefined) {
    output.usage = result.usage;
    output.usage_source = "agent";
    try {
      const prices = loadPrices();
      const computedCost = computeCost(result.usage, agentName, prices);
      output.cost_usd = computedCost.cost_usd;
      if (computedCost.cost_source !== null) {
        output.cost_source = computedCost.cost_source;
      }
    } catch {
      // If price loading fails, just return usage without cost
    }
    return output;
  }

  return output;
}

async function runIteration(ctx: IterationContext): Promise<IterationOutcome> {
  const { preflight, logging, opts, activeAgents, state } = ctx;
  const { specPath, isIndexSpec, gitEnabled, agentWorkingDir, cfg } = preflight;
  const { fanout, writeTelemetry, specDisplayName } = logging;
  const iteration = state.iteration;
  const iterationStartedAt = Date.now();
  const iterationDurationMs = (): number => Date.now() - iterationStartedAt;

  if (isIndexSpec && iteration > cfg.maxIterations) {
    printBoundedTail(opts, [
      ...state.latestIterationStdout,
      ...state.latestIterationStderr,
    ]);
    fanout(
      "harness",
      `max iterations (${cfg.maxIterations}) reached; stopping\n`,
      "stderr",
    );
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
    writeTelemetry({
      agent: "harness",
      iteration,
      durationMs: iterationDurationMs(),
      kind: "ok",
      exitReason: "criteria-complete",
    });
    return { kind: "return", exitCode: done };
  }

  const agent = activeAgents[0];
  if (agent === undefined) {
    fanout("harness", "all agents quota-exhausted\n", "stderr");
    writeTelemetry({
      agent: "harness",
      iteration,
      durationMs: iterationDurationMs(),
      kind: "quota",
      exitReason: "quota-exhausted",
    });
    return { kind: "return", exitCode: 2 };
  }

  const task = getFirstUncheckedTask(specPath);
  const taskExcerpt = task.line.slice(0, 140);
  const activeSubspecPath = isIndexSpec
    ? getActiveLinkedSubspecPath(specPath)
    : undefined;

  // Check if the active subspec already has a blocker at the start
  if (activeSubspecPath !== undefined) {
    const parsedSubspec = parsePatchSpec(
      readFileSync(activeSubspecPath, "utf8"),
    );
    if (parsedSubspec.blocker !== undefined) {
      const blockerBody = parsedSubspec.blocker;
      const blockerText = blockerBody
        ? `${activeSubspecPath}\n\n${blockerBody}`
        : activeSubspecPath;
      fanout("harness", `${blockerText}\n`, "stderr");
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "blocked",
        exitReason: "blocker-detected",
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
        beforeParse.warnings.length === 0
          ? ""
          : ` Parser warnings:\n- ${beforeParse.warnings.join("\n- ")}`;
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
  const prompt = buildPrompt(specPath);
  fanout("outbound", prompt, null, {
    iteration,
    agent: agent.name,
  });

  // Create per-iteration abort controller
  state.currentController = new AbortController();
  const iterationTimeoutHandle = setTimeout(() => {
    state.currentController?.abort("iteration-timeout");
  }, cfg.iterationTimeoutMs);

  try {
    const result = await agent.run(prompt, {
      cwd: agentWorkingDir,
      ...(preflight.additionalReadDirs === undefined
        ? {}
        : { additionalReadDirs: preflight.additionalReadDirs }),
      signal: state.currentController.signal,
    });

    // Check for iteration timeout
    if (
      result.kind === "error" &&
      result.stderr.includes("aborted: iteration-timeout")
    ) {
      fanout(
        "harness",
        `iteration ${iteration} exceeded timeout of ${cfg.iterationTimeoutMs}ms\n`,
        "stderr",
      );
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "timeout",
        exitReason: "iteration-timeout",
      });
      return { kind: "return", exitCode: 8 };
    }

    // Check for global run timeout
    if (
      result.kind === "error" &&
      result.stderr.includes("aborted: run-timeout")
    ) {
      fanout(
        "harness",
        cfg.runTimeoutMs
          ? `run exceeded timeout of ${cfg.runTimeoutMs}ms\n`
          : "run timeout\n",
        "stderr",
      );
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "timeout",
        exitReason: "run-timeout",
      });
      return { kind: "return", exitCode: 8 };
    }

    // Check for SIGINT
    if (result.kind === "error" && result.stderr.includes("aborted: sigint")) {
      return { kind: "exit", exitCode: 130 };
    }

    if (result.kind === "ok") {
      // Extract usage and cost data from the agent result
      const usageCost = extractUsageAndCost(result, agent.name);
      if (
        agent.name === "opencode" &&
        usageCost.usage_source === "unavailable" &&
        !state.opencodeUnavailableNoted
      ) {
        fanout(
          "harness",
          "opencode: token usage not available for this CLI version (recording usage as unavailable)\n",
          "stderr",
        );
        state.opencodeUnavailableNoted = true;
      }
      if (
        agent.name === "cursor" &&
        usageCost.usage_source === "unavailable" &&
        !state.cursorUnavailableNoted
      ) {
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
      if (activeSubspecPath !== undefined) {
        const afterCriteria = snapshotAcceptanceCriteria(activeSubspecPath);
        const newlyChecked = diffAcceptanceCriteria(
          beforeCriteria,
          afterCriteria,
        );
        const allChecked =
          afterCriteria.length > 0 && afterCriteria.every((c) => c.checked);
        const checkedTotal = afterCriteria.filter((c) => c.checked).length;

        // Check if a blocker was added during this iteration
        const afterParse = parsePatchSpec(
          readFileSync(activeSubspecPath, "utf8"),
        );
        const hasBlockerNow = afterParse.blocker !== undefined;
        if (hasBlockerNow && !hasBlockerBefore) {
          const blockerBody = afterParse.blocker;
          if (!blockerBody) {
            throw new Error(
              `Blocker section added but body is missing in ${activeSubspecPath}`,
            );
          }

          if (gitEnabled) {
            try {
              commitWipProgressWithBlocker(activeSubspecPath, {
                cwd: agentWorkingDir,
                newlyChecked,
                checkedTotal,
                total: afterCriteria.length,
                blockerBody,
                agentLabel: agent.attributionLabel(),
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              fanout(
                "harness",
                `failed to commit blocker for ${activeSubspecPath}: ${message}\n`,
                "stderr",
              );
              return { kind: "return", exitCode: 1 };
            }

            if (!opts.skipGhCheck) {
              try {
                const firstPush = !hasUpstream(agentWorkingDir);
                pushCurrent({ cwd: agentWorkingDir, firstPush });
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : String(err);
                fanout(
                  "harness",
                  `failed to push blocker commit for ${activeSubspecPath}: ${message}\n`,
                  "stderr",
                );
                return { kind: "return", exitCode: 1 };
              }
            }
          }

          const blockerText = `${activeSubspecPath}\n\n${blockerBody}`;
          fanout("harness", `${blockerText}\n`, "stderr");
          writeTelemetry({
            agent: agent.name,
            iteration,
            durationMs: iterationDurationMs(),
            kind: "blocked",
            exitReason: "blocker-detected",
          });
          return { kind: "return", exitCode: 7 };
        }

        if (allChecked) {
          if (gitEnabled) {
            try {
              commitSubspec(activeSubspecPath, {
                cwd: agentWorkingDir,
                agentLabel: agent.attributionLabel(),
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              fanout(
                "harness",
                `failed to commit completed subspec ${activeSubspecPath}: ${message}\n`,
                "stderr",
              );
              return { kind: "return", exitCode: 1 };
            }

            if (!opts.skipGhCheck) {
              try {
                const firstPush = !hasUpstream(agentWorkingDir);
                pushCurrent({ cwd: agentWorkingDir, firstPush });
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : String(err);
                fanout(
                  "harness",
                  `failed to push completed subspec ${activeSubspecPath}: ${message}\n`,
                  "stderr",
                );
                return { kind: "return", exitCode: 1 };
              }

              try {
                let createdThisIteration = false;
                const base = await getBaseBranch(agentWorkingDir);
                const branch = getCurrentBranch(agentWorkingDir);
                if (!state.draftPrEnsured) {
                  const prBody = async (): Promise<string> =>
                    getDeterministicPrBody(specPath);
                  const footer = renderAttribution({
                    cwd: agentWorkingDir,
                    base,
                  });
                  const ensured = await ensureDraftPr({
                    branch,
                    base,
                    title: getIndexTitle(specPath),
                    bodyGenerator: prBody,
                    footer,
                    cwd: agentWorkingDir,
                  });
                  createdThisIteration = ensured.created;
                  state.draftPrEnsured = true;
                }
                if (!createdThisIteration) {
                  try {
                    updatePrBody({
                      indexPath: specPath,
                      branch,
                      base,
                      cwd: agentWorkingDir,
                    });
                  } catch (err) {
                    const message =
                      err instanceof Error ? err.message : String(err);
                    fanout(
                      "harness",
                      `failed to update PR body for ${activeSubspecPath}: ${message}\n`,
                      "stderr",
                    );
                  }
                }
                maybeMarkReady({
                  indexPath: specPath,
                  cwd: agentWorkingDir,
                });
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : String(err);
                fanout(
                  "harness",
                  `failed to update PR for completed subspec ${activeSubspecPath}: ${message}\n`,
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
              commitWipProgress(activeSubspecPath, {
                cwd: agentWorkingDir,
                newlyChecked,
                checkedTotal,
                total: afterCriteria.length,
                agentLabel: agent.attributionLabel(),
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              fanout(
                "harness",
                `failed to commit WIP progress for ${activeSubspecPath}: ${message}\n`,
                "stderr",
              );
              return { kind: "return", exitCode: 1 };
            }
          }
        } else {
          if (gitEnabled) {
            const blocker = worktreeCompletionBlocker(agentWorkingDir);
            if (blocker !== undefined) {
              const unchecked = afterCriteria.filter((c) => !c.checked);
              const unmetList = unchecked
                .map((c) => `  - ${c.text}`)
                .join("\n");
              const worktreeName = basename(agentWorkingDir);
              fanout(
                "harness",
                `iteration ${iteration} edited files but checked no new acceptance criteria for ${activeSubspecPath}; ${blocker}\n\nUnmet acceptance criteria:\n${unmetList}\n\nInspect the dirty worktree, then tick satisfied acceptance criteria, fix, or revert before rerunning. Worktree: ${agentWorkingDir}\n\nRun \`jarvis triage ${worktreeName}\` to inspect state and see suggested next moves.\n`,
                "stderr",
              );
              return { kind: "return", exitCode: 6 };
            }
          }
        }
      }
      const after = countUnchecked(specPath);
      if (after === 0) {
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "ok",
          exitReason: "criteria-complete",
          ...usageCost,
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
          ...usageCost,
        });
        return { kind: "return", exitCode: done };
      }
      if (!isIndexSpec) {
        fanout(
          "harness",
          "one-iteration run finished with unchecked tasks remaining\n",
          "stdout",
        );
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "ok",
          exitReason: "criteria-progress",
          ...usageCost,
        });
        return { kind: "return", exitCode: 0 };
      }
      if (after === before && !subspecCompleted && !subspecProgressed) {
        printBoundedTail(opts, [
          ...state.latestIterationStdout,
          ...state.latestIterationStderr,
        ]);
        fanout(
          "harness",
          `iteration ${iteration} made no progress; stopping\n`,
          "stderr",
        );
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "ok",
          exitReason: "no-progress",
          ...usageCost,
        });
        return { kind: "return", exitCode: 4 };
      }
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "ok",
        exitReason: "criteria-progress",
        ...usageCost,
      });
      state.iteration += 1;
      return { kind: "continue" };
    }
    if (result.kind === "quota") {
      activeAgents.shift();
      fanout(
        "harness",
        `${agent.name}: quota exhausted; falling back\n`,
        "stderr",
      );
      if (activeAgents.length === 0) {
        fanout("harness", "all agents quota-exhausted\n", "stderr");
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "quota",
          exitReason: "quota-exhausted",
        });
        return { kind: "return", exitCode: 2 };
      }
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "quota",
        exitReason: "quota-fallback",
      });
      state.iteration += 1;
      return { kind: "continue" };
    }
    if (result.kind === "model_config") {
      const entry = cfg.modes.patch.agentOrder.find(
        (e) => e.agent === agent.name,
      );
      const configErr = `${agent.name}: configured patch model ${JSON.stringify(entry?.model)} is not supported by this CLI/account\n`;
      fanout("harness", configErr, "stderr");
      if (result.stderr.length > 0) {
        const stderr = result.stderr.endsWith("\n")
          ? result.stderr
          : `${result.stderr}\n`;
        fanout("harness", stderr, "stderr");
      }
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "model_config",
        exitReason: "model-config",
      });
      return { kind: "return", exitCode: 3 };
    }

    let checkedAnyCriteria = false;
    if (activeSubspecPath !== undefined) {
      const afterCriteria = snapshotAcceptanceCriteria(activeSubspecPath);
      checkedAnyCriteria =
        diffAcceptanceCriteria(beforeCriteria, afterCriteria).length > 0;
    }
    const isGitWorktree = existsSync(join(agentWorkingDir, ".git"));
    const editedFiles = isGitWorktree
      ? worktreeCompletionBlocker(agentWorkingDir) !== undefined
      : false;
    const weakQuotaAllowed = cfg.quotaFallback !== "strict";
    const weakQuota = weakQuotaAllowed
      ? isWeakQuotaSignal(
          agent.name,
          result.exitCode,
          result.stderr,
          cfg.weakQuotaExitCodes,
        )
      : false;
    if (weakQuota && !checkedAnyCriteria && !editedFiles) {
      activeAgents.shift();
      fanout(
        "harness",
        `${agent.name}: probable quota-like error (exit ${result.exitCode}); falling back\n`,
        "stderr",
      );
      if (result.stderr.length > 0) {
        const stderr = result.stderr.endsWith("\n")
          ? result.stderr
          : `${result.stderr}\n`;
        fanout("harness", stderr, "stderr");
      }
      if (activeAgents.length === 0) {
        fanout("harness", "all agents quota-exhausted\n", "stderr");
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "quota",
          exitReason: "quota-exhausted",
        });
        return { kind: "return", exitCode: 2 };
      }
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "quota",
        exitReason: "probable-quota-fallback",
      });
      state.iteration += 1;
      return { kind: "continue" };
    }

    if (result.stderr.length > 0) {
      const stderr = result.stderr.endsWith("\n")
        ? result.stderr
        : `${result.stderr}\n`;
      fanout("harness", stderr, "stderr");
    }
    writeTelemetry({
      agent: agent.name,
      iteration,
      durationMs: iterationDurationMs(),
      kind: "error",
      exitReason: "agent-error",
    });
    return { kind: "return", exitCode: 3 };
  } finally {
    clearTimeout(iterationTimeoutHandle);
  }
}

async function tryFinishSpecIfDone(
  ctx: IterationContext,
): Promise<number | null> {
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
        `spec checklists are complete, but ${blocker}\n\nCommit and push from the worktree so the PR updates. Worktree: ${preflight.agentWorkingDir}\n\nRun \`jarvis triage ${worktreeName}\` to inspect state and see suggested next moves.\n`,
        "stderr",
      );
      return 6;
    }
  }
  logging.fanout("harness", "spec complete\n", "stdout");

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

function getDeterministicPrBody(specPath: string): string {
  const generated = generatePrBodyFromSpec(specPath).trim();
  // Strip the leading H1 (it lives in buildPrBody's header instead).
  const withoutH1 = generated.replace(/^#\s+.+\n*/, "").trim();
  const narrative = withoutH1 !== "" ? withoutH1 : "Auto-generated by jarvis";
  return buildPrBody({ indexPath: specPath, narrative });
}

function diffAcceptanceCriteria(
  before: AcceptanceCriterion[],
  after: AcceptanceCriterion[],
): AcceptanceCriterion[] {
  const beforeByText = new Map(before.map((c) => [c.text, c.checked]));
  const newlyChecked: AcceptanceCriterion[] = [];
  for (const c of after) {
    if (c.checked && beforeByText.get(c.text) === false) {
      newlyChecked.push(c);
    }
  }
  return newlyChecked;
}

function hasUpstream(cwd: string): boolean {
  try {
    execFileSync(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      {
        cwd,
        stdio: "pipe",
      },
    );
    return true;
  } catch {
    return false;
  }
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
  const output = execFileSync(
    "gh",
    ["pr", "view", branch, "--json", "url", "-q", ".url"],
    {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  const url = output.trim();
  return url || null;
}

export function specOutsideWorktreeReadDirs(opts: {
  specPath: string;
  agentWorkingDir: string;
}): string[] | undefined {
  const agentWorkingDir = resolve(opts.agentWorkingDir);
  const specPath = resolve(opts.specPath);
  const rel = relative(agentWorkingDir, specPath);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return undefined;
  }
  return [dirname(specPath)];
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
