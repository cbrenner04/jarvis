import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { openLogRepository } from "../log-repository.ts";
import { openStateStore } from "../state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import type { WriteLoopInput, WriteLoopResult } from "../write-loop.ts";
import {
  OwnershipConflictError,
  RunManager,
  type RunManagerDeps,
  reservesOwnership,
  SteeringError,
} from "./run-manager.ts";

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

  test("pause accepts an active run and stops at the next loop boundary", async () => {
    let releaseIteration: (() => void) | undefined;
    const iterationGate = new Promise<void>((resolve) => {
      releaseIteration = resolve;
    });
    let pauseChecked = false;
    const { manager, stateStore, logRepository, getLoopPromise } = createManager({
      executeWriteLoop: async (input) => {
        await iterationGate;
        pauseChecked = input.shouldPauseAtBoundary?.() ?? false;
        const store = input.stateStore;
        const run = store?.findRunByProjectBranch({
          project: input.worktree.projectName,
          branch: input.worktree.branchName,
        });
        const runId = run?.id ?? "missing";
        if (pauseChecked) {
          store?.setRunStatus(runId, "paused", "paused-at-boundary");
          return { kind: "paused-at-boundary", runId, iterationsConsumed: 1, resumable: true };
        }
        store?.setRunStatus(runId, "completed");
        return { kind: "complete", runId, iterationsConsumed: 1, resumable: false };
      },
    });

    const started = manager.start(baseParams());
    await waitFor(() => manager.list().activeRunIds.includes(started.runId));
    expect(manager.pause(started.runId)).toEqual({ accepted: true });
    releaseIteration?.();
    const loop = getLoopPromise();
    if (loop !== undefined) await loop;
    await waitFor(() => stateStore.loadRun(started.runId)?.status === "paused");
    expect(pauseChecked).toBe(true);
    expect(stateStore.loadRun(started.runId)?.stopCause).toBe("paused-at-boundary");

    const events = logRepository.listRecords(started.runId).map((record) => record.event);
    expect(events).toContain("run.pause-requested");
    expect(events).toContain("run.paused");
    expect(events).not.toContain("run.finished");
  });

  test("resume schedules a paused run without reusing the active invocation slot", async () => {
    let releaseIteration: (() => void) | undefined;
    let iterationGate = new Promise<void>((resolve) => {
      releaseIteration = resolve;
    });
    let loopCalls = 0;
    const { manager, stateStore, logRepository } = createManager({
      executeWriteLoop: async (input) => {
        loopCalls += 1;
        await iterationGate;
        const store = input.stateStore;
        const run = store?.findRunByProjectBranch({
          project: input.worktree.projectName,
          branch: input.worktree.branchName,
        });
        const runId = run?.id ?? "missing";
        if (input.shouldPauseAtBoundary?.()) {
          store?.setRunStatus(runId, "paused", "paused-at-boundary");
          return { kind: "paused-at-boundary", runId, iterationsConsumed: 1, resumable: true };
        }
        store?.setRunStatus(runId, "completed");
        return { kind: "complete", runId, iterationsConsumed: 1, resumable: false };
      },
    });

    const started = manager.start(baseParams());
    await waitFor(() => manager.list().activeRunIds.includes(started.runId));
    manager.pause(started.runId);
    releaseIteration?.();
    await waitFor(() => stateStore.loadRun(started.runId)?.status === "paused");

    iterationGate = new Promise<void>((resolve) => {
      releaseIteration = resolve;
    });
    expect(manager.resume(started.runId)).toEqual({ accepted: true });
    await waitFor(() => manager.list().activeRunIds.includes(started.runId));
    releaseIteration?.();
    await waitFor(() => stateStore.loadRun(started.runId)?.status === "completed");
    expect(loopCalls).toBe(2);

    const resumeRequested = logRepository
      .listRecords(started.runId)
      .find((record) => record.event === "run.resume-requested");
    expect(resumeRequested?.data).toEqual({
      priorStopCause: "paused-at-boundary",
      resumeBranch: "next-iteration",
    });
  });

  test("kill aborts an active run and marks it killed", async () => {
    let releaseIteration: (() => void) | undefined;
    const iterationGate = new Promise<void>((resolve) => {
      releaseIteration = resolve;
    });
    const { manager, stateStore, logRepository } = createManager({
      executeWriteLoop: async (input) => {
        await iterationGate;
        await new Promise<void>((resolve) => {
          input.signal?.addEventListener("abort", () => resolve(), { once: true });
          if (input.signal?.aborted) resolve();
        });
        const store = input.stateStore;
        const run = store?.findRunByProjectBranch({
          project: input.worktree.projectName,
          branch: input.worktree.branchName,
        });
        const runId = run?.id ?? "missing";
        return { kind: "progress", runId, iterationsConsumed: 1, resumable: true };
      },
    });

    const started = manager.start(baseParams());
    await waitFor(() => manager.list().activeRunIds.includes(started.runId));
    expect(manager.kill(started.runId)).toEqual({ accepted: true });
    releaseIteration?.();
    await waitFor(() => stateStore.loadRun(started.runId)?.status === "killed");
    expect(stateStore.loadRun(started.runId)?.stopCause).toBe("interrupted");

    const events = logRepository.listRecords(started.runId).map((record) => record.event);
    expect(events).toContain("run.kill-requested");
    expect(events).toContain("run.killed");
  });

  test("resume after killed mid-step re-runs the interrupted attempt over the dirty worktree", async () => {
    const { repoRoot, jarvisRoot } = setupRepo();
    const dirtiedMarker = "dirty.txt";
    let firstInvoke = true;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd, signal }) => {
          if (firstInvoke) {
            firstInvoke = false;
            writeFileSync(join(cwd, dirtiedMarker), "dirty\n", "utf8");
            await new Promise<void>((resolve) => {
              signal?.addEventListener("abort", () => resolve(), { once: true });
              if (signal?.aborted) resolve();
            });
            return { kind: "error", exitCode: 1, stderr: "aborted" };
          }
          expect(readFileSync(join(cwd, dirtiedMarker), "utf8")).toBe("dirty\n");
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const stateStore = openStateStore(join(jarvisRoot, "state", "v2.sqlite"));
    const logRepository = openLogRepository(join(jarvisRoot, "state", "logs.sqlite"));
    cleanups.push(() => {
      logRepository.close();
      stateStore.close();
    });
    const active: string[] = [];
    const manager = new RunManager({
      stateStore,
      logRepository,
      jarvisRoot,
      createBindings: () => bindings,
      registerActiveInvocation: (runId) => {
        active.push(runId);
      },
      unregisterActiveInvocation: (runId) => {
        const index = active.indexOf(runId);
        if (index >= 0) active.splice(index, 1);
      },
    });

    const started = manager.start({
      projectRoot: repoRoot,
      project: "demo",
      branch: "kill-resume",
      base: "HEAD",
      spec: "spec.md",
      artifact: "proof.txt",
    });
    await waitFor(() => manager.list().activeRunIds.includes(started.runId));
    manager.kill(started.runId);
    await waitFor(() => stateStore.loadRun(started.runId)?.status === "killed");

    const interrupted = stateStore.loadRun(started.runId);
    expect(interrupted?.attempts).toHaveLength(1);
    expect(interrupted?.attempts[0]?.status).toBe("in-progress");

    manager.resume(started.runId);
    await waitFor(() => stateStore.loadRun(started.runId)?.status === "completed");

    const completed = stateStore.loadRun(started.runId);
    expect(completed?.attemptCount).toBe(1);
    expect(completed?.attempts[0]?.outcomeKind).toBe("done");

    const resumeRequested = logRepository
      .listRecords(started.runId)
      .find((record) => record.event === "run.resume-requested");
    expect(resumeRequested?.data).toEqual({
      priorStopCause: "interrupted",
      resumeBranch: "interrupted-attempt",
    });
  });

  test("steering rejects unknown runs and invalid lifecycle states", async () => {
    const { manager } = createManager();
    expect(() => manager.pause("missing")).toThrow(SteeringError);
    expect(() => manager.resume("missing")).toThrow(SteeringError);
    expect(() => manager.kill("missing")).toThrow(SteeringError);

    const started = manager.start(baseParams());
    expect(() => manager.resume(started.runId)).toThrow(SteeringError);
    await waitFor(() => manager.list().activeRunIds.length === 0);
    expect(() => manager.pause(started.runId)).toThrow(SteeringError);
    expect(() => manager.kill(started.runId)).toThrow(SteeringError);
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

function setupRepo(): { repoRoot: string; jarvisRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "jarvis-run-mgr-repo-"));
  const repoRoot = join(root, "repo");
  const jarvisRoot = join(root, "jarvis-home");

  execFileSync("git", ["init", repoRoot], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "test@example.com"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "Test User"], { stdio: "pipe" });
  writeFileSync(join(repoRoot, "spec.md"), "- [ ] work\n", "utf8");
  execFileSync("git", ["-C", repoRoot, "add", "spec.md"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "seed"], { stdio: "pipe" });

  return { repoRoot, jarvisRoot };
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
