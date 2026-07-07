import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("resume on a paused run returns not_implemented without invoking the executor", async () => {
  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async (input) => {
      starts.push(input);
    },
    failureReporter: () => {},
    isWorktreeDirty: () => false,
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

  const frame: IpcFrame & { kind: "request" } = {
    kind: "request",
    id: "r1",
    method: "resume",
    params: { runId: pausedRunId },
  };
  const response = await handlers.resume(frame, new AbortController().signal);

  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("not_implemented");
    expect(response.message).toBe("Paused run resume is not yet implemented");
  }

  expect(starts).toHaveLength(0);
  expect(stateStore.loadRun(pausedRunId)?.status).toBe("paused");
});
