import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogEvent, LogSink } from "../persistence/log-stream.ts";
import { openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { reconcileOrphanedRuns } from "./daemon.ts";

const dbPath = join(tmpdir(), `jarvis-reconciliation-${process.pid}.sqlite`);
const orphanedStatuses: readonly RunStatus[] = [
  "queued",
  "in-progress",
  "paused",
  "budget-soft-stopped",
  "awaiting-human",
  "revising",
];
const terminalStatuses: readonly RunStatus[] = ["completed", "blocked", "failed", "killed"];

let store: StateStore;

function createRun(status: RunStatus): string {
  return store.createRun({
    project: "project",
    specRef: "main",
    worktreePath: `/tmp/worktree-${status}`,
    branch: `branch-${status}`,
    specPath: `/tmp/spec-${status}.md`,
    status,
    workflowSnapshot: { invocationId: `workflow-${status}`, steps: [{ stepId: "step", role: "implement" }] },
    ...(status === "queued"
      ? {
          queuedInput: {
            worktree: { projectRoot: "/tmp/queued", projectName: "project", branchName: "queued", baseRef: "main" },
            specPath: "spec.md",
            stepRules: "",
            expectedArtifactPath: "",
            bindings: [],
          },
        }
      : {}),
  });
}

beforeEach(() => {
  rmSync(dbPath, { force: true });
  store = openStateStore(dbPath);
});

afterEach(() => {
  store.close();
  rmSync(dbPath, { force: true });
});

test("reconciles every orphaned status, retaining durable run metadata", () => {
  const runIds = orphanedStatuses.map(createRun);
  const attemptIds = runIds.map((runId) => store.recordAttemptStart(runId));
  const events: Array<{ runId: string; event: LogEvent }> = [];
  const sink: LogSink = { append: (runId, event) => events.push({ runId, event }), close: () => undefined };

  reconcileOrphanedRuns(store, sink);

  for (const runId of runIds) {
    const run = store.loadRun(runId);
    expect(run?.status).toBe("killed");
    expect(run?.worktreePath).toBe(`/tmp/worktree-${orphanedStatuses[runIds.indexOf(runId)]}`);
    expect(run?.branch).toBe(`branch-${orphanedStatuses[runIds.indexOf(runId)]}`);
    expect(run?.workflowSnapshot?.steps).toEqual([{ stepId: "step", role: "implement" }]);
    expect(run?.attempts[0]?.id).toBe(attemptIds[runIds.indexOf(runId)]);
  }
  expect(events.sort((a, b) => a.runId.localeCompare(b.runId))).toEqual(
    runIds
      .map((runId) => ({
      runId,
      event: { kind: "run_reconciled" as const, runStatus: "killed" as const, reason: "daemon_restart" as const },
      }))
      .sort((a, b) => a.runId.localeCompare(b.runId)),
  );
  expect(store.loadRun(runIds[0] as string)?.queuedInput?.worktree.projectRoot).toBe("/tmp/queued");
});

test("leaves terminal statuses unchanged without reconciliation events", () => {
  const runIds = terminalStatuses.map(createRun);
  const events: Array<{ runId: string; event: LogEvent }> = [];

  reconcileOrphanedRuns(store, { append: (runId, event) => events.push({ runId, event }), close: () => undefined });

  expect(runIds.map((runId) => store.loadRun(runId)?.status)).toEqual([...terminalStatuses]);
  expect(events).toEqual([]);
});

test("propagates reconciliation errors", () => {
  createRun("in-progress");
  const sink: LogSink = {
    append: () => {
      throw new Error("log unavailable");
    },
    close: () => undefined,
  };

  expect(() => reconcileOrphanedRuns(store, sink)).toThrow("log unavailable");
});

test("propagates durable-state reconciliation errors", () => {
  const failingStore = { listRuns: () => { throw new Error("state unavailable"); } } as unknown as StateStore;
  const sink: LogSink = { append: () => undefined, close: () => undefined };

  expect(() => reconcileOrphanedRuns(failingStore, sink)).toThrow("state unavailable");
});
