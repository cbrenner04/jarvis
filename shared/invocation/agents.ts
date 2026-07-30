import type { ChildProcess, SpawnOptions, StdioOptions } from "node:child_process";
import { spawn as realSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type Dirent, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isClaudeZeroExitQuotaEnvelope, parseClaudeJsonOutput } from "./claude-json.ts";
import { parseCursorJsonOutput } from "./cursor-json.ts";
import type { InvocationBinding, InvocationOk, InvocationResult } from "./execute.ts";
import { parseOpencodeJsonOutput } from "./opencode-json.ts";

export type ResolvedAgentBinding = {
  agentId: string;
  adapterModel: string;
  priceKey: string;
};

type SpawnFn = (binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess;

export type ResolvedAgentBindingOptions = {
  spawn?: SpawnFn;
  codexSessionsDir?: string;
  randomUUID?: () => string;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
};

function createUnwiredBinding(id: string, stderr: string): InvocationBinding {
  return {
    id,
    invoke: async () => ({
      kind: "error",
      exitCode: 127,
      stderr,
    }),
  };
}

/** Build one unresolved production binding from one resolved agent/model rung. */
export function createResolvedAgentBinding(
  args: ResolvedAgentBinding,
  opts: ResolvedAgentBindingOptions = {},
): InvocationBinding {
  const { agentId, adapterModel, priceKey } = args;
  const id = `${agentId}/${adapterModel}/${priceKey}`;
  const metadata = { agent: agentId, model: adapterModel };
  if (agentId === "claude") {
    return {
      id,
      metadata,
      invoke: ({ prompt, cwd, signal, idleOutputMs, joinProcessOnIdleStall, onOutputProgress }) =>
        runClaudeBinding({
          prompt,
          cwd,
          adapterModel,
          ...(idleOutputMs !== undefined ? { idleOutputMs } : {}),
          ...(joinProcessOnIdleStall === true ? { joinProcessOnIdleStall: true } : {}),
          ...(onOutputProgress !== undefined ? { onOutputProgress } : {}),
          ...(opts.spawn !== undefined ? { spawn: opts.spawn } : {}),
          ...(opts.setTimeout !== undefined ? { setTimeout: opts.setTimeout } : {}),
          ...(opts.clearTimeout !== undefined ? { clearTimeout: opts.clearTimeout } : {}),
          ...(signal !== undefined ? { signal } : {}),
        }),
    };
  }

  if (agentId === "codex") {
    return {
      id,
      metadata,
      invoke: ({ prompt, cwd, signal, idleOutputMs, joinProcessOnIdleStall, onOutputProgress }) => {
        const runArgs = {
          prompt,
          cwd,
          adapterModel,
          ...(idleOutputMs !== undefined ? { idleOutputMs } : {}),
          ...(joinProcessOnIdleStall === true ? { joinProcessOnIdleStall: true } : {}),
          ...(onOutputProgress !== undefined ? { onOutputProgress } : {}),
          ...(opts.spawn !== undefined ? { spawn: opts.spawn } : {}),
          ...(opts.setTimeout !== undefined ? { setTimeout: opts.setTimeout } : {}),
          ...(opts.clearTimeout !== undefined ? { clearTimeout: opts.clearTimeout } : {}),
          ...(opts.codexSessionsDir !== undefined ? { sessionsDir: opts.codexSessionsDir } : {}),
          ...(opts.randomUUID !== undefined ? { randomUUID: opts.randomUUID } : {}),
          ...(signal !== undefined ? { signal } : {}),
        };
        return runCodexBinding(runArgs);
      },
    };
  }

  if (agentId === "cursor") {
    return {
      id,
      metadata,
      invoke: ({ prompt, cwd, signal, idleOutputMs, joinProcessOnIdleStall, onOutputProgress }) =>
        runCursorBinding({
          prompt,
          cwd,
          adapterModel,
          ...(idleOutputMs !== undefined ? { idleOutputMs } : {}),
          ...(joinProcessOnIdleStall === true ? { joinProcessOnIdleStall: true } : {}),
          ...(onOutputProgress !== undefined ? { onOutputProgress } : {}),
          ...(opts.spawn !== undefined ? { spawn: opts.spawn } : {}),
          ...(opts.setTimeout !== undefined ? { setTimeout: opts.setTimeout } : {}),
          ...(opts.clearTimeout !== undefined ? { clearTimeout: opts.clearTimeout } : {}),
          ...(signal !== undefined ? { signal } : {}),
        }),
    };
  }

  if (agentId === "opencode") {
    return {
      id,
      metadata,
      invoke: ({ prompt, cwd, signal, idleOutputMs, joinProcessOnIdleStall, onOutputProgress }) =>
        runOpencodeBinding({
          prompt,
          cwd,
          adapterModel,
          ...(idleOutputMs !== undefined ? { idleOutputMs } : {}),
          ...(joinProcessOnIdleStall === true ? { joinProcessOnIdleStall: true } : {}),
          ...(onOutputProgress !== undefined ? { onOutputProgress } : {}),
          ...(opts.spawn !== undefined ? { spawn: opts.spawn } : {}),
          ...(opts.setTimeout !== undefined ? { setTimeout: opts.setTimeout } : {}),
          ...(opts.clearTimeout !== undefined ? { clearTimeout: opts.clearTimeout } : {}),
          ...(signal !== undefined ? { signal } : {}),
        }),
    };
  }

  return {
    ...createUnwiredBinding(
      id,
      `agent '${agentId}' model '${adapterModel}' price '${priceKey}' invocation is not wired yet`,
    ),
    metadata,
  };
}

type AgentName = "claude" | "codex" | "cursor" | "opencode";

type AgentRunOptions = {
  signal?: AbortSignal;
  abortKillGraceMs?: number;
  sleepMs?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  idleOutputMs?: number;
  joinProcessOnIdleStall?: boolean;
  onOutputProgress?: () => void;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
};

function pickAgentRunOptions(
  args: Pick<
    AgentRunOptions,
    "signal" | "idleOutputMs" | "joinProcessOnIdleStall" | "onOutputProgress" | "setTimeout" | "clearTimeout"
  >,
): AgentRunOptions {
  return {
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.idleOutputMs !== undefined ? { idleOutputMs: args.idleOutputMs } : {}),
    ...(args.joinProcessOnIdleStall === true ? { joinProcessOnIdleStall: true } : {}),
    ...(args.onOutputProgress !== undefined ? { onOutputProgress: args.onOutputProgress } : {}),
    ...(args.setTimeout !== undefined ? { setTimeout: args.setTimeout } : {}),
    ...(args.clearTimeout !== undefined ? { clearTimeout: args.clearTimeout } : {}),
  };
}

