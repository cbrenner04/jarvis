import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLogRepository } from "../log-repository.ts";
import { openStateStore } from "../state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import type { WriteLoopInput, WriteLoopResult } from "../write-loop.ts";
import { OwnershipConflictError, RunManager, type RunManagerDeps, reservesOwnership } from "./run-manager.ts";

describe("run manager", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  function createManager(overrides: Partial<Pick<RunManagerDeps, "executeWriteLoop" | "createBindings">> = {}) {
    const root = mkdtempSync(join(tmpdir(), "jarvis-run-mgr-"));
    const stateStore = openStateStore(join(root, "state", "v2.sqlite"));
    const logRepository = openLogRepository(join(root, "state", "logs.sqlite"));
    const active: string[] = [];
    cleanups.push(() => {
      logRepository.close();
      stateStore.close();
    });

    let loopPromise: Promise<WriteLoopResult> | undefined;
    const manager = new RunManager({
      stateStore,
      logRepository,
      jarvisRoot: root,
      executeWriteLoop:
        overrides.executeWriteLoop ??
        (async (input) => {
          loopPromise = completeLoop(input);
          return loopPromise;
        }),
      createBindings: overrides.createBindings ?? (() => simulatedBindings(["done"])),
      registerActiveInvocation: (runId) => {
        active.push(runId);
      },
      unregisterActiveInvocation: (runId) => {
        const index = active.indexOf(runId);
        if (index >= 0) active.splice(index, 1);
      },
    });

    return { root, stateStore, logRepository, manager, active, getLoopPromise: () => loopPromise };
  }

  test("run.start returns run id without waiting for loop completion", async () => {
    let resolveDelay: (() => void) | undefined;
    const delay = new Promise<void>((resolve) => {
      resolveDelay = resolve;
    });
    let loopEntered = false;
    const { manager } = createManager({
      executeWriteLoop: async (input) => {
        await delay;
        loopEntered = true;
        return completeLoop(input);
      },
    });

    const started = manager.start(baseParams());
    expect(started.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(loopEntered).toBe(false);
    resolveDelay?.();
    await waitFor(() => loopEntered);
  });

  test("rejects a second start for the same project and branch while ownership is held", () => {
    const { manager } = createManager();
    manager.start(baseParams());
    expect(() => manager.start(baseParams())).toThrow(OwnershipConflictError);
  });

  test("rebuilds ownership from paused, blocked, budget-soft-stopped, and killed durable runs", () => {
    const { stateStore, logRepository, root } = createManager();
    const statuses = ["paused", "blocked", "budget-soft-stopped", "killed"] as const;
    for (const [index, status] of statuses.entries()) {
      const runId = stateStore.createRun({
        project: `p-${index}`,
        specRef: "HEAD",
        worktreePath: `/tmp/wt-${index}`,
        branch: `b-${index}`,
        specPath: "spec.md",
      });
      stateStore.setRunStatus(runId, status);
      expect(reservesOwnership(status)).toBe(true);
    }

    const rebuilt = new RunManager({
      stateStore,
      logRepository,
      jarvisRoot: root,
      registerActiveInvocation: () => {},
      unregisterActiveInvocation: () => {},
    });

    for (const [index] of statuses.entries()) {
      expect(() =>
        rebuilt.start({
          ...baseParams(),
          project: `p-${index}`,
          branch: `b-${index}`,
        }),
      ).toThrow(OwnershipConflictError);
    }
  });

  test("run.list merges durable snapshots with active invocation flags", async () => {
    const { manager, stateStore, getLoopPromise } = createManager();
    const started = manager.start(baseParams());
    await waitFor(() => stateStore.loadRun(started.runId) !== null);
    const during = manager.list();
    expect(during.runs.some((run) => run.id === started.runId && run.active)).toBe(true);
    expect(during.activeRunIds).toContain(started.runId);
    const loop = getLoopPromise();
    if (loop !== undefined) await loop;
    await waitFor(() => manager.list().activeRunIds.length === 0);
    expect(manager.list().runs.find((run) => run.id === started.runId)?.active).toBe(false);
  });

  test("emits structured run lifecycle log records", async () => {
    const { manager, logRepository, getLoopPromise } = createManager();
    const started = manager.start(baseParams());
    const loop = getLoopPromise();
    if (loop !== undefined) await loop;
    await waitFor(() => logRepository.listRecords(started.runId).some((record) => record.event === "run.finished"));

    const events = logRepository.listRecords(started.runId).map((record) => record.event);
    expect(events).toEqual(["run.accepted", "run.started", "run.iteration", "run.finished"]);
  });
});

function baseParams() {
  return {
    projectRoot: "/tmp/repo",
    project: "demo",
    branch: "run-branch",
    base: "HEAD",
    spec: "spec.md",
    artifact: "proof.txt",
  };
}

async function completeLoop(input: WriteLoopInput): Promise<WriteLoopResult> {
  const store = input.stateStore;
  if (store === undefined) {
    throw new Error("missing state store");
  }
  const existing = store.findRunByProjectBranch({
    project: input.worktree.projectName,
    branch: input.worktree.branchName,
  });
  const runId = existing?.id ?? "missing";
  store.setRunStatus(runId, "completed");
  return { kind: "complete", runId, iterationsConsumed: 1, resumable: false };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("condition not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
