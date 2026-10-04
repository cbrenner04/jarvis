import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, listOwnedRunsDirect, listRunsDirect } from "../testing/run-control.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers, type WriteLoopBindingSourceDeps } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let handlers: Handlers;
let writeLoopBindingSourceDeps: WriteLoopBindingSourceDeps;
let profileHome: string;
let previousJarvisHome: string | undefined;

beforeEach(() => {
  profileHome = trackedMkdtempSync(join(tmpdir(), `jarvis-list-owned-profile-${process.pid}-`));
  const machinesDir = join(profileHome, "machines");
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string) => ({ rungs: [{ adapterModel, priceKey: adapterModel }] });
  writeFileSync(
    join(machinesDir, "list-owned.json"),
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
    JSON.stringify({ machineProfile: "list-owned", agents: ["codex", "cursor"] }),
  );
  previousJarvisHome = process.env.JARVIS_HOME;
  process.env.JARVIS_HOME = profileHome;
  writeLoopBindingSourceDeps = { machineConfigPath: join(profileHome, "config.json"), machinesDir };
  const stateStorePath = join(tmpdir(), `jarvis-list-owned-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(stateStorePath);
  fakeExecutor = createFakeWriteLoopExecutor();
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
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

async function startLiveRun(h: Handlers, projectName: string): Promise<string> {
  const branch = `${projectName}-branch`;
  const runId = stateStore.createRun({
    project: projectName,
    specRef: "main",
    worktreePath: `/tmp/${projectName}`,
    branch,
    specPath: "/tmp/spec.md",
    stepId: "implement",
    status: "paused",
    workflowSnapshot: {
      invocationId: `inv-${projectName}`,
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

async function dismissDirect(h: Handlers, runId: string) {
  return h.dismiss({ kind: "request", id: "d1", method: "dismiss", params: { runId } }, new AbortController().signal);
}

test("list_owned returns every currently-live row, unfiltered by dismissal, unlike the default public list", async () => {
  const runId = await startLiveRun(handlers, "p1");
  await dismissDirect(handlers, runId);

  const publicRows = await listRunsDirect(handlers);
  expect(publicRows?.find((row) => row.runId === runId)).toBeUndefined();

  const ownedRows = await listOwnedRunsDirect(handlers);
  const ownedRow = ownedRows?.find((row) => row.runId === runId);
  expect(ownedRow?.isLive).toBe(true);
});

test("list_owned ignores request-shaped selection: no project filter and no limit, unlike the public filtered/limited list path", async () => {
  const runA = await startLiveRun(handlers, "p1");
  const runB = await startLiveRun(handlers, "p2");

  // The public handler's filtered path (any dimension filter set) caps the response to `limit`.
  const filteredPublicRows = await listRunsDirect(handlers, { project: "p1", limit: 1 });
  expect(filteredPublicRows?.length).toBe(1);

  // `list_owned` takes no params: every currently-live row across every project comes back.
  const ownedRows = await listOwnedRunsDirect(handlers);
  const ownedIds = new Set(ownedRows?.map((row) => row.runId) ?? []);
  expect(ownedIds.has(runA)).toBe(true);
  expect(ownedIds.has(runB)).toBe(true);
});

test("list_owned excludes a run this daemon does not currently hold live", async () => {
  const terminalRunId = stateStore.createRun({
    project: "proj",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "br",
    specPath: "/tmp/spec.md",
    status: "completed",
  });

  const ownedRows = await listOwnedRunsDirect(handlers);
  expect(ownedRows?.find((row) => row.runId === terminalRunId)).toBeUndefined();
});

test("list_owned excludes a durably in-progress row this daemon never admitted into activeRuns", async () => {
  // Both status and activeRuns membership must hold: a row reading "in-progress" that this
  // daemon's own registry never claimed (the shape a predecessor-held run takes) is not "its own".
  const orphanRunId = stateStore.createRun({
    project: "proj",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "br",
    specPath: "/tmp/spec.md",
    status: "in-progress",
  });

  const ownedRows = await listOwnedRunsDirect(handlers);
  expect(ownedRows?.find((row) => row.runId === orphanRunId)).toBeUndefined();
});

test("live_run_ids reports only currently-live run ids, without the list projection", async () => {
  const liveRunId = await startLiveRun(handlers, "p1");
  const terminalRunId = stateStore.createRun({
    project: "proj",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "br",
    specPath: "/tmp/spec.md",
    status: "completed",
  });

  const response = await handlers.live_run_ids(
    { kind: "request", id: "l1", method: "live_run_ids" },
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { runIds: [liveRunId] } });
  expect(terminalRunId).not.toBe(liveRunId);
});
