// Real-socket coverage for autonomous self-handoff: a daemon that samples its own executable tree
// digest and starts a successor with no client request once it stably diverges from the loaded one.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client";
import type { IpcFrame, ResponseFrame } from "../ipc/types";
import type { LogReader, LogSink } from "../persistence/log-stream";
import { openStateStore, type StateStore } from "../persistence/state-store";
import { flushBackgroundRuns, listRuns, loadRunOrThrow, mockWriteLoopInput, startRun } from "../testing/run-control";
import { canUseUnixSockets } from "../testing/unix-socket";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor";
import { startDaemonRuntime } from "./daemon";

const socketTest = test.skipIf(!canUseUnixSockets());

/** Self-handoff sampling interval every harness below runs with. Negative-assertion windows are
 * sized as small multiples of it, matched to the number of intervals each is documented to cover. */
const SELF_HANDOFF_INTERVAL_MS = 20;

function fakeReader(): LogReader {
  return { tail: () => [], async *follow() {} };
}

function fakeSink(): LogSink {
  return { append: () => undefined, close: () => undefined };
}

async function request(socketPath: string, method: string, params?: unknown): Promise<IpcFrame> {
  const client = await connectIpcClient(socketPath);
  try {
    client.send({ kind: "request", id: `${method}-${Date.now()}-${Math.random()}`, method, params });
    return await client.nextFrame();
  } finally {
    client.close();
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, boundMs: number, stepMs = 20): Promise<boolean> {
  const deadline = Date.now() + boundMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

/** True when `socketPath` refuses a `start` because its generation is retiring. */
async function isSuperseded(socketPath: string): Promise<boolean> {
  const frame = await request(socketPath, "start", { input: mockWriteLoopInput() });
  return frame.kind === "error" && (frame as { code?: string }).code === "daemon_superseded";
}

/** Same as {@link isSuperseded}, but treats a still-rebinding (unreachable) socket as superseded
 * too, so a caller can poll through the brief close/rebind window a rollback goes through. */
async function isSupersededOrUnavailable(socketPath: string): Promise<boolean> {
  try {
    return await isSuperseded(socketPath);
  } catch {
    return true;
  }
}

/** Requests `changeover` from the incumbent's public socket and returns the private endpoint and
 * handoff id it was handed, shared by every fake successor below. */
async function acceptChangeover(publicSocketPath: string): Promise<{ privateSocketPath: string; handoffId: string }> {
  const changeoverFrame = await request(publicSocketPath, "changeover");
  if (changeoverFrame.kind !== "response") {
    throw new Error(`changeover failed: ${JSON.stringify(changeoverFrame)}`);
  }
  return (changeoverFrame as ResponseFrame).result as { privateSocketPath: string; handoffId: string };
}

/** Plays the successor's half of the real changeover protocol and commits it, without spawning a
 * process: accepts the changeover, then answers `handoff_commit` on the private endpoint it was
 * handed. */
async function fakeSuccessor(publicSocketPath: string): Promise<"committed" | "rolled_back"> {
  const { privateSocketPath, handoffId } = await acceptChangeover(publicSocketPath);
  const settleFrame = await request(privateSocketPath, "handoff_commit", { handoffId });
  if (settleFrame.kind !== "response") {
    throw new Error(`handoff settle failed: ${JSON.stringify(settleFrame)}`);
  }
  const result = (settleFrame as ResponseFrame).result as { state?: "committed" | "rolled_back" };
  if (result.state === undefined) throw new Error("missing handoff state");
  return result.state;
}

/** Plays a successor that accepts the handoff and then dies during startup: rolls back the
 * transaction it was handed (exactly as `startDaemon`'s own failure path does) before surfacing
 * the failure as a rejection. */
async function fakeFailingSuccessor(publicSocketPath: string): Promise<never> {
  const { privateSocketPath, handoffId } = await acceptChangeover(publicSocketPath);
  await request(privateSocketPath, "handoff_rollback", { handoffId });
  throw new Error("simulated successor startup failure");
}

/** Digest sampler backed by a push queue: queued values are returned one per call, in order;
 * once drained it returns a fresh, never-repeating value so idle ticks can never accidentally
 * form two consecutive matching samples. */
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

/** Digest sampler whose calls never resolve on their own: each `sample()` call queues a resolver,
 * and the test drains them one at a time via `resolveOldest`, in call order. Decouples "which
 * logical sample answers which tick" from real interval timing, so a test can park a tick's own
 * `sample()` call mid-flight and inject other state changes before letting it resolve. */
function controlledDigestSampler(): {
  sample: () => Promise<string>;
  pendingCount: () => number;
  resolveOldest: (digest: string) => void;
} {
  const pendingResolvers: Array<(digest: string) => void> = [];
  return {
    sample: () =>
      new Promise<string>((resolve) => {
        pendingResolvers.push(resolve);
      }),
    pendingCount: () => pendingResolvers.length,
    resolveOldest: (digest: string) => {
      pendingResolvers.shift()?.(digest);
    },
  };
}

type Harness = {
  publicSocketPath: string;
  privateSocketPath: string;
  store: StateStore;
  fakeExecutor: ReturnType<typeof createFakeWriteLoopExecutor>;
  anchorRunId: string;
  close: () => Promise<void>;
};

/** Starts a real in-process incumbent with an admitted, never-settled anchor run so it never
 * drain-exits mid-test, and wires the self-handoff seams to `buildDeps`' return. */
async function startIncumbent(
  name: string,
  buildDeps: (paths: { publicSocketPath: string; privateSocketPath: string }) => Record<string, unknown> = () => ({}),
  optIn = true,
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), `jarvis-self-handoff-${name}-`));
  const publicSocketPath = join(root, "daemon.sock");
  const privateSocketPath = join(root, "daemon-incumbent.sock");
  const store = openStateStore(join(root, "state.sqlite"));
  const fakeExecutor = createFakeWriteLoopExecutor();
  const extraDeps = buildDeps({ publicSocketPath, privateSocketPath });

  const runtime = await startDaemonRuntime(publicSocketPath, store, fakeReader(), {
    privateSocketPath,
    openLogSink: () => fakeSink(),
    enumerateOtherDaemonSockets: () => [],
    hasMemoryHeadroom: () => true,
    // Settling the fake executor drives the same terminal-settlement call the real write loop
    // makes on success, so a test can observe a run reach "completed" through actual execution
    // rather than asserting a status it wrote itself.
    writeLoopExecutor: async (input, signal, pauseSignal) => {
      await fakeExecutor.executor(input, signal, pauseSignal);
      const run = store.findRunByProjectBranch({
        project: input.worktree.projectName,
        branch: input.worktree.branchName,
        stepId: input.stepId ?? null,
      });
      if (run !== null) store.commitTerminalRunSettlement({ runId: run.id, status: "completed" });
    },
    processExit: (code: number) => {
      throw new Error(`unexpected daemon exit ${code}`);
    },
    ...(optIn ? { enableSelfHandoff: true } : {}),
    selfHandoffSamplingIntervalMs: SELF_HANDOFF_INTERVAL_MS,
    ...extraDeps,
  });

  const client = await connectIpcClient(privateSocketPath);
  const anchorRunId = await startRun(
    client,
    mockWriteLoopInput({ projectName: `${name}-anchor`, branchName: "anchor" }),
  );
  client.close();
  if (typeof anchorRunId !== "string") throw new Error("expected anchor run to admit");

  return {
    publicSocketPath,
    privateSocketPath,
    store,
    fakeExecutor,
    anchorRunId,
    close: async () => {
      await runtime.close();
      fakeExecutor.abortAll();
      await flushBackgroundRuns(3);
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("daemon self-handoff (real sockets)", () => {
  socketTest(
    "a runtime started without the self-handoff opt-in never samples or spawns a successor",
    async () => {
      let samples = 0;
      let successorCalls = 0;
      const harness = await startIncumbent(
        "no-opt-in",
        () => ({
          sampleExecutableDigest: async () => {
            samples += 1;
            return "changed-no-opt-in";
          },
          startSelfHandoffSuccessor: async () => {
            successorCalls += 1;
            return "committed" as const;
          },
        }),
        false,
      );
      try {
        // No opt-in means no timer is ever scheduled; a few intervals' worth of real time is
        // enough margin to catch a regression that scheduled one anyway.
        await new Promise((resolve) => setTimeout(resolve, SELF_HANDOFF_INTERVAL_MS * 3));
        expect(samples).toBe(0);
        expect(successorCalls).toBe(0);
        expect(await isSuperseded(harness.privateSocketPath)).toBe(false);
      } finally {
        await harness.close();
      }
    },
    15_000,
  );

  socketTest(
    "a stable digest divergence starts a successor with no client request, and the already-admitted run stays live under the outgoing generation",
    async () => {
      const harness = await startIncumbent("basic", ({ publicSocketPath }) => ({
        sampleExecutableDigest: async () => "changed-basic",
        startSelfHandoffSuccessor: () => fakeSuccessor(publicSocketPath),
      }));
      try {
        // No client ever sends `changeover`; the daemon's own sampler must trigger it.
        expect(await waitFor(() => isSuperseded(harness.privateSocketPath), 3_000)).toBe(true);

        // The anchor run, admitted before the trigger fired, is still tracked live and settles
        // normally under the outgoing (incumbent) generation.
        const rows = await listRuns(await connectIpcClient(harness.privateSocketPath));
        expect(rows?.find((row) => row.runId === harness.anchorRunId)?.isLive).toBe(true);

        harness.fakeExecutor.settleAll();
        await flushBackgroundRuns(3);
        expect(loadRunOrThrow(harness.store, harness.anchorRunId).status).toBe("completed");
      } finally {
        await harness.close();
      }
    },
    15_000,
  );

  socketTest(
    "no second successor starts after this generation's own trigger commits",
    async () => {
      let callCount = 0;
      const harness = await startIncumbent("no-double-self", ({ publicSocketPath }) => ({
        sampleExecutableDigest: async () => "changed-no-double-self",
        startSelfHandoffSuccessor: async () => {
          callCount += 1;
          return fakeSuccessor(publicSocketPath);
        },
      }));
      try {
        expect(await waitFor(() => callCount === 1, 3_000)).toBe(true);
        // The sampler keeps matching for many more intervals; once committed, admission stays cut
        // and the sampling loop must stay stopped rather than spawn a second successor.
        await new Promise((resolve) => setTimeout(resolve, SELF_HANDOFF_INTERVAL_MS * 5));
        expect(callCount).toBe(1);
      } finally {
        await harness.close();
      }
    },
    15_000,
  );

  socketTest(
    "a client-initiated changeover stops the self-handoff sampling loop",
    async () => {
      let callCount = 0;
      const harness = await startIncumbent("client-cuts-sampling", () => ({
        sampleExecutableDigest: async () => "changed-client-cuts-sampling",
        startSelfHandoffSuccessor: async () => {
          callCount += 1;
          return "committed" as const;
        },
      }));
      try {
        const changeoverFrame = await request(harness.publicSocketPath, "changeover");
        expect(changeoverFrame.kind).toBe("response");

        // The sampler is divergent from the very first tick; absent the isRetiring() cutoff this
        // would trigger within two intervals.
        await new Promise((resolve) => setTimeout(resolve, SELF_HANDOFF_INTERVAL_MS * 2));
        expect(callCount).toBe(0);
      } finally {
        await harness.close();
      }
    },
    15_000,
  );

  socketTest(
    "self-handoff does not start while a client-initiated handoff is already pending",
    async () => {
      let successorCalls = 0;
      const digest = controlledDigestSampler();
      const harness = await startIncumbent("pending-guard", ({ publicSocketPath }) => ({
        sampleExecutableDigest: digest.sample,
        startSelfHandoffSuccessor: async () => {
          successorCalls += 1;
          return fakeSuccessor(publicSocketPath);
        },
      }));
      try {
        // First sample seeds the candidate; a single sample never triggers regardless.
        expect(await waitFor(() => digest.pendingCount() >= 1, 3_000)).toBe(true);
        digest.resolveOldest("d1");

        // The next tick's own sample() call is left pending. A client-initiated changeover lands
        // and is fully accepted (pending transaction created) while this tick is mid-flight.
        expect(await waitFor(() => digest.pendingCount() >= 1, 3_000)).toBe(true);
        const changeoverFrame = await request(harness.publicSocketPath, "changeover");
        expect(changeoverFrame.kind).toBe("response");

        // Only now does the in-flight tick's sample resolve, matching the seeded candidate: this
        // tick's own `isRetiring()` gate already passed before the changeover landed, so only the
        // pending-handoff guard inside `startHandoff` itself can still stop it from spawning a
        // second successor that would race the real one for the same private socket.
        digest.resolveOldest("d1");

        await new Promise((resolve) => setTimeout(resolve, SELF_HANDOFF_INTERVAL_MS * 3));
        expect(successorCalls).toBe(0);
      } finally {
        await harness.close();
      }
    },
    15_000,
  );

  socketTest(
    "a rejected successor restores incumbent admission; a retry needs two fresh matching samples",
    async () => {
      let attempts = 0;
      let firstAttemptSettled = false;
      const digest = queueDigestSampler();
      const harness = await startIncumbent("rollback-retry", ({ publicSocketPath }) => ({
        sampleExecutableDigest: digest.sample,
        startSelfHandoffSuccessor: async () => {
          attempts += 1;
          const isFirst = attempts === 1;
          try {
            return isFirst ? await fakeFailingSuccessor(publicSocketPath) : await fakeSuccessor(publicSocketPath);
          } finally {
            if (isFirst) firstAttemptSettled = true;
          }
        },
      }));
      try {
        digest.push("d1");
        digest.push("d1");
        expect(await waitFor(() => firstAttemptSettled, 3_000)).toBe(true);

        // The failed successor's own rollback restored admission on the incumbent (polled: the
        // public socket briefly unbinds and rebinds as part of that rollback).
        expect(await waitFor(async () => !(await isSupersededOrUnavailable(harness.publicSocketPath)), 3_000)).toBe(
          true,
        );

        // One fresh matching sample after the rollback does not retrigger.
        digest.push("d2");
        await new Promise((resolve) => setTimeout(resolve, SELF_HANDOFF_INTERVAL_MS * 3));
        expect(attempts).toBe(1);

        // Two fresh matching samples do.
        digest.push("d3");
        digest.push("d3");
        expect(await waitFor(() => attempts === 2, 3_000)).toBe(true);
      } finally {
        await harness.close();
      }
    },
    15_000,
  );

  socketTest(
    "the initiating generation's process log records loaded and observed digests as the self-handoff cause",
    async () => {
      const logLines: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        logLines.push(args.map((arg) => String(arg)).join(" "));
      };
      let harness: Harness | undefined;
      try {
        harness = await startIncumbent("log-line", ({ publicSocketPath }) => ({
          sampleExecutableDigest: async () => "changed-log-line",
          startSelfHandoffSuccessor: () => fakeSuccessor(publicSocketPath),
        }));
        expect(
          await waitFor(
            () =>
              logLines.some((line) =>
                /Self-handoff triggered: loaded digest \S+, observed digest changed-log-line/.test(line),
              ),
            3_000,
          ),
        ).toBe(true);
      } finally {
        console.error = originalError;
        if (harness) await harness.close();
      }
    },
    15_000,
  );
});
