import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { LogEvent, LogReader, LoopFinishedEvent } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk";
import { mockWriteLoopInput } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import {
  createRunControlHandlers,
  reconcileOrphanedRuns,
  recoverReconciledRuns,
  type WriteLoopBindingSourceDeps,
} from "./daemon.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";

const IDENTITY_A = "11111:1000000";
const IDENTITY_B = "22222:2000000";
const IDENTITY_C = "33333:3000000";

const dbPaths: string[] = [];
const executors: FakeWriteLoopExecutor[] = [];

function trackedDbPath(name: string): string {
  const dbPath = join(tmpdir(), `jarvis-resume-owner-stamp-${name}-${process.pid}-${Date.now()}-${Math.random()}.db`);
  dbPaths.push(dbPath);
  return dbPath;
}

function trackedExecutor(onStart?: (input: unknown) => void): FakeWriteLoopExecutor {
  const executor = createFakeWriteLoopExecutor(onStart);
  executors.push(executor);
  return executor;
}

afterEach(() => {
  for (const executor of executors.splice(0)) executor.abortAll();
  for (const dbPath of dbPaths.splice(0)) removeOrchestrationStore(dbPath);
});

function readOwnerIdentity(dbPath: string, runId: string): string | null {
  const raw = new Database(dbPath);
  try {
    const row = raw.prepare("SELECT owner_identity AS ownerIdentity FROM runs WHERE id = ?").get(runId) as {
      ownerIdentity: string | null;
    };
    return row.ownerIdentity;
  } finally {
    raw.close();
  }
}

const WORKFLOW_AGENT_MODEL_CONFIG: AgentModelConfig = {
  codex: { implement: { rungs: [{ adapterModel: "codex-fast", priceKey: "codex-fast" }] } },
};

function installResumeBindingProfile(): WriteLoopBindingSourceDeps {
  const profileHome = trackedMkdtempSync(join(tmpdir(), "jarvis-resume-owner-stamp-profile-"));
  const machinesDir = join(profileHome, "machines");
  mkdirSync(machinesDir, { recursive: true });
  const machineProfile = "resume-owner-stamp-profile";
  writeFileSync(
    join(machinesDir, `${machineProfile}.json`),
    JSON.stringify({
      models: {
        codex: {
          implement: { rungs: [{ adapterModel: "codex-fast", priceKey: "codex-fast" }] },
          shrink: { rungs: [{ adapterModel: "shrink", priceKey: "shrink" }] },
        },
      },
    }),
  );
  writeFileSync(join(profileHome, "config.json"), JSON.stringify({ machineProfile, agents: ["codex"] }));
  return { machineConfigPath: join(profileHome, "config.json"), machinesDir };
}

function loopFinishedLogReader(runId: string, event: Omit<LoopFinishedEvent, "kind">): LogReader {
  return {
    tail: (id) =>
      id === runId
        ? [
            {
              runId,
              seq: 1,
              ts: "2026-01-01T00:00:00.000Z",
              event: { kind: "loop_finished", ...event } as LogEvent,
            },
          ]
        : [],
    async *follow() {},
  };
}

function handlersFor(
  stateStore: ReturnType<typeof openStateStore>,
  executor: FakeWriteLoopExecutor,
  overrides: Partial<Parameters<typeof createRunControlHandlers>[0]> = {},
): ReturnType<typeof createRunControlHandlers> {
  return createRunControlHandlers({
    stateStore,
    writeLoopExecutor: executor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
    ...overrides,
  });
}

async function resumeDirect(handlers: ReturnType<typeof createRunControlHandlers>, runId: string) {
  return handlers.resume(
    { kind: "request", id: "r1", method: "resume", params: { runId } },
    new AbortController().signal,
  );
}

