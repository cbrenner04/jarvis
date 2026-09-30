import { expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore } from "../persistence/state-store.ts";
import { DEFAULT_DAEMON_READINESS_TIMEOUT_MS, DEFAULT_SELF_HANDOFF_READINESS_TIMEOUT_MS } from "./daemon-changeover.ts";
import { startDaemonRuntime } from "./daemon.ts";
import type { ProcessProber, SocketProber } from "./daemon-lifecycle.ts";

function queueDigestSampler(): { sample: () => Promise<string>; push: (digest: string) => void } {
  const queue: string[] = [];
  let idleCounter = 0;
  return {
    sample: async () => {
      const next = queue.shift();
      if (next !== undefined) return next;
      idleCounter += 1;
      return `idle-${idleCounter}`;
    },
    push: (digest: string) => {
      queue.push(digest);
    },
  };
}

const CHANGEOVER_OUTCOME = {
  kind: "changeover" as const,
  privateSocketPath: "/fake/private.sock",
  handoffId: "handoff-1",
};

test(
  "startDaemonRuntime default spawnSelfHandoffSuccessor tolerates readiness after the manual-start budget",
  async () => {
    const tmpDir = join(tmpdir(), `jarvis-self-handoff-readiness-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const publicSocketPath = join(tmpDir, "daemon.sock");
    const store = openStateStore(join(tmpDir, "state.sqlite"));
    const sampler = queueDigestSampler();
    const observedDigest = "observed-self-handoff-readiness-digest";

    type ProbePhase = "occupancy" | "release" | "readiness";
    let phase: ProbePhase = "occupancy";
    let readinessStartMs = 0;
    const socketProber: SocketProber = {
      probe: async () => {
        if (phase === "occupancy") {
          phase = "release";
          return true;
        }
        if (phase === "release") {
          phase = "readiness";
          readinessStartMs = Date.now();
          return false;
        }
        return Date.now() - readinessStartMs > DEFAULT_DAEMON_READINESS_TIMEOUT_MS;
      },
    };
    const processProber: ProcessProber = { isAlive: () => true };

    let handoffCommitted = false;
    let readinessDelayMs = 0;

    const runtime = await startDaemonRuntime(
      publicSocketPath,
      store,
      { tail: () => [], async *follow() {} },
      {
        privateSocketPath: join(tmpDir, "incumbent-private.sock"),
        enableSelfHandoff: true,
        sampleExecutableDigest: sampler.sample,
        selfHandoffSamplingIntervalMs: 5,
        enumerateOtherDaemonSockets: () => [],
        processExit: (code: number) => {
          throw new Error(`unexpected daemon exit ${code}`);
        },
        selfHandoffStartDaemonOptions: {
          daemonScript: "/fake/script",
          socketProber,
          processProber,
          requestChangeover: async () => CHANGEOVER_OUTCOME,
          requestHandoffResolution: async (_private, _id, resolution) => {
            if (resolution === "commit") {
              handoffCommitted = true;
              readinessDelayMs = Date.now() - readinessStartMs;
              return "committed";
            }
            return "rolled_back";
          },
        },
      },
    );

    sampler.push(observedDigest);
    sampler.push(observedDigest);

    const deadline = Date.now() + DEFAULT_SELF_HANDOFF_READINESS_TIMEOUT_MS + 5_000;
    while (Date.now() < deadline) {
      if (handoffCommitted) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(handoffCommitted).toBe(true);
    expect(readinessDelayMs).toBeGreaterThan(DEFAULT_DAEMON_READINESS_TIMEOUT_MS);

    await runtime.close();
    rmSync(tmpDir, { recursive: true, force: true });
  },
  DEFAULT_SELF_HANDOFF_READINESS_TIMEOUT_MS + 10_000,
);
