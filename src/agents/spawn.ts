// Shared spawn loop for CLI agents: handles process lifecycle (spawn, stream buffering,
// settling, error classification) with agent-specific argv building and stdio control.

import type { StdioOptions } from "node:child_process";
import { spawn } from "node:child_process";
import { isModelConfigurationSignal, isQuotaSignal } from "./quota.ts";
import type { AgentName, AgentResult, AgentRunOptions } from "./types.ts";

export interface SpawnConfig {
  name: AgentName;
  binary: string;
  cwd: string;
  buildArgv: (prompt: string, opts: AgentRunOptions) => string[];
  stdio: StdioOptions;
  writeStdin?: (stdin: NodeJS.WritableStream, prompt: string) => void;
  streamErrorPrefix: string;
}

export function runAgent(
  config: SpawnConfig,
  prompt: string,
  opts: AgentRunOptions,
): Promise<AgentResult> {
  return new Promise((resolvePromise) => {
    const argv = config.buildArgv(prompt, opts);
    const env = { ...process.env, PWD: config.cwd } as Record<string, string>;
    delete env.OLDPWD;
    const child = spawn(config.binary, argv, {
      cwd: config.cwd,
      env,
      stdio: config.stdio,
    });

    // Handle null streams
    const stdin = config.stdio[0] === "pipe" ? child.stdin : null;
    const stdout = child.stdout;
    const stderr = child.stderr;

    if (
      stdout === null ||
      stderr === null ||
      (config.stdio[0] === "pipe" && stdin === null)
    ) {
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
    const settle = (r: AgentResult) => {
      if (settled) return;
      settled = true;
      resolvePromise(r);
    };
    const checkSettlement = (code?: number | null) => {
      if (settled) return;
      if (stdoutEnded && stderrEnded && (childClosed || code !== undefined)) {
        if (code === 0 || code === undefined) {
          settle({ kind: "ok", stdout: outBuf, stderr: errBuf });
        } else {
          const exitCode = code ?? -1;
          const diagnostics = `${errBuf}${outBuf}`;

          // Classification order: model config → quota → generic error
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
    });
    stdout.on("end", () => {
      stdoutEnded = true;
      checkSettlement();
    });
    stderr.on("data", (chunk: Buffer) => {
      errBuf += chunk.toString("utf8");
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
    child.on("close", (code) => {
      childClosed = true;
      checkSettlement(code);
    });

    // Handle abort signal: send SIGTERM, wait grace period, then SIGKILL
    if (opts.signal) {
      const handleAbort = () => {
        child.kill("SIGTERM");
        // unref so a settled-but-not-yet-dead child does not keep the
        // event loop alive for the full grace period.
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 2000).unref();
        const reason = opts.signal?.reason
          ? String(opts.signal.reason)
          : "aborted";
        settle({
          kind: "error",
          exitCode: -1,
          stderr: `aborted: ${reason}`,
        });
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
