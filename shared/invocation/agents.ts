import type { ChildProcess, SpawnOptions, StdioOptions } from "node:child_process";
import { spawn as realSpawn } from "node:child_process";
import type { InvocationBinding, InvocationResult } from "./execute.ts";

export type ResolvedAgentBinding = {
  agentId: string;
  adapterModel: string;
  priceKey: string;
};

type SpawnFn = (binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess;

export type ResolvedAgentBindingOptions = {
  spawn?: SpawnFn;
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
      invoke: ({ prompt, cwd, signal }) =>
        runAgent(
          {
            name: "claude",
            binary: "claude",
            cwd,
            buildArgv: () => [
              "-p",
              "--permission-mode",
              "acceptEdits",
              "--model",
              adapterModel,
              "--output-format",
              "json",
            ],
            stdio: ["pipe", "pipe", "pipe"],
            writeStdin: (stdin, text) => {
              stdin.write(text);
              stdin.end();
            },
            streamErrorPrefix: "claude:",
            ...(opts.spawn !== undefined ? { spawn: opts.spawn } : {}),
          },
          prompt,
          signal === undefined ? {} : { signal },
        ),
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

/**
 * Build the ordered agent bindings the runner falls back through.
 *
 * This legacy helper keeps bare agent ids terminal-unwired; resolved production
 * rungs use `createResolvedAgentBinding`.
 */
export function createAgentBindings(agentIds: readonly string[]): readonly InvocationBinding[] {
  return agentIds.map((id) => ({
    ...createUnwiredBinding(id, `agent '${id}' invocation is not wired yet`),
    metadata: { agent: id, model: id },
  }));
}

type AgentName = "claude";

type AgentRunOptions = {
  signal?: AbortSignal;
  abortKillGraceMs?: number;
  sleepMs?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
};

type SpawnConfig = {
  name: AgentName;
  binary: string;
  cwd: string;
  buildArgv: (prompt: string) => string[];
  stdio: StdioOptions;
  writeStdin?: (stdin: NodeJS.WritableStream, prompt: string) => void;
  streamErrorPrefix: string;
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
    let abortTimer: NodeJS.Timeout | null = null;

    const settle = (result: InvocationResult) => {
      if (settled) return;
      settled = true;
      if (abortTimer !== null) {
        clearTimeout(abortTimer);
        abortTimer = null;
      }
      resolvePromise(result);
    };

    const settleAbort = () => {
      settle({
        kind: "error",
        exitCode: -1,
        stderr: `aborted: ${abortReason}`,
      });
    };

    const settleZeroExit = () => {
      if (isClaudeZeroExitQuotaEnvelope(outBuf)) {
        settle({ kind: "quota", stderr: outBuf });
        return;
      }
      settle({ kind: "ok", stdout: outBuf, stderr: errBuf });
    };

    const settleNonZeroExit = (exitCode: number) => {
      const diagnostics = `${errBuf}${outBuf}`;
      if (isTransientSignal(exitCode, diagnostics)) {
        settle({ kind: "error", exitCode, stderr: diagnostics });
      } else if (isQuotaSignal(exitCode, diagnostics)) {
        settle({ kind: "quota", stderr: diagnostics });
      } else if (isModelConfigurationSignal(diagnostics)) {
        settle({ kind: "model_config", stderr: diagnostics });
      } else {
        settle({ kind: "error", exitCode, stderr: diagnostics });
      }
    };

    const checkSettlement = (code?: number | null) => {
      if (settled) return;
      const closedOrClosing = childClosed || code !== undefined;
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

    stdout.on("data", (chunk: Buffer) => {
      outBuf += chunk.toString("utf8");
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
      if (abortReason === null && code === 0) {
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
        const pgid = child.pid;
        if (pgid !== undefined) {
          try {
            process.kill(-pgid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
          const abortKillGraceMs = opts.abortKillGraceMs ?? 2000;
          abortTimer = setTimeout(() => {
            try {
              process.kill(-pgid, "SIGKILL");
            } catch {
              try {
                child.kill("SIGKILL");
              } catch {
                // Best-effort abort.
              }
            }
          }, abortKillGraceMs);
          abortTimer.unref();
        } else {
          child.kill("SIGTERM");
        }
        abortReason = opts.signal?.reason ? String(opts.signal.reason) : "aborted";
        checkSettlement();
      };
      if (opts.signal.aborted) {
        handleAbort();
      } else {
        opts.signal.addEventListener("abort", handleAbort);
      }
    }

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
      isTransientSignal(result.exitCode, result.stderr)
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

const transportContextWords = ["error", "err", "failed", "failure", "http", "status"] as const;

function guardedStatusPatterns(statusCodes: readonly number[]): RegExp[] {
  const context = transportContextWords.join("|");
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

function isQuotaSignal(exitCode: number, stderr: string): boolean {
  return exitCode !== 0 && claudeQuotaPatterns.some((pattern) => pattern.test(stderr));
}

function isModelConfigurationSignal(stderr: string): boolean {
  return modelConfigurationPatterns.some((pattern) => pattern.test(stderr));
}

function isTransientSignal(exitCode: number, stderr: string): boolean {
  return exitCode !== 0 && transientPatterns.some((pattern) => pattern.test(stderr));
}

function isClaudeZeroExitQuotaEnvelope(stdout: string): boolean {
  try {
    const envelope: unknown = JSON.parse(stdout);
    if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
      return false;
    }
    const obj = envelope as Record<string, unknown>;
    return obj.is_error === true && obj.api_error_status === 429 && isClaudeQuotaMessageText(obj.result);
  } catch {
    return false;
  }
}

function isClaudeQuotaMessageText(value: unknown): boolean {
  return typeof value === "string" && claudeQuotaPatterns.some((pattern) => pattern.test(value));
}