type SpawnConfig = {
  name: AgentName;
  binary: string;
  cwd: string;
  buildArgv: (prompt: string) => string[];
  stdio: StdioOptions;
  writeStdin?: (stdin: NodeJS.WritableStream, prompt: string) => void;
  streamErrorPrefix: string;
  classifier: AgentName;
  spawn?: SpawnFn;
};

function singleSpawn(config: SpawnConfig, prompt: string, opts: AgentRunOptions): Promise<InvocationResult> {
  return new Promise((resolvePromise) => {
    const argv = config.buildArgv(prompt);
    const env = { ...process.env, PWD: config.cwd, GIT_TERMINAL_PROMPT: "0" } as Record<string, string>;
    delete env.OLDPWD;
    const spawn = config.spawn ?? realSpawn;
    let child: ChildProcess;
    try {
      child = spawn(config.binary, argv, {
        cwd: config.cwd,
        env,
        detached: true,
        stdio: config.stdio,
      });
    } catch (error) {
      resolvePromise({
        kind: "error",
        exitCode: -1,
        stderr: String(error),
      });
      return;
    }

    const stdin = config.stdio[0] === "pipe" ? child.stdin : null;
    const stdout = child.stdout;
    const stderr = child.stderr;

    if (stdout === null || stderr === null || (config.stdio[0] === "pipe" && stdin === null)) {
      resolvePromise({
        kind: "error",
        exitCode: -1,
        stderr: `${config.streamErrorPrefix} failed to open child process streams`,
      });
      return;
    }

    let outBuf = "";
    let errBuf = "";
    let settled = false;
    let stdoutEnded = false;
    let stderrEnded = false;
    let childClosed = false;
    let abortReason: string | null = null;
    let forcedResult: InvocationResult | null = null;
    let removeAbortListener: (() => void) | undefined;
    let abortTimer: ReturnType<typeof setTimeout> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const setTimer = opts.setTimeout ?? setTimeout;
    const clearTimer = opts.clearTimeout ?? clearTimeout;

    const settle = (result: InvocationResult, keepAbortTimer = false) => {
      if (settled) return;
      settled = true;
      if (!keepAbortTimer && abortTimer !== null) {
        clearTimer(abortTimer);
        abortTimer = null;
      }
      if (idleTimer !== null) {
        clearTimer(idleTimer);
        idleTimer = null;
      }
      removeAbortListener?.();
      resolvePromise(result);
    };

    const settleAbort = () => {
      settle({
        kind: "error",
        exitCode: -1,
        stderr: `aborted: ${abortReason}`,
      });
    };

    const killProcessGroup = () => {
      const pgid = child.pid;
      if (pgid === undefined) {
        child.kill("SIGTERM");
        return;
      }
      try {
        process.kill(-pgid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      abortTimer = setTimer(() => {
        try {
          process.kill(-pgid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            // Best-effort kill.
          }
        }
      }, opts.abortKillGraceMs ?? 2000);
      abortTimer.unref?.();
    };

    const armIdleTimer = () => {
      if (opts.idleOutputMs === undefined || opts.idleOutputMs <= 0 || settled) return;
      if (idleTimer !== null) clearTimer(idleTimer);
      idleTimer = setTimer(() => {
        if (opts.joinProcessOnIdleStall) {
          forcedResult = { kind: "stall", stderr: errBuf };
          killProcessGroup();
          checkSettlement();
        } else {
          settle({ kind: "stall", stderr: errBuf }, true);
        }
      }, opts.idleOutputMs);
      idleTimer.unref?.();
    };

    const settleZeroExit = () => {
      if (config.classifier === "claude") {
        if (isClaudeZeroExitQuotaEnvelope(outBuf)) {
          settle({ kind: "quota", stderr: outBuf });
          return;
        }
      } else {
        const diagnostics = `${errBuf}${outBuf}`;
        if (quotaPatternsFor(config.classifier).some((pattern) => pattern.test(diagnostics))) {
          settle({ kind: "quota", stderr: diagnostics });
          return;
        }
      }
      settle({ kind: "ok", stdout: outBuf, stderr: errBuf });
    };

    const settleNonZeroExit = (exitCode: number) => {
      const diagnostics = `${errBuf}${outBuf}`;
      if (isTransientSignal(config.classifier, exitCode, diagnostics)) {
        settle({ kind: "error", exitCode, stderr: diagnostics });
      } else if (isCredentialAuthSignal(config.classifier, exitCode, diagnostics)) {
        settle({ kind: "quota", stderr: diagnostics, authFailure: true });
      } else if (isQuotaSignal(config.classifier, exitCode, diagnostics)) {
        settle({ kind: "quota", stderr: diagnostics });
      } else if (isModelConfigurationSignal(config.classifier, diagnostics)) {
        settle({ kind: "model_config", stderr: diagnostics });
      } else {
        settle({ kind: "error", exitCode, stderr: diagnostics });
      }
    };

    const checkSettlement = (code?: number | null) => {
      if (settled) return;
      const closedOrClosing = childClosed || code !== undefined;
      if (forcedResult !== null) {
        if (closedOrClosing) settle(forcedResult);
        return;
      }
      if (abortReason !== null) {
        if (closedOrClosing) settleAbort();
        return;
      }
      if (!stdoutEnded || !stderrEnded || !closedOrClosing) {
        return;
      }
      if (code === 0 || code === undefined) {
        settleZeroExit();
        return;
      }
      settleNonZeroExit(code ?? -1);
    };

    const notifyOutputProgress = () => {
      try {
        opts.onOutputProgress?.();
      } catch {
        // Progress hooks are observability only; they must never fail the invocation.
      }
    };

    stdout.on("data", (chunk: Buffer) => {
      outBuf += chunk.toString("utf8");
      armIdleTimer();
      notifyOutputProgress();
    });
    stdout.on("end", () => {
      stdoutEnded = true;
      checkSettlement();
    });
    stdout.on("error", (error) => {
      settle({ kind: "error", exitCode: -1, stderr: `${errBuf}${String(error)}` });
    });
    stderr.on("data", (chunk: Buffer) => {
      errBuf += chunk.toString("utf8");
      armIdleTimer();
      notifyOutputProgress();
    });
    stderr.on("end", () => {
      stderrEnded = true;
      checkSettlement();
    });
    stderr.on("error", (error) => {
      settle({ kind: "error", exitCode: -1, stderr: `${errBuf}${String(error)}` });
    });
    child.on("error", (error) => {
      settle({
        kind: "error",
        exitCode: -1,
        stderr: `${errBuf}${String(error)}`,
      });
    });
    child.on("exit", (code) => {
      if (!settled && abortReason === null && code === 0) {
        const pgid = child.pid;
        if (pgid !== undefined) {
          try {
            process.kill(-pgid, "SIGKILL");
          } catch {
            // Best-effort reap.
          }
        }
      }
    });
    child.on("close", (code) => {
      childClosed = true;
      checkSettlement(code);
    });

    if (opts.signal) {
      const handleAbort = () => {
        killProcessGroup();
        abortReason = opts.signal?.reason ? String(opts.signal.reason) : "aborted";
        checkSettlement();
      };
      if (opts.signal.aborted) {
        handleAbort();
      } else {
        opts.signal.addEventListener("abort", handleAbort);
        removeAbortListener = () => opts.signal?.removeEventListener("abort", handleAbort);
      }
    }

    armIdleTimer();

    if (config.writeStdin && stdin) {
      config.writeStdin(stdin, prompt);
    }
  });
}

const TRANSIENT_RETRY_CAP = 3;
const TRANSIENT_BACKOFF_SCHEDULE_MS = [1000, 2000, 4000] as const;

function defaultSleepMs(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let timeout: NodeJS.Timeout | null = setTimeout(() => {
      timeout = null;
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      resolve();
    };
    signal?.addEventListener("abort", handleAbort);
  });
}

async function runAgent(config: SpawnConfig, prompt: string, opts: AgentRunOptions) {
  const sleepMs = opts.sleepMs ?? defaultSleepMs;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_CAP; attempt++) {
    const result = await singleSpawn(config, prompt, opts);
    if (
      attempt < TRANSIENT_RETRY_CAP &&
      result.kind === "error" &&
      !opts.signal?.aborted &&
      isTransientSignal(config.classifier, result.exitCode, result.stderr)
    ) {
      const backoffMs = TRANSIENT_BACKOFF_SCHEDULE_MS[attempt];
      if (!opts.signal?.aborted && backoffMs !== undefined) {
        await sleepMs(backoffMs, opts.signal);
      }
      if (opts.signal?.aborted) {
        return {
          kind: "error",
          exitCode: -1,
          stderr: `aborted: ${opts.signal.reason ? String(opts.signal.reason) : "aborted"}`,
        } as const;
      }
      continue;
    }
    return result;
  }

  throw new Error("Unexpected: retry loop should always return");
}

