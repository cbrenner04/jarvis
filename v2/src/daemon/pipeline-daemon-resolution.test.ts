import { expect, test } from "bun:test";
import type { IpcClient } from "../ipc/client.ts";
import type { PipelineDaemonResolutionDeps } from "./pipeline-daemon-resolution.ts";
import {
  PIPELINE_NO_LIVE_OWNER_RECOVERY,
  queryPipelineListsFromSocketPaths,
  resolvePipelineDaemon,
  resolvePipelineDaemonFromSocketPaths,
  resolvePipelineIdAcrossDaemons,
} from "./pipeline-daemon-resolution.ts";
import { ambiguousPipelineIdMessage } from "./pipeline-id-resolution.ts";
import type { PipelineSnapshot } from "./pipeline-observation.ts";

const PIPELINE_ID = "pipeline-full-id";
const INVOKING_SOCKET = "/jarvis/daemon-bbbb.sock";
const OTHER_SOCKET = "/jarvis/daemon-aaaa.sock";

type Reply = { result: unknown } | { error: { code: string; message: string } } | { hung: true };

function replyingClient(reply: Reply, sent: unknown[] = []): IpcClient {
  let request: { id: string } | undefined;
  let closed = false;
  return {
    send(frame: unknown): void {
      sent.push(frame);
      request = frame as { id: string };
    },
    async nextFrame() {
      await Promise.resolve();
      if (closed) throw new Error("connection closed");
      if ("hung" in reply) return new Promise(() => {});
      if (request === undefined) throw new Error("request not sent");
      return "error" in reply
        ? { kind: "error", id: request.id, ...reply.error }
        : { kind: "response", id: request.id, result: reply.result };
    },
    close(): void {
      closed = true;
    },
  };
}

function owner(kind: "owner" | "not_owner" | "not_found", pipelineId = PIPELINE_ID): Reply {
  return { result: { kind, pipelineId } };
}

function durable(state: "succeeded" | "interrupted", pipelineId = PIPELINE_ID): Reply {
  return { result: { kind: "durable_state", pipelineId, state } };
}

function refusingStartDaemon(): never {
  throw new Error("should not start a daemon");
}

test("resolves a non-invoking active owner", async () => {
  const connected: string[] = [];
  const result = await resolvePipelineDaemon(
    PIPELINE_ID,
    {
      socketPath: INVOKING_SOCKET,
      socketDiscovery: async () => [OTHER_SOCKET, INVOKING_SOCKET],
      connectIpcClient: async (socketPath) => {
        connected.push(socketPath);
        return replyingClient(socketPath === OTHER_SOCKET ? owner("owner") : owner("not_owner"));
      },
      startDaemon: refusingStartDaemon,
    },
    20,
  );

  expect(result).toEqual({ kind: "owner", pipelineId: PIPELINE_ID, socketPath: OTHER_SOCKET });
  expect(connected).toEqual([OTHER_SOCKET, INVOKING_SOCKET]);
});

test("skips a failed socket before a later owner witness", async () => {
  const ownerSocket = "/5-owner.sock";
  const paths = [
    "/1-connect-fails.sock",
    "/2-rpc-fails.sock",
    "/3-response-hangs.sock",
    "/4-connect-hangs.sock",
    ownerSocket,
  ];
  const sent: unknown[] = [];
  const result = await resolvePipelineDaemonFromSocketPaths(
    async (socketPath) => {
      if (socketPath === paths[0]) throw new Error("connect ENOENT /raw/path.sock");
      if (socketPath === paths[1]) {
        return replyingClient({ error: { code: "broken", message: "rpc failed" } }, sent);
      }
      if (socketPath === paths[2]) return replyingClient({ hung: true }, sent);
      if (socketPath === paths[3]) return new Promise(() => {});
      return replyingClient(owner("owner"), sent);
    },
    paths,
    PIPELINE_ID,
    10,
  );

  expect(result).toEqual({ kind: "owner", pipelineId: PIPELINE_ID, socketPath: ownerSocket });
  expect(sent).toHaveLength(3);
  expect(sent.every((frame) => (frame as { method?: string }).method === "pipeline_owner")).toBeTrue();
});

