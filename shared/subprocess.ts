import { execFile, execFileSync } from "node:child_process";

/** Injectable seam for the execFileSync-style call shape used by shared/git.ts. */
export interface SubprocessRunner {
  /** Runs `cmd args` in `cwd`, returning stdout; throws on non-zero exit. */
  run(cmd: string, args: string[], cwd: string): string;
}

/** Injectable seam for async subprocess execution. */
export interface AsyncSubprocessRunner {
  /** Runs `cmd args` in `cwd`, returning stdout; rejects on non-zero exit. */
  runAsync(cmd: string, args: string[], cwd: string): Promise<string>;
}

export const realSubprocessRunner: SubprocessRunner = {
  run(cmd, args, cwd) {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  },
};

export const realAsyncSubprocessRunner: AsyncSubprocessRunner = {
  async runAsync(cmd, args, cwd) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { cwd, encoding: "utf8" }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  },
};
