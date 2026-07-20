import { afterEach } from "bun:test";
import { isProcessAlive, startDaemon } from "../daemon/daemon-lifecycle.ts";

/** Owns detached daemons started by a sandbox-unrunnable test. */
export function createTestDaemonLifecycle(): {
  start: (socketPath: string, options?: Parameters<typeof startDaemon>[1]) => ReturnType<typeof startDaemon>;
  reap: () => void;
} {
  const pids = new Set<number>();
  const reap = () => {
    for (const pid of pids) {
      if (isProcessAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // The daemon exited between probe and signal.
        }
      }
    }
    pids.clear();
  };

  afterEach(reap);
  return {
    start: (socketPath, options) =>
      startDaemon(socketPath, {
        ...options,
        testOwnerPid: process.pid,
        onSpawn: (pid) => {
          pids.add(pid);
          options?.onSpawn?.(pid);
        },
      }),
    reap,
  };
}
