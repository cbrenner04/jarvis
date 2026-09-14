import { expect, test } from "bun:test";
import type { IpcClient } from "../ipc/client.ts";
import { queryPipelineListsFromSocketPaths, resolvePipelineIdAcrossDaemons } from "./pipeline-daemon-resolution.ts";
import { ambiguousPipelineIdMessage } from "./pipeline-id-resolution.ts";
import type { PipelineSnapshot } from "./pipeline-observation.ts";

const PIPELINE_ID = "pipeline-full-id";
const INVOKING_SOCKET = "/jarvis/daemon-bbbb.sock";

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

/** Answers only the stable (invoking) address; any other connect target fails the test. */
function stableOnlyDeps(replies: readonly Reply[], sent: unknown[] = []) {
  let call = 0;
  return {
    socketPath: INVOKING_SOCKET,
    connectIpcClient: async (socketPath: string) => {
      if (socketPath !== INVOKING_SOCKET) throw new Error(`unexpected non-stable connect ${socketPath}`);
      const reply = replies[Math.min(call, replies.length - 1)];
      call += 1;
      if (reply === undefined) throw new Error("no stub reply");
      return replyingClient(reply, sent);
    },
  };
}

test("resolves a unique prefix against the stable-address listing only", async () => {
  const sent: unknown[] = [];
  const deps = stableOnlyDeps(
    [{ result: { pipelines: [pipelineSnapshot("aaaa1111bbbb"), pipelineSnapshot("cccc2222dddd")] } }],
    sent,
  );

  expect(await resolvePipelineIdAcrossDaemons("aaaa1111", deps, 20)).toEqual({
    kind: "resolved",
    pipelineId: "aaaa1111bbbb",
  });
  expect(sent).toHaveLength(1);
});

test("preserves exact-id, ambiguous-prefix, and unknown-id outcomes with a stable-only connect stub", async () => {
  const sent: unknown[] = [];
  const deps = stableOnlyDeps(
    [{ result: { pipelines: [pipelineSnapshot("abc12345xxxx"), pipelineSnapshot("abc12345yyyy")] } }],
    sent,
  );

  expect(await resolvePipelineIdAcrossDaemons("abc12345xxxx", deps, 20)).toEqual({
    kind: "resolved",
    pipelineId: "abc12345xxxx",
  });
  const candidates = ["abc12345xxxx", "abc12345yyyy"];
  expect(await resolvePipelineIdAcrossDaemons("abc12345", deps, 20)).toEqual({
    kind: "ambiguous",
    candidates,
    message: ambiguousPipelineIdMessage("abc12345", candidates),
  });
  expect(await resolvePipelineIdAcrossDaemons("no-such-pipeline", deps, 20)).toEqual({
    kind: "unmatched",
    pipelineId: "no-such-pipeline",
  });
  expect(sent.every((frame) => (frame as { method?: string }).method === "pipeline_list")).toBeTrue();
});

test("refuses a prefix once the stable listing degrades after a predecessor-held pipeline was listed (2026-09-13)", async () => {
  const predecessorHeld = "aaaa1111pred";
  const unrelatedLocal = "aaaa1111locl";
  const deps = stableOnlyDeps([
    { result: { pipelines: [pipelineSnapshot(predecessorHeld)] } },
    { result: { pipelines: [pipelineSnapshot(unrelatedLocal)], degraded: true } },
  ]);

  expect(await resolvePipelineIdAcrossDaemons("aaaa1111p", deps, 20)).toEqual({
    kind: "resolved",
    pipelineId: predecessorHeld,
  });
  expect(await resolvePipelineIdAcrossDaemons("aaaa1111", deps, 20)).toEqual({
    kind: "incomplete",
    message: expect.stringContaining("pipeline_id_set_incomplete:"),
  });
});

test("a degraded listing refuses a prefix even when a same-prefix local id exists", async () => {
  const deps = stableOnlyDeps([{ result: { pipelines: [pipelineSnapshot("aaaa1111locl")], degraded: true } }]);

  expect(await resolvePipelineIdAcrossDaemons("aaaa1111", deps, 20)).toEqual({
    kind: "incomplete",
    message: expect.stringContaining("pipeline_id_set_incomplete:"),
  });
});

test("a degraded listing still resolves an exact id present in it", async () => {
  const deps = stableOnlyDeps([{ result: { pipelines: [pipelineSnapshot("aaaa1111locl")], degraded: true } }]);

  expect(await resolvePipelineIdAcrossDaemons("aaaa1111locl", deps, 20)).toEqual({
    kind: "resolved",
    pipelineId: "aaaa1111locl",
  });
});

test("resolves a dismissed pipeline's full id via the merged, dismissed-inclusive listing", async () => {
  const dismissedId = "dismissed-pipeline-id";
  const sent: unknown[] = [];
  const result = await resolvePipelineIdAcrossDaemons(
    dismissedId,
    {
      socketPath: INVOKING_SOCKET,
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
] as const)("refuses prefix resolution when the stable-address listing is unavailable: %s", async (failure) => {
  const reply: Reply =
    failure === "rpc-error"
      ? { error: { code: "internal_error", message: "unavailable" } }
      : failure === "timeout"
        ? { hung: true }
        : { result: { pipelines: [{ pipelineId: "aaaa1111cccc" }] } };
  const deps = {
    socketPath: INVOKING_SOCKET,
    connectIpcClient: async (socketPath: string) => {
      if (socketPath !== INVOKING_SOCKET) throw new Error(`unexpected non-stable connect ${socketPath}`);
      if (failure === "disconnected") throw new Error("connection refused");
      return replyingClient(reply);
    },
  };
  expect(await resolvePipelineIdAcrossDaemons("aaaa1111", deps, 20)).toEqual({
    kind: "incomplete",
    message: expect.stringContaining("pipeline_id_set_incomplete:"),
  });
});
