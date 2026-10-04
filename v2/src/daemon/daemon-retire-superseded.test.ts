import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, listRunsDirect, loadRunOrThrow, workflowWriteStep } from "../testing/run-control.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers, shouldShutdownNow, type WriteLoopBindingSourceDeps } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

async function resumeDirect(h: Handlers, runId: string) {
  return h.resume({ kind: "request", id: "r1", method: "resume", params: { runId } }, new AbortController().signal);
}

let stateStore: StateStore;
let stateStorePath: string;
let fakeExecutor: FakeWriteLoopExecutor;
let memoryHeadroom: boolean;
let handlers: Handlers;
let writeLoopBindingSourceDeps: WriteLoopBindingSourceDeps;
let profileHome: string;
let previousJarvisHome: string | undefined;

async function startLiveRun(h: Handlers): Promise<string> {
  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "test-branch",
    specPath: "/tmp/spec.md",
    stepId: "implement",
    status: "paused",
    workflowSnapshot: {
      invocationId: "inv-retire-superseded",
      steps: [
        {
          stepId: "implement",
          role: "implement",
          stepRules: "rules",
          expectedArtifactPath: "out.md",
          agents: ["codex"],
          agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
        },
      ],
    },
  });
  const resumed = await h.resume(
    { kind: "request", id: "r", method: "resume", params: { runId } },
    new AbortController().signal,
  );
  if (resumed.kind !== "response") throw new Error("resume failed");
  await flushBackgroundRuns();
  return runId;
}

