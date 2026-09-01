import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcServer } from "../ipc/server.ts";
import type { LogReader } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore, type WorkflowSnapshot } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import { startDaemonRuntime } from "./daemon.ts";
import { deriveOperatorIncidents } from "./operator-incidents.ts";
import { runNotificationSweep } from "./operator-notification-sweep.ts";

const dbPath = join(tmpdir(), `jarvis-operator-notify-${process.pid}.sqlite`);

let store: StateStore;

function sweepDeps(
  overrides: Partial<Parameters<typeof runNotificationSweep>[0]> = {},
): Parameters<typeof runNotificationSweep>[0] {
  return {
    store,
    readSinkCommand: () => "cat",
    ...overrides,
  };
}

async function startDaemonWithSink(
  targetStore: StateStore,
  spawnSink: NonNullable<Parameters<typeof runNotificationSweep>[0]["spawnSink"]>,
  readSinkCommand: () => string | undefined = () => "cat",
) {
  const reader: LogReader = { tail: () => [], async *follow() {} };
  return startDaemonRuntime("/fake/socket", targetStore, reader, {
    openLogSink: () => ({ append: () => undefined, close: () => undefined }),
    startIpcServer: async () => ({ close: async () => undefined }) as IpcServer,
    readNotificationSinkCommand: readSinkCommand,
    notificationSpawnSink: spawnSink,
  });
}

beforeEach(() => {
  removeOrchestrationStore(dbPath);
  store = openStateStore(dbPath);
});

afterEach(() => {
  store.close();
  removeOrchestrationStore(dbPath);
});

test("pipeline awaiting-approval then terminal fires the sink once per transition", () => {
  const payloads: string[] = [];
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  runNotificationSweep(
    sweepDeps({
      spawnSink: (_command, json) => {
        payloads.push(json);
        return { ok: true };
      },
    }),
  );

  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "rejected" } });
  runNotificationSweep(
    sweepDeps({
      spawnSink: (_command, json) => {
        payloads.push(json);
        return { ok: true };
      },
    }),
  );

  expect(payloads).toHaveLength(2);
  const first = JSON.parse(payloads[0] ?? "{}") as { kind: string; pipelineId: string; transition: string };
  const second = JSON.parse(payloads[1] ?? "{}") as { kind: string; pipelineId: string; transition: string; cause: string };
  expect(first.kind).toBe("pipeline-awaiting-approval");
  expect(first.pipelineId).toBe(pipelineId);
  expect(first.transition).toBe("awaiting-approval:gate:default");
  expect(second.kind).toBe("pipeline-terminal");
  expect(second.pipelineId).toBe(pipelineId);
  expect(second.transition).toBe("terminal:rejected");
  expect(second.cause).toBe("rejected");
});

test("a single failed stage produces one incident across stage, entry-run, and step-run rows", () => {
  const snapshot: WorkflowSnapshot = {
    invocationId: "inv-failed-stage",
    steps: [{ stepId: "plan", role: "plan" }],
  };
  const entryRunId = store.createRun({
    project: "demo",
    specRef: "HEAD",
    worktreePath: "/tmp/worktree",
    branch: "feature",
    specPath: "spec.md",
    stepId: "plan",
    workflowSnapshot: snapshot,
  });
  const entryAttempt = store.recordAttemptStart(entryRunId);
  store.commitCompletionBoundary({ attemptId: entryAttempt, runStatus: "completed", outcomeKind: "done" });

  const reviewRunId = store.createRun({
    project: "demo",
    specRef: "",
    worktreePath: "/tmp/worktree",
    branch: "feature",
    specPath: ".jarvis-plan-stage",
    stepId: "plan-review",
    workflowSnapshot: snapshot,
  });
  const reviewAttempt = store.recordAttemptStart(reviewRunId);
  store.commitCompletionBoundary({
    attemptId: reviewAttempt,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
  });

  const pipelineId = store.createPipeline({
    definition: {
      name: "workflow-only",
      stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "light" }],
    },
  });
  store.updateStage({
    pipelineId,
    stageId: "plan",
    patch: {
      status: "failed",
      workflowInvocationId: entryRunId,
      failureDetail: { message: "review failed" },
    },
  });

  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({
      kind: "pipeline-terminal",
      pipelineId,
      transition: "terminal:failed",
      cause: "failed",
    }),
  ]);
});

test("boot sweep delivers an incident settled while no daemon was alive", async () => {
  const payloads: string[] = [];
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
  store.close();

  const bootStore = openStateStore(dbPath);
  const runtime = await startDaemonWithSink(bootStore, (_command, json) => {
    payloads.push(json);
    return { ok: true };
  });
  try {
    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0] ?? "{}")).toMatchObject({
      kind: "pipeline-awaiting-approval",
      pipelineId,
    });
  } finally {
    await runtime.close();
    bootStore.close();
  }
});

test("concurrent sweeps deliver an owed incident once", async () => {
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  let spawnCount = 0;
  const deps = sweepDeps({
    spawnSink: (_command, _json) => {
      spawnCount += 1;
      return { ok: true };
    },
  });

  await Promise.all([Promise.resolve().then(() => runNotificationSweep(deps)), Promise.resolve().then(() => runNotificationSweep(deps))]);

  expect(spawnCount).toBe(1);
  expect(
    store.hasNotificationDelivery({
      incidentId: `pipeline:${pipelineId}`,
      transition: "awaiting-approval:gate:default",
    }),
  ).toBe(true);
});

test("a sink spawn failure leaves the incident owed and the next sweep retries", () => {
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  let attempts = 0;
  const deps = sweepDeps({
    spawnSink: () => {
      attempts += 1;
      return attempts === 1 ? { ok: false } : { ok: true };
    },
  });

  runNotificationSweep(deps);
  expect(
    store.hasNotificationDelivery({
      incidentId: `pipeline:${pipelineId}`,
      transition: "awaiting-approval:gate:default",
    }),
  ).toBe(false);

  runNotificationSweep(deps);
  expect(
    store.hasNotificationDelivery({
      incidentId: `pipeline:${pipelineId}`,
      transition: "awaiting-approval:gate:default",
    }),
  ).toBe(true);
  expect(attempts).toBe(2);
});

test("no sink configured advances the ledger without spawning", () => {
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  let spawnCount = 0;
  runNotificationSweep(
    sweepDeps({
      readSinkCommand: () => undefined,
      spawnSink: () => {
        spawnCount += 1;
        return { ok: true };
      },
    }),
  );

  expect(spawnCount).toBe(0);
  expect(
    store.hasNotificationDelivery({
      incidentId: `pipeline:${pipelineId}`,
      transition: "awaiting-approval:gate:default",
    }),
  ).toBe(true);
});
