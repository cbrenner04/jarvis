import { execFileSync, execSync } from "node:child_process";
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
import { createLogClient, type LogClient } from "../../logging.ts";
import { ensureDraftPr } from "../../pr.ts";
import { resolveProject } from "../../resolve-project.ts";
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
  type WorktreeLock,
} from "../../worktree-lock.ts";
import {
  countUnchecked,
  getActiveLinkedSubspecPath,
  getFirstUncheckedTask,
} from "./completion.ts";
import { generatePrBodyFromSpec, maybeMarkReady } from "./pr.ts";
import { buildPrompt } from "./prompt.ts";
import {
  type AcceptanceCriterion,
  commitSubspec,
  commitWipProgress,
  commitWipProgressWithBlocker,
  snapshotAcceptanceCriteria,
} from "./subspec.ts";
import { parsePatchSpec } from "./spec.ts";

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

export async function runCommand(opts: RunCommandOptions): Promise<number> {
  let specPath = resolve(opts.specPath);
  if (!existsSync(specPath)) {
    opts.io.stderr(`spec path does not exist: ${specPath}\n`);
    return 1;
  }

  const projectResolution = await resolveProjectFromSpec({
    specPath,
    repoFlag: opts.repoFlag,
    config: opts.config,
    io: opts.io,
    disambiguate: opts.disambiguate,
  });
  if (projectResolution.error !== undefined) {
    opts.io.stderr(`${projectResolution.error}\n`);
    return 1;
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
    return 1;
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
    return 1;
  }
  let cwdOverride: string | undefined;
  if (opts.cwdFlag !== undefined) {
    cwdOverride = resolve(opts.cwdFlag);
    if (!existsSync(cwdOverride)) {
      opts.io.stderr(`error: --cwd directory does not exist: ${cwdOverride}\n`);
      return 1;
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
    return 1;
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
      return 1;
    }
  }

  let agentWorkingDir = cwdOverride ?? project.root;
  let worktreeLocked = false;
  let stalepidRecovered: number | undefined;
  if (!opts.skipGhCheck && gitEnabled) {
    try {
      agentWorkingDir = await ensureWorktree(project.root, specPath);
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
        return 9;
      }
      if (lockResult.kind === "recovered") {
        stalepidRecovered = lockResult.stalepid;
      }
      worktreeLocked = true;
    } catch (err) {
      opts.io.stderr(
        `failed to create or resume worktree: ${(err as Error).message}\n`,
      );
      return 1;
    }
  }
  specPath = prepareActiveSpecPath({
    projectRoot: project.root,
    agentWorkingDir,
    specPath,
  });
  const additionalReadDirs = specOutsideWorktreeReadDirs({
    specPath,
    agentWorkingDir,
  });

  const isIndexSpec = basename(specPath) === "index.md";
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
      // Fall through to continue with the normal index-spec path
    } else {
      // e, empty input, or unrecognized
      return 0;
    }
  }

  const agentsByName = opts.agents ?? defaultAgents(cfg);
  const activeAgents = cfg.agentOrder
    .map((name) => agentsByName[name])
    .filter((agent): agent is Agent => agent !== undefined);
  const logServerUrl = cfg.logServerUrl ?? "http://127.0.0.1:4310/logs";
  const logClient = opts.logClient ?? createLogClient(logServerUrl);
  try {
    await logClient.assertReachable();
  } catch (err) {
    opts.io.stderr(
      `jarvis: log server unreachable at ${logServerUrl}. Start it with \`jarvis log-server\` or update config.\n`,
    );
    opts.io.stderr(`jarvis: ${(err as Error).message}\n`);
    return 1;
  }

  const specDisplayName = getSpecDisplayName(specPath);
  const runNamespace = `${project.key}:${specDisplayName}`;
  const telemetryPath = cfg.telemetryPath ?? null;
  const writeTelemetry = (record: {
    agent: string;
    iteration: number;
    durationMs: number;
    kind: TelemetryKind;
    exitReason: string;
  }): void => {
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
  const sendLog = (
    tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
    text: string,
    annotations?: Record<string, string | number | boolean | null>,
  ): void => {
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
  const writeSessionLine = (
    tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
    line: string,
  ): void => {
    const stamped = `${new Date().toISOString()} [${tag}] ${line}\n`;
    writeSync(sessionFd, stamped, undefined, "utf8");
  };
  const splitLines = (text: string): string[] => {
    const normalized = text.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }
    return lines;
  };
  const writeLog = (
    tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
    text: string,
    annotations?: Record<string, string | number | boolean | null>,
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
  const fanout = (
    tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
    text: string,
    stream: "stdout" | "stderr" | null,
    annotations?: Record<string, string | number | boolean | null>,
  ): void => {
    if (stream !== null) {
      writeTerminal(stream, text);
    }
    writeLog(tag, text, annotations);
  };
  let iteration = 1;
  let latestIterationStdout: string[] = [];
  let latestIterationStderr: string[] = [];
  let draftPrEnsured = false;

  const printBoundedTail = (lines: string[]): void => {
    const tail = lines.slice(-40);
    for (const line of tail) {
      opts.io.stdout(`${line}\n`);
    }
  };

  let currentController: AbortController | null = null;
  const onSigint = () => {
    writeSessionLine("harness", "interrupted");
    opts.io.stderr("interrupted\n");
    if (currentController) {
      currentController.abort("sigint");
    } else {
      process.exit(130);
    }
  };
  if (opts.handleSignals !== false) {
    process.once("SIGINT", onSigint);
  }

  // Set up global run timeout if configured
  let globalTimeoutHandle: NodeJS.Timeout | null = null;
  if (cfg.runTimeoutMs !== undefined) {
    globalTimeoutHandle = setTimeout(() => {
      if (currentController) {
        currentController.abort("run-timeout");
      }
    }, cfg.runTimeoutMs);
  }

  try {
    const tryFinishSpecIfDone = async (): Promise<number | null> => {
      if (countUnchecked(specPath) !== 0) {
        return null;
      }
      if (gitEnabled) {
        const blocker = worktreeCompletionBlocker(agentWorkingDir);
        if (blocker !== undefined) {
          const worktreeName = basename(agentWorkingDir);
          fanout(
            "harness",
            `spec checklists are complete, but ${blocker}\n\nCommit and push from the worktree so the PR updates. Worktree: ${agentWorkingDir}\n\nRun \`jarvis triage ${worktreeName}\` to inspect state and see suggested next moves.\n`,
            "stderr",
          );
          return 6;
        }
      }
      fanout("harness", "spec complete\n", "stdout");
      return 0;
    };

    while (true) {
      const iterationStartedAt = Date.now();
      const iterationDurationMs = (): number => Date.now() - iterationStartedAt;
      if (isIndexSpec && iteration > cfg.maxIterations) {
        printBoundedTail([...latestIterationStdout, ...latestIterationStderr]);
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
        return 5;
      }

      latestIterationStdout = [];
      latestIterationStderr = [];
      const before = countUnchecked(specPath);
      if (before === 0) {
        const done = await tryFinishSpecIfDone();
        if (done !== null) {
          writeTelemetry({
            agent: "harness",
            iteration,
            durationMs: iterationDurationMs(),
            kind: "ok",
            exitReason: "criteria-complete",
          });
          return done;
        }
        writeTelemetry({
          agent: "harness",
          iteration,
          durationMs: iterationDurationMs(),
          kind: "ok",
          exitReason: "criteria-complete",
        });
        return 0;
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
        return 2;
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
          sendLog("harness", blockerText);
          writeTelemetry({
            agent: agent.name,
            iteration,
            durationMs: iterationDurationMs(),
            kind: "blocked",
            exitReason: "blocker-detected",
          });
          return 7;
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
          return 1;
        }
      }
      const banner = `project: ${project.key} | spec: ${specDisplayName} | iteration: ${iteration} | current-task: ${task.ordinal}/${task.total} ${taskExcerpt} | agent: ${agent.name}\n`;
      fanout("harness", banner, "stdout", {
        project: project.key,
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
      currentController = new AbortController();
      const iterationTimeoutHandle = setTimeout(() => {
        currentController?.abort("iteration-timeout");
      }, cfg.iterationTimeoutMs);

      try {
        const result = await agent.run(prompt, {
          cwd: agentWorkingDir,
          ...(additionalReadDirs === undefined ? {} : { additionalReadDirs }),
          signal: currentController.signal,
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
          return 8;
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
          return 8;
        }

        // Check for SIGINT
        if (
          result.kind === "error" &&
          result.stderr.includes("aborted: sigint")
        ) {
          process.exit(130);
        }

        if (result.kind === "ok") {
        if (result.stdout.length > 0) {
          latestIterationStdout.push(...splitLines(result.stdout));
          fanout("inbound_stdout", result.stdout, null, {
            iteration,
            agent: agent.name,
          });
        }
        if (result.stderr.length > 0) {
          latestIterationStderr.push(...splitLines(result.stderr));
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
          const afterParse = parsePatchSpec(readFileSync(activeSubspecPath, "utf8"));
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
                });
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : String(err);
                fanout(
                  "harness",
                  `failed to commit blocker for ${activeSubspecPath}: ${message}\n`,
                  "stderr",
                );
                return 1;
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
                  return 1;
                }
              }
            }

            const blockerText = `${activeSubspecPath}\n\n${blockerBody}`;
            fanout("harness", `${blockerText}\n`, "stderr");
            sendLog("harness", blockerText);
            writeTelemetry({
              agent: agent.name,
              iteration,
              durationMs: iterationDurationMs(),
              kind: "blocked",
              exitReason: "blocker-detected",
            });
            return 7;
          }

          if (allChecked) {
            if (gitEnabled) {
              try {
                commitSubspec(activeSubspecPath, { cwd: agentWorkingDir });
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : String(err);
                fanout(
                  "harness",
                  `failed to commit completed subspec ${activeSubspecPath}: ${message}\n`,
                  "stderr",
                );
                return 1;
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
                  return 1;
                }

                try {
                  if (!draftPrEnsured) {
                    const prBody = async (): Promise<string> =>
                      getDeterministicPrBody(specPath);
                    const attribution = `Written by ${agent.attributionLabel()} through Jarvis.`;
                    await ensureDraftPr({
                      branch: getCurrentBranch(agentWorkingDir),
                      base: await getBaseBranch(agentWorkingDir),
                      title: getIndexTitle(specPath),
                      bodyGenerator: prBody,
                      attribution,
                      cwd: agentWorkingDir,
                    });
                    draftPrEnsured = true;
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
                  return 1;
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
                });
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : String(err);
                fanout(
                  "harness",
                  `failed to commit WIP progress for ${activeSubspecPath}: ${message}\n`,
                  "stderr",
                );
                return 1;
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
                return 6;
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
          const done = await tryFinishSpecIfDone();
          if (done !== null) {
            writeTelemetry({
              agent: agent.name,
              iteration,
              durationMs: iterationDurationMs(),
              kind: "ok",
              exitReason: "completed-spec",
            });
            return done;
          }
          writeTelemetry({
            agent: agent.name,
            iteration,
            durationMs: iterationDurationMs(),
            kind: "ok",
            exitReason: "completed-spec",
          });
          return 0;
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
          return 0;
        }
        if (after === before && !subspecCompleted && !subspecProgressed) {
          printBoundedTail([
            ...latestIterationStdout,
            ...latestIterationStderr,
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
          return 4;
        }
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "ok",
          exitReason: "criteria-progress",
        });
        iteration += 1;
        continue;
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
          return 2;
        }
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "quota",
          exitReason: "quota-fallback",
        });
        iteration += 1;
        continue;
      }
      if (result.kind === "model_config") {
        const configErr = `${agent.name}: configured patch model ${JSON.stringify(cfg.patchModels[agent.name])} is not supported by this CLI/account\n`;
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
        return 3;
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
        ? isWeakQuotaSignal(agent.name, result.exitCode, result.stderr)
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
          return 2;
        }
        writeTelemetry({
          agent: agent.name,
          iteration,
          durationMs: iterationDurationMs(),
          kind: "quota",
          exitReason: "probable-quota-fallback",
        });
        iteration += 1;
        continue;
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
      return 3;
      } finally {
        clearTimeout(iterationTimeoutHandle);
      }
    }
  } finally {
    if (globalTimeoutHandle) {
      clearTimeout(globalTimeoutHandle);
    }
    if (worktreeLocked) {
      releaseWorktreeLock(agentWorkingDir);
    }
    if (stalepidRecovered !== undefined) {
      sendLog(
        "harness",
        `recovered stale worktree lock (pid ${stalepidRecovered} no longer running)`,
      );
    }
    closeSync(sessionFd);
    if (opts.handleSignals !== false) {
      process.removeListener("SIGINT", onSigint);
    }
  }
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
  if (generated !== "") {
    return generated;
  }
  return `${getSpecDisplayName(specPath)}\n\nAuto-generated by jarvis`;
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
    execFileSync("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
      cwd,
      stdio: "pipe",
    });
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

  const resolveOpts: Parameters<typeof resolveProject>[0] = {
    specPath: opts.specPath,
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
  const result = resolveProject(resolveOpts);

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

function defaultAgents(cfg: Config): Record<AgentName, Agent> {
  return {
    claude: new ClaudeAgent({ model: cfg.patchModels.claude }),
    codex: new CodexAgent({ model: cfg.patchModels.codex }),
    cursor: new CursorAgent({ model: cfg.patchModels.cursor }),
    opencode: new OpencodeAgent({ model: cfg.patchModels.opencode }),
  };
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
