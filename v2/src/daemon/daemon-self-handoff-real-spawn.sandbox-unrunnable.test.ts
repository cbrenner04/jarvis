// Real-process coverage for autonomous self-handoff: a spawned production entrypoint (sampler driven
// by a test digest file) starts a real successor through the default `startDaemon` closure.

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectIpcClient } from "../ipc/client";
import type { IpcFrame } from "../ipc/types";
import { orchestrationStorePath } from "../paths";
import { openStateStore } from "../persistence/state-store";
import { canUseUnixSockets } from "../testing/unix-socket";

const socketTest = test.skipIf(!canUseUnixSockets());
const entrypoint = resolve(import.meta.dir, "../daemon-entrypoint.ts");
const SELF_HANDOFF_INTERVAL_MS = 50;

async function request(socketPath: string, method: string): Promise<IpcFrame> {
  const client = await connectIpcClient(socketPath);
  try {
    client.send({ kind: "request", id: `${method}-${Date.now()}-${Math.random()}`, method });
    return await client.nextFrame();
  } finally {
    client.close();
  }
}

async function answersHealth(socketPath: string): Promise<boolean> {
  try {
    return (await request(socketPath, "health")).kind === "response";
  } catch {
    return false;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(pidPath: string): number | undefined {
  if (!existsSync(pidPath)) return undefined;
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, boundMs: number): Promise<boolean> {
  const deadline = Date.now() + boundMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
}

function seedRunHistory(home: string, count: number): void {
  const store = openStateStore(orchestrationStorePath(home));
  for (let i = 0; i < count; i++) {
    store.createRun({
      project: "p",
      specRef: `s${i}`,
      worktreePath: `/w/${i}`,
      branch: `b${i}`,
      specPath: `/s/${i}`,
      status: "blocked",
      workflowSnapshot: {
        invocationId: `inv-${i}`,
        steps: [
          { stepId: "implement", role: "implement", stepRules: "x".repeat(3_000) },
          { stepId: "review", role: "review", behavior: "review" },
        ],
      },
    });
  }
}

describe("daemon self-handoff (real processes)", () => {
  socketTest(
    "a changed observed digest hands the public socket to a real successor and the incumbent exits",
    async () => {
      // JARVIS_HOME and the socket directory differ on purpose: the successor's pid/log/private
      // paths must derive from the running daemon's own socket directory, not module-level home paths.
      const home = mkdtempSync(join(tmpdir(), "jsh-home-"));
      const sockDir = mkdtempSync(join(tmpdir(), "jsh-sock-"));
      mkdirSync(join(home, "state"), { recursive: true });
      // A realistic run history makes the incumbent's full `list` projection take on the order of a
      // second. Successor drain polling must not starve the incumbent's handoff readiness loop.
      seedRunHistory(home, 15_000);
      const publicSocketPath = join(sockDir, "daemon.sock");
      const pidPath = join(sockDir, "daemon.pid");
      const digestFile = join(home, "digest");
      writeFileSync(digestFile, "unknown");
      const logFd = openSync(join(home, "incumbent.log"), "a");

      const incumbent = spawn(
        "bun",
        [
          entrypoint,
          "--socket",
          publicSocketPath,
          "--private-socket",
          join(sockDir, "daemon-incumbent.sock"),
          "--test-owner-pid",
          String(process.pid),
          "--test-self-handoff-digest-file",
          digestFile,
          "--test-self-handoff-interval-ms",
          String(SELF_HANDOFF_INTERVAL_MS),
        ],
        { env: { ...process.env, JARVIS_HOME: home }, stdio: ["ignore", logFd, logFd] },
      );
      const incumbentPid = incumbent.pid;
      let incumbentExited = false;
      incumbent.once("exit", () => {
        incumbentExited = true;
      });
      try {
        if (incumbentPid === undefined) throw new Error("incumbent did not spawn");
        expect(await waitFor(() => answersHealth(publicSocketPath), 15_000)).toBe(true);

        // An "unknown" sample never triggers: nothing hands off while the file is unchanged.
        // Absence can't be awaited, so this holds for one digest-sampling interval only.
        await new Promise((r) => setTimeout(r, SELF_HANDOFF_INTERVAL_MS));
        expect(existsSync(pidPath)).toBe(false);

        writeFileSync(digestFile, "changed-observed-digest");

        expect(await waitFor(() => readPid(pidPath) !== undefined, 20_000)).toBe(true);
        const successorPid = readPid(pidPath);
        expect(successorPid).not.toBe(incumbentPid);
        expect(successorPid !== undefined && isAlive(successorPid)).toBe(true);
        expect(existsSync(join(sockDir, "daemon-changed-observed.sock"))).toBe(true);
        expect(await answersHealth(publicSocketPath)).toBe(true);

        // No runs to drain: the retired incumbent exits. Node's `exit` event only fires once the OS
        // has reaped the process and torn down its process group, so this is a real, not merely
        // observed, exit.
        expect(await waitFor(() => incumbentExited, 15_000)).toBe(true);
        // The successor must outlive its spawning incumbent, not merely be alive at the instant it
        // exits: sample alive+health repeatedly across a real window after the incumbent is gone.
        for (let sample = 0; sample < 3; sample++) {
          expect(successorPid !== undefined && isAlive(successorPid)).toBe(true);
          expect(await answersHealth(publicSocketPath)).toBe(true);
          if (sample < 2) await new Promise((r) => setTimeout(r, SELF_HANDOFF_INTERVAL_MS));
        }
      } finally {
        for (const pid of [readPid(pidPath), incumbentPid]) {
          if (pid !== undefined && isAlive(pid)) process.kill(pid, "SIGKILL");
        }
        rmSync(home, { recursive: true, force: true });
        rmSync(sockDir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