function finalizeClaudeInvocationResult(result: InvocationResult): InvocationResult {
  if (result.kind !== "ok") {
    return result;
  }
  if (isClaudeZeroExitQuotaEnvelope(result.stdout)) {
    return { kind: "quota", stderr: result.stdout };
  }

  const parsed = parseClaudeJsonOutput(result.stdout);
  const output: InvocationOk = {
    kind: "ok",
    stdout: parsed.displayText,
    stderr: result.stderr,
  };
  if (parsed.usage !== null) {
    output.usage = parsed.usage;
    output.usage_source = "agent";
  }
  if (parsed.cost_usd !== null) {
    output.cost_usd = parsed.cost_usd;
    output.cost_source = "agent";
  }
  if (parsed.warnings.length > 0) {
    output.warnings = parsed.warnings;
  }
  return output;
}

function finalizeCursorInvocationResult(result: InvocationResult): InvocationResult {
  if (result.kind !== "ok") {
    return result;
  }

  const parsed = parseCursorJsonOutput(result.stdout);
  return {
    kind: "ok",
    stdout: parsed.displayText,
    stderr: result.stderr,
  };
}

function finalizeOpencodeInvocationResult(result: InvocationResult): InvocationResult {
  if (result.kind !== "ok") {
    return result;
  }

  const parsed = parseOpencodeJsonOutput(result.stdout);
  const output: InvocationOk = {
    kind: "ok",
    stdout: parsed.displayText,
    stderr: result.stderr,
  };
  if (parsed.sawStepFinish) {
    output.usage = parsed.usage;
    output.usage_source = "agent";
    if (parsed.sawAnyCostField) {
      output.cost_usd = parsed.cost_usd;
      output.cost_source = "agent";
    } else {
      output.cost_usd = null;
      output.cost_source = "no-price";
    }
    return output;
  }
  output.usage_source = "unavailable";
  output.cost_usd = null;
  output.cost_source = "no-usage";
  output.warnings = ["opencode: no step_finish events in --format json stream; usage recorded as unavailable."];
  return output;
}

