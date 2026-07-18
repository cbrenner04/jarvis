import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { DEFAULT_WRITE_STEP_RULES } from "../execution/write-loop-input.ts";
import type { IpcClient } from "../ipc/client.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { RpcConnectionError, RpcError } from "../ipc/rpc-errors.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { DAEMON_SOCKET_PATH } from "../paths.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { createDeferredIpcClient, makeIpcClient } from "../testing/ipc-client-fake.ts";
import type { TuiDaemonClient } from "./tui-daemon-client.ts";
import { connectTuiDaemon } from "./tui-daemon-client.ts";

const START_INPUT: WriteLoopInput = {
  worktree: {
    projectRoot: "/tmp/repo",
    projectName: "demo",
    branchName: "write-run",
    baseRef: "HEAD",
  },
  specPath: "spec.md",
  stepRules: DEFAULT_WRITE_STEP_RULES,
  expectedArtifactPath: "proof.txt",
  bindings: simulatedBindings(["done"]),
};

const UNREACHABLE_SOCKET_PATH = join(tmpdir(), `jarvis-tui-daemon-client-missing-${process.pid}.sock`);

const HEALTH_REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const STATUS_REQUEST_ID = "00000000-0000-4000-8000-000000000002";
const START_REQUEST_ID = "00000000-0000-4000-8000-000000000003";
const LIST_REQUEST_ID = "00000000-0000-4000-8000-000000000004";
const WAIT_REQUEST_ID = "00000000-0000-4000-8000-000000000005";
const PAUSE_REQUEST_ID = "00000000-0000-4000-8000-000000000008";
const RESUME_REQUEST_ID = "00000000-0000-4000-8000-000000000009";
const KILL_REQUEST_ID = "00000000-0000-4000-8000-00000000000a";
const CURRENT_REVISION = "abc123";

const matchingRevision = async (): Promise<string> => CURRENT_REVISION;

function statusFrame(id = STATUS_REQUEST_ID, loadedRevision = CURRENT_REVISION): IpcFrame {
  return { kind: "response", id, result: { state: "running", loadedRevision } };
}

// All fixed clients in this file drive connectTuiDaemon's reader loop, which requires gated delivery.
function makeGatedIpcClient(frames: unknown[], options: { sent?: unknown[] } = {}): IpcClient {
  return makeIpcClient(frames, { ...options, gated: true });
}

test("uses injected connectIpcClient instead of production transport", async () => {
  const sent: unknown[] = [];
  let connectCalls = 0;
  const fakeConnect = async (socketPath: string): Promise<IpcClient> => {
    connectCalls += 1;
    expect(socketPath).toBe("/tmp/injected.sock");
    return makeGatedIpcClient(
      [
        { kind: "response", id: HEALTH_REQUEST_ID, result: { ok: true } },
        statusFrame(),
        {
          kind: "response",
          id: LIST_REQUEST_ID,
          result: {
            runs: [{ runId: "run-1", project: "demo", branch: "main", status: "completed", isLive: false }],
          },
        },
        { kind: "response", id: WAIT_REQUEST_ID, result: { runStatus: "completed" } },
      ],
      { sent },
    );
  };

  await withFixedUuid([HEALTH_REQUEST_ID, STATUS_REQUEST_ID, LIST_REQUEST_ID, WAIT_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      socketPath: "/tmp/injected.sock",
      connectIpcClient: fakeConnect,
    });

    await expect(client.health()).resolves.toEqual({ ok: true });
    await expect(client.status()).resolves.toEqual({ state: "running", loadedRevision: "abc123" });
    await expect(client.list()).resolves.toEqual({
      runs: [{ runId: "run-1", project: "demo", branch: "main", status: "completed", isLive: false }],
    });
    await expect(client.wait("run-1")).resolves.toEqual({ runStatus: "completed" });
    client.close();
  });

  expect(connectCalls).toBe(1);
  expect(sent).toEqual([
    { kind: "request", id: HEALTH_REQUEST_ID, method: "health" },
    { kind: "request", id: STATUS_REQUEST_ID, method: "status" },
    { kind: "request", id: LIST_REQUEST_ID, method: "list" },
    { kind: "request", id: WAIT_REQUEST_ID, method: "wait", params: { runId: "run-1" } },
  ]);
});