test("selects a durable-state endpoint or reports a dead active owner", async () => {
  const high = "/jarvis/daemon-ffff.sock";
  const low = "/jarvis/daemon-0000.sock";
  for (const state of ["succeeded", "interrupted"] as const) {
    const result = await resolvePipelineDaemonFromSocketPaths(
      async () => replyingClient(durable(state)),
      [high, low],
      PIPELINE_ID,
      20,
    );
    expect(result).toEqual({
      kind: "durable_state",
      pipelineId: PIPELINE_ID,
      socketPath: low,
      state,
    });
  }

  const deadOwner = await resolvePipelineDaemonFromSocketPaths(
    async () => replyingClient(owner("not_owner")),
    [OTHER_SOCKET, INVOKING_SOCKET],
    PIPELINE_ID,
    20,
  );
  expect(deadOwner).toEqual({
    kind: "pipeline_no_live_owner",
    pipelineId: PIPELINE_ID,
    recovery: PIPELINE_NO_LIVE_OWNER_RECOVERY,
  });
  expect(deadOwner).toMatchObject({ recovery: "jarvis daemon start, then retry" });
});

test("refuses duplicate owner witnesses", async () => {
  const sent: unknown[] = [];
  const result = await resolvePipelineDaemonFromSocketPaths(
    async () => replyingClient(owner("owner"), sent),
    [INVOKING_SOCKET, OTHER_SOCKET],
    PIPELINE_ID,
    20,
  );

  expect(result).toEqual({
    kind: "pipeline_owner_conflict",
    pipelineId: PIPELINE_ID,
    claimantPaths: [OTHER_SOCKET, INVOKING_SOCKET],
  });
  expect(sent).toHaveLength(2);
  expect(sent.every((frame) => (frame as { method?: string }).method === "pipeline_owner")).toBeTrue();
});

test("reports absent and unavailable pipelines", async () => {
  const absent = await resolvePipelineDaemonFromSocketPaths(
    async () => replyingClient(owner("not_found")),
    [OTHER_SOCKET, INVOKING_SOCKET],
    PIPELINE_ID,
    20,
  );
  expect(absent).toEqual({ kind: "pipeline_not_found", pipelineId: PIPELINE_ID });

  const unavailable = await resolvePipelineDaemonFromSocketPaths(
    async () => {
      throw new Error("connect ENOENT /raw/path.sock");
    },
    [OTHER_SOCKET, INVOKING_SOCKET],
    PIPELINE_ID,
    20,
  );
  expect(unavailable).toEqual({ kind: "pipeline_daemon_unavailable", pipelineId: PIPELINE_ID });
  expect(JSON.stringify([absent, unavailable])).not.toContain("ENOENT");

  const malformed = await resolvePipelineDaemonFromSocketPaths(
    async (socketPath) =>
      replyingClient(
        socketPath === OTHER_SOCKET
          ? owner("owner", "wrong-pipeline")
          : { result: { kind: "durable_state", pipelineId: PIPELINE_ID, state: "not-a-state" } },
      ),
    [OTHER_SOCKET, INVOKING_SOCKET],
    PIPELINE_ID,
    20,
  );
  expect(malformed).toEqual({ kind: "pipeline_daemon_unavailable", pipelineId: PIPELINE_ID });
});

test("never auto-starts", async () => {
  let startCalls = 0;
  const startDaemon: PipelineDaemonResolutionDeps["startDaemon"] = async () => {
    startCalls += 1;
    throw new Error("should not start a daemon");
  };
  const connectors: Array<(socketPath: string) => Promise<ReturnType<typeof replyingClient>>> = [
    async () => replyingClient(owner("owner")), // owner
    async () => replyingClient(durable("succeeded")), // durable_state
    async () => replyingClient(owner("owner")), // pipeline_owner_conflict (both sockets claim owner)
    async () => replyingClient(owner("not_owner")), // pipeline_no_live_owner
    async () => replyingClient(owner("not_found")), // pipeline_not_found
    async () => {
      throw new Error("connect ENOENT /raw/path.sock");
    }, // pipeline_daemon_unavailable
  ];

  for (const connectIpcClient of connectors) {
    await resolvePipelineDaemon(
      PIPELINE_ID,
      {
        socketPath: INVOKING_SOCKET,
        socketDiscovery: async () => [OTHER_SOCKET],
        connectIpcClient,
        startDaemon,
      },
      20,
    );
  }

  expect(startCalls).toBe(0);
});

