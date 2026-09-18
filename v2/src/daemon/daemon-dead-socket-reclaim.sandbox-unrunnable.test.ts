// Real-process coverage: a SIGKILLed Bun daemon leaves its public and private socket files behind
// (Bun's connect reads them as ENOENT, not ECONNREFUSED); a fresh start must reclaim both, while a
// live listener is still never unlinked.

import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import { connectIpcClient } from "../ipc/client";
import { startIpcServer } from "../ipc/server";
import { canUseUnixSockets } from "../testing/unix-socket";
import { startDaemon } from "./daemon-lifecycle";

const socketTest = test.skipIf(!canUseUnixSockets());

/** A stand-in daemon: binds `--private-socket` then `--socket` through `startIpcServer` and answers health. */
function writeStandInDaemon(dir: string): string {
  const path = join(dir, "stand-in-daemon.ts");
  const serverModule = resolve(import.meta.dir, "../ipc/server.ts");
  writeFileSync(
    path,
    `import { startIpcServer } from ${JSON.stringify(serverModule)};
const arg = (flag: string) => process.argv[process.argv.indexOf(flag) + 1] as string;
const handlers = { health: () => ({ kind: "response" as const, result: { ok: true } }) };
await startIpcServer(arg("--private-socket"), handlers);
await startIpcServer(arg("--socket"), handlers);
setInterval(() => {}, 1_000);
`,
  );
  return path;
}

async function answersHealth(socketPath: string): Promise<boolean> {
  try {
    const client = await connectIpcClient(socketPath);
    try {
      client.send({ kind: "request", id: "h", method: "health" });
      return (await client.nextFrame()).kind === "response";
    } finally {
      client.close();
    }
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, boundMs: number): Promise<boolean> {
  const deadline = Date.now() + boundMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

socketTest(
  "a fresh start binds over a SIGKILLed daemon's leftover public and private sockets; a live listener still refuses",
  async () => {
    const dir = trackedMkdtempSync(join(tmpdir(), "jdsr-"));
    const publicPath = join(dir, "daemon.sock");
    const privatePath = join(dir, "daemon-0123456789abcdef.sock");
    const script = writeStandInDaemon(dir);
    const pids: number[] = [];
    try {
      const dead = spawn("bun", [script, "--socket", publicPath, "--private-socket", privatePath], { stdio: "ignore" });
      expect(await waitFor(() => answersHealth(publicPath), 10_000)).toBe(true);
      dead.kill("SIGKILL");
      await new Promise((r) => dead.once("exit", r));
      expect(existsSync(publicPath)).toBe(true);
      expect(existsSync(privatePath)).toBe(true);

      const started = await startDaemon(publicPath, {
        daemonScript: script,
        privateSocketPath: privatePath,
        readinessTimeoutMs: 10_000,
      });
      pids.push(started.pid);
      expect(await answersHealth(publicPath)).toBe(true);
      expect(await answersHealth(privatePath)).toBe(true);

      // Never-unlink-a-live-socket: both endpoints are live now, so a direct rebind refuses.
      await expect(startIpcServer(privatePath)).rejects.toThrow();
      await expect(startIpcServer(publicPath)).rejects.toThrow();
      expect(await answersHealth(publicPath)).toBe(true);
      expect(await answersHealth(privatePath)).toBe(true);
    } finally {
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
  40_000,
);
