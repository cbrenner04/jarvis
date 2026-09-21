import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import { createRunControlHandlers } from "../daemon/daemon.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";

let store: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let handlers: ReturnType<typeof createRunControlHandlers>;

beforeEach(() => {
  store = openStateStore(join(trackedMkdtempSync(join(tmpdir(), "jarvis-run-dismiss-project-")), "state.db"));
  fakeExecutor = createFakeWriteLoopExecutor();
  handlers = createRunControlHandlers({
    stateStore: store,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
});

afterEach(() => {
  fakeExecutor.abortAll();
  store.close();
});

function seed(overrides: Partial<Parameters<StateStore["createRun"]>[0]>): string {
  return store.createRun({
    project: "alpha",
    specRef: "main",
    worktreePath: "/tmp/worktree",
    branch: "branch",
    specPath: "spec.md",
    ...overrides,
  });
}

function dismissedAt(runId: string): number | null | undefined {
  return store.loadRun(runId)?.dismissedAt;
}

test("bulk dismiss by project dismisses terminal standalone and workflow step rows, leaving nonterminal rows", async () => {
  const snapshot = (stepId: string) => ({ invocationId: "inv-1", steps: [{ stepId, role: "implement" }] });
  const standalone = seed({ branch: "standalone", status: "completed" });
  const stepEntry = seed({ stepId: "entry", workflowSnapshot: snapshot("entry"), status: "failed" });
  const stepSibling = seed({ stepId: "sibling", workflowSnapshot: snapshot("sibling"), status: "blocked" });
  const inProgress = seed({ branch: "in-progress", status: "in-progress" });
  const queued = seed({ branch: "queued", status: "queued" });
  const paused = seed({ branch: "paused", status: "paused" });
  const otherProject = seed({ project: "beta", branch: "other", status: "completed" });

  const outcome = await handlers.dismiss(
    { kind: "request", id: "d1", method: "dismiss", params: { project: "alpha" } },
    new AbortController().signal,
  );

  expect(outcome).toEqual({ kind: "response", result: { kind: "applied", dismissedCount: 3 } });
  for (const runId of [standalone, stepEntry, stepSibling]) expect(dismissedAt(runId)).not.toBeNull();
  for (const runId of [inProgress, queued, paused, otherProject]) expect(dismissedAt(runId)).toBeNull();
});
