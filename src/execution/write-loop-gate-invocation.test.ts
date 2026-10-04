import { afterEach, describe, expect, test } from "bun:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_STEP_BUDGET_MS } from "../../scripts/ready.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { createResolvedAgentBinding } from "../shared/invocation/agents.ts";
import type { InvocationBinding } from "../shared/invocation/execute.ts";
import { createFakeWithExternalWorktree, createJarvisHome } from "../testing/write-fixtures.ts";
import { isReadyTestCommand, ReadyGateError } from "./ready-finalize.ts";
import {
  CLEAN_MARKDOWNLINT_RUNNER,
  claudeGateShellBinding,
  claudeGateShellFrames,
  claudeStreamGateShellFrames,
  cursorGateShellBinding,
  GateShellFrameChild,
  gateShellFrames,
  roots,
  TestLogSink,
} from "./write-loop.test-support.ts";
import {
  acquireGateInvocationLease,
  gateInvocationAdmits,
  executeWriteLoop as invokeWriteLoop,
  liveGateInvocationLeaseCount,
  MAX_CONCURRENT_AGENT_GATE_INVOCATIONS,
  subscribeGateInvocationLeaseReleased,
  type WriteLoopInput,
} from "./write-loop.ts";

function executeWriteLoop(input: WriteLoopInput): ReturnType<typeof invokeWriteLoop> {
  return invokeWriteLoop({
    ...input,
    stagedMarkdownLintRunner: input.stagedMarkdownLintRunner ?? CLEAN_MARKDOWNLINT_RUNNER,
  });
}

describe.serial("agent gate shell observability", () => {
  test("implement iteration records classified active-gate state from streamed shell frames", async () => {
    const gateCommand = "bun run test:agent";
    expect(isReadyTestCommand(gateCommand)).toBe(true);
    expect(isReadyTestCommand("bun test")).toBe(false);

    const { startedFrame, completedFrame, resultFrame } = gateShellFrames(gateCommand);

    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const sessionsDir = join(jarvisRoot, "sessions");
    const store = openStateStore(stateDbPath);
    try {
      const result = await executeWriteLoop({
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "gate-shell-observability",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return progress.",
        expectedArtifactPath: "proof.txt",
        bindings: [cursorGateShellBinding([startedFrame, completedFrame, resultFrame])],
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir,
        maxIterations: 1,
        clock: () => new Date("2026-09-08T06:00:00.000Z"),
      });

      expect(result.kind).toBe("budget-exhausted");
      const shardDir = join(sessionsDir, "2026-09");
      const sessionBasename = readdirSync(shardDir)[0];
      expect(sessionBasename).toBeDefined();
      const sessionContent = readFileSync(join(shardDir, sessionBasename ?? ""), "utf8");
      expect(sessionContent).toContain(
        `active_gate command=${gateCommand} startedAtMs=${Date.parse("2026-09-08T06:00:00.000Z")}`,
      );
      expect(sessionContent).not.toMatch(/active_gate command=bun test/);
    } finally {
      store.close();
    }
  });
});

