import type { StdioOptions } from "node:child_process";
import { spawn } from "node:child_process";
import type { InvocationBinding, InvocationResult } from "./execute.ts";

/** Default grace between SIGTERM and SIGKILL when aborting a child process group. */
export const DEFAULT_ABORT_KILL_GRACE_MS = 2000;

export type RunInvocationChildArgs = {
  command: string;
  argv: readonly string[];
  cwd: string;
  signal?: AbortSignal;
  abortKillGraceMs?: number;
  onSpawned?: (info: { pid: number }) => void;
  env?: Record<string, string>;
  stdio?: StdioOptions;
};

/**
 * Send SIGTERM to a detached child process group, then SIGKILL after a grace
 * period. Falls back to killing the direct child when the group is unavailable.
 */
export function abortProcessGroup(pgid: number, graceMs = DEFAULT_ABORT_KILL_GRACE_MS): void {
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    try {
      process.kill(pgid, "SIGTERM");
    } catch {
      // best-effort
    }
  }

  const timer = setTimeout(() => {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      try {
        process.kill(pgid, "SIGKILL");
      } catch {
        // best-effort
      }
    }
  }, graceMs);
  timer.unref();
}

/**
 * Spawn a detached child in its own process group, buffer stdio until close,
 * and abort via SIGTERM→SIGKILL on the whole group when `signal` aborts.
 *
 * Bindings that do not own a child process should implement injectable abort
 * locally instead of calling this helper.
 */
export function runInvocationChild(args: RunInvocationChildArgs): Promise<InvocationResult> {
  return new Promise((resolvePromise) => {
    const env = { ...process.env, PWD: args.cwd, ...args.env } as Record<string, string>;
    delete env.OLDPWD;
    const child = spawn(args.command, [...args.argv], {
      cwd: args.cwd,
      env,
      detached: true,
      stdio: args.stdio ?? ["ignore", "pipe", "pipe"],
    });
    if (child.pid !== undefined) {
      args.onSpawned?.({ pid: child.pid });
    }

    const stdout = child.stdout;
    const stderr = child.stderr;
    if (stdout === null || stderr === null) {
      resolvePromise({
        kind: "error",
        exitCode: -1,
        stderr: "invocation child failed to open stdio streams",
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

    const settle = (result: InvocationResult) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
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
          settle({
            kind: "error",
            exitCode: code ?? -1,
            stderr: `${errBuf}${outBuf}`,
          });
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

    if (args.signal) {
      const handleAbort = () => {
        const pgid = child.pid;
        if (pgid !== undefined) {
          abortProcessGroup(pgid, args.abortKillGraceMs ?? DEFAULT_ABORT_KILL_GRACE_MS);
        } else {
          child.kill("SIGTERM");
        }
        abortReason = args.signal?.reason ? String(args.signal.reason) : "aborted";
        checkSettlement();
      };
      if (args.signal.aborted) {
        handleAbort();
      } else {
        args.signal.addEventListener("abort", handleAbort);
      }
    }
  });
}

/**
 * Build a binding that owns a real child process and honors abort via process-group
 * termination. Tests inject custom `invoke` implementations instead.
 */
export function createChildProcessBinding(args: {
  id: string;
  command: string;
  buildArgv: (input: { prompt: string }) => readonly string[];
  abortKillGraceMs?: number;
}): InvocationBinding {
  return {
    id: args.id,
    invoke: async ({ prompt, cwd, signal }) =>
      runInvocationChild({
        command: args.command,
        argv: args.buildArgv({ prompt }),
        cwd,
        ...(signal !== undefined ? { signal } : {}),
        ...(args.abortKillGraceMs !== undefined ? { abortKillGraceMs: args.abortKillGraceMs } : {}),
      }),
  };
}