test("pipeline list queries retain valid snapshots and distinguish malformed replies", async () => {
  const validSocket = "/1-valid.sock";
  const malformedSocket = "/2-malformed.sock";
  const rpcFailureSocket = "/3-rpc-failure.sock";
  const connectFailureSocket = "/4-connect-failure.sock";
  const sent: unknown[] = [];
  const snapshot: PipelineSnapshot = {
    pipelineId: PIPELINE_ID,
    name: "test",
    state: "running",
    terminalPublicationSucceededAt: null,
    terminalPublicationFailure: null,
    createdAt: 1,
    finishedAtMs: null,
    dismissedAt: null,
    stages: [
      {
        id: "stage-1",
        stageId: "stage",
        branchKey: "default",
        position: 0,
        status: "running",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        decidedAt: null,
        artifact: null,
        failureDetail: null,
      },
    ],
  };

  const result = await queryPipelineListsFromSocketPaths(
    async (socketPath) => {
      if (socketPath === connectFailureSocket) throw new Error("connect failed");
      if (socketPath === rpcFailureSocket) {
        return replyingClient({ error: { code: "broken", message: "rpc failed" } }, sent);
      }
      return replyingClient(
        {
          result:
            socketPath === validSocket
              ? { pipelines: [snapshot] }
              : { pipelines: [snapshot, { ...snapshot, stages: [{ ...snapshot.stages[0], endedAt: "broken" }] }] },
        },
        sent,
      );
    },
    [validSocket, malformedSocket, rpcFailureSocket, connectFailureSocket],
    { includeDismissed: true },
    20,
  );

  expect(result).toEqual({
    snapshotsBySocketPath: { [validSocket]: [snapshot] },
    hasMalformedResponse: true,
  });
  expect(sent).toHaveLength(3);
  expect(sent.every((frame) => (frame as { method?: string }).method === "pipeline_list")).toBeTrue();
  expect(
    sent.every((frame) => (frame as { params?: { includeDismissed?: unknown } }).params?.includeDismissed === true),
  ).toBeTrue();
});

test("pipeline list distinguishes null from non-numeric nullable timestamps", async () => {
  const snapshot: PipelineSnapshot = {
    pipelineId: PIPELINE_ID,
    name: "test",
    state: "running",
    terminalPublicationSucceededAt: 1,
    terminalPublicationFailure: null,
    createdAt: 1,
    finishedAtMs: 2,
    dismissedAt: null,
    stages: [],
  };

  const valid = await queryPipelineListsFromSocketPaths(
    async () => replyingClient({ result: { pipelines: [snapshot] } }),
    [INVOKING_SOCKET],
    undefined,
    20,
  );
  expect(valid).toEqual({
    snapshotsBySocketPath: { [INVOKING_SOCKET]: [snapshot] },
    hasMalformedResponse: false,
  });

  const invalidTimestamp = {
    ...snapshot,
    dismissedAt: "invalid",
  };
  const invalid = await queryPipelineListsFromSocketPaths(
    async () => replyingClient({ result: { pipelines: [invalidTimestamp] } }),
    [INVOKING_SOCKET],
    undefined,
    20,
  );
  expect(invalid).toEqual({ snapshotsBySocketPath: {}, hasMalformedResponse: true });
});

test("pipeline list accepts a snapshot carrying an optional string field", async () => {
  const snapshot: PipelineSnapshot = {
    pipelineId: PIPELINE_ID,
    name: "test",
    state: "running",
    seedPath: "/seeds/example.md",
    terminalPublicationSucceededAt: null,
    terminalPublicationFailure: null,
    createdAt: 1,
    finishedAtMs: null,
    dismissedAt: null,
    stages: [],
  };

  const result = await queryPipelineListsFromSocketPaths(
    async () => replyingClient({ result: { pipelines: [snapshot] } }),
    [INVOKING_SOCKET],
    undefined,
    20,
  );
  expect(result).toEqual({
    snapshotsBySocketPath: { [INVOKING_SOCKET]: [snapshot] },
    hasMalformedResponse: false,
  });
});

function pipelineSnapshot(pipelineId: string, overrides: Partial<PipelineSnapshot> = {}): PipelineSnapshot {
  return {
    pipelineId,
    name: "test",
    state: "running",
    terminalPublicationSucceededAt: null,
    terminalPublicationFailure: null,
    createdAt: 1,
    finishedAtMs: null,
    dismissedAt: null,
    stages: [],
    ...overrides,
  };
}

test("resolves a unique cross-daemon prefix to the full pipeline id", async () => {
  const idOnOtherSocket = "aaaa1111bbbb";
  const idOnInvokingSocket = "cccc2222dddd";
  const sent: unknown[] = [];
  const result = await resolvePipelineIdAcrossDaemons(
    "aaaa1111",
    {
      socketPath: INVOKING_SOCKET,
      socketDiscovery: async () => [OTHER_SOCKET],
      connectIpcClient: async (socketPath) =>
        replyingClient(
          {
            result: {
              pipelines: [pipelineSnapshot(socketPath === OTHER_SOCKET ? idOnOtherSocket : idOnInvokingSocket)],
            },
          },
          sent,
        ),
    },
    20,
  );

  expect(result).toEqual({ kind: "resolved", pipelineId: idOnOtherSocket });
  expect(sent).toHaveLength(2);
});

