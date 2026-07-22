// Two keyed daemons coexist at runtime over real sockets with distinct digests.
// Validates that daemonPathsByDigest produces path disjointness and both daemon
// processes stay live when started under the same JARVIS_HOME.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../cli";
import { connectIpcClient } from "../ipc/client";
import type { ResponseFrame } from "../ipc/types";
import { daemonPathsByDigest } from "../paths";
import { canUseUnixSockets } from "../testing/unix-socket";

const socketTest = test.skipIf(!canUseUnixSockets());
const capturedPids = new Set<number>();

async function startDaemon(digest: string): Promise<{ pid: number; socketPath: string }> {
  let stdout = "";
  const exitCode = await main(
    ["daemon", "start"],
    { stdout: (s) => (stdout += s), stderr: () => {} },
    { getExecutableDigest: async () => digest },
  );
  expect(exitCode).toBe(0);
  expect(stdout).toBeTruthy();
  const result = JSON.parse(stdout.trim());
  expect(result.pid).toBeGreaterThan(0);
  capturedPids.add(result.pid);
  return result;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const pid of capturedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone or unkillable -- best-effort reap.
    }
  }
  capturedPids.clear();
});

describe("daemon (keyed coexistence)", () => {
  socketTest("two daemons coexist with distinct digests over real sockets", async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "jarvis-keyed-test-"));
    const digest1 = "digest1111111111";
    const digest2 = "digest2222222222";

    const originalJarvisHome = process.env.JARVIS_HOME;
    process.env.JARVIS_HOME = tempHome;

    try {
      const daemon1 = await startDaemon(digest1);
      expect(daemon1.socketPath).toContain("daemon-digest1");
      const daemon2 = await startDaemon(digest2);
      expect(daemon2.socketPath).toContain("daemon-digest2");

      expect(daemon1.pid).not.toBe(daemon2.pid);
      expect(isProcessAlive(daemon1.pid)).toBe(true);
      expect(isProcessAlive(daemon2.pid)).toBe(true);

      const paths1 = daemonPathsByDigest(digest1);
      const paths2 = daemonPathsByDigest(digest2);
      expect(paths1.socketPath).toBe(daemon1.socketPath);
      expect(paths2.socketPath).toBe(daemon2.socketPath);
      expect(paths1.socketPath).not.toBe(paths2.socketPath);
      expect(paths1.pidPath).not.toBe(paths2.pidPath);
      expect(paths1.logPath).not.toBe(paths2.logPath);

      expect(Number(readFileSync(paths1.pidPath, "utf-8").trim())).toBe(daemon1.pid);
      expect(Number(readFileSync(paths2.pidPath, "utf-8").trim())).toBe(daemon2.pid);

      for (const { socketPath } of [daemon1, daemon2]) {
        const client = await connectIpcClient(socketPath);
        try {
          client.send({ kind: "request", id: socketPath, method: "status" });
          const frame = await client.nextFrame();
          expect(frame.kind).toBe("response");
          expect(((frame as ResponseFrame).result as { state?: string }).state).toBe("running");
        } finally {
          client.close();
        }
      }
    } finally {
      if (originalJarvisHome !== undefined) {
        process.env.JARVIS_HOME = originalJarvisHome;
      } else {
        delete process.env.JARVIS_HOME;
      }
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