test("defaults socket path to ~/.jarvis/daemon.sock when omitted", async () => {
  let seenPath: string | undefined;
  await withFixedUuid([HEALTH_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async (socketPath) => {
        seenPath = socketPath;
        return makeGatedIpcClient([{ kind: "response", id: HEALTH_REQUEST_ID, result: { ok: true } }]);
      },
    });
    await client.health();
    client.close();
  });
  expect(seenPath).toBe(DAEMON_SOCKET_PATH);
});

test("health then status reuse one connection without reconnecting", async () => {
  let connectCalls = 0;
  await withFixedUuid([HEALTH_REQUEST_ID, STATUS_REQUEST_ID, LIST_REQUEST_ID, WAIT_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () => {
        connectCalls += 1;
        return makeGatedIpcClient([
          { kind: "response", id: HEALTH_REQUEST_ID, result: { ok: true } },
          { kind: "response", id: STATUS_REQUEST_ID, result: { state: "running", loadedRevision: "xyz789" } },
          { kind: "response", id: LIST_REQUEST_ID, result: { runs: [] } },
          { kind: "response", id: WAIT_REQUEST_ID, result: { runStatus: "completed" } },
        ]);
      },
    });

    await expect(client.health()).resolves.toEqual({ ok: true });
    await expect(client.status()).resolves.toEqual({ state: "running", loadedRevision: "xyz789" });
    await expect(client.list()).resolves.toEqual({ runs: [] });
    await expect(client.wait("run-1")).resolves.toEqual({ runStatus: "completed" });
    client.close();
  });

  expect(connectCalls).toBe(1);
});

interface ErrorCase {
  method: string;
  requestId: string;
  code: string;
  message: string;
  call: (client: TuiDaemonClient) => Promise<unknown>;
  assert: (promise: Promise<unknown>) => unknown;
}

const HEALTH_UNHEALTHY_CASE: ErrorCase = {
  method: "health",
  requestId: HEALTH_REQUEST_ID,
  code: "unhealthy",
  message: "daemon not ready",
  call: (client) => client.health(),
  assert: (promise) =>
    expect(promise).rejects.toMatchObject({
      name: "RpcError",
      code: "unhealthy",
      message: "daemon not ready",
    }),
};

const STATUS_UNAVAILABLE_CASE: ErrorCase = {
  method: "status",
  requestId: STATUS_REQUEST_ID,
  code: "status_unavailable",
  message: "no status",
  call: (client) => client.status(),
  assert: (promise) => expect(promise).rejects.toBeInstanceOf(RpcError),
};

const LIST_INTERNAL_ERROR_CASE: ErrorCase = {
  method: "list",
  requestId: LIST_REQUEST_ID,
  code: "internal_error",
  message: "list failed",
  call: (client) => client.list(),
  assert: (promise) => expect(promise).rejects.toBeInstanceOf(RpcError),
};

const WAIT_UNKNOWN_RUN_CASE: ErrorCase = {
  method: "wait",
  requestId: WAIT_REQUEST_ID,
  code: "unknown_run",
  message: "missing run",
  call: (client) => client.wait("run-404"),
  assert: (promise) => expect(promise).rejects.toMatchObject({ code: "unknown_run" }),
};

const START_RUN_IN_PROGRESS_CASE: ErrorCase = {
  method: "start",
  requestId: START_REQUEST_ID,
  code: "run_in_progress",
  message: "A run is already in progress; at most one in-flight run globally",
  call: (client) => client.start(START_INPUT),
  assert: (promise) => expect(promise).rejects.toMatchObject({ name: "RpcError", code: "run_in_progress" }),
};

const START_WORKTREE_CLAIMED_CASE: ErrorCase = {
  method: "start",
  requestId: START_REQUEST_ID,
  code: "worktree_claimed",
  message: "Run already active for project/branch",
  call: (client) => client.start(START_INPUT),
  assert: (promise) => expect(promise).rejects.toMatchObject({ code: "worktree_claimed" }),
};

const START_INVALID_PARAMS_CASE: ErrorCase = {
  method: "start",
  requestId: START_REQUEST_ID,
  code: "invalid_params",
  message: "missing input",
  call: (client) => client.start(START_INPUT),
  assert: (promise) => expect(promise).rejects.toBeInstanceOf(RpcError),
};

