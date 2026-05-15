import { execFileSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
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
import { readGitOriginUrl } from "../../commands/init.ts";
import {
  type AgentName,
  type Config,
  type ConfigOptions,
  effectiveGit,
  findProjectMatchForPath,
  loadConfig,
  openSessionLog,
  type ProjectMatch,
  setProjectOrigin,
} from "../../config.ts";
import {
  type DisambiguationResult,
  promptForProject,
} from "../../disambiguation-prompt.ts";
import { assertGhReady, getBaseBranch } from "../../gh.ts";
import type { LogClient } from "../../logging.ts";
import { runModeLogPreflight } from "../../mode-entry.ts";
import { ensureDraftPr, renderAttribution } from "../../pr.ts";
import { resolveTargetRepo } from "../../repo.ts";
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

export type RunIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type ConfirmRun = (prompt: string) => string | Promise<string>;

export type DisambiguateFn = (opts: {
  candidates: ProjectMatch[];
  reason: string;
  io: RunIo;
}) => Promise<DisambiguationResult> | DisambiguationResult;

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

  const preflight = await resolveAndPreflight(opts, initialSpecPath);
  if (preflight.kind === "error") {
    return preflight.exitCode;
  }
  if (preflight.kind === "exit") {
    return preflight.exitCode;
  }

  const activeAgents = buildActiveAgents(opts, preflight.cfg);

  const loggingSetup = await setupLogging(opts, preflight);
  if (loggingSetup.kind === "error") {
    return loggingSetup.exitCode;
  }
  const logging = loggingSetup.logging;

  const state = {
    iteration: 1,
    latestIterationStdout: [] as string[],
    latestIterationStderr: [] as string[],
    draftPrEnsured: false,
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

async function resolveAndPreflight(
  opts: RunCommandOptions,
  initialSpecPath: string,
): Promise<PreflightResult> {
  const projectResolution = await resolveProjectFromSpec({
    specPath: initialSpecPath,
    repoFlag: opts.repoFlag,
    config: opts.config,
    io: opts.io,
    disambiguate: opts.disambiguate,
  });
  if (projectResolution.error !== undefined) {
    opts.io.stderr(`${projectResolution.error}\n`);
    return { kind: "error", exitCode: 1 };
  }
  const project = projectResolution.project;
  const projectMode = projectResolution.mode;
  const projectSource = projectResolution.source;

  // Preflight: the resolved project root must exist on disk before any
  // side-effecting work (worktree, gh, agent spawn, session log open).
  // A registered or spec-`repo:`-named root may have been moved or
  // deleted; an ad-hoc walk may land on a `.git` whose parent has been
  // removed. Without this check, the failure surfaces several call sites
  // later as a misleading `posix_spawn 'gh' ENOENT`, since `posix_spawn`
  // returns ENOENT when the child's `cwd` does not exist.
  const projectRootCheck = checkProjectRootExists(project.root);
  if (!projectRootCheck.ok) {
    opts.io.stderr(
      `${formatMissingProjectRootError({
        path: project.root,
        projectKey: project.key,
        source: projectSource,
        repoFlag: opts.repoFlag,
        reason: projectRootCheck.reason,
      })}\n`,
    );
    return { kind: "error", exitCode: 1 };
  }
  const cfg = loadConfig(opts.config);
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
    agents.push(makeAgent(entry.agent, entry.model));
  }
  return agents;
}

function makeAgent(name: AgentName, model: string): Agent {
  switch (name) {
    case "claude":
      return new ClaudeAgent({ model });
    case "codex":
      return new CodexAgent({ model });
    case "cursor":
      return new CursorAgent({ model });
    case "opencode":
      return new OpencodeAgent({ model });
  }
}

async function setupLogging(
  opts: RunCommandOptions,
  preflight: PreflightOk,
): Promise<
  { kind: "ok"; logging: LoggingContext } | { kind: "error"; exitCode: number }
> {
  const cfg = preflight.cfg;
  const preflightOpts: Parameters<typeof runModeLogPreflight>[0] = {
    io: { stderr: opts.io.stderr },
    logServerUrl: cfg.logServerUrl,
  };
  if (opts.logClient !== undefined) {
    preflightOpts.logClient = opts.logClient;
  }
  const logServerResult = await runModeLogPreflight(preflightOpts);
  if (logServerResult.kind === "error") {
    return { kind: "error", exitCode: logServerResult.exitCode };
  }
  const logClient = logServerResult.logClient;

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
    kind: "ok",
    logging: {
      fanout,
      sendLog,
      writeSessionLine,
      writeTelemetry,
      sessionFd,
      logClient,
      runNamespace,
      specDisplayName,
    },
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
        });
        return { kind: "return", exitCode: 4 };
      }
      writeTelemetry({
        agent: agent.name,
        iteration,
        durationMs: iterationDurationMs(),
        kind: "ok",
        exitReason: "criteria-progress",
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

async function resolveProjectFromSpec(opts: {
  specPath: string;
  repoFlag?: string | undefined;
  config?: ConfigOptions | undefined;
  io: RunIo;
  disambiguate?: DisambiguateFn | undefined;
}): Promise<{
  project: ProjectMatch;
  mode: "registered" | "ad-hoc";
  source?: "repo-flag" | "spec-repo" | "registered" | "ad-hoc";
  error?: string;
}> {
  const specRepoRaw = readRepoPath(opts.specPath);
  const specRepo =
    specRepoRaw === undefined || specRepoRaw.trim() === ""
      ? undefined
      : specRepoRaw.trim();

  // Reject relative `repo:` values up front (kept from prior behavior).
  if (
    specRepo !== undefined &&
    /[\\/]/.test(specRepo) &&
    !isAbsolute(specRepo) &&
    !looksLikeUrlOrSlug(specRepo)
  ) {
    return {
      project: { key: "", root: "" },
      mode: "registered",
      error: `spec repo must be an absolute path: ${specRepo}`,
    };
  }

  const resolveOpts: Parameters<typeof resolveTargetRepo>[0] = {
    candidatePath: opts.specPath,
  };
  if (specRepo !== undefined) {
    resolveOpts.specRepo = specRepo;
  }
  if (opts.repoFlag !== undefined) {
    resolveOpts.repoFlag = opts.repoFlag;
  }
  if (opts.config !== undefined) {
    resolveOpts.config = opts.config;
  }
  const result = resolveTargetRepo(resolveOpts);

  if (result.kind === "ok") {
    return {
      project: result.resolved.project,
      mode: result.resolved.mode,
      source: result.resolved.source,
    };
  }
  if (result.kind === "error") {
    return {
      project: { key: "", root: "" },
      mode: "registered",
      error: result.message,
    };
  }

  // Ambiguous: prompt user to pick from the matching candidates.
  if (result.kind === "ambiguous") {
    return await runDisambiguationPrompt({
      candidates: result.candidates,
      reason: result.reason,
      io: opts.io,
      disambiguate: opts.disambiguate,
    });
  }

  // needs-prompt: prompt user to pick from all registered projects.
  const allProjects = listConfiguredProjects(opts.config);
  if (allProjects.length === 0) {
    return {
      project: { key: "", root: "" },
      mode: "registered",
      error:
        "could not determine a target project for this spec and no projects are registered. Run `jarvis init` in a target repo, or pass --repo <name|url>, or add a `repo:` line.",
    };
  }
  return await runDisambiguationPrompt({
    candidates: allProjects,
    reason: result.reason,
    io: opts.io,
    disambiguate: opts.disambiguate,
  });
}

async function runDisambiguationPrompt(opts: {
  candidates: ProjectMatch[];
  reason: string;
  io: RunIo;
  disambiguate?: DisambiguateFn | undefined;
}): Promise<{
  project: ProjectMatch;
  mode: "registered" | "ad-hoc";
  source?: "repo-flag" | "spec-repo" | "registered" | "ad-hoc";
  error?: string;
}> {
  const prompt = opts.disambiguate ?? defaultDisambiguate;
  const result = await prompt({
    candidates: opts.candidates,
    reason: opts.reason,
    io: opts.io,
  });
  if (result.kind === "selected") {
    return {
      project: result.project,
      mode: "registered",
      source: "registered",
    };
  }
  if (result.kind === "non-tty") {
    const list = opts.candidates.map((c) => `  - ${c.key}`).join("\n");
    return {
      project: { key: "", root: "" },
      mode: "registered",
      error: `${opts.reason}; rerun with --repo <name>. Candidates:\n${list}`,
    };
  }
  // cancelled
  return {
    project: { key: "", root: "" },
    mode: "registered",
    error: "project selection cancelled",
  };
}

function listConfiguredProjects(opts?: ConfigOptions): ProjectMatch[] {
  const cfg = loadConfig(opts);
  const out: ProjectMatch[] = [];
  for (const [key, project] of Object.entries(cfg.projects)) {
    const match: ProjectMatch = { key, root: project.root };
    if (project.origin !== undefined) {
      match.origin = project.origin;
    }
    out.push(match);
  }
  return out;
}

async function defaultDisambiguate(opts: {
  candidates: ProjectMatch[];
  reason: string;
  io: RunIo;
}): Promise<DisambiguationResult> {
  const isTty = Boolean(process.stdin.isTTY);
  return promptForProject({
    candidates: opts.candidates,
    reason: opts.reason,
    io: opts.io,
    readLine: readLineFromStdin,
    isTty,
  });
}

async function readLineFromStdin(): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const newline = buffer.indexOf(10);
    if (newline !== -1) {
      chunks.push(buffer.subarray(0, newline));
      return Buffer.concat(chunks).toString("utf8");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return Buffer.concat(chunks).toString("utf8");
}

function looksLikeUrlOrSlug(value: string): boolean {
  if (/^(https?:\/\/|ssh:\/\/|git:\/\/|git@)/i.test(value)) {
    return true;
  }
  // `owner/repo` slug. Disallow leading `.` to keep `./relative` paths
  // from being misread as a slug.
  if (
    /^[A-Za-z0-9_-][A-Za-z0-9._-]*\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(value)
  ) {
    return true;
  }
  return false;
}

function readRepoPath(specPath: string): string | undefined {
  let inFence = false;
  for (const line of readFileSync(specPath, "utf8").split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = line.match(/^repo:\s*(.+?)\s*$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
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
function checkProjectRootExists(
  path: string,
): { ok: true } | { ok: false; reason: "missing" | "not-directory" } {
  if (!existsSync(path)) {
    return { ok: false, reason: "missing" };
  }
  try {
    if (!statSync(path).isDirectory()) {
      return { ok: false, reason: "not-directory" };
    }
  } catch {
    return { ok: false, reason: "missing" };
  }
  return { ok: true };
}

function formatMissingProjectRootError(opts: {
  path: string;
  projectKey: string;
  source: "repo-flag" | "spec-repo" | "registered" | "ad-hoc" | undefined;
  repoFlag: string | undefined;
  reason: "missing" | "not-directory";
}): string {
  const sourceText = describeProjectSource(
    opts.source,
    opts.repoFlag,
    opts.projectKey,
  );
  const what =
    opts.reason === "not-directory"
      ? "is not a directory"
      : "does not exist on disk";
  return `error: project root ${opts.path} ${what} (resolved from ${sourceText})`;
}

function describeProjectSource(
  source: "repo-flag" | "spec-repo" | "registered" | "ad-hoc" | undefined,
  repoFlag: string | undefined,
  projectKey: string,
): string {
  switch (source) {
    case "repo-flag":
      return repoFlag === undefined
        ? "--repo flag value"
        : `--repo flag value ${JSON.stringify(repoFlag)}`;
    case "spec-repo":
      return "spec `repo:` line";
    case "ad-hoc":
      return "ad-hoc git checkout discovered from spec location";
    default:
      return projectKey === ""
        ? "registered project"
        : `registered project \`${projectKey}\``;
  }
}
