import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { createRunControlHandlers } from "./daemon.ts";

let stateStore: StateStore;
let starts: WriteLoopInput[];
let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-state-resume-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(dbPath);
  starts = [];
});

afterEach(() => {
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
  rmSync(dbPath, { force: true });
});

const AGENT_MODEL_CONFIG: AgentModelConfig = {
  codex: {
    implement: {
      rungs: [
        { adapterModel: "codex-fast", priceKey: "codex-fast" },
        { adapterModel: "codex-deep", priceKey: "codex-deep" },
      ],
    },
  },
  cursor: {
    implement: {
      rungs: [{ adapterModel: "cursor-fast", priceKey: "cursor-fast" }],
    },
  },
};

function resumeFrame(runId: string): IpcFrame & { kind: "request" } {
  return {
    kind: "request",
    id: "r1",
    method: "resume",
    params: { runId },
  };
}

test("resume on an ad-hoc paused run returns not_implemented without invoking the executor", async () => {
  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async (input) => {
      starts.push(input);
    },
    failureReporter: () => {},
    isWorktreeDirty: async () => false,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

  const pausedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  const response = await handlers.resume(resumeFrame(pausedRunId), new AbortController().signal);

  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("not_implemented");
    expect(response.message).toBe("Paused run resume is not yet implemented");
  }

  expect(starts).toHaveLength(0);
  expect(stateStore.loadRun(pausedRunId)?.status).toBe("paused");
});

test("resume on a workflow paused run respawns with resolved bindings", async () => {
  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async (input) => {
      starts.push(input);
    },
    failureReporter: () => {},
    isWorktreeDirty: async () => false,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

  const pausedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
    stepId: "step-1",
    workflowSnapshot: {
      invocationId: "workflow-1",
      steps: [
        {
          stepId: "step-1",
          role: "implement",
          stepRules: "resume rules",
          expectedArtifactPath: "/tmp/test-project/artifact",
          agents: ["codex", "cursor"],
          agentModelConfig: AGENT_MODEL_CONFIG,
          iterationTimeoutMs: 123,
        },
      ],
    },
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  const response = await handlers.resume(resumeFrame(pausedRunId), new AbortController().signal);

  expect(response).toEqual({ kind: "response", result: { ok: true } });
  expect(starts).toHaveLength(1);
  expect(starts[0]?.bindings.map((binding) => binding.id)).toEqual([
    "codex/codex-fast/codex-fast",
    "codex/codex-deep/codex-deep",
    "cursor/cursor-fast/cursor-fast",
  ]);
  expect(starts[0]?.stepRules).toBe("resume rules");
  expect(starts[0]?.stepId).toBe("step-1");
  expect(starts[0]?.iterationTimeoutMs).toBe(123);
});

test("resume on a workflow paused run with an empty agents list returns not_implemented", async () => {
  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async (input) => {
      starts.push(input);
    },
    failureReporter: () => {},
    isWorktreeDirty: async () => false,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

  const pausedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
    stepId: "step-1",
    workflowSnapshot: {
      invocationId: "workflow-1",
      steps: [
        {
          stepId: "step-1",
          role: "implement",
          stepRules: "resume rules",
          expectedArtifactPath: "/tmp/test-project/artifact",
          agents: [],
          agentModelConfig: AGENT_MODEL_CONFIG,
        },
      ],
    },
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  const response = await handlers.resume(resumeFrame(pausedRunId), new AbortController().signal);

  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("not_implemented");
  }
  expect(starts).toHaveLength(0);
});

test("resume on a workflow paused run with a non-executable role returns a controlled error", async () => {
  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async (input) => {
      starts.push(input);
    },
    failureReporter: () => {},
    isWorktreeDirty: async () => false,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

  const pausedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
    stepId: "step-1",
    workflowSnapshot: {
      invocationId: "workflow-1",
      steps: [
        {
          stepId: "step-1",
          role: "review",
          stepRules: "resume rules",
          expectedArtifactPath: "/tmp/test-project/artifact",
          agents: ["codex"],
          agentModelConfig: AGENT_MODEL_CONFIG,
        },
      ],
    },
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  const response = await handlers.resume(resumeFrame(pausedRunId), new AbortController().signal);

  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("resume_unsupported");
  }
  expect(starts).toHaveLength(0);
  expect(stateStore.loadRun(pausedRunId)?.status).toBe("paused");
});