const PAUSE_UNKNOWN_RUN_CASE: ErrorCase = {
  method: "pause",
  requestId: PAUSE_REQUEST_ID,
  code: "unknown_run",
  message: "missing run",
  call: (client) => client.pause("run-404"),
  assert: (promise) => expect(promise).rejects.toMatchObject({ code: "unknown_run" }),
};

const RESUME_TERMINAL_RUN_CASE: ErrorCase = {
  method: "resume",
  requestId: RESUME_REQUEST_ID,
  code: "terminal_run",
  message: "Cannot resume a completed run",
  call: (client) => client.resume("run-done"),
  assert: (promise) => expect(promise).rejects.toMatchObject({ code: "terminal_run" }),
};

const KILL_UNKNOWN_RUN_CASE: ErrorCase = {
  method: "kill",
  requestId: KILL_REQUEST_ID,
  code: "unknown_run",
  message: "missing run",
  call: (client) => client.kill("run-404"),
  assert: (promise) => expect(promise).rejects.toMatchObject({ code: "unknown_run" }),
};

const PAUSE_RUN_NOT_ACTIVE_CASE: ErrorCase = {
  method: "pause",
  requestId: PAUSE_REQUEST_ID,
  code: "run_not_active",
  message: "Run run-123 is not currently active",
  call: (client) => client.pause("run-123"),
  assert: (promise) => expect(promise).rejects.toMatchObject({ code: "run_not_active" }),
};

const KILL_RUN_NOT_ACTIVE_CASE: ErrorCase = {
  method: "kill",
  requestId: KILL_REQUEST_ID,
  code: "run_not_active",
  message: "Run run-123 is not currently active",
  call: (client) => client.kill("run-123"),
  assert: (promise) => expect(promise).rejects.toMatchObject({ code: "run_not_active" }),
};

const RESUME_RUN_IN_PROGRESS_CASE: ErrorCase = {
  method: "resume",
  requestId: RESUME_REQUEST_ID,
  code: "run_in_progress",
  message: "A run is already in progress; at most one in-flight run globally",
  call: (client) => client.resume("run-paused"),
  assert: (promise) => expect(promise).rejects.toMatchObject({ code: "run_in_progress" }),
};

async function runErrorCaseGroup(cases: ErrorCase[]): Promise<void> {
  await withFixedUuid(
    cases.flatMap((c) => (c.method === "start" || c.method === "resume" ? [c.requestId, c.requestId] : [c.requestId])),
    async () => {
      const client = await connectTuiDaemon({
        connectIpcClient: async () =>
          makeGatedIpcClient(
            cases.flatMap((c) =>
              c.method === "start" || c.method === "resume"
                ? [statusFrame(c.requestId), { kind: "error", id: c.requestId, code: c.code, message: c.message }]
                : [{ kind: "error", id: c.requestId, code: c.code, message: c.message }],
            ),
          ),
        getCurrentRevision: matchingRevision,
      });

      for (const c of cases) {
        await c.assert(c.call(client));
      }
      client.close();
    },
  );
}

const ERROR_CASE_GROUPS: Array<[string, ErrorCase[]]> = [
  ["health/unhealthy", [HEALTH_UNHEALTHY_CASE]],
  ["status/status_unavailable", [STATUS_UNAVAILABLE_CASE]],
  ["list/internal_error, wait/unknown_run", [LIST_INTERNAL_ERROR_CASE, WAIT_UNKNOWN_RUN_CASE]],
  ["start/run_in_progress", [START_RUN_IN_PROGRESS_CASE]],
  ["start/worktree_claimed", [START_WORKTREE_CLAIMED_CASE]],
  ["start/invalid_params", [START_INVALID_PARAMS_CASE]],
  [
    "pause/unknown_run, resume/terminal_run, kill/unknown_run",
    [PAUSE_UNKNOWN_RUN_CASE, RESUME_TERMINAL_RUN_CASE, KILL_UNKNOWN_RUN_CASE],
  ],
  ["pause/run_not_active, kill/run_not_active", [PAUSE_RUN_NOT_ACTIVE_CASE, KILL_RUN_NOT_ACTIVE_CASE]],
  ["resume/run_in_progress", [RESUME_RUN_IN_PROGRESS_CASE]],
];

