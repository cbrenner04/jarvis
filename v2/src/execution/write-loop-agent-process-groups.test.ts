import { expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { openStateStore } from "../persistence/state-store.ts";
import { createResolvedAgentBinding } from "../shared/invocation/agents.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { createFakeWithExternalWorktree, trackedTempRoots } from "../testing/write-fixtures.ts";
import { executeWriteLoop, type WallSegmentSchedule } from "./write-loop.ts";

const { roots } = trackedTempRoots();
const AGENT_PGID = 999_999;
const DESCENDANT_PGID = 888_888;

class AgentChild extends EventEmitter {
  readonly pid = AGENT_PGID;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();

  async close(code: number | null = 0) {
    if (code === 0) this.stdout.write(`${JSON.stringify({ type: "result", result: "progress" })}\n`);
    this.stdout.end();
    this.stderr.end();
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.emit("close", code);
  }

  kill() {
    return true;
  }
}

function startIteration(probe?: () => Promise<ReadonlySet<number>>, agentId = "claude") {
  mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });
  const jarvisRoot = trackedMkdtempSync(join(process.cwd(), ".scratch", "agent-groups-"));
  roots.push(jarvisRoot);
  const store = openStateStore(":memory:");
  const child = new AgentChild();
  const controller = new AbortController();
  const signals: { pgid: number; signal: NodeJS.Signals }[] = [];
  const recordedAtSignal: number[][] = [];
  let runId = "";
  let fireWatchdog = () => {};
  let fireIdle = () => {};
  let resolveSpawn!: () => void;
  const spawned = new Promise<void>((resolve) => {
    resolveSpawn = resolve;
  });
  const schedule: WallSegmentSchedule = (fire) => {
    fireWatchdog = fire;
    return { cancel() {} };
  };
  const binding = createResolvedAgentBinding(
    { agentId, adapterModel: "sonnet", priceKey: "sonnet" },
    {
      spawn: () => {
        resolveSpawn();
        return child as unknown as ChildProcess;
      },
      watchWorktreeActivity: () => {},
      codexSessionsDir: join(jarvisRoot, "codex-sessions"),
      probeAgentDescendantProcessGroups: probe ?? (async () => new Set([AGENT_PGID, DESCENDANT_PGID, process.pid])),
      signalProcessGroup: (pgid, signal) => {
        recordedAtSignal.push(store.verifierProcessGroups(runId));
        signals.push({ pgid, signal });
      },
      setTimeout: ((fire: () => void, delay: number) => {
        if (delay === 123) fireIdle = fire;
        return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeout: (() => {}) as typeof clearTimeout,
    },
  );
  const result = executeWriteLoop({
    worktree: { projectRoot: "/fake", projectName: "demo", branchName: "agent-groups", baseRef: "HEAD", jarvisRoot },
    specPath: "spec.md",
    expectedArtifactPath: "proof.txt",
    stepRules: "Return one terminal token.",
    bindings: [binding],
    stateStore: store,
    withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
    sessionsDir: join(jarvisRoot, "sessions"),
    stagedMarkdownLintRunner: { runAsync: async () => "" },
    maxIterations: 1,
    idleOutputMs: 123,
    joinProcessOnIdleStall: true,
    schedule,
    signal: controller.signal,
    onRunCreated: (id) => {
      runId = id;
    },
  });
  return {
    child,
    store,
    spawned,
    result,
    signals,
    recordedAtSignal,
    recorded: () => store.verifierProcessGroups(runId),
    abort: () => controller.abort("operator-kill"),
    timeout: () => fireWatchdog(),
    stall: () => fireIdle(),
  };
}

test("bounded iteration records the agent group through production invoke forwarding and clears on success", async () => {
  const iteration = startIteration();
  try {
    await iteration.spawned;
    expect(iteration.recorded()).toEqual([AGENT_PGID]);
    await iteration.child.close();
    await iteration.result;
    expect(iteration.recorded()).toEqual([]);
  } finally {
    iteration.store.close();
  }
});

for (const cause of ["abort", "timeout", "stall"] as const) {
  test(`${cause} snapshot records distinct foreign descendant groups before signals and clears on settle`, async () => {
    const iteration = startIteration();
    try {
      await iteration.spawned;
      expect(iteration.recorded()).toEqual([AGENT_PGID]);
      iteration[cause]();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(iteration.recorded().sort()).toEqual([DESCENDANT_PGID, AGENT_PGID]);
      expect(iteration.recordedAtSignal.map((groups) => groups.sort())).toEqual([
        [DESCENDANT_PGID, AGENT_PGID],
        [DESCENDANT_PGID, AGENT_PGID],
      ]);
      expect(iteration.signals).toEqual([
        { pgid: DESCENDANT_PGID, signal: "SIGTERM" },
        { pgid: AGENT_PGID, signal: "SIGTERM" },
      ]);
      await iteration.child.close(null);
      await iteration.result;
      expect(iteration.recorded()).toEqual([]);
    } finally {
      iteration.store.close();
    }
  });
}

test("a descendant snapshot resolving after invocation settle cannot leave stale recorded groups", async () => {
  let resolveProbe!: (groups: ReadonlySet<number>) => void;
  const snapshot = new Promise<ReadonlySet<number>>((resolve) => {
    resolveProbe = resolve;
  });
  const iteration = startIteration(() => snapshot);
  try {
    await iteration.spawned;
    iteration.abort();
    await iteration.child.close(null);
    await iteration.result;
    expect(iteration.recorded()).toEqual([]);
    resolveProbe(new Set([AGENT_PGID, DESCENDANT_PGID]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(iteration.recorded()).toEqual([]);
    expect(iteration.signals.map(({ pgid }) => pgid)).toEqual([DESCENDANT_PGID, AGENT_PGID]);
  } finally {
    iteration.store.close();
  }
});

for (const agentId of ["codex", "cursor", "opencode"]) {
  test(`${agentId} binding forwards process-group recording and clears on abort`, async () => {
    const iteration = startIteration(undefined, agentId);
    try {
      await iteration.spawned;
      expect(iteration.recorded()).toEqual([AGENT_PGID]);
      iteration.abort();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(iteration.recorded().sort()).toEqual([DESCENDANT_PGID, AGENT_PGID]);
      await iteration.child.close(null);
      await iteration.result;
      expect(iteration.recorded()).toEqual([]);
    } finally {
      iteration.store.close();
    }
  });
}
