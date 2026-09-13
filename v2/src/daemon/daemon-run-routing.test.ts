import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { listRunsDirect, mockWriteLoopInput, startRunDirect } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
import type { ObservedRunRoute } from "./daemon-drain-observer.ts";
import type { DaemonListRunRow } from "./daemon-wire.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let store: StateStore;
let executor: FakeWriteLoopExecutor;
let routes: ObservedRunRoute[];
let handlers: Handlers;

beforeEach(() => {
  store = openStateStore(join(tmpdir(), `jarvis-run-routing-${process.pid}-${Date.now()}-${crypto.randomUUID()}.db`));
  executor = createFakeWriteLoopExecutor();
  routes = [];
  handlers = createRunControlHandlers({
    stateStore: store,
    writeLoopExecutor: executor.executor,
    failureReporter: () => undefined,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
    externalRunRoutes: () => routes,
  });
});

afterEach(() => {
  executor.abortAll();
  store.close();
});

function ownerRow(overrides: Partial<DaemonListRunRow> = {}): DaemonListRunRow {
  return {
    runId: "owner-run",
    project: "owner-project",
    branch: "owner-branch",
    createdAt: Date.now(),
    status: "in-progress",
    isLive: false,
    dismissedAt: null,
    ...overrides,
  };
}

function route(row: DaemonListRunRow): ObservedRunRoute {
  return { runId: row.runId, isLive: row.isLive, row };
}

describe("stable-chain run list routing", () => {
  test("one owner row wins over successor-local projection and owner isLive remains authoritative", async () => {
    const runId = store.createRun({
      project: "successor-project",
      specRef: "main",
      worktreePath: "/successor/worktree",
      branch: "successor-branch",
      specPath: "/successor/spec.md",
      status: "in-progress",
    });
    routes = [
      route(
        ownerRow({
          runId,
          project: "draining-owner-project",
          branch: "draining-owner-branch",
          reviewPasses: 7,
          isLive: true,
        }),
      ),
    ];

    let listed = await listRunsDirect(handlers);
    expect(listed?.filter((row) => row.runId === runId)).toEqual([
      expect.objectContaining({
        runId,
        project: "draining-owner-project",
        branch: "draining-owner-branch",
        reviewPasses: 7,
        isLive: true,
      }),
    ]);

    const stoppedOwnerRow = ownerRow({ runId, project: "stopped-owner-project", isLive: false });
    routes = [route(stoppedOwnerRow)];
    listed = await listRunsDirect(handlers);
    expect(listed?.find((row) => row.runId === runId)).toEqual(stoppedOwnerRow);
  });

  test("a local live owner outranks a routed duplicate", async () => {
    const runId = await startRunDirect(
      handlers,
      mockWriteLoopInput({ projectName: "local-project", branchName: "local-branch" }),
    );
    if (runId === undefined) throw new Error("run did not start");
    routes = [route(ownerRow({ runId, project: "stale-route-project", isLive: true }))];

    const listed = await listRunsDirect(handlers);
    expect(listed?.find((row) => row.runId === runId)).toEqual(
      expect.objectContaining({ project: "local-project", branch: "local-branch", isLive: true }),
    );
  });

  test("paused owner rows and completed workflow siblings retain route authority without public liveness", async () => {
    const invocationId = "workflow-invocation";
    const workflow = {
      invocationId,
      steps: [
        {
          stepId: "write",
          role: "implement",
          status: "stopped" as const,
          attemptCount: 1,
          terminalOutcome: "paused" as const,
        },
        { stepId: "review", role: "review", status: "completed" as const, attemptCount: 1 },
      ],
    };
    const paused = ownerRow({ runId: "paused-owner", status: "paused", isLive: false, stepId: "write", workflow });
    const completed = ownerRow({
      runId: "completed-sibling",
      status: "completed",
      isLive: false,
      stepId: "review",
      workflow,
    });
    routes = [route(paused), route(completed)];

    const listed = await listRunsDirect(handlers);
    expect(listed?.find((row) => row.runId === paused.runId)).toEqual(paused);
    expect(listed?.find((row) => row.runId === completed.runId)).toEqual(completed);
    expect(listed?.filter((row) => row.isLive)).toEqual([]);
  });

  test("filters and dismissal apply after owner-row composition", async () => {
    const dismissed = ownerRow({ runId: "dismissed-route", dismissedAt: 123, project: "target" });
    const matching = ownerRow({ runId: "matching-route", project: "target" });
    const other = ownerRow({ runId: "other-route", project: "other" });
    routes = [route(dismissed), route(matching), route(other)];

    expect((await listRunsDirect(handlers, { project: "target" }))?.map((row) => row.runId)).toEqual([
      "matching-route",
    ]);
    expect(
      (await listRunsDirect(handlers, { project: "target", includeDismissed: true }))?.map((row) => row.runId).sort(),
    ).toEqual(["dismissed-route", "matching-route"]);
  });

  test("terminal retention runs on the deduplicated owner-winning view", async () => {
    for (let index = 0; index < 50; index++) {
      store.createRun({
        project: "local",
        specRef: "main",
        worktreePath: `/local/${index}`,
        branch: `branch-${index}`,
        specPath: `/local/${index}/spec.md`,
        status: "completed" satisfies RunStatus,
      });
    }
    const newestOwner = ownerRow({
      runId: "newest-routed-terminal",
      status: "completed",
      createdAt: Date.now() + 10_000,
    });
    routes = [route(newestOwner)];

    const listed = await listRunsDirect(handlers);
    expect(listed).toHaveLength(50);
    expect(listed?.filter((row) => row.runId === newestOwner.runId)).toEqual([newestOwner]);
  });
});
