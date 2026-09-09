import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { AnyWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import type { IpcClient } from "../ipc/client.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { captureIo, cliMain } from "../testing/cli-test-helpers.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { createBindingFactory, writeStepFixtures } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
import { type PipelineSnapshot, projectPipelineSnapshot } from "./pipeline-observation.ts";

const { createWriteStep } = writeStepFixtures();

const ADMISSION_CONTEXT = { cwd: "/fake", seed: "seed text", configPath: "/fake/.jarvis/config.json" } as const;

const SINGLE_WORKFLOW = (name: string): PipelineDefinition => ({
  name,
  stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
});

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

function controllableBindingFactory(): {
  factory: NonNullable<WriteWorkflowStep["createBinding"]>;
  settle: () => void;
} {
  let settleFn: (() => void) | undefined;
  const factory = createBindingFactory(
    ({ cwd }) =>
      new Promise<InvocationResult>((resolve) => {
        settleFn = () => {
          writeFileSync(join(cwd, "proof.txt"), "done\n", "utf8");
          resolve({ kind: "ok", stdout: "done", stderr: "" } as const);
        };
      }),
  );
  return { factory, settle: () => settleFn?.() };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

let stateStore: StateStore;
let stateDbPath: string;
let fakeExecutor: FakeWriteLoopExecutor;
let handlers: ReturnType<typeof createRunControlHandlers>;

beforeEach(() => {
  stateDbPath = join(tmpdir(), `jarvis-pipeline-dismiss-${process.pid}-${Date.now()}-${Math.random()}.db`);
  stateStore = openStateStore(stateDbPath);
  fakeExecutor = createFakeWriteLoopExecutor();
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => ({ ok: true, steps: [] }),
  });
});

afterEach(async () => {
  fakeExecutor.abortAll();
  await flushBackgroundRuns();
  try {
    stateStore.close();
  } catch {
    // already closed
  }
});

test("dismissed pipelines drop out of the default pipeline_list", async () => {
  const pipelineA = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("dismiss-a") });
  const pipelineB = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("dismiss-b") });
  await handlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", { pipelineId: pipelineA }),
    new AbortController().signal,
  );

  const response = await handlers.pipeline_list(requestFrame("l", "pipeline_list"), new AbortController().signal);
  const ids = (response as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines.map((p) => p.pipelineId);
  expect(ids).toContain(pipelineB);
  expect(ids).not.toContain(pipelineA);
  expect(ids).toHaveLength(1);
});

test("includeDismissed returns dismissed pipelines with dismissedAt set", async () => {
  const pipelineA = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("dismiss-a") });
  const pipelineB = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("dismiss-b") });
  await handlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", { pipelineId: pipelineA }),
    new AbortController().signal,
  );

  const response = await handlers.pipeline_list(
    requestFrame("l", "pipeline_list", { includeDismissed: true }),
    new AbortController().signal,
  );
  const pipelines = (response as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines;
  const a = pipelines.find((p) => p.pipelineId === pipelineA);
  const b = pipelines.find((p) => p.pipelineId === pipelineB);
  if (!a || !b) throw new Error("expected both pipelines in the includeDismissed listing");
  expect(a.dismissedAt).toEqual(expect.any(Number));
  expect(b.dismissedAt).toBeNull();
  expect(a).toEqual(projectPipelineSnapshot(stateStore.loadPipeline(pipelineA)!));
  expect(b).toEqual(projectPipelineSnapshot(stateStore.loadPipeline(pipelineB)!));
});

test("includeDismissed reads strict === true, a truthy non-boolean value does not opt in", async () => {
  const pipelineA = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("dismiss-a") });
  await handlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", { pipelineId: pipelineA }),
    new AbortController().signal,
  );

  const response = await handlers.pipeline_list(
    requestFrame("l", "pipeline_list", { includeDismissed: "true" }),
    new AbortController().signal,
  );
  const ids = (response as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines.map((p) => p.pipelineId);
  expect(ids).not.toContain(pipelineA);
});