test.each(ERROR_CASE_GROUPS)("%s rejects as RpcError", async (_label, cases) => {
  await runErrorCaseGroup(cases);
});

test("list sends one correlated IPC list request and returns parsed runs", async () => {
  const sent: unknown[] = [];
  await withFixedUuid([LIST_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeGatedIpcClient(
          [
            {
              kind: "response",
              id: LIST_REQUEST_ID,
              result: {
                runs: [{ runId: "run-123", project: "demo", branch: "feature", status: "completed", isLive: false }],
              },
            },
          ],
          { sent },
        ),
    });

    await expect(client.list()).resolves.toEqual({
      runs: [{ runId: "run-123", project: "demo", branch: "feature", status: "completed", isLive: false }],
    });
    expect(sent).toEqual([{ kind: "request", id: LIST_REQUEST_ID, method: "list" }]);
    client.close();
  });
});

test("wait sends one correlated IPC wait request and returns only present optional fields", async () => {
  const sent: unknown[] = [];
  await withFixedUuid([WAIT_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeGatedIpcClient(
          [
            {
              kind: "response",
              id: WAIT_REQUEST_ID,
              result: { runStatus: "completed", loopOutcomeKind: "complete", iterationsConsumed: 2 },
            },
          ],
          { sent },
        ),
    });

    await expect(client.wait("run-123")).resolves.toEqual({
      runStatus: "completed",
      loopOutcomeKind: "complete",
      iterationsConsumed: 2,
    });
    expect(sent).toEqual([{ kind: "request", id: WAIT_REQUEST_ID, method: "wait", params: { runId: "run-123" } }]);
    client.close();
  });
});

test("list succeeds while wait is unresolved on the same client", async () => {
  const sent: unknown[] = [];
  const deferred = createDeferredIpcClient(sent);

  await withFixedUuid([WAIT_REQUEST_ID, LIST_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({ connectIpcClient: async () => deferred.client });
    const waitPromise = client.wait("run-123");
    const listPromise = client.list();

    deferred.push({
      kind: "response",
      id: LIST_REQUEST_ID,
      result: {
        runs: [{ runId: "run-123", project: "demo", branch: "feature", status: "in-progress", isLive: true }],
      },
    });

    await expect(listPromise).resolves.toEqual({
      runs: [{ runId: "run-123", project: "demo", branch: "feature", status: "in-progress", isLive: true }],
    });

    let settled = false;
    void waitPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    deferred.push({ kind: "response", id: WAIT_REQUEST_ID, result: { runStatus: "completed" } });
    await expect(waitPromise).resolves.toEqual({ runStatus: "completed" });
    expect(sent).toEqual([
      { kind: "request", id: WAIT_REQUEST_ID, method: "wait", params: { runId: "run-123" } },
      { kind: "request", id: LIST_REQUEST_ID, method: "list" },
    ]);
    client.close();
  });
});

test("wait stays pending until its correlated reply arrives", async () => {
  const deferred = createDeferredIpcClient();

  await withFixedUuid([WAIT_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({ connectIpcClient: async () => deferred.client });
    const waitPromise = client.wait("run-123");

    let settled = false;
    void waitPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    deferred.push({ kind: "response", id: WAIT_REQUEST_ID, result: { runStatus: "completed", resumable: false } });
    await expect(waitPromise).resolves.toEqual({ runStatus: "completed", resumable: false });
    client.close();
  });
});

test("late correlated wait replies do not resolve an abandoned promise", async () => {
  const deferred = createDeferredIpcClient();

  await withFixedUuid([WAIT_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({ connectIpcClient: async () => deferred.client });
    let resolved = false;
    const waitPromise = client.wait("run-123").then(
      () => {
        resolved = true;
      },
      () => undefined,
    );

    client.close();
    deferred.push({ kind: "response", id: WAIT_REQUEST_ID, result: { runStatus: "completed" } });
    await waitPromise;
    expect(resolved).toBe(false);
  });
});

