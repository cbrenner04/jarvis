// Shared spawn loop for CLI agents: handles process lifecycle (spawn, stream buffering,
// settling, error classification) with agent-specific argv building and stdio control.

import type { ChildProcess, SpawnOptions, StdioOptions } from "node:child_process";
import { spawn as realSpawn } from "node:child_process";
import { isModelConfigurationSignal, isQuotaSignal, isTransientSignal } from "./quota.ts";
import type { AgentName, AgentResult, AgentRunOptions } from "./types.ts";

export interface SpawnConfig {
  name: AgentName;
  binary: string;
  cwd: string;
  buildArgv: (prompt: string, opts: AgentRunOptions) => string[];
  stdio: StdioOptions;
  writeStdin?: (stdin: NodeJS.WritableStream, prompt: string) => void;
  streamErrorPrefix: string;
  env?: Record<string, string>;
  spawn?: (binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess;
}

function singleSpawn(config: SpawnConfig, prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
  return new Promise((resolvePromise) => {
    const argv = config.buildArgv(prompt, opts);
    const env = { ...process.env, PWD: config.cwd, ...config.env } as Record<string, string>;
    delete env.OLDPWD;
    const spawn = config.spawn ?? realSpawn;
    const child = spawn(config.binary, argv, {
      cwd: config.cwd,
      env,
      detached: true,
      stdio: config.stdio,
    });
    if (child.pid !== undefined) {
      opts.onSpawned?.({ pid: child.pid });
    }

    // Handle null streams
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
    const settle = (r: AgentResult) => {
      if (settled) return;
      settled = true;
      if (abortTimer !== null) {
        clearTimeout(abortTimer);
        abortTimer = null;
      }
      resolvePromise(r);
    };
    const checkSettlement = (code?: number | null) => {
      if (settled) return;
      if (abortReason !== null) {
        if (childClosed || code !== undefined) {
          settle({
            kind: "error",
            exitCode: -1,
            stderr: `aborted: ${abortReason}`,
          });
        }
        return;
      }
      if (stdoutEnded && stderrEnded && (childClosed || code !== undefined)) {
        if (code === 0 || code === undefined) {
          settle({ kind: "ok", stdout: outBuf, stderr: errBuf });
        } else {
          const exitCode = code ?? -1;
          const diagnostics = `${errBuf}${outBuf}`;

          // Classification order: model config → quota → transient retry → generic error
          if (isModelConfigurationSignal(config.name, diagnostics)) {
            settle({ kind: "model_config", stderr: diagnostics });
          } else if (isQuotaSignal(config.name, exitCode, diagnostics)) {
            settle({ kind: "quota", stderr: diagnostics });
          } else {
            settle({ kind: "error", exitCode, stderr: diagnostics });
          }
        }
      }
    };

    stdout.on("data", (chunk: Buffer) => {
      outBuf += chunk.toString("utf8");
      if (opts.lastOutputAtMs) {
        opts.lastOutputAtMs.current = Date.now();
      }
    });
    stdout.on("end", () => {
      stdoutEnded = true;
      checkSettlement();
    });
    stderr.on("data", (chunk: Buffer) => {
      errBuf += chunk.toString("utf8");
      if (opts.lastOutputAtMs) {
        opts.lastOutputAtMs.current = Date.now();
      }
    });
    stderr.on("end", () => {
      stderrEnded = true;
      checkSettlement();
    });
    child.on("error", (err) => {
      settle({
        kind: "error",
        exitCode: -1,
        stderr: `${errBuf}${String(err)}`,
      });
    });
    // Reap in-group stragglers on normal completion. Done on "exit" — not "close"
    // — because "close" only fires after the stdio streams tear down, and a
    // straggler that inherited the agent's stdout/stderr pipes holds them open,
    // so "close" (and thus settlement) would deadlock. "exit" fires when the
    // process itself ends; killing the group then closes those inherited pipes,
    // letting the streams end and "close"/settlement proceed. Best-effort: kill
    // errors are swallowed (ESRCH is expected on a clean close).
    child.on("exit", (code) => {
      if (abortReason === null && code === 0) {
        const pgid = child.pid;
        if (pgid !== undefined) {
          try {
            process.kill(-pgid, "SIGKILL");
          } catch {
            // Swallow reap errors: ESRCH is expected on clean close, others are non-fatal.
          }
        }
      }
    });
    child.on("close", (code) => {
      childClosed = true;
      checkSettlement(code);
    });

    // Handle abort signal: send SIGTERM, wait grace period, then SIGKILL
    if (opts.signal) {
      const handleAbort = () => {
        const pgid = child.pid;
        if (pgid !== undefined) {
          try {
            process.kill(-pgid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
          // Keep the abort path bounded even if a descendant ignores SIGTERM.
          const abortKillGraceMs = opts.abortKillGraceMs ?? 2000;
          abortTimer = setTimeout(() => {
            try {
              process.kill(-pgid, "SIGKILL");
            } catch {
              try {
                child.kill("SIGKILL");
              } catch {
                // best-effort
              }
            }
          }, abortKillGraceMs);
          abortTimer.unref();
        } else {
          child.kill("SIGTERM");
        }
        const reason = opts.signal?.reason ? String(opts.signal.reason) : "aborted";
        abortReason = reason;
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
const TRANSIENT_BACKOFF_SCHEDULE_MS = [1000, 2000, 4000];

function defaultSleepMs(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let timeout: NodeJS.Timeout | null = setTimeout(() => {
      timeout = null;
      if (signal) {
        signal.removeEventListener("abort", handleAbort);
      }
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

export async function runAgent(config: SpawnConfig, prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
  const sleepMs = opts.sleepMs ?? defaultSleepMs;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_CAP; attempt++) {
    const result = await singleSpawn(config, prompt, opts);

    // Check if we should retry on transient error
    if (
      attempt < TRANSIENT_RETRY_CAP &&
      result.kind === "error" &&
      !opts.signal?.aborted &&
      isTransientSignal(config.name, result.exitCode, result.stderr)
    ) {
      opts.onTransientRetry?.({
        attempt: attempt + 1,
        cap: TRANSIENT_RETRY_CAP,
        agent: config.name,
        exitCode: result.exitCode,
      });

      // Sleep before re-attempt, racing the abort signal
      if (!opts.signal?.aborted && attempt < TRANSIENT_BACKOFF_SCHEDULE_MS.length) {
        await sleepMs(TRANSIENT_BACKOFF_SCHEDULE_MS[attempt]!, opts.signal);
      }

      // Abort may have arrived during the sleep; short-circuit before spawning
      if (opts.signal?.aborted) {
        return {
          kind: "error",
          exitCode: -1,
          stderr: `aborted: ${opts.signal.reason ? String(opts.signal.reason) : "aborted"}`,
        };
      }

      continue;
    }

    // Return on first non-transient result or when cap is reached
    return result;
  }

  throw new Error("Unexpected: retry loop should always return");
}