async function runClaudeBinding(args: {
  prompt: string;
  cwd: string;
  adapterModel: string;
  signal?: AbortSignal;
  idleOutputMs?: number;
  joinProcessOnIdleStall?: boolean;
  onOutputProgress?: () => void;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  spawn?: SpawnFn;
}): Promise<InvocationResult> {
  const result = await runAgent(
    {
      name: "claude",
      binary: "claude",
      cwd: args.cwd,
      buildArgv: () => [
        "-p",
        "--permission-mode",
        "acceptEdits",
        "--model",
        args.adapterModel,
        "--output-format",
        "stream-json",
        "--verbose",
      ],
      stdio: ["pipe", "pipe", "pipe"],
      writeStdin: (stdin, text) => {
        stdin.write(text);
        stdin.end();
      },
      streamErrorPrefix: "claude:",
      classifier: "claude",
      ...(args.spawn !== undefined ? { spawn: args.spawn } : {}),
    },
    args.prompt,
    pickAgentRunOptions(args),
  );
  return finalizeClaudeInvocationResult(result);
}

async function runCodexBinding(args: {
  prompt: string;
  cwd: string;
  adapterModel: string;
  signal?: AbortSignal;
  idleOutputMs?: number;
  joinProcessOnIdleStall?: boolean;
  onOutputProgress?: () => void;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  spawn?: SpawnFn;
  sessionsDir?: string;
  randomUUID?: () => string;
}): Promise<InvocationResult> {
  const sessionsDir = args.sessionsDir ?? getCodexSessionsDir();
  const beforeSnapshot = snapshotCodexSessionFiles(sessionsDir);
  const invocationId = (args.randomUUID ?? randomUUID)();
  const invocationMarker = `<!-- jarvis-codex-invocation: ${invocationId} -->`;
  const result = await runAgent(
    {
      name: "codex",
      binary: "codex",
      cwd: args.cwd,
      buildArgv: () => [
        "exec",
        "--color",
        "never",
        "--sandbox",
        "workspace-write",
        "-c",
        'approval_policy="on-request"',
        "--model",
        args.adapterModel,
      ],
      stdio: ["pipe", "pipe", "pipe"],
      writeStdin: (stdin, text) => {
        stdin.write(text);
        stdin.end();
      },
      streamErrorPrefix: "codex:",
      classifier: "codex",
      ...(args.spawn !== undefined ? { spawn: args.spawn } : {}),
    },
    `${args.prompt}\n${invocationMarker}`,
    pickAgentRunOptions(args),
  );

  if (result.kind !== "ok") {
    return result;
  }

  const resolved = resolveCodexSessionUsage({
    sessionsDir,
    beforeSnapshot,
    invocationMarker,
    cwd: args.cwd,
  });
  if (resolved.sessionFile === null) {
    return {
      ...result,
      usage_source: "unavailable",
      cost_usd: null,
      cost_source: "no-usage",
      warnings: resolved.warnings,
    };
  }
  return result;
}