test("pipeline_undismiss returns applied with state and restores the default listing", async () => {
  const pipelineId = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("undismiss") });
  await handlers.pipeline_dismiss(requestFrame("d", "pipeline_dismiss", { pipelineId }), new AbortController().signal);

  const response = await handlers.pipeline_undismiss(
    requestFrame("u", "pipeline_undismiss", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { kind: "applied", pipelineId, state: "pending" } });

  const listResponse = await handlers.pipeline_list(requestFrame("l", "pipeline_list"), new AbortController().signal);
  const pipelines = (listResponse as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines;
  const restored = pipelines.find((p) => p.pipelineId === pipelineId);
  if (!restored) throw new Error("expected the undismissed pipeline back in the default listing");
  expect(restored.dismissedAt).toBeNull();
});

test("a repeat dismiss stays applied and leaves the original dismissedAt unchanged", async () => {
  const pipelineId = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("repeat-dismiss") });

  const first = await handlers.pipeline_dismiss(
    requestFrame("d1", "pipeline_dismiss", { pipelineId }),
    new AbortController().signal,
  );
  expect(first).toEqual({ kind: "response", result: { kind: "applied", pipelineId, state: "pending" } });
  const firstDismissedAt = stateStore.loadPipeline(pipelineId)?.dismissedAt;

  const second = await handlers.pipeline_dismiss(
    requestFrame("d2", "pipeline_dismiss", { pipelineId }),
    new AbortController().signal,
  );
  expect(second).toEqual({ kind: "response", result: { kind: "applied", pipelineId, state: "pending" } });

  const listResponse = await handlers.pipeline_list(
    requestFrame("l", "pipeline_list", { includeDismissed: true }),
    new AbortController().signal,
  );
  const pipelines = (listResponse as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines;
  const found = pipelines.find((p) => p.pipelineId === pipelineId);
  expect(found?.dismissedAt).toBe(firstDismissedAt);
});

test("an unknown pipeline id is refused on dismiss and undismiss", async () => {
  const realPipelineId = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("real") });

  const dismissResponse = await handlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", { pipelineId: "no-such-pipeline" }),
    new AbortController().signal,
  );
  expect(dismissResponse).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId: "no-such-pipeline", reason: "pipeline_not_found" },
  });

  const undismissResponse = await handlers.pipeline_undismiss(
    requestFrame("u", "pipeline_undismiss", { pipelineId: "no-such-pipeline" }),
    new AbortController().signal,
  );
  expect(undismissResponse).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId: "no-such-pipeline", reason: "pipeline_not_found" },
  });

  const listResponse = await handlers.pipeline_list(requestFrame("l", "pipeline_list"), new AbortController().signal);
  const ids = (listResponse as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines.map((p) => p.pipelineId);
  expect(ids).toContain(realPipelineId);
});

test("a missing pipelineId is refused invalid_params on dismiss and undismiss", async () => {
  const dismissResponse = await handlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", {}),
    new AbortController().signal,
  );
  expect(dismissResponse).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId required" });

  const undismissResponse = await handlers.pipeline_undismiss(
    requestFrame("u", "pipeline_undismiss", {}),
    new AbortController().signal,
  );
  expect(undismissResponse).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId required" });
});

