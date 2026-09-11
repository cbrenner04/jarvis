// Real-socket coverage for the stable public daemon address: a started daemon answers health
// on the stable public socket path (no digest in it) and on its digest-keyed private endpoint,
// records its pid at the public pid path, and `daemon status` reports running from the public
// socket probe.
//
// Spawned as a real CLI subprocess rather than driven in-process: `paths.ts`'s exported path
// constants are computed once at module import, so an in-process `JARVIS_HOME` mutation after
// the CLI module has already loaded would not be observed by them.

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
      // Already gone or unkillable -- best-effort reap.
    }
  }
  capturedPids.clear();
});

describe("daemon (stable public address)", () => {
  socketTest(
    "a started daemon answers health on the public socket and its digest-keyed private endpoint, records its pid publicly, and reports running from the public probe",
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

        // Live only long enough to compute the expected keyed path; restored in `finally`.
        process.env.JARVIS_HOME = tempHome;
        const digest = await getInvokingExecutableDigest();
        const privateSocketPath = daemonPathsByDigest(digest).socketPath;
        expect(privateSocketPath).not.toBe(publicSocketPath);
        expect(await health(privateSocketPath)).toEqual({ ok: true });

        const publicPidPath = join(tempHome, "daemon.pid");
        expect(Number(readFileSync(publicPidPath, "utf-8").trim())).toBe(result.pid);

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
