import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";

const SINGLE_WORKFLOW = (name: string): PipelineDefinition => ({
  name,
  stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
});

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

function setOwnerIdentity(dbPath: string, pipelineId: string, ownerIdentity: string | null): void {
  const db = new Database(dbPath);
  try {
    db.prepare("UPDATE pipelines SET owner_identity = ? WHERE id = ?").run(ownerIdentity, pipelineId);
  } finally {
    db.close();
  }
}

function setPipelineStatus(dbPath: string, pipelineId: string, status: "active" | "interrupted"): void {
  const db = new Database(dbPath);
  try {
    db.prepare("UPDATE pipelines SET status = ? WHERE id = ?").run(status, pipelineId);
  } finally {
    db.close();
  }
}

let stateDbPath: string;
let fakeExecutor: FakeWriteLoopExecutor;

function makeHandlers(stateStore: StateStore) {
  return createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => ({ ok: true, steps: [] }),
  });
}

beforeEach(() => {
  stateDbPath = join(tmpdir(), `jarvis-pipeline-owner-${process.pid}-${Date.now()}-${Math.random()}.db`);
  fakeExecutor = createFakeWriteLoopExecutor();
});

afterEach(async () => {
  fakeExecutor.abortAll();
  await flushBackgroundRuns();
});

test("classifies an owned active pipeline", async () => {
  const store = openStateStore(stateDbPath, { currentIdentity: "daemon-a" });
  const handlers = makeHandlers(store);
  const pipelineId = store.createPipeline({ definition: SINGLE_WORKFLOW("owned") });

  const response = await handlers.pipeline_owner(
    requestFrame("o", "pipeline_owner", { pipelineId }),
    new AbortController().signal,
  );

  expect(response).toEqual({ kind: "response", result: { kind: "owner", pipelineId, ownerIdentity: "daemon-a" } });
  store.close();
});

test("classifies a foreign active pipeline", async () => {
  const seedStore = openStateStore(stateDbPath, { currentIdentity: "daemon-a" });
  const pipelineId = seedStore.createPipeline({ definition: SINGLE_WORKFLOW("foreign") });
  seedStore.close();

  const store = openStateStore(stateDbPath, { currentIdentity: "daemon-b" });
  const handlers = makeHandlers(store);

  const response = await handlers.pipeline_owner(
    requestFrame("o", "pipeline_owner", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { kind: "not_owner", pipelineId, ownerIdentity: "daemon-b" } });

  // A `null`-owner active row is unowned, not foreign-owned, but resolves the same way: `not_owner`.
  setOwnerIdentity(stateDbPath, pipelineId, null);
  const nullOwnerResponse = await handlers.pipeline_owner(
    requestFrame("o2", "pipeline_owner", { pipelineId }),
    new AbortController().signal,
  );
  expect(nullOwnerResponse).toEqual({
    kind: "response",
    result: { kind: "not_owner", pipelineId, ownerIdentity: "daemon-b" },
  });
  store.close();
});

test("classifies reconciled and terminal pipelines", async () => {
  const store = openStateStore(stateDbPath, { currentIdentity: "daemon-a" });
  const handlers = makeHandlers(store);

  const interruptedId = store.createPipeline({ definition: SINGLE_WORKFLOW("reconciled") });
  setPipelineStatus(stateDbPath, interruptedId, "interrupted");
  const interruptedResponse = await handlers.pipeline_owner(
    requestFrame("o", "pipeline_owner", { pipelineId: interruptedId }),
    new AbortController().signal,
  );
  expect(interruptedResponse).toEqual({
    kind: "response",
    result: { kind: "durable_state", pipelineId: interruptedId, state: "pending", ownerIdentity: "daemon-a" },
  });

  // Terminal precedes ownership: `active` and owned by this daemon, but derived state is terminal.
  const terminalOwnedId = store.createPipeline({ definition: SINGLE_WORKFLOW("terminal-owned") });
  store.updateStage({ pipelineId: terminalOwnedId, stageId: "s1", patch: { status: "failed", endedAt: Date.now() } });
  const terminalResponse = await handlers.pipeline_owner(
    requestFrame("o2", "pipeline_owner", { pipelineId: terminalOwnedId }),
    new AbortController().signal,
  );
  expect(terminalResponse).toEqual({
    kind: "response",
    result: { kind: "durable_state", pipelineId: terminalOwnedId, state: "failed", ownerIdentity: "daemon-a" },
  });
  store.close();
});

test("classifies an absent pipeline", async () => {
  const store = openStateStore(stateDbPath, { currentIdentity: "daemon-a" });
  const handlers = makeHandlers(store);

  const response = await handlers.pipeline_owner(
    requestFrame("o", "pipeline_owner", { pipelineId: "no-such-pipeline" }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "not_found", pipelineId: "no-such-pipeline", ownerIdentity: "daemon-a" },
  });
  store.close();
});

test("rejects a malformed pipelineId", async () => {
  const store = openStateStore(stateDbPath, { currentIdentity: "daemon-a" });
  const handlers = makeHandlers(store);

  const missing = await handlers.pipeline_owner(requestFrame("o1", "pipeline_owner", {}), new AbortController().signal);
  expect(missing).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId required" });

  const nonString = await handlers.pipeline_owner(
    requestFrame("o2", "pipeline_owner", { pipelineId: 42 }),
    new AbortController().signal,
  );
  expect(nonString).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId required" });

  const empty = await handlers.pipeline_owner(
    requestFrame("o3", "pipeline_owner", { pipelineId: "" }),
    new AbortController().signal,
  );
  expect(empty).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId required" });
  store.close();
});