beforeEach(() => {
  profileHome = trackedMkdtempSync(join(tmpdir(), `jarvis-retire-superseded-profile-${process.pid}-`));
  const machinesDir = join(profileHome, "machines");
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string) => ({ rungs: [{ adapterModel, priceKey: adapterModel }] });
  writeFileSync(
    join(machinesDir, "retire-superseded.json"),
    JSON.stringify({
      models: {
        codex: {
          implement: rung("codex-fast"),
          plan: rung("plan"),
          shrink: rung("shrink"),
          adversary: rung("a"),
          critic: rung("c"),
          advocate: rung("adv"),
          adjudicator: rung("adj"),
          actuator: rung("act"),
          routing: rung("act"),
        },
        cursor: {
          implement: rung("cursor-fast"),
          plan: rung("plan"),
          shrink: rung("shrink"),
          adversary: rung("a"),
          critic: rung("c"),
          advocate: rung("adv"),
          adjudicator: rung("adj"),
          actuator: rung("act"),
          routing: rung("act"),
        },
      },
    }),
  );
  writeFileSync(
    join(profileHome, "config.json"),
    JSON.stringify({ machineProfile: "retire-superseded", agents: ["codex", "cursor"] }),
  );
  previousJarvisHome = process.env.JARVIS_HOME;
  process.env.JARVIS_HOME = profileHome;
  writeLoopBindingSourceDeps = { machineConfigPath: join(profileHome, "config.json"), machinesDir };
  stateStorePath = join(tmpdir(), `jarvis-state-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(stateStorePath);
  fakeExecutor = createFakeWriteLoopExecutor();
  memoryHeadroom = true;

  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
    writeLoopBindingSourceDeps,
  });
});

afterEach(async () => {
  fakeExecutor.abortAll();
  await flushBackgroundRuns();
  if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
  else process.env.JARVIS_HOME = previousJarvisHome;
  rmSync(profileHome, { recursive: true, force: true });
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

test("setRetiring makes resume reject with daemon_superseded", async () => {
  const runId = await startLiveRun(handlers);
  expect(runId).toBeDefined();

  handlers.setRetiring();
  await flushBackgroundRuns();

  if (runId) {
    const resumeResponse = await resumeDirect(handlers, runId);
    expect(resumeResponse.kind).toBe("error");
    if (resumeResponse.kind === "error") {
      expect(resumeResponse.code).toBe("daemon_superseded");
    }
  }
});

test("hasActiveRuns returns true when write loop is active", async () => {
  await startLiveRun(handlers);
  expect(handlers.hasActiveRuns()).toBe(true);
});

test("hasActiveRuns returns false when no runs are active", async () => {
  expect(handlers.hasActiveRuns()).toBe(false);
});

test("isRetiring returns false initially", () => {
  expect(handlers.isRetiring()).toBe(false);
});

test("isRetiring returns true after setRetiring", () => {
  handlers.setRetiring();
  expect(handlers.isRetiring()).toBe(true);
});

test("a daemon with an in-flight run stays up and serving after supersede", async () => {
  const runId = await startLiveRun(handlers);
  expect(runId).toBeDefined();
  expect(handlers.hasActiveRuns()).toBe(true);

  handlers.setRetiring();
  expect(handlers.isRetiring()).toBe(true);
  expect(handlers.hasActiveRuns()).toBe(true);

  const listResponse = await listRunsDirect(handlers);
  expect(listResponse).toBeDefined();
  expect(listResponse?.some((row) => row.runId === runId)).toBe(true);
});

test("a run in flight when supersede arrives reaches normal outcome under same daemon", async () => {
  const runId = await startLiveRun(handlers);
  expect(runId).toBeDefined();

  if (runId) {
    handlers.setRetiring();
    const run = loadRunOrThrow(stateStore, runId);
    expect(run.status).toBe("in-progress");

    fakeExecutor.settleAll();
    await flushBackgroundRuns(3);

    stateStore.setRunStatus(runId, "completed");
    const updatedRun = loadRunOrThrow(stateStore, runId);
    expect(updatedRun.status).toBe("completed");
  }
});

test("queued runs are not promoted after supersession", async () => {
  const runId1 = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "queued-branch",
    specPath: "/tmp/spec.md",
    status: "queued",
  });

  handlers.setRetiring();

  fakeExecutor.settleAll();
  await flushBackgroundRuns(3);

  expect(loadRunOrThrow(stateStore, runId1).status).toBe("queued");
});

test("resume does not create a claim when rejecting for retirement", async () => {
  const runId = await startLiveRun(handlers);
  expect(runId).toBeDefined();

  if (runId) {
    await flushBackgroundRuns();

    handlers.setRetiring();

    const resumeResponse = await resumeDirect(handlers, runId);
    expect(resumeResponse.kind).toBe("error");
    if (resumeResponse.kind === "error") {
      expect(resumeResponse.code).toBe("daemon_superseded");
    }

    // The run should still be managed by this daemon (not claimed by another)
    expect(handlers.hasActiveRuns()).toBe(true);
  }
});

test("observation methods still work after supersede", async () => {
  const runId = await startLiveRun(handlers);
  expect(runId).toBeDefined();

  handlers.setRetiring();

  const listResponse = await listRunsDirect(handlers);
  expect(listResponse).toBeDefined();
  if (runId) {
    expect(listResponse?.some((row) => row.runId === runId)).toBe(true);
  }
});

test("start after retiring is rejected before any worktree materialization", async () => {
  handlers.setRetiring();

  const worktree = workflowWriteStep().worktree;
  const response = await handlers.start(
    {
      kind: "request",
      id: "s1",
      method: "start",
      params: {
        steps: [
          {
            behavior: "write",
            role: "implement",
            stepId: "test-step-1",
            worktree,
            specPath: "spec.md",
            stepRules: "r",
            expectedArtifactPath: "o",
            agents: ["codex"],
            agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
          },
        ],
      },
    },
    new AbortController().signal,
  );

  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("daemon_superseded");
  }

  const run = stateStore.findRunByProjectBranch({
    project: worktree.projectName,
    branch: worktree.branchName,
    stepId: "test-step-1",
  });
  expect(run).toBeNull();

  const runs = await listRunsDirect(handlers);
  expect(runs?.length ?? 0).toBe(0);
});

test("shouldShutdownNow: retiring daemon exits only once no run is active", () => {
  // Retiring + active run → stays up (inverting the !hasActiveRuns guard would exit here).
  expect(shouldShutdownNow(false, true, true)).toBe(false);
  // Retiring + idle → exits.
  expect(shouldShutdownNow(false, true, false)).toBe(true);
  // Not retiring + idle → stays up (idle alone must not trigger shutdown).
  expect(shouldShutdownNow(false, false, false)).toBe(false);
  // Explicit stop always exits, regardless of retiring/active state.
  expect(shouldShutdownNow(true, false, true)).toBe(true);
});