test("replacing wait abandons the prior pending request without resolving it", async () => {
  const WAIT_FIRST_ID = "00000000-0000-4000-8000-000000000006";
  const WAIT_SECOND_ID = "00000000-0000-4000-8000-000000000007";
  const deferred = createDeferredIpcClient();

  await withFixedUuid([WAIT_FIRST_ID, WAIT_SECOND_ID], async () => {
    const client = await connectTuiDaemon({ connectIpcClient: async () => deferred.client });
    const abandoned = client.wait("run-a");
    const replacement = client.wait("run-b");

    deferred.push({
      kind: "response",
      id: WAIT_FIRST_ID,
      result: { runStatus: "completed", loopOutcomeKind: "complete", iterationsConsumed: 9 },
    });
    await expect(
      Promise.race([abandoned.then(() => "resolved" as const), Promise.resolve("pending" as const)]),
    ).resolves.toBe("pending");

    deferred.push({ kind: "response", id: WAIT_SECOND_ID, result: { runStatus: "blocked" } });
    await expect(replacement).resolves.toEqual({ runStatus: "blocked" });
    client.close();
  });
});

test("rejects malformed RPC replies with RpcConnectionError", async () => {
  await withFixedUuid([HEALTH_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () => makeGatedIpcClient([{ kind: "stream-open", streamId: "s1" } as IpcFrame]),
    });

    await expect(client.health()).rejects.toBeInstanceOf(RpcConnectionError);
    client.close();
  });
});

test("rejects non-correlated RPC replies with RpcConnectionError", async () => {
  await withFixedUuid([HEALTH_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () => makeGatedIpcClient([{ kind: "response", id: "other-id", result: { ok: true } }]),
    });

    await expect(client.health()).rejects.toBeInstanceOf(RpcConnectionError);
    client.close();
  });
});

test("rejects unreachable socket with RpcConnectionError and sends no RPCs", async () => {
  const sent: unknown[] = [];
  const trackingConnect = async (socketPath: string): Promise<IpcClient> => {
    const ipc = await connectIpcClient(socketPath);
    const originalSend = ipc.send.bind(ipc);
    return {
      ...ipc,
      send(frame: unknown): void {
        sent.push(frame);
        originalSend(frame);
      },
    };
  };

  await expect(
    connectTuiDaemon({ socketPath: UNREACHABLE_SOCKET_PATH, connectIpcClient: trackingConnect }),
  ).rejects.toBeInstanceOf(RpcConnectionError);
  expect(sent).toEqual([]);
});

test("start sends one correlated IPC start request and returns runId", async () => {
  const sent: unknown[] = [];
  await withFixedUuid([STATUS_REQUEST_ID, START_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeGatedIpcClient([statusFrame(), { kind: "response", id: START_REQUEST_ID, result: { runId: "run-999" } }], {
          sent,
        }),
      getCurrentRevision: matchingRevision,
    });

    await expect(client.start(START_INPUT)).resolves.toEqual({ runId: "run-999" });
    expect(sent).toEqual([
      { kind: "request", id: STATUS_REQUEST_ID, method: "status" },
      {
        kind: "request",
        id: START_REQUEST_ID,
        method: "start",
        params: { input: START_INPUT },
      },
    ]);
    client.close();
  });
});

test("revision mismatch rejects start and human-decision resume before their mutating requests", async () => {
  const sent: unknown[] = [];
  await withFixedUuid([STATUS_REQUEST_ID, STATUS_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeGatedIpcClient(
          [
            {
              kind: "response",
              id: STATUS_REQUEST_ID,
              result: { state: "running", loadedRevision: "loaded-revision" },
            },
            {
              kind: "response",
              id: STATUS_REQUEST_ID,
              result: { state: "running", loadedRevision: "loaded-revision" },
            },
          ],
          { sent },
        ),
      getCurrentRevision: async () => "current-revision",
    });

    await expect(client.start(START_INPUT)).rejects.toThrow("loaded=loaded-revision current=current-revision");
    await expect(client.resume("run-123", { decision: "revise", prompt: "try again" })).rejects.toThrow(
      "restart the daemon before starting or resuming work",
    );
    expect(sent).toEqual([
      { kind: "request", id: STATUS_REQUEST_ID, method: "status" },
      { kind: "request", id: STATUS_REQUEST_ID, method: "status" },
    ]);
    client.close();
  });
});