function createPausedRun(dbPath: string, worktreeSuffix: string): string {
  const storeA = openStateStore(dbPath, { currentIdentity: IDENTITY_A });
  const branch = `resume-owner-branch-${worktreeSuffix}`;
  const runId = storeA.createRun({
    project: "project",
    specRef: "main",
    worktreePath: `/tmp/resume-owner-worktree-${worktreeSuffix}`,
    branch,
    specPath: `/tmp/resume-owner-spec-${worktreeSuffix}.md`,
    stepId: "implement",
    status: "paused",
    workflowSnapshot: {
      invocationId: `inv-${worktreeSuffix}`,
      steps: [
        {
          stepId: "implement",
          role: "implement",
          stepRules: "rules",
          expectedArtifactPath: "out.md",
          agents: ["codex"],
          agentModelConfig: WORKFLOW_AGENT_MODEL_CONFIG,
        },
      ],
    },
  });
  storeA.close();
  return runId;
}

test("resume on a successor daemon re-stamps the paused run's owner, so a later successor leaves it live", async () => {
  const dbPath = trackedDbPath("handoff");
  const runId = createPausedRun(dbPath, "handoff");

  // Handoff A -> B: B is the only live identity at resume time (A already superseded).
  const storeB = openStateStore(dbPath, {
    currentIdentity: IDENTITY_B,
    isOwnerAlive: async (identity) => identity === IDENTITY_B,
  });
  const handlersB = handlersFor(storeB, trackedExecutor());

  const response = await resumeDirect(handlersB, runId);
  expect(response.kind).toBe("response");
  expect(storeB.loadRun(runId)?.status).toBe("in-progress");
  expect(readOwnerIdentity(dbPath, runId)).toBe(IDENTITY_B);
  storeB.close();

  // Handoff B -> C: B is still alive (actively driving the resumed run); A is long dead.
  const storeC = openStateStore(dbPath, {
    currentIdentity: IDENTITY_C,
    isOwnerAlive: async (identity) => identity === IDENTITY_B,
  });
  const events: Array<{ runId: string; event: unknown }> = [];
  const reconciled = await reconcileOrphanedRuns(storeC, {
    append: (id, event) => events.push({ runId: id, event }),
    close: () => undefined,
  });

  expect(reconciled).not.toContain(runId);
  expect(events.some((entry) => entry.runId === runId)).toBe(false);
  expect(storeC.loadRun(runId)?.status).toBe("in-progress");
  expect(readOwnerIdentity(dbPath, runId)).toBe(IDENTITY_B);
  storeC.close();
});

test("automatic restart recovery leaves the resumed row's owner_identity equal to the recovering daemon's identity", async () => {
  const dbPath = trackedDbPath("recovery");
  const runId = createPausedRun(dbPath, "recovery");

  const storeD = openStateStore(dbPath, {
    currentIdentity: IDENTITY_C,
    isOwnerAlive: async () => false,
  });
  const handlersD = handlersFor(storeD, trackedExecutor());
  const events: Array<{ runId: string; event: unknown }> = [];

  const recovery = await recoverReconciledRuns(
    [runId],
    storeD,
    { append: (id, event) => events.push({ runId: id, event }), close: () => undefined },
    handlersD.resume,
  );

  expect(recovery).toEqual({ resumed: 1 });
  expect(readOwnerIdentity(dbPath, runId)).toBe(IDENTITY_C);
  storeD.close();
});

test("a finalization-tail resume whose tail fails restores the prior terminal status, owned by the resuming daemon", async () => {
  const dbPath = trackedDbPath("tail-fails");
  const storeA = openStateStore(dbPath, { currentIdentity: IDENTITY_A });
  const runId = storeA.createRun({
    project: "project",
    specRef: "main",
    worktreePath: "/tmp/resume-owner-worktree-tail-fails",
    branch: "resume-owner-branch-tail-fails",
    specPath: "/tmp/resume-owner-spec-tail-fails.md",
    status: "failed",
  });
  storeA.commitTerminalRunSettlement({ runId, status: "failed", terminalCause: "invocation_failure" });
  storeA.close();

  const storeB = openStateStore(dbPath, { currentIdentity: IDENTITY_B, isOwnerAlive: async () => false });
  const ctx = createRunControlHandlerContext({
    stateStore: storeB,
    writeLoopExecutor: trackedExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "unsupported" }),
  });
  const run = storeB.loadRun(runId);
  if (!run) throw new Error("run missing");
  const response = await handlers.resumeFinalizationOnly(
    run,
    { project: run.project, branch: run.branch },
    async () => {
      expect(storeB.loadRun(runId)?.status).toBe("in-progress");
      return { ok: false, message: "tail failed" };
    },
  );

  expect(response.kind).toBe("error");
  expect(storeB.loadRun(runId)?.status).toBe("failed");
  expect(storeB.loadRun(runId)?.terminalCause).toBe("invocation_failure");
  expect(readOwnerIdentity(dbPath, runId)).toBe(IDENTITY_B);
  storeB.close();
});