async function runCursorBinding(args: {
  prompt: string;
  cwd: string;
  adapterModel: string;
  signal?: AbortSignal;
  idleOutputMs?: number;
  joinProcessOnIdleStall?: boolean;
  onOutputProgress?: () => void;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  spawn?: SpawnFn;
}): Promise<InvocationResult> {
  const result = await runAgent(
    {
      name: "cursor",
      binary: "cursor",
      cwd: args.cwd,
      buildArgv: (promptText) => [
        "agent",
        "-p",
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        "--model",
        resolveCursorCliModel(args.adapterModel),
        "--force",
        "--workspace",
        args.cwd,
        promptText,
      ],
      stdio: ["ignore", "pipe", "pipe"],
      streamErrorPrefix: "cursor:",
      classifier: "cursor",
      ...(args.spawn !== undefined ? { spawn: args.spawn } : {}),
    },
    args.prompt,
    pickAgentRunOptions(args),
  );
  return finalizeCursorInvocationResult(result);
}

async function runOpencodeBinding(args: {
  prompt: string;
  cwd: string;
  adapterModel: string;
  signal?: AbortSignal;
  idleOutputMs?: number;
  joinProcessOnIdleStall?: boolean;
  onOutputProgress?: () => void;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  spawn?: SpawnFn;
}): Promise<InvocationResult> {
  const result = await runAgent(
    {
      name: "opencode",
      binary: "opencode",
      cwd: args.cwd,
      buildArgv: (promptText) => [
        "run",
        "--dir",
        args.cwd,
        "--model",
        args.adapterModel,
        "--format",
        "json",
        promptText,
      ],
      stdio: ["ignore", "pipe", "pipe"],
      streamErrorPrefix: "opencode:",
      classifier: "opencode",
      ...(args.spawn !== undefined ? { spawn: args.spawn } : {}),
    },
    args.prompt,
    pickAgentRunOptions(args),
  );
  return finalizeOpencodeInvocationResult(result);
}