test("refuses a prefix matching ids across two daemons with the ambiguous message, without further RPC", async () => {
  const idOnOtherSocket = "abc12345xxxx";
  const idOnInvokingSocket = "abc12345yyyy";
  const sent: unknown[] = [];
  const result = await resolvePipelineIdAcrossDaemons(
    "abc12345",
    {
      socketPath: INVOKING_SOCKET,
      socketDiscovery: async () => [OTHER_SOCKET],
      connectIpcClient: async (socketPath) =>
        replyingClient(
          {
            result: {
              pipelines: [pipelineSnapshot(socketPath === OTHER_SOCKET ? idOnOtherSocket : idOnInvokingSocket)],
            },
          },
          sent,
        ),
    },
    20,
  );

  const candidates = [idOnOtherSocket, idOnInvokingSocket].sort();
  expect(result).toEqual({
    kind: "ambiguous",
    candidates,
    message: ambiguousPipelineIdMessage("abc12345", candidates),
  });
  expect(sent).toHaveLength(2);
  expect(sent.every((frame) => (frame as { method?: string }).method === "pipeline_list")).toBeTrue();
});

test("resolves a dismissed pipeline's full id via the merged, dismissed-inclusive listing", async () => {
  const dismissedId = "dismissed-pipeline-id";
  const sent: unknown[] = [];
  const result = await resolvePipelineIdAcrossDaemons(
    dismissedId,
    {
      socketPath: INVOKING_SOCKET,
      socketDiscovery: async () => [],
      connectIpcClient: async () =>
        replyingClient({ result: { pipelines: [pipelineSnapshot(dismissedId, { dismissedAt: 5 })] } }, sent),
    },
    20,
  );

  expect(result).toEqual({ kind: "resolved", pipelineId: dismissedId });
  expect(
    sent.every((frame) => (frame as { params?: { includeDismissed?: unknown } }).params?.includeDismissed === true),
  ).toBeTrue();
});

test("returns unmatched when an argument matches zero ids across the merged listing", async () => {
  const result = await resolvePipelineIdAcrossDaemons(
    "no-such-pipeline",
    {
      socketPath: INVOKING_SOCKET,
      socketDiscovery: async () => [OTHER_SOCKET],
      connectIpcClient: async () => replyingClient({ result: { pipelines: [pipelineSnapshot(PIPELINE_ID)] } }),
    },
    20,
  );

  expect(result).toEqual({ kind: "unmatched", pipelineId: "no-such-pipeline" });
});

test("never prefix-resolves an argument shorter than the minimum prefix length", async () => {
  const result = await resolvePipelineIdAcrossDaemons(
    "ab",
    {
      socketPath: INVOKING_SOCKET,
      socketDiscovery: async () => [],
      connectIpcClient: async () => replyingClient({ result: { pipelines: [pipelineSnapshot("abcdefghijkl")] } }),
    },
    20,
  );

  expect(result).toEqual({ kind: "unmatched", pipelineId: "ab" });
});

test.each([
  "malformed",
  "disconnected",
  "rpc-error",
  "timeout",
] as const)("refuses prefix resolution against an incomplete daemon listing: %s", async (failure) => {
  const fullId = "aaaa1111bbbb";
  const deps = {
    socketPath: INVOKING_SOCKET,
    socketDiscovery: async () => [OTHER_SOCKET],
    connectIpcClient: async (socketPath: string) => {
      if (socketPath === INVOKING_SOCKET) return replyingClient({ result: { pipelines: [pipelineSnapshot(fullId)] } });
      if (failure === "disconnected") throw new Error("connection refused");
      if (failure === "rpc-error") return replyingClient({ error: { code: "internal_error", message: "unavailable" } });
      if (failure === "timeout") return replyingClient({ hung: true });
      return replyingClient({ result: { pipelines: [{ pipelineId: "aaaa1111cccc" }] } });
    },
  };
  expect(await resolvePipelineIdAcrossDaemons("aaaa1111", deps, 20)).toEqual({
    kind: "incomplete",
    message: expect.stringContaining("pipeline_id_set_incomplete:"),
  });
  expect(await resolvePipelineIdAcrossDaemons(fullId, deps, 20)).toEqual({ kind: "resolved", pipelineId: fullId });
});
