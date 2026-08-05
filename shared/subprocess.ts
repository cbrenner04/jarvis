import { execFile, execFileSync } from "node:child_process";

/** Injectable seam for the execFileSync-style call shape used by shared/git.ts. */
export interface SubprocessRunner {
  /** Runs `cmd args` in `cwd`, returning stdout; throws on non-zero exit. */
  run(cmd: string, args: string[], cwd: string): string;
}

export type AsyncSubprocessOptions = {
  maxBuffer?: number;
  /** When `ignore`, stdout is not captured and resolves to `""`. Default `pipe`. */
  stdio?: "pipe" | "ignore";
  /** Kills the subprocess and rejects if it hasn't exited within this many ms. */
  timeoutMs?: number;
  /** Environment variables for the child process; unset preserves inherited env. */
  env?: NodeJS.ProcessEnv;
  /** When aborted, kills the child with SIGTERM then SIGKILL after a short grace period. */
  signal?: AbortSignal;
};

export class AsyncSubprocessError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly stdout: string,
    readonly stderr: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "AsyncSubprocessError";
  }
}

/** Injectable seam for async subprocess execution. */
export interface AsyncSubprocessRunner {
  /** Runs `cmd args` in `cwd`, returning stdout; rejects on non-zero exit. */
  runAsync(cmd: string, args: string[], cwd: string, options?: AsyncSubprocessOptions): Promise<string>;
}

export const realSubprocessRunner: SubprocessRunner = {
  run(cmd, args, cwd) {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  },
};

/**
 * Synchronous run with a timeout and explicit env, for v1 CLI callers that need more than the
 * `SubprocessRunner` seam offers. Lives here because this file is the allowlisted sync seam;
 * daemon-reachable code must use `realAsyncSubprocessRunner` instead.
 */
export function runSyncWithTimeout(
  cmd: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): void {
  execFileSync(cmd, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "pipe",
    timeout: options.timeoutMs,
  });
}

export const realAsyncSubprocessRunner: AsyncSubprocessRunner = {
  async runAsync(cmd, args, cwd, options) {
    const stdio = options?.stdio ?? "pipe";
    return new Promise((resolve, reject) => {
      let settled = false;
      const child = execFile(
        cmd,
        args,
        {
          cwd,
          encoding: "utf8",
          ...(options?.maxBuffer !== undefined ? { maxBuffer: options.maxBuffer } : {}),
          ...(stdio === "ignore" ? { stdio: "ignore" } : {}),
          ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
          ...(options?.env !== undefined ? { env: options.env } : {}),
        },
        (error, stdout, stderr) => {
          if (settled) return;
          settled = true;
          cleanupAbort();
          if (error) {
            const status = typeof error.code === "number" ? error.code : undefined;
            reject(
              new AsyncSubprocessError(
                error.message,
                status,
                stdout ?? "",
                stderr ?? "",
                typeof error.code === "string" ? error.code : undefined,
              ),
            );
          } else resolve(stdio === "ignore" ? "" : (stdout ?? ""));
        },
      );

      const killChild = () => {
        if (settled) return;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 50).unref?.();
      };

      const onAbort = () => killChild();
      const cleanupAbort = () => options?.signal?.removeEventListener("abort", onAbort);
      if (options?.signal !== undefined) {
        if (options.signal.aborted) killChild();
        else options.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  },
};