// Patterns below are ported from v1's quota.ts.
const transportContextWords = ["error", "err", "failed", "failure", "http", "status"] as const;

function guardedStatusPatterns(
  statusCodes: readonly number[],
  contextWords: readonly string[] = transportContextWords,
): RegExp[] {
  const context = contextWords.join("|");
  return statusCodes.flatMap((statusCode) => [
    new RegExp(`(?:^|\\n)[^\\n]*(?:${context})[^\\n]*\\b${statusCode}\\b`, "i"),
    new RegExp(`(?:^|\\n)[^\\n]*\\b${statusCode}\\b[^\\n]*(?:${context})\\b`, "i"),
  ]);
}

const claudeQuotaPatterns = [
  /\byou['’]ve hit your (?:session|weekly|opus) limit\b/i,
  /\byou['’]ve hit your monthly spend limit\b/i,
  /\byou['’]ve hit your org['’]s monthly usage limit\b/i,
  /\bcredit balance is too low\b/i,
  /\brequest rejected \(429\)\b/i,
  /\binsufficient[_ ]quota\b/i,
  /\bquota exceeded\b/i,
  /\b(usages?|requests?) (?:have been )?exhausted\b/i,
] as const;

const codexQuotaPatterns = [
  /\byou['’]ve (?:hit|reached) your usage limit\b/i,
  /\busage limit\b.*\b(?:reset|resets|window)\b/i,
  /\brate_limit_exceeded\b/i,
  /\binsufficient[_ ]quota\b/i,
  /\bquota exceeded\b/i,
] as const;

const cursorQuotaPatterns = [
  /\byou['’]ve hit your usage limit\b/i,
  /\byou['’]ve hit your free requests limit\b/i,
  /\btotal usage limit reached\b/i,
  /\bmonthly cursor usage limit\b/i,
  /\bon-demand spending limit\b/i,
  /\bspend limit\b/i,
  /\bresource_exhausted\b/i,
  /\binsufficient[_ ]quota\b/i,
  /\bquota exceeded\b/i,
] as const;

const modelConfigurationPatterns = [
  /\bunknown model\b/i,
  /\bunsupported model\b/i,
  /\binvalid model\b/i,
  /\bmodel not found\b/i,
  /\bmodel is not available\b/i,
  /\bnot available for your account\b/i,
  /\bunrecognized model\b/i,
  /\bLLM Provider NOT provided\b/i,
] as const;

const opencodeQuotaPatterns = [
  /\brate limit\b/i,
  /\bquota exceeded\b/i,
  /\binsufficient_quota\b/i,
  ...guardedStatusPatterns([429]),
  /\byou have exceeded your\b/i,
] as const;

const opencodeModelConfigurationPatterns = [/\bno provider configured for\b/i] as const;

const codexCredentialAuthPatterns = [
  /\brefresh token was revoked\b/i,
  /\brefresh token revoked\b/i,
  /\blog out and sign in\b/i,
  /\bplease log out and sign in\b/i,
  /\bre-?authenticate/i,
  /\bre-?authentication required\b/i,
] as const;

const transientPatterns = [
  /\bconnection closed\b/i,
  /\bconnection reset\b/i,
  /\bconnection refused\b/i,
  /\bsocket hang up\b/i,
  /\bpremature\b.*\b(?:close|end)\b/i,
  /\b(?:close|end)\b.*\bpremature\b/i,
  /\bstream closed\b/i,
  /\beconnreset\b/i,
  /\bepipe\b/i,
  /\bbroken pipe\b/i,
  /\bservice unavailable\b/i,
  /\boverloaded\b/i,
  ...guardedStatusPatterns([502, 503, 504, 529]),
] as const;

const opencodeTransportPatterns = [
  ...guardedStatusPatterns([500], [...transportContextWords, "unknownerror"]),
] as const;

function quotaPatternsFor(name: AgentName) {
  return name === "codex"
    ? codexQuotaPatterns
    : name === "cursor"
      ? cursorQuotaPatterns
      : name === "opencode"
        ? opencodeQuotaPatterns
        : claudeQuotaPatterns;
}

function isQuotaSignal(name: AgentName, exitCode: number, stderr: string): boolean {
  if (exitCode === 0) return false;
  return quotaPatternsFor(name).some((pattern) => pattern.test(stderr));
}

function isCredentialAuthSignal(name: AgentName, exitCode: number, stderr: string): boolean {
  if (exitCode === 0 || name !== "codex") return false;
  return codexCredentialAuthPatterns.some((pattern) => pattern.test(stderr));
}

function isModelConfigurationSignal(name: AgentName, stderr: string): boolean {
  const patterns =
    name === "opencode"
      ? [...modelConfigurationPatterns, ...opencodeModelConfigurationPatterns]
      : modelConfigurationPatterns;
  return patterns.some((pattern) => pattern.test(stderr));
}

function isTransientSignal(name: AgentName, exitCode: number, stderr: string): boolean {
  if (exitCode === 0) return false;
  return (
    (name === "opencode" && opencodeTransportPatterns.some((pattern) => pattern.test(stderr))) ||
    transientPatterns.some((pattern) => pattern.test(stderr))
  );
}

const cursorCliModels: Record<string, string> = {
  "Composer 2": "composer-2.5",
  "Composer 2.5": "composer-2.5",
  "Composer 2.5 Fast": "composer-2.5-fast",
  "Claude 4 Sonnet": "claude-4-sonnet",
  "Claude 4.6 Sonnet": "claude-4.6-sonnet-medium",
  "Claude 4.7 Opus": "claude-opus-4-7-medium",
  "Claude 4.8 Opus": "claude-opus-4-8-medium",
  "GPT-5.3 Codex": "gpt-5.3-codex",
  "GPT-5.4": "gpt-5.4-medium",
  "GPT-5.5": "gpt-5.5-medium",
  "Gemini 3.1 Pro": "gemini-3.1-pro",
  "Gemini 3.5 Flash": "gemini-3.5-flash",
};

function resolveCursorCliModel(model: string): string {
  return cursorCliModels[model] ?? model;
}

type CodexSessionPathState = {
  mtimeMs: number;
  size: number;
};

type CodexSessionsSnapshot = Map<string, CodexSessionPathState>;

function getCodexSessionsDir(): string {
  return join(process.env.HOME ?? homedir(), ".codex", "sessions");
}

function snapshotCodexSessionFiles(sessionsDir: string): CodexSessionsSnapshot {
  const map: CodexSessionsSnapshot = new Map();
  for (const file of listSessionFileStats(sessionsDir)) {
    map.set(file.path, { mtimeMs: file.mtimeMs, size: file.size });
  }
  return map;
}

function listSessionFileStats(dir: string): { path: string; mtimeMs: number; size: number }[] {
  const out: { path: string; mtimeMs: number; size: number }[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, String(entry.name));
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.isFile() || !String(entry.name).endsWith(".jsonl")) continue;
      try {
        const stats = statSync(path);
        out.push({ path, mtimeMs: stats.mtimeMs, size: stats.size });
      } catch {
        // best-effort
      }
    }
  }
  return out;
}

function resolveCodexSessionUsage(opts: {
  sessionsDir: string;
  beforeSnapshot: CodexSessionsSnapshot;
  invocationMarker: string;
  cwd: string;
}): { warnings: string[]; sessionFile: string | null } {
  const changed = listChangedCodexSessionFiles(opts.sessionsDir, opts.beforeSnapshot);
  if (changed.length === 0) {
    return {
      warnings: ["codex usage unavailable: no session JSONL changed after this invocation"],
      sessionFile: null,
    };
  }

  const matched: string[] = [];
  for (const path of changed) {
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (!sessionFileCwdsCompatible(content, opts.cwd)) continue;
    if (!sessionContentHasInvocationMarker(content, opts.invocationMarker)) continue;
    if (!sessionContentHasTokenCountEvent(content)) continue;
    matched.push(path);
  }

  if (matched.length === 0) {
    return {
      warnings: ["codex usage unavailable: no changed session file matched this invocation marker and cwd"],
      sessionFile: null,
    };
  }
  if (matched.length > 1) {
    return {
      warnings: [
        `codex usage unavailable: multiple session files matched this invocation; refusing to guess: ${matched.sort().join(", ")}`,
      ],
      sessionFile: null,
    };
  }
  return { warnings: [], sessionFile: matched[0] ?? null };
}

function listChangedCodexSessionFiles(sessionsDir: string, before: CodexSessionsSnapshot): string[] {
  const after = snapshotCodexSessionFiles(sessionsDir);
  const changed: string[] = [];
  for (const [path, state] of after) {
    const prev = before.get(path);
    if (prev === undefined || prev.mtimeMs !== state.mtimeMs || prev.size !== state.size) {
      changed.push(path);
    }
  }
  return changed;
}

function sessionFileCwdsCompatible(content: string, jarvisCwd: string): boolean {
  const seenCwds: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const event = parseJsonObject(line);
    const payload = event?.payload;
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) continue;
    const rec = payload as Record<string, unknown>;
    if (
      event !== null &&
      (event.type === "session_meta" || event.type === "turn_context") &&
      typeof rec.cwd === "string"
    ) {
      seenCwds.push(rec.cwd);
    }
  }
  if (seenCwds.length === 0) return true;
  return seenCwds.every((cwd) => cwdEqual(cwd, jarvisCwd));
}

