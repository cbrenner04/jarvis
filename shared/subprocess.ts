import { execFile, execFileSync, spawn } from "node:child_process";

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
  signal?: AbortSignal | undefined;
  /**
   * Opt-in process-group mode: spawns the child detached (its own process group) so abort and
   * timeout signal the whole group (`-pgid`, SIGTERM then SIGKILL) instead of only the direct
   * child, reaching grandchildren (e.g. `bun test` pool workers under a gate command). Presence
   * of this option enables the mode. Timeout and abort settle only after confirmed group
   * disappearance (lifecycle detail: `v2/docs/v2-architecture.md`); `onGroupId`, if given, fires
   * once synchronously after spawn with the group id (== `child.pid`, since a detached child is
   * its own group leader) so the caller can record it for owner-crash recovery, not for a live
   * owner's own settlement. Not invoked if spawn failed (`child.pid` undefined). POSIX-only.
   */
  processGroup?: { onGroupId?: (pgid: number) => void };
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
 * Synchronous run with a timeout and explicit env, for CLI callers that need more than the
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

/**
 * Group-mode `runAsync`: spawns detached (its own process group) so abort/timeout can signal
 * the whole group via `-pgid`, reaching grandchildren that `execFile`'s direct-child `kill()`
 * cannot. Kept separate from the default path below rather than folded into one `execFile`
 * call because `detached` is not honored by `execFile` in this stack's Bun runtime; `spawn`
 * is required for the group to actually form.
 */
function runGroupMode(
  cmd: string,
  args: string[],
  cwd: string,
  options: AsyncSubprocessOptions,
  stdio: "pipe" | "ignore",
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let killGroupPromise: Promise<void> | undefined;
    let cause: "timeout" | "abort" | undefined;
    let groupConfirmedDead = false;
    let pendingCloseSettle: (() => void) | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(cmd, args, {
      cwd,
      detached: true,
      stdio: stdio === "ignore" ? "ignore" : ["ignore", "pipe", "pipe"],
      ...(options.env !== undefined ? { env: options.env } : {}),
    });

    if (child.pid !== undefined) options.processGroup?.onGroupId?.(child.pid);

    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    // Signals SIGTERM immediately, escalates to SIGKILL after a referenced 50ms grace (the
    // timer holds the event loop open so an owner exiting right after settlement can't cut the
    // escalation short), then confirms the whole group is gone before resolving. Idempotent:
    // repeat calls (timeout racing abort) return the same in-flight promise.
    const killGroup = (): Promise<void> => {
      if (killGroupPromise !== undefined) return killGroupPromise;
      if (child.pid === undefined) {
        killGroupPromise = Promise.resolve();
        return killGroupPromise;
      }
      const pgid = child.pid;
      try {
        process.kill(-pgid, "SIGTERM");
      } catch {
        // already gone (ESRCH) or not permitted (EPERM); escalation still confirms below.
      }
      killGroupPromise = new Promise<void>((resolveDead) => {
        setTimeout(() => {
          try {
            process.kill(-pgid, "SIGKILL");
          } catch {
            // already gone (ESRCH) or not permitted (EPERM); confirmation probe still runs.
          }
          // No confirmation deadline: probe every 10ms until ESRCH. Any other outcome,
          // including EPERM, means the group's liveness is unconfirmed, so keep polling.
          const probe = () => {
            try {
              process.kill(-pgid, 0);
              setTimeout(probe, 10);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ESRCH") resolveDead();
              else setTimeout(probe, 10);
            }
          };
          probe();
        }, 50);
      });
      return killGroupPromise;
    };

    // Sole settlement authority for timeout/abort: a no-op until the group is confirmed dead,
    // then called from both the confirmation callback and (if it arrives later) the direct
    // child's own `close`, whichever comes last — safe to call from either order or repeatedly.
    const finalizeAfterConfirmedDeath = () => {
      if (settled || !groupConfirmedDead) return;
      if (cause === "timeout") {
        settled = true;
        settle();
        reject(
          new AsyncSubprocessError(`Command timed out after ${options.timeoutMs}ms`, undefined, "", "", "ETIMEDOUT"),
        );
      } else if (cause === "abort" && pendingCloseSettle !== undefined) {
        pendingCloseSettle();
      }
    };

    const triggerTermination = (newCause: "timeout" | "abort") => {
      if (cause === undefined) cause = newCause;
      killGroup().then(() => {
        groupConfirmedDead = true;
        finalizeAfterConfirmedDeath();
      });
    };

    const onAbort = () => triggerTermination("abort");
    const cleanupAbort = () => options.signal?.removeEventListener("abort", onAbort);
    if (options.signal !== undefined) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const settle = () => {
      cleanupAbort();
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    };

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      settle();
      reject(new AsyncSubprocessError(error.message, undefined, "", "", undefined));
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const applyCloseResult = () => {
        if (settled) return;
        settled = true;
        settle();
        if (code !== 0 || signal !== null) {
          reject(
            new AsyncSubprocessError(
              `Command failed: ${cmd} ${args.join(" ")}`,
              code ?? undefined,
              stdout,
              stderr,
              signal ?? undefined,
            ),
          );
        } else resolve(stdio === "ignore" ? "" : stdout);
      };
      // Group-mode close outside timeout/abort (`cause` unset) settles right away — natural
      // success or non-zero exit never waits on group-death confirmation. Under abort, the
      // direct child's own close classification (status/code/output) is retained but held
      // until the whole group is confirmed dead (`finalizeAfterConfirmedDeath` is a no-op
      // until then); under timeout, close is ignored entirely, so `ETIMEDOUT` always wins.
      if (cause === undefined) applyCloseResult();
      else if (cause === "abort") {
        pendingCloseSettle = applyCloseResult;
        finalizeAfterConfirmedDeath();
      }
    });

    if (options.timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => {
        if (settled) return;
        triggerTermination("timeout");
      }, options.timeoutMs);
      timeoutTimer.unref?.();
    }
  });
}

export const realAsyncSubprocessRunner: AsyncSubprocessRunner = {
  async runAsync(cmd, args, cwd, options) {
    const stdio = options?.stdio ?? "pipe";
    const groupMode = options?.processGroup !== undefined;
    if (groupMode) return runGroupMode(cmd, args, cwd, options ?? {}, stdio);
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