test.each([
  ["pause", PAUSE_REQUEST_ID] as const,
  ["resume", RESUME_REQUEST_ID] as const,
  ["kill", KILL_REQUEST_ID] as const,
])("%s sends one correlated IPC request and returns ok", async (method, requestId) => {
  const sent: unknown[] = [];
  const ids = method === "resume" ? [STATUS_REQUEST_ID, requestId] : [requestId];
  const frames =
    method === "resume"
      ? [statusFrame(), { kind: "response", id: requestId, result: { ok: true } }]
      : [{ kind: "response", id: requestId, result: { ok: true } }];
  await withFixedUuid(ids, async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () => makeGatedIpcClient(frames, { sent }),
      getCurrentRevision: matchingRevision,
    });

    await expect(client[method]("run-123")).resolves.toEqual({ ok: true });
    expect(sent).toEqual([
      ...(method === "resume" ? [{ kind: "request", id: STATUS_REQUEST_ID, method: "status" }] : []),
      { kind: "request", id: requestId, method, params: { runId: "run-123" } },
    ]);
    client.close();
  });
});

test("resume forwards decision and prompt for awaiting-human runs", async () => {
  const sent: unknown[] = [];
  await withFixedUuid([STATUS_REQUEST_ID, RESUME_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeGatedIpcClient([statusFrame(), { kind: "response", id: RESUME_REQUEST_ID, result: { ok: true } }], {
          sent,
        }),
      getCurrentRevision: matchingRevision,
    });

    await expect(client.resume("run-123", { decision: "revise", prompt: "try again" })).resolves.toEqual({
      ok: true,
    });
    expect(sent).toEqual([
      { kind: "request", id: STATUS_REQUEST_ID, method: "status" },
      {
        kind: "request",
        id: RESUME_REQUEST_ID,
        method: "resume",
        params: { runId: "run-123", decision: "revise", prompt: "try again" },
      },
    ]);
    client.close();
  });
});

test("steering RPCs succeed while wait is unresolved on the same client", async () => {
  const sent: unknown[] = [];
  const deferred = createDeferredIpcClient(sent);

  await withFixedUuid([WAIT_REQUEST_ID, PAUSE_REQUEST_ID, KILL_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({ connectIpcClient: async () => deferred.client });
    const waitPromise = client.wait("run-123");

    const pausePromise = client.pause("run-123");
    deferred.push({ kind: "response", id: PAUSE_REQUEST_ID, result: { ok: true } });
    await expect(pausePromise).resolves.toEqual({ ok: true });

    const killPromise = client.kill("run-123");
    deferred.push({ kind: "response", id: KILL_REQUEST_ID, result: { ok: true } });
    await expect(killPromise).resolves.toEqual({ ok: true });

    let settled = false;
    void waitPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    deferred.push({ kind: "response", id: WAIT_REQUEST_ID, result: { runStatus: "completed" } });
    await expect(waitPromise).resolves.toEqual({ runStatus: "completed" });
    expect(sent).toEqual([
      { kind: "request", id: WAIT_REQUEST_ID, method: "wait", params: { runId: "run-123" } },
      { kind: "request", id: PAUSE_REQUEST_ID, method: "pause", params: { runId: "run-123" } },
      { kind: "request", id: KILL_REQUEST_ID, method: "kill", params: { runId: "run-123" } },
    ]);
    client.close();
  });
});

test("steering malformed success payloads reject as RpcConnectionError", async () => {
  await withFixedUuid([PAUSE_REQUEST_ID, RESUME_REQUEST_ID, KILL_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeGatedIpcClient([
          { kind: "response", id: PAUSE_REQUEST_ID, result: { ok: false } },
          { kind: "response", id: RESUME_REQUEST_ID, result: {} },
          { kind: "response", id: KILL_REQUEST_ID, result: { state: "running" } },
        ]),
    });

    await expect(client.pause("run-1")).rejects.toBeInstanceOf(RpcConnectionError);
    await expect(client.resume("run-1")).rejects.toBeInstanceOf(RpcConnectionError);
    await expect(client.kill("run-1")).rejects.toBeInstanceOf(RpcConnectionError);
    client.close();
  });
});
