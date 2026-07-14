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

export const realAsyncSubprocessRunner: AsyncSubprocessRunner = {
  async runAsync(cmd, args, cwd, options) {
    const stdio = options?.stdio ?? "pipe";
    return new Promise((resolve, reject) => {
      execFile(
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
    });
  },
};