describe.serial("gate invocation budget and settlement", () => {
  afterEach(() => {
    // Every test releases what it acquired; a leaked lease is a test defect, not something to reset by fiat.
    expect(liveGateInvocationLeaseCount()).toBe(0);
  });

  test("refuses gate invocation when iteration ceiling headroom cannot accommodate TEST_STEP_BUDGET_MS", async () => {
    const gateCommand = "bun run test:agent";
    const { startedFrame, completedFrame, resultFrame } = gateShellFrames(gateCommand);
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const sessionsDir = join(jarvisRoot, "sessions");
    const store = openStateStore(stateDbPath);
    const sink = new TestLogSink();
    try {
      const result = await executeWriteLoop({
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "gate-preflight-refusal",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return progress.",
        expectedArtifactPath: "proof.txt",
        bindings: [cursorGateShellBinding([startedFrame, completedFrame, resultFrame])],
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir,
        logSink: sink,
        maxIterations: 1,
        iterationCeilingMs: TEST_STEP_BUDGET_MS - 1,
        clock: () => new Date("2026-09-08T06:00:00.000Z"),
      });

      expect(result).toMatchObject({
        kind: "gate_invocation_refused",
        iterationsConsumed: 1,
        resumable: true,
        gateCommand,
        gateRefusalCause: "ceiling_headroom",
      });
      const finished = sink
        .getEventsForRun(result.runId)
        .find((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "gate_invocation_refused");
      expect(finished).toMatchObject({ resumable: true, gateCommand, gateRefusalCause: "ceiling_headroom" });
    } finally {
      store.close();
    }
  });

  test("serializes concurrent gate invocations so only one lane proceeds", async () => {
    const gateCommand = "bun run test:agent";
    const { startedFrame, completedFrame, resultFrame } = gateShellFrames(gateCommand);
    let releaseFirstGate!: () => void;
    const firstGateHeld = new Promise<void>((resolve) => {
      releaseFirstGate = resolve;
    });
    let firstGateStarted!: () => void;
    const firstGateStartedPromise = new Promise<void>((resolve) => {
      firstGateStarted = resolve;
    });
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const sink = new TestLogSink();
    const baseInput = {
      specPath: "spec.md",
      stepRules: "Return progress.",
      expectedArtifactPath: "proof.txt",
      stateStore: store,
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
      sessionsDir: join(jarvisRoot, "sessions"),
      logSink: sink,
      maxIterations: 1,
      iterationCeilingMs: TEST_STEP_BUDGET_MS + 60_000,
      clock: () => new Date("2026-09-08T06:00:00.000Z"),
    };
    class SyncHoldingGateShellFrameChild extends GateShellFrameChild {
      override start(frames: string[]) {
        queueMicrotask(async () => {
          for (const frame of frames) {
            const parsed = JSON.parse(frame) as { type?: string; subtype?: string };
            this.stdout.write(`${frame}\n`);
            if (parsed.type === "tool_call" && parsed.subtype === "started") {
              await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
              firstGateStarted();
              await firstGateHeld;
            }
          }
          this.stdout.end();
          this.stderr.end();
          setImmediate(() => {
            this.emit("exit", 0);
            this.emit("close", 0);
          });
        });
      }
    }
    const holdingSpawn = (_binary: string, _argv: readonly string[], _opts: SpawnOptions): ChildProcess => {
      const child = new SyncHoldingGateShellFrameChild();
      child.start([startedFrame, completedFrame, resultFrame]);
      return child as unknown as ChildProcess;
    };
    try {
      const first = executeWriteLoop({
        ...baseInput,
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "gate-serialize-first",
          baseRef: "HEAD",
          jarvisRoot,
        },
        bindings: [
          createResolvedAgentBinding(
            { agentId: "cursor", adapterModel: "Composer 2.5", priceKey: "composer" },
            { spawn: holdingSpawn },
          ),
        ],
      });
      await firstGateStartedPromise;
      const second = await executeWriteLoop({
        ...baseInput,
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "gate-serialize-second",
          baseRef: "HEAD",
          jarvisRoot,
        },
        bindings: [cursorGateShellBinding([startedFrame, completedFrame, resultFrame])],
      });
      releaseFirstGate();
      const firstResult = await first;

      expect(firstResult.kind).not.toBe("gate_invocation_refused");
      expect(second).toMatchObject({
        kind: "gate_invocation_refused",
        iterationsConsumed: 1,
        resumable: true,
        gateCommand,
        gateRefusalCause: "slot_contention",
      });
      const finished = sink
        .getEventsForRun(second.runId)
        .find((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "gate_invocation_refused");
      expect(finished).toMatchObject({ gateCommand, gateRefusalCause: "slot_contention" });
    } finally {
      store.close();
    }
  });

  test("an iteration without a gate does not release another lane's held slot", async () => {
    const { resultFrame } = claudeGateShellFrames("bun run test:agent");
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const sink = new TestLogSink();
    // Another lane is mid-suite and holds the sole lease.
    const otherLane = acquireGateInvocationLease();
    expect(otherLane).toBeDefined();
    try {
      const result = await executeWriteLoop({
        specPath: "spec.md",
        stepRules: "Return progress.",
        expectedArtifactPath: "proof.txt",
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        logSink: sink,
        maxIterations: 1,
        iterationCeilingMs: TEST_STEP_BUDGET_MS + 60_000,
        clock: () => new Date("2026-09-08T06:00:00.000Z"),
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "gate-slot-unrelated-lane",
          baseRef: "HEAD",
          jarvisRoot,
        },
        bindings: [claudeGateShellBinding([resultFrame])],
      });
      expect(result.kind).not.toBe("gate_invocation_refused");
      // The unrelated lane's settle must not have freed the other lane's lease.
      expect(acquireGateInvocationLease()).toBeUndefined();
    } finally {
      otherLane?.release();
      store.close();
    }
  });

  test("a lane that never acquired the slot cannot release it", () => {
    const first = acquireGateInvocationLease();
    expect(first).toBeDefined();
    first?.release();
    first?.release();
    expect(liveGateInvocationLeaseCount()).toBe(0);

    const second = acquireGateInvocationLease();
    expect(second).toBeDefined();
    // A stale lease from an earlier hold cannot free the lease another lane holds now.
    first?.release();
    expect(liveGateInvocationLeaseCount()).toBe(1);
    expect(acquireGateInvocationLease()).toBeUndefined();
    second?.release();
    expect(liveGateInvocationLeaseCount()).toBe(0);
  });

  test("a release notifies subscribers once, asynchronously, after the lease is deleted", async () => {
    const observed: number[] = [];
    const unsubscribe = subscribeGateInvocationLeaseReleased(() => {
      observed.push(liveGateInvocationLeaseCount());
    });
    try {
      const lease = acquireGateInvocationLease();
      expect(lease).toBeDefined();
      lease?.release();
      expect(observed).toEqual([]);
      await Promise.resolve();
      expect(observed).toEqual([0]);
      lease?.release();
      await Promise.resolve();
      expect(observed).toEqual([0]);
    } finally {
      unsubscribe();
    }
    const after = acquireGateInvocationLease();
    after?.release();
    await Promise.resolve();
    expect(observed).toEqual([0]);
  });

  test("a throwing listener does not stop other listeners from being notified", async () => {
    let notified = 0;
    const unsubscribeThrowing = subscribeGateInvocationLeaseReleased(() => {
      throw new Error("listener failure");
    });
    const unsubscribeCounting = subscribeGateInvocationLeaseReleased(() => {
      notified += 1;
    });
    try {
      acquireGateInvocationLease()?.release();
      await Promise.resolve();
      expect(notified).toBe(1);
      expect(liveGateInvocationLeaseCount()).toBe(0);
    } finally {
      unsubscribeThrowing();
      unsubscribeCounting();
    }
  });

  test("gateInvocationAdmits bounds admission by the limit it is given", () => {
    expect(gateInvocationAdmits(0, 2)).toBe(true);
    expect(gateInvocationAdmits(1, 2)).toBe(true);
    expect(gateInvocationAdmits(2, 2)).toBe(false);
    const leases: Array<ReturnType<typeof acquireGateInvocationLease>> = [];
    for (let i = 0; i < MAX_CONCURRENT_AGENT_GATE_INVOCATIONS; i += 1) {
      const lease = acquireGateInvocationLease();
      expect(lease).toBeDefined();
      leases.push(lease);
    }
    expect(acquireGateInvocationLease()).toBeUndefined();
    for (const lease of leases) lease?.release();
    expect(liveGateInvocationLeaseCount()).toBe(0);
  });

  test.each([
    "settled",
    "threw",
    "aborted",
  ] as const)("a finalization-repair iteration releases the gate lease it acquired (%s)", async (exit) => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const controller = new AbortController();
    let calls = 0;
    let gateCalls = 0;
    let leaseCountDuringRepair = -1;
    const bindings: InvocationBinding[] = [
      {
        id: "repair-gate",
        metadata: { agent: "codex", model: "test" },
        invoke: async ({ cwd, signal, onAgentShellCommand }) => {
          calls += 1;
          if (calls === 1) {
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          }
          // The repair agent starts a full-suite gate and never reports its completion frame.
          await onAgentShellCommand?.("bun run test:agent");
          leaseCountDuringRepair = liveGateInvocationLeaseCount();
          if (exit === "threw") throw new Error("repair agent crashed mid-suite");
          if (exit === "aborted") {
            await new Promise<void>((resolve) => {
              if (signal?.aborted) return resolve();
              signal?.addEventListener("abort", () => resolve(), { once: true });
              queueMicrotask(() => controller.abort());
            });
            return { kind: "ok", stdout: "progress", stderr: "" };
          }
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];
    try {
      const result = await executeWriteLoop({
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: `repair-lease-${exit}`,
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings,
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        signal: controller.signal,
        maxIterations: 2,
        quiescenceTimeoutMs: 1,
        iterationCeilingMs: TEST_STEP_BUDGET_MS + 60_000,
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        runFixCommand: async () => {},
        readyFinalizer: async () => {
          gateCalls += 1;
          // Stay red through the autofix retry so a repair iteration actually runs.
          if (gateCalls <= 2) throw new ReadyGateError("bun run ready", 1, "red");
        },
      });
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(leaseCountDuringRepair).toBe(1);
      expect(result.kind).toBeDefined();
      expect(liveGateInvocationLeaseCount()).toBe(0);
    } finally {
      store.close();
    }
  });

  test("claude NDJSON releases gate slot on iteration settle when shell completion frame is missing", async () => {
    const gateCommand = "bun run test:agent";
    const { assistantStart, resultFrame } = claudeGateShellFrames(gateCommand);
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const sink = new TestLogSink();
    const baseInput = {
      specPath: "spec.md",
      stepRules: "Return progress.",
      expectedArtifactPath: "proof.txt",
      stateStore: store,
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
      sessionsDir: join(jarvisRoot, "sessions"),
      logSink: sink,
      maxIterations: 1,
      iterationCeilingMs: TEST_STEP_BUDGET_MS + 60_000,
      clock: () => new Date("2026-09-08T06:00:00.000Z"),
    };
    try {
      const first = await executeWriteLoop({
        ...baseInput,
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "claude-gate-slot-release",
          baseRef: "HEAD",
          jarvisRoot,
        },
        bindings: [claudeGateShellBinding([assistantStart, resultFrame])],
      });
      expect(first.kind).not.toBe("gate_invocation_refused");

      const second = await executeWriteLoop({
        ...baseInput,
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "claude-gate-slot-release-second",
          baseRef: "HEAD",
          jarvisRoot,
        },
        bindings: [claudeGateShellBinding([assistantStart, resultFrame])],
      });
      expect(second.kind).not.toBe("gate_invocation_refused");
    } finally {
      store.close();
    }
  });

  test("claude stream NDJSON does not release gate slot before correlated tool_result", async () => {
    const gateCommand = "bun run test:agent";
    const { streamStart, streamDelta, streamStop, toolResult, resultFrame } = claudeStreamGateShellFrames(gateCommand);
    let releaseFirstGate!: () => void;
    const firstGateHeld = new Promise<void>((resolve) => {
      releaseFirstGate = resolve;
    });
    let firstGateStarted!: () => void;
    const firstGateStartedPromise = new Promise<void>((resolve) => {
      firstGateStarted = resolve;
    });
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const sink = new TestLogSink();
    const baseInput = {
      specPath: "spec.md",
      stepRules: "Return progress.",
      expectedArtifactPath: "proof.txt",
      stateStore: store,
      withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
      sessionsDir: join(jarvisRoot, "sessions"),
      logSink: sink,
      maxIterations: 1,
      iterationCeilingMs: TEST_STEP_BUDGET_MS + 60_000,
      clock: () => new Date("2026-09-08T06:00:00.000Z"),
    };
    class ClaudeHoldingGateShellFrameChild extends GateShellFrameChild {
      override start(frames: string[]) {
        queueMicrotask(async () => {
          for (const frame of frames) {
            this.stdout.write(`${frame}\n`);
            const parsed = JSON.parse(frame) as { type?: string; event?: { type?: string } };
            if (parsed.type === "stream_event" && parsed.event?.type === "content_block_stop") {
              firstGateStarted();
              await firstGateHeld;
            }
          }
          this.stdout.end();
          this.stderr.end();
          setImmediate(() => {
            this.emit("exit", 0);
            this.emit("close", 0);
          });
        });
      }
    }
    const holdingSpawn = (_binary: string, _argv: readonly string[], _opts: SpawnOptions): ChildProcess => {
      const child = new ClaudeHoldingGateShellFrameChild();
      child.start([streamStart, streamDelta, streamStop, toolResult, resultFrame]);
      return child as unknown as ChildProcess;
    };
    try {
      const first = executeWriteLoop({
        ...baseInput,
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "claude-gate-serialize-first",
          baseRef: "HEAD",
          jarvisRoot,
        },
        bindings: [
          createResolvedAgentBinding(
            { agentId: "claude", adapterModel: "sonnet", priceKey: "sonnet" },
            { spawn: holdingSpawn },
          ),
        ],
      });
      await firstGateStartedPromise;
      const second = await executeWriteLoop({
        ...baseInput,
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "claude-gate-serialize-second",
          baseRef: "HEAD",
          jarvisRoot,
        },
        bindings: [
          claudeGateShellBinding([claudeGateShellFrames(gateCommand).assistantStart, toolResult, resultFrame]),
        ],
      });
      releaseFirstGate();
      const firstResult = await first;

      expect(firstResult.kind).not.toBe("gate_invocation_refused");
      expect(second).toMatchObject({
        kind: "gate_invocation_refused",
        iterationsConsumed: 1,
        resumable: true,
        gateCommand,
      });
    } finally {
      store.close();
    }
  });
});