test("dismissing a mid-flight pipeline changes only dismissed_at and lets it settle to terminal", async () => {
  const stage1 = controllableBindingFactory();
  const stage1Step: AnyWorkflowStep = createWriteStep("stage-1", "pipeline-branch", stage1.factory, {
    suppressShrink: true,
  });
  const midFlightHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => ({ ok: true, steps: [stage1Step] }),
  });

  const startResponse = await midFlightHandlers.pipeline_start(
    requestFrame("start", "pipeline_start", { definition: SINGLE_WORKFLOW("mid-flight"), context: ADMISSION_CONTEXT }),
    new AbortController().signal,
  );
  expect(startResponse.kind).toBe("response");
  const pipelineId = (startResponse as { result: { pipelineId: string } }).result.pipelineId;

  await waitFor(() => stateStore.loadPipeline(pipelineId)?.stages[0]?.status === "running");
  const midFlightPipeline = stateStore.loadPipeline(pipelineId);
  if (!midFlightPipeline) throw new Error("expected durable pipeline mid-flight");
  const midFlightStages = midFlightPipeline.stages.map((stage) => ({
    id: stage.id,
    stageId: stage.stageId,
    branchKey: stage.branchKey,
    position: stage.position,
    status: stage.status,
    workflowInvocationId: stage.workflowInvocationId,
    startedAt: stage.startedAt,
    endedAt: stage.endedAt,
    decidedAt: stage.decidedAt,
    artifact: stage.artifact,
    failureDetail: stage.failureDetail,
  }));

  const dismissResponse = await midFlightHandlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", { pipelineId }),
    new AbortController().signal,
  );
  expect(dismissResponse).toEqual({ kind: "response", result: { kind: "applied", pipelineId, state: "running" } });

  const listResponse = await midFlightHandlers.pipeline_list(
    requestFrame("l", "pipeline_list", { includeDismissed: true }),
    new AbortController().signal,
  );
  const listed = (listResponse as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines.find(
    (p) => p.pipelineId === pipelineId,
  );
  if (!listed) throw new Error("expected the dismissed pipeline in the includeDismissed listing");
  expect(listed.stages).toEqual(midFlightStages);
  expect(listed.state).toBe("running");

  stage1.settle();
  await waitFor(() => stateStore.loadPipeline(pipelineId)?.stages[0]?.status === "succeeded");
  await flushBackgroundRuns();
  expect(stateStore.loadPipeline(pipelineId)?.dismissedAt).toEqual(expect.any(Number));
});

/** An IPC client whose requests dispatch straight into the daemon handlers under test. */
function handlerBackedIpcClient(): IpcClient {
  const queue: IpcFrame[] = [];
  let waiter: ((frame: IpcFrame) => void) | undefined;
  const deliver = (frame: IpcFrame): void => {
    if (waiter !== undefined) {
      const pending = waiter;
      waiter = undefined;
      pending(frame);
      return;
    }
    queue.push(frame);
  };
  return {
    send(frame: unknown): void {
      const request = frame as { id: string; method: string; params?: unknown };
      const handler = (
        handlers as unknown as Record<string, ((frame: unknown, signal: AbortSignal) => unknown) | undefined>
      )[request.method];
      if (handler === undefined) {
        deliver({ kind: "error", id: request.id, code: "unknown_method", message: request.method } as IpcFrame);
        return;
      }
      void Promise.resolve(handler(request, new AbortController().signal)).then((outcome) => {
        deliver({ ...(outcome as object), id: request.id } as IpcFrame);
      });
    },
    nextFrame(): Promise<IpcFrame> {
      const queued = queue.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise((resolve) => {
        waiter = resolve;
      });
    },
    close(): void {},
  };
}

/** Rewrite two pipelines' ids so they share a prefix longer than the resolver's minimum. */
function craftSharedPrefixIds(original: readonly [string, string]): [string, string] {
  const crafted: [string, string] = ["aaaaaaaa-1111-4000-8000-000000000001", "aaaaaaaa-2222-4000-8000-000000000002"];
  const db = new Database(stateDbPath);
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%pipeline_id TEXT%'",
      )
      .all()
      .map((row) => row.name);
    db.transaction(() => {
      original.forEach((from, index) => {
        const to = crafted[index] as string;
        db.prepare("UPDATE pipelines SET id = ? WHERE id = ?").run(to, from);
        for (const table of tables)
          db.prepare(`UPDATE ${table} SET pipeline_id = ? WHERE pipeline_id = ?`).run(to, from);
      });
    })();
  } finally {
    db.close();
  }
  return crafted;
}