function cwdEqual(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

function sessionContentHasInvocationMarker(content: string, invocationMarker: string): boolean {
  for (const line of content.split(/\r?\n/)) {
    const event = parseJsonObject(line);
    if (event !== null && lineIncludesMarkerStructured(event, invocationMarker)) {
      return true;
    }
  }
  return content.includes(invocationMarker);
}

function lineIncludesMarkerStructured(event: Record<string, unknown>, invocationMarker: string): boolean {
  const payload = event.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return false;
  const rec = payload as Record<string, unknown>;
  if (event.type === "event_msg" && rec.type === "user_message" && typeof rec.message === "string") {
    return rec.message.includes(invocationMarker);
  }
  if (event.type !== "response_item" || rec.type !== "message" || rec.role !== "user" || !Array.isArray(rec.content)) {
    return false;
  }
  return rec.content.some(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).type === "input_text" &&
      typeof (item as Record<string, unknown>).text === "string" &&
      String((item as Record<string, unknown>).text).includes(invocationMarker),
  );
}

function sessionContentHasTokenCountEvent(content: string): boolean {
  for (const line of content.split(/\r?\n/)) {
    const event = parseJsonObject(line);
    const payload = event?.payload;
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) continue;
    const rec = payload as Record<string, unknown>;
    if (event?.type === "event_msg" && rec.type === "token_count") return true;
  }
  return false;
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  if (line.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
