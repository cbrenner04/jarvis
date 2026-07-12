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
};

/** Injectable seam for async subprocess execution. */
export interface AsyncSubprocessRunner {
  /** Runs `cmd args` in `cwd`, returning stdout; rejects on non-zero exit. */
  runAsync(cmd: string, args: string[], cwd: string, options?: AsyncSubprocessOptions): Promise<string>;
}

/** Captures a completed async subprocess failure without relying on Node's error shape. */
export class AsyncSubprocessError extends Error {
  constructor(
    public readonly status: number | undefined,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly code?: string,
  ) {
    super(`subprocess failed (exit ${status ?? "unknown"})`);
  }
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
        },
        (error, stdout, stderr) => {
          if (error) {
            const status = typeof error.code === "number" ? error.code : undefined;
            reject(
              new AsyncSubprocessError(
                status,
                stdio === "ignore" ? "" : (stdout?.toString() ?? ""),
                stderr?.toString() ?? "",
                typeof error.code === "string" ? error.code : undefined,
              ),
            );
          } else {
            resolve(stdio === "ignore" ? "" : (stdout ?? ""));
          }
        },
      );
    });
  },
};