test("the first column of the human pipeline list is accepted verbatim by pipeline dismiss", async () => {
  const pipelineId = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("listed") });
  const listIo = captureIo();
  const deps = { cwd: () => tmpdir(), connectIpcClient: async () => handlerBackedIpcClient() };
  expect(await cliMain(["pipeline", "list"], listIo.io, deps)).toBe(0);
  const [firstColumn] = (listIo.read().stdout.split("\n")[0] ?? "").split("\t");
  if (firstColumn === undefined || firstColumn.length === 0) throw new Error("expected a listed id column");
  expect(firstColumn).not.toBe(pipelineId);

  const dismissIo = captureIo();
  expect(await cliMain(["pipeline", "dismiss", firstColumn], dismissIo.io, deps)).toBe(0);
  expect(dismissIo.read().stdout).toBe(`pipeline dismiss: ${pipelineId}\n`);
  expect(stateStore.loadPipeline(pipelineId)?.dismissedAt).toEqual(expect.any(Number));
});

test("a unique id prefix resolves for dismiss and wait while an unmatched argument keeps each verb's not-found reason", async () => {
  const pipelineId = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("prefixed") });
  const prefix = pipelineId.slice(0, 8);

  // A resolved id begins the wait (aborted here, since a pending pipeline never reaches a boundary);
  // an unresolved one returns `unknown_pipeline` before any wait starts.
  const abort = new AbortController();
  const waiting = handlers.pipeline_wait(requestFrame("w", "pipeline_wait", { pipelineId: prefix }), abort.signal);
  setTimeout(() => abort.abort(), 20);
  await expect(waiting).rejects.toThrow("pipeline_wait aborted");

  const dismissResponse = await handlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", { pipelineId: prefix }),
    new AbortController().signal,
  );
  expect(dismissResponse).toMatchObject({ kind: "response", result: { kind: "applied", pipelineId } });

  expect(
    await handlers.pipeline_dismiss(
      requestFrame("d2", "pipeline_dismiss", { pipelineId: "ffffffff-none" }),
      new AbortController().signal,
    ),
  ).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId: "ffffffff-none", reason: "pipeline_not_found" },
  });
  expect(
    await handlers.pipeline_wait(
      requestFrame("w2", "pipeline_wait", { pipelineId: "ffffffff-none" }),
      new AbortController().signal,
    ),
  ).toEqual({ kind: "error", code: "unknown_pipeline", message: "Pipeline ffffffff-none not found" });
});

test("an ambiguous prefix refuses with pipeline_id_ambiguous, names both candidates, and dismisses neither", async () => {
  const first = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("shared-a") });
  const second = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("shared-b") });
  const [a, b] = craftSharedPrefixIds([first, second]);

  const response = await handlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", { pipelineId: "aaaaaaaa" }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: {
      kind: "refused",
      pipelineId: "aaaaaaaa",
      reason: "pipeline_id_ambiguous",
      candidates: [a, b],
      message: `pipeline id aaaaaaaa matches 2 pipelines: ${a}, ${b}`,
    },
  });
  expect(stateStore.loadPipeline(a)?.dismissedAt).toBeNull();
  expect(stateStore.loadPipeline(b)?.dismissedAt).toBeNull();

  const waitResponse = await handlers.pipeline_wait(
    requestFrame("w", "pipeline_wait", { pipelineId: "aaaaaaaa-" }),
    new AbortController().signal,
  );
  expect(waitResponse).toMatchObject({ kind: "error", code: "pipeline_id_ambiguous" });

  // Arguments shorter than the minimum never resolve, even when unique.
  expect(
    await handlers.pipeline_dismiss(
      requestFrame("d3", "pipeline_dismiss", { pipelineId: "aaa" }),
      new AbortController().signal,
    ),
  ).toEqual({ kind: "response", result: { kind: "refused", pipelineId: "aaa", reason: "pipeline_not_found" } });
});
