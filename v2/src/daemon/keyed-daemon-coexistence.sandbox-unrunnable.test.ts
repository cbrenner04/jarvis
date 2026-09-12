// Real-socket coverage for the stable public daemon address and private successor endpoint.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getInvokingExecutableDigest } from "../cli/dispatch-revision";
import { connectIpcClient } from "../ipc/client";
import type { ResponseFrame } from "../ipc/types";
import { daemonPathsByDigest } from "../paths";
import { canUseUnixSockets } from "../testing/unix-socket";

const socketTest = test.skipIf(!canUseUnixSockets());
const cliEntrypoint = join(import.meta.dir, "..", "cli.ts");
const capturedPids = new Set<number>();

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function health(socketPath: string): Promise<unknown> {
  const client = await connectIpcClient(socketPath);
  try {
    client.send({ kind: "request", id: socketPath, method: "health" });
    const frame = await client.nextFrame();
    expect(frame.kind).toBe("response");
    return (frame as ResponseFrame).result;
  } finally {
    client.close();
  }
}

async function runCli(args: readonly string[], jarvisHome: string): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn([process.execPath, cliEntrypoint, ...args], {
    env: { ...process.env, JARVIS_HOME: jarvisHome },
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

afterEach(() => {
  for (const pid of capturedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone or unkillable.
    }
  }
  capturedPids.clear();
});

describe("daemon (stable public address)", () => {
  socketTest(
    "answers on public and private sockets, records its public pid, and reports running publicly",
    async () => {
      const tempHome = mkdtempSync(join(tmpdir(), "jarvis-stable-address-test-"));
      const originalJarvisHome = process.env.JARVIS_HOME;

      try {
        const started = await runCli(["daemon", "start"], tempHome);
        expect(started.code).toBe(0);
        expect(started.stdout).toBeTruthy();
        const result = JSON.parse(started.stdout.trim());
        expect(result.pid).toBeGreaterThan(0);
        capturedPids.add(result.pid);
        expect(isProcessAlive(result.pid)).toBe(true);

        const publicSocketPath = join(tempHome, "daemon.sock");
        expect(result.socketPath).toBe(publicSocketPath);
        expect(result.socketPath).not.toMatch(/daemon-[0-9a-f]{16}\.sock$/);
        expect(await health(publicSocketPath)).toEqual({ ok: true });

        process.env.JARVIS_HOME = tempHome;
        const digest = await getInvokingExecutableDigest();
        const privateSocketPath = daemonPathsByDigest(digest).socketPath;
        expect(privateSocketPath).not.toBe(publicSocketPath);
        expect(await health(privateSocketPath)).toEqual({ ok: true });

        expect(Number(readFileSync(join(tempHome, "daemon.pid"), "utf-8").trim())).toBe(result.pid);

        const status = await runCli(["daemon", "status"], tempHome);
        expect(status.code).toBe(0);
        expect(status.stdout).toContain("running");
      } finally {
        if (originalJarvisHome !== undefined) {
          process.env.JARVIS_HOME = originalJarvisHome;
        } else {
          delete process.env.JARVIS_HOME;
        }
        rmSync(tempHome, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