test("resume succeeds on a terminal peer-owned row when list already projects resumable", async () => {
  const dbPath = trackedDbPath("terminal-peer-resume");
  const storeA = openStateStore(dbPath, { currentIdentity: IDENTITY_A });
  const runId = storeA.createRun({
    project: "project",
    specRef: "main",
    worktreePath: "/tmp/resume-owner-worktree-terminal-peer",
    branch: "resume-owner-branch-terminal-peer",
    specPath: "/tmp/resume-owner-spec-terminal-peer.md",
    stepId: "step-1",
    workflowSnapshot: {
      invocationId: "terminal-peer-resume",
      steps: [
        {
          stepId: "step-1",
          role: "implement",
          stepRules: "resume rules",
          expectedArtifactPath: "/tmp/resume-owner/artifact",
          agents: ["codex"],
          agentModelConfig: WORKFLOW_AGENT_MODEL_CONFIG,
        },
      ],
    },
  });
  storeA.setRunStatus(runId, "failed");
  storeA.close();

  const logReader = loopFinishedLogReader(runId, {
    loopOutcomeKind: "completion_commit_failed",
    iterationsConsumed: 1,
    resumable: true,
  });
  const writeLoopBindingSourceDeps = installResumeBindingProfile();
  const storeB = openStateStore(dbPath, {
    currentIdentity: IDENTITY_B,
    isOwnerAlive: async (identity) => identity === IDENTITY_A,
  });
  const handlersB = handlersFor(storeB, trackedExecutor(), {
    logReader,
    writeLoopBindingSourceDeps,
    intentFinalizationResumeDeps: {
      completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
      completionPublisher: async () => ({ pushSha: "push-1", prNumber: 1, prUrl: "https://example.test/pr/1" }),
      readyFinalizer: async () => {},
    },
  });
  const listFrame = await handlersB.list(
    { kind: "request", id: "list-terminal-peer", method: "list" },
    new AbortController().signal,
  );
  expect(listFrame).toMatchObject({ kind: "response" });
  const row = (
    listFrame as { kind: "response"; result: { runs: Array<{ runId: string; resumable?: boolean }> } }
  ).result.runs.find((candidate) => candidate.runId === runId);
  expect(row?.resumable).toBe(true);

  const response = await resumeDirect(handlersB, runId);
  expect(response).toMatchObject({ kind: "response", result: { ok: true } });
  expect(storeB.loadRun(runId)?.status).toBe("completed");
  expect(readOwnerIdentity(dbPath, runId)).toBe(IDENTITY_B);
  storeB.close();
});

test("resume is refused with the claim refusal reason when a different live daemon owns the row", async () => {
  const dbPath = trackedDbPath("refusal");
  const runId = createPausedRun(dbPath, "refusal");

  // B attempts to resume while A is still alive and driving the row.
  const storeB = openStateStore(dbPath, {
    currentIdentity: IDENTITY_B,
    isOwnerAlive: async (identity) => identity === IDENTITY_A,
  });
  const starts: unknown[] = [];
  const handlersB = handlersFor(
    storeB,
    trackedExecutor((input) => starts.push(input)),
  );

  const response = await resumeDirect(handlersB, runId);

  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("owner_alive");
    expect(response.message).toContain("owner_alive");
  }
  expect(starts).toHaveLength(0);
  expect(storeB.loadRun(runId)?.status).toBe("paused");
  expect(readOwnerIdentity(dbPath, runId)).toBe(IDENTITY_A);
  storeB.close();
});
