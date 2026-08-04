import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import {
  absentMachineConfigPath,
  type CliRepoFixture,
  captureIo,
  cliMain as main,
  makeCliRepoFixture,
  makeIpcClient,
  stubAgentModelConfig,
  writeMachineConfig,
} from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";

let fx: CliRepoFixture;

beforeAll(() => {
  fx = makeCliRepoFixture();
});

afterAll(() => {
  fx.cleanup();
});

const WAIT_REQUEST_ID = "00000000-0000-4000-8000-000000000010";
const OPERATOR_SESSION_ID = "00000000-0000-4000-8000-000000000002";
const SOLO_LIST_REQUEST_ID = "00000000-0000-4000-8000-000000000003";
const SOLO_LIST_ROW_REQUEST_ID = "00000000-0000-4000-8000-000000000011";
const COMPLETION_COMMIT_ERROR_MSG = "failed to push some refs to 'origin/feature'";

function soloDaemonListRow(runId: string) {
  return { runId, project: "demo", branch: "main", status: "completed", isLive: true };
}

function connectAfterSoloOwnerList(
  listRequestId: string,
  runs: Array<ReturnType<typeof soloDaemonListRow>>,
  after: () => ReturnType<typeof makeIpcClient>,
) {
  let connectCount = 0;
  return async () => {
    connectCount += 1;
    if (connectCount === 1) {
      return makeIpcClient([{ kind: "response", id: listRequestId, result: { runs } }]);
    }
    return after();
  };
}

function waitResponse(result: unknown): unknown {
  return { kind: "response", id: WAIT_REQUEST_ID, result };
}

function waitError(code: string, message: string): unknown {
  return { kind: "error", id: WAIT_REQUEST_ID, code, message };
}

async function runSoloList(runs: Record<string, unknown>[]) {
  const cap = captureIo();
  const code = await withFixedUuid(SOLO_LIST_ROW_REQUEST_ID, () =>
    main(["run", "list"], cap.io, {
      connectIpcClient: async () =>
        makeIpcClient([{ kind: "response", id: SOLO_LIST_ROW_REQUEST_ID, result: { runs } }]),
    }),
  );
  const stdout = cap.read().stdout;
  return {
    code,
    stdout,
    row: () => stdout.trimEnd().split("\t"),
    rows: () =>
      stdout
        .trimEnd()
        .split("\n")
        .map((line) => line.split("\t")),
  };
}

async function runWait(
  cap: ReturnType<typeof captureIo>,
  runId: string,
  frames: unknown[],
  sent: unknown[] = [],
  listRuns?: Array<ReturnType<typeof soloDaemonListRow>>,
): Promise<number> {
  const runs = listRuns ?? [soloDaemonListRow(runId)];
  return withFixedUuid([OPERATOR_SESSION_ID, SOLO_LIST_REQUEST_ID, WAIT_REQUEST_ID], () =>
    main(["run", "wait", runId], cap.io, {
      socketDiscovery: async () => [],
      connectIpcClient: connectAfterSoloOwnerList(SOLO_LIST_REQUEST_ID, runs, () => makeIpcClient(frames, { sent })),
    }),
  );
}

function logRecord(seq: number, eventKind: PersistedRecord["event"]["kind"]): PersistedRecord {
  return {
    runId: "run-123",
    seq,
    ts: `2026-06-28T03:27:0${seq}.000Z`,
    event:
      eventKind === "iteration_started"
        ? { kind: "iteration_started", attemptId: `attempt-${seq}` }
        : eventKind === "boundary_committed"
          ? {
              kind: "boundary_committed",
              attemptId: `attempt-${seq}`,
              outcomeKind: "progress",
              runStatus: "in-progress",
            }
          : {
              kind: "loop_finished",
              loopOutcomeKind: "complete",
              iterationsConsumed: 1,
              resumable: false,
            },
  };
}

describe("run start", () => {
  test("run start sends one IPC start request carrying write-loop input and prints run ID", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000001";

    const code = await withFixedUuid(requestId, () =>
      main([...fx.runStartArgs, "--max-iterations", "4"], cap.io, {
        loadAgentModelConfig: stubAgentModelConfig,
        machineConfigPath: absentMachineConfigPath(),
        connectIpcClient: async () =>
          makeIpcClient([{ kind: "response", id: requestId, result: { runId: "run-999" } }], { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "run-999\n", stderr: "" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "request",
      method: "start",
      params: {
        input: {
          worktree: {
            projectRoot: fx.repoRoot,
            projectName: "demo",
            branchName: "write-run",
            baseRef: "HEAD",
          },
          specPath: "spec.md",
          expectedArtifactPath: "proof.txt",
          maxIterations: 4,
          bindings: [],
          bindingResolution: { role: "implement", agents: ["claude"] },
        },
      },
    });
  });

  test("run start forwards machine-config agents into IPC start payload", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ agents: ["codex", "cursor"] });
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000022";

    const code = await withFixedUuid(requestId, () =>
      main(fx.runStartArgs, cap.io, {
        loadAgentModelConfig: stubAgentModelConfig,
        machineConfigPath: configPath,
        connectIpcClient: async () =>
          makeIpcClient([{ kind: "response", id: requestId, result: { runId: "run-machine-config" } }], { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "run-machine-config\n", stderr: "" });
    expect(sent[0]).toMatchObject({
      params: {
        input: {
          bindings: [],
          bindingResolution: { role: "implement", agents: ["codex", "cursor"] },
        },
      },
    });
  });

  test("run start passes through daemon guard errors without local write-loop logic", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000002";

    const code = await withFixedUuid(requestId, () =>
      main(fx.runStartArgs, cap.io, {
        loadAgentModelConfig: stubAgentModelConfig,
        connectIpcClient: async () =>
          makeIpcClient([
            {
              kind: "error",
              id: requestId,
              code: "run_in_progress",
              message: "A run is already in progress; at most one in-flight run globally",
            },
          ]),
        executeWriteLoop: async () => {
          throw new Error("should not execute locally");
        },
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "run_in_progress: A run is already in progress; at most one in-flight run globally\n",
    });
  });
});

describe("dispatch to keyed daemons", () => {
  test("run start dispatches without a preceding status request", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000001";

    const code = await withFixedUuid(requestId, () =>
      main([...fx.runStartArgs], cap.io, {
        loadAgentModelConfig: stubAgentModelConfig,
        connectIpcClient: async () =>
          makeIpcClient([{ kind: "response", id: requestId, result: { runId: "run-999" } }], { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "request",
      method: "start",
    });
    expect(cap.read()).toEqual({ stdout: "run-999\n", stderr: "" });
  });

  test("run resume dispatches without listing runs, so live runs cannot refuse it", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000001";

    const code = await withFixedUuid(requestId, () =>
      main(["run", "resume", "run-123"], cap.io, {
        connectIpcClient: async () =>
          makeIpcClient([{ kind: "response", id: requestId, result: { ok: true } }], { sent }),
      }),
    );

    expect(code).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "request",
      method: "resume",
      params: { runId: "run-123" },
    });
    expect(cap.read()).toEqual({ stdout: "resumed run-123\n", stderr: "" });
  });

  test("--no-auto-bounce flag is rejected as unknown", async () => {
    const cap = captureIo();
    const code = await main([...fx.runStartArgs, "--no-auto-bounce"], cap.io, {
      loadAgentModelConfig: stubAgentModelConfig,
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("usage:");
  });
});

describe("keyed daemon auto-start on dispatch", () => {
  const KEYED_SOCKET = "/keyed/digest-a.sock";
  const OTHER_SOCKET = "/keyed/digest-b.sock";

  test("run start auto-starts the keyed daemon when absent, then dispatches", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const connectPaths: string[] = [];
    const startCalls: Array<{ socketPath: string; pidPath: string | undefined; logPath: string | undefined }> = [];
    const code = await withFixedUuid(["operator", "start"], () =>
      main(fx.runStartArgs, cap.io, {
        loadAgentModelConfig: stubAgentModelConfig,
        socketPath: KEYED_SOCKET,
        pidPath: "/keyed/digest-a.pid",
        logPath: "/keyed/digest-a.log",
        connectIpcClient: async (socketPath) => {
          connectPaths.push(socketPath);
          if (connectPaths.length === 1) throw new Error("ECONNREFUSED");
          return makeIpcClient([{ kind: "response", id: "start", result: { runId: "run-autostart" } }], { sent });
        },
        startDaemon: async (socketPath, options) => {
          startCalls.push({ socketPath, pidPath: options?.pidPath, logPath: options?.logPath });
          return { pid: 7, socketPath };
        },
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "run-autostart\n", stderr: "" });
    expect(startCalls).toEqual([
      { socketPath: KEYED_SOCKET, pidPath: "/keyed/digest-a.pid", logPath: "/keyed/digest-a.log" },
    ]);
    expect(connectPaths).toEqual([KEYED_SOCKET, KEYED_SOCKET]);
    expect(sent.filter((frame) => (frame as { method?: string }).method === "start")).toHaveLength(1);
  });

  test("run start reuses a running keyed daemon without starting one", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const code = await withFixedUuid(["operator", "start"], () =>
      main(fx.runStartArgs, cap.io, {
        loadAgentModelConfig: stubAgentModelConfig,
        socketPath: KEYED_SOCKET,
        connectIpcClient: async () =>
          makeIpcClient([{ kind: "response", id: "start", result: { runId: "run-reused" } }], { sent }),
        startDaemon: async () => {
          throw new Error("should not start");
        },
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "run-reused\n", stderr: "" });
    expect(sent.filter((frame) => (frame as { method?: string }).method === "start")).toHaveLength(1);
  });

  test("a live daemon on another digest's socket receives no request", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const otherSent: unknown[] = [];
    const startCalls: string[] = [];
    const code = await withFixedUuid(["operator", "start"], () =>
      main(fx.runStartArgs, cap.io, {
        loadAgentModelConfig: stubAgentModelConfig,
        socketPath: KEYED_SOCKET,
        connectIpcClient: async (socketPath) => {
          if (socketPath === OTHER_SOCKET) {
            const otherRuns = { runs: [{ runId: "other", isLive: true }] };
            return makeIpcClient([{ kind: "response", id: "list", result: otherRuns }], { sent: otherSent });
          }
          if (sent.length === 0 && startCalls.length === 0) throw new Error("ECONNREFUSED");
          return makeIpcClient([{ kind: "response", id: "start", result: { runId: "run-keyed" } }], { sent });
        },
        startDaemon: async (socketPath) => {
          startCalls.push(socketPath);
          return { pid: 7, socketPath };
        },
      }),
    );

    expect(code).toBe(0);
    expect(startCalls).toEqual([KEYED_SOCKET]);
    expect(otherSent).toEqual([]);
    expect(sent.filter((frame) => (frame as { method?: string }).method === "start")).toHaveLength(1);
  });

  test("a non-race start failure reports a lifecycle error with exit 1 and no dispatch", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const code = await main(fx.runStartArgs, cap.io, {
      loadAgentModelConfig: stubAgentModelConfig,
      socketPath: KEYED_SOCKET,
      connectIpcClient: async () => {
        throw new Error("ECONNREFUSED");
      },
      startDaemon: async () => {
        throw new Error("daemon start failed: log directory missing");
      },
    });

    expect(code).toBe(1);
    expect(sent).toEqual([]);
    expect(cap.read().stderr).toContain("daemon start failed: log directory missing");
  });

  test("an exhausted connect deadline exits 1 with a connection error and no dispatch", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    let time = 0;
    const code = await main(fx.runStartArgs, cap.io, {
      loadAgentModelConfig: stubAgentModelConfig,
      socketPath: KEYED_SOCKET,
      connectIpcClient: async () => {
        throw new Error("ECONNREFUSED");
      },
      startDaemon: async (socketPath) => ({ pid: 7, socketPath }),
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    });

    expect(code).toBe(1);
    expect(sent).toEqual([]);
    expect(cap.read().stderr).toBe(
      `Failed to connect to daemon on socket ${KEYED_SOCKET} after starting it (5000ms deadline exceeded)\n`,
    );
    expect(time).toBe(5000);
  });

  test("read-only run list reports the missing daemon instead of starting one", async () => {
    const cap = captureIo();
    let started = 0;
    const code = await main(["run", "list"], cap.io, {
      socketPath: KEYED_SOCKET,
      connectIpcClient: async () => {
        throw new Error("ECONNREFUSED");
      },
      startDaemon: async (socketPath) => {
        started += 1;
        return { pid: 7, socketPath };
      },
    });

    expect(code).toBe(1);
    expect(started).toBe(0);
    expect(cap.read().stderr).toBe("ECONNREFUSED\n");
  });
});

describe("run control", () => {
  test("run log prints replay and follow records as compact JSONL in order", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const streamId = "00000000-0000-4000-8000-000000000004";
    const records = [
      logRecord(1, "iteration_started"),
      logRecord(2, "boundary_committed"),
      logRecord(3, "loop_finished"),
      {
        runId: "run-123",
        seq: 4,
        ts: "2026-01-01T00:00:04.000Z",
        event: { kind: "run_reconciled", runStatus: "killed", reason: "daemon_restart" },
      },
    ];

    const code = await withFixedUuid([OPERATOR_SESSION_ID, SOLO_LIST_REQUEST_ID, streamId], () =>
      main(["run", "log", "run-123"], cap.io, {
        socketDiscovery: async () => [],
        connectIpcClient: connectAfterSoloOwnerList(SOLO_LIST_REQUEST_ID, [soloDaemonListRow("run-123")], () =>
          makeIpcClient(
            [
              { kind: "stream-data", streamId, payload: JSON.stringify(records[0]) },
              { kind: "stream-data", streamId, payload: JSON.stringify(records[1]) },
              { kind: "stream-data", streamId, payload: JSON.stringify(records[2]) },
              { kind: "stream-data", streamId, payload: JSON.stringify(records[3]) },
              { kind: "stream-end", streamId },
            ],
            { sent },
          ),
        ),
      }),
    );

    expect(code).toBe(0);
    expect(sent).toEqual([{ kind: "stream-open", streamId, payload: { runId: "run-123", afterSeq: 0 } }]);
    expect(cap.read()).toEqual({
      stdout: `${JSON.stringify(records[0])}\n${JSON.stringify(records[1])}\n${JSON.stringify(records[2])}\n${JSON.stringify(records[3])}\n`,
      stderr: "",
    });
  });

  test("run log sends no follow flag by default", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const streamId = "00000000-0000-4000-8000-000000000006";

    const code = await withFixedUuid([OPERATOR_SESSION_ID, SOLO_LIST_REQUEST_ID, streamId], () =>
      main(["run", "log", "run-123"], cap.io, {
        socketDiscovery: async () => [],
        connectIpcClient: connectAfterSoloOwnerList(SOLO_LIST_REQUEST_ID, [soloDaemonListRow("run-123")], () =>
          makeIpcClient([{ kind: "stream-end", streamId }], { sent }),
        ),
      }),
    );

    expect(code).toBe(0);
    expect(sent).toEqual([{ kind: "stream-open", streamId, payload: { runId: "run-123", afterSeq: 0 } }]);
  });

  test("run log --follow sends follow: true", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const streamId = "00000000-0000-4000-8000-000000000007";

    const code = await withFixedUuid([OPERATOR_SESSION_ID, SOLO_LIST_REQUEST_ID, streamId], () =>
      main(["run", "log", "run-123", "--follow"], cap.io, {
        socketDiscovery: async () => [],
        connectIpcClient: connectAfterSoloOwnerList(SOLO_LIST_REQUEST_ID, [soloDaemonListRow("run-123")], () =>
          makeIpcClient([{ kind: "stream-end", streamId }], { sent }),
        ),
      }),
    );

    expect(code).toBe(0);
    expect(sent).toEqual([{ kind: "stream-open", streamId, payload: { runId: "run-123", afterSeq: 0, follow: true } }]);
  });

  test("run log --follow exits when the daemon closes the stream", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const streamId = "00000000-0000-4000-8000-000000000009";
    const record = logRecord(1, "iteration_started");

    const code = await withFixedUuid([OPERATOR_SESSION_ID, SOLO_LIST_REQUEST_ID, streamId], () =>
      main(["run", "log", "run-123", "--follow"], cap.io, {
        socketDiscovery: async () => [],
        connectIpcClient: connectAfterSoloOwnerList(SOLO_LIST_REQUEST_ID, [soloDaemonListRow("run-123")], () =>
          makeIpcClient(
            [
              { kind: "stream-data", streamId, payload: JSON.stringify(record) },
              { kind: "stream-end", streamId },
            ],
            { sent },
          ),
        ),
      }),
    );

    expect(code).toBe(0);
    expect(sent).toEqual([{ kind: "stream-open", streamId, payload: { runId: "run-123", afterSeq: 0, follow: true } }]);
    expect(cap.read()).toEqual({ stdout: `${JSON.stringify(record)}\n`, stderr: "" });
  });

  test("run log --follow before the run id also sends follow: true", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const streamId = "00000000-0000-4000-8000-000000000008";

    const code = await withFixedUuid([OPERATOR_SESSION_ID, SOLO_LIST_REQUEST_ID, streamId], () =>
      main(["run", "log", "--follow", "run-123"], cap.io, {
        socketDiscovery: async () => [],
        connectIpcClient: connectAfterSoloOwnerList(SOLO_LIST_REQUEST_ID, [soloDaemonListRow("run-123")], () =>
          makeIpcClient([{ kind: "stream-end", streamId }], { sent }),
        ),
      }),
    );

    expect(code).toBe(0);
    expect(sent).toEqual([{ kind: "stream-open", streamId, payload: { runId: "run-123", afterSeq: 0, follow: true } }]);
  });

  test("run log rejects extra positional args", async () => {
    const cap = captureIo();
    const code = await main(["run", "log", "run-123", "extra"], cap.io, {});
    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("usage:");
  });

  test("run pause reports daemon success", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000005";

    const code = await withFixedUuid(requestId, () =>
      main(["run", "pause", "run-123"], cap.io, {
        connectIpcClient: async () => makeIpcClient([{ kind: "response", id: requestId, result: { ok: true } }]),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "paused run-123\n", stderr: "" });
  });

  test("run resume passes through terminal_run errors", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000006";

    const code = await withFixedUuid(requestId, () =>
      main(["run", "resume", "run-123"], cap.io, {
        connectIpcClient: async () =>
          makeIpcClient([
            { kind: "error", id: requestId, code: "terminal_run", message: "Cannot resume a completed run" },
          ]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "terminal_run: Cannot resume a completed run\n" });
  });

  test("run kill passes through unknown_run errors", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000007";

    const code = await withFixedUuid(requestId, () =>
      main(["run", "kill", "run-404"], cap.io, {
        connectIpcClient: async () =>
          makeIpcClient([{ kind: "error", id: requestId, code: "unknown_run", message: "Run run-404 not found" }]),
      }),
    );

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "unknown_run: Run run-404 not found\n" });
  });

  test("run-control commands print terse connection errors when the socket is unavailable", async () => {
    const cap = captureIo();

    const code = await main(["run", "list"], cap.io, {
      connectIpcClient: async () => {
        throw new Error("connect ENOENT /tmp/jarvis.sock");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "connect ENOENT /tmp/jarvis.sock\n" });
  });
});

describe("run list multi-daemon", () => {
  const INVOKING_SOCKET = "/jarvis/daemon-aaaa.sock";
  const OTHER_SOCKET = "/jarvis/daemon-bbbb.sock";

  type RunsBySocket = Record<
    string,
    Array<{ runId: string; project: string; branch: string; status: string; isLive: boolean }> | Error
  >;

  function listRow(runId: string, status: string, isLive: boolean) {
    return { runId, project: "demo", branch: "main", status, isLive };
  }

  function connectForList(requestId: string, runsBySocket: RunsBySocket, onConnect?: (socketPath: string) => void) {
    return async (socketPath: string) => {
      onConnect?.(socketPath);
      const runs = runsBySocket[socketPath];
      if (runs instanceof Error) throw runs;
      if (runs === undefined) throw new Error("unexpected socket");
      return makeIpcClient([{ kind: "response", id: requestId, result: { runs } }]);
    };
  }

  async function runList(
    requestId: string,
    options: { runsBySocket: RunsBySocket; discovery?: string[]; onConnect?: (socketPath: string) => void },
  ) {
    const cap = captureIo();
    const code = await withFixedUuid(requestId, () =>
      main(["run", "list"], cap.io, {
        socketPath: INVOKING_SOCKET,
        connectIpcClient: connectForList(requestId, options.runsBySocket, options.onConnect),
        socketDiscovery: async () => options.discovery ?? [OTHER_SOCKET],
      }),
    );
    return { code, cap, lines: () => cap.read().stdout.trimEnd().split("\n") };
  }

  test("run list aggregates runs from multiple live daemons", async () => {
    const connectAttempts: string[] = [];
    const { code, lines } = await runList("00000000-0000-4000-8000-000000000020", {
      runsBySocket: {
        [INVOKING_SOCKET]: [listRow("invoking-run", "completed", false)],
        [OTHER_SOCKET]: [listRow("other-run", "in-progress", true)],
      },
      onConnect: (socketPath) => connectAttempts.push(socketPath),
    });

    expect(code).toBe(0);
    expect(lines()).toHaveLength(2);
    expect(lines()[0]).toContain("invoking-run");
    expect(lines()[1]).toContain("other-run");
    expect(connectAttempts).toContain(INVOKING_SOCKET);
    expect(connectAttempts).toContain(OTHER_SOCKET);
  });

  test("run list dedupes by runId, preferring isLive=true", async () => {
    const { code, lines } = await runList("00000000-0000-4000-8000-000000000021", {
      runsBySocket: {
        [INVOKING_SOCKET]: [listRow("shared-run", "completed", false)],
        [OTHER_SOCKET]: [listRow("shared-run", "in-progress", true)],
      },
    });

    expect(code).toBe(0);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("shared-run");
    expect(lines()[0]).toContain("live");
  });

  test("run list skips unreachable sockets and lists remaining runs", async () => {
    const { code, lines } = await runList("00000000-0000-4000-8000-000000000022", {
      runsBySocket: {
        [INVOKING_SOCKET]: [listRow("invoking-run", "completed", false)],
        [OTHER_SOCKET]: new Error("ECONNREFUSED"),
      },
    });

    expect(code).toBe(0);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("invoking-run");
  });

  test("run list solo-daemon output unchanged when only invoking daemon is live", async () => {
    const { code, lines } = await runList("00000000-0000-4000-8000-000000000023", {
      runsBySocket: { [INVOKING_SOCKET]: [listRow("solo-run", "completed", false)] },
      discovery: [],
    });

    expect(code).toBe(0);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("solo-run");
  });

  test("run list sorts by runId", async () => {
    const { code, lines } = await runList("00000000-0000-4000-8000-000000000024", {
      runsBySocket: {
        [INVOKING_SOCKET]: [
          listRow("run-z", "completed", false),
          listRow("run-a", "completed", false),
          listRow("run-m", "completed", false),
        ],
      },
      discovery: [],
    });

    expect(code).toBe(0);
    expect(lines()).toHaveLength(3);
    expect(lines()[0]).toContain("run-a");
    expect(lines()[1]).toContain("run-m");
    expect(lines()[2]).toContain("run-z");
  });

  test("run list exits with first error when all sockets fail", async () => {
    const cap = captureIo();

    const code = await main(["run", "list"], cap.io, {
      socketPath: INVOKING_SOCKET,
      connectIpcClient: async (socketPath) => {
        if (socketPath === INVOKING_SOCKET) throw new Error("first error");
        throw new Error("second error");
      },
      socketDiscovery: async () => [OTHER_SOCKET],
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("first error");
  });

  const LIST_REQUEST_INVOKING = "00000000-0000-4000-8000-000000000030";
  const LIST_REQUEST_OTHER = "00000000-0000-4000-8000-000000000031";
  const STREAM_REQUEST_ID = "00000000-0000-4000-8000-000000000032";
  const LIST_IDS: [string, string] = [LIST_REQUEST_INVOKING, LIST_REQUEST_OTHER];

  function runsForRemoteOwner(runId: string): RunsBySocket {
    return {
      [INVOKING_SOCKET]: [],
      [OTHER_SOCKET]: [listRow(runId, "in-progress", true)],
    };
  }

  function connectForTwoListsThen(
    listIds: [string, string],
    runsBySocket: RunsBySocket,
    connectSockets: string[],
    then: (socketPath: string) => ReturnType<typeof makeIpcClient> | Promise<ReturnType<typeof makeIpcClient>>,
  ) {
    let connectCount = 0;
    return async (socketPath: string) => {
      connectCount += 1;
      connectSockets.push(socketPath);
      const runs = runsBySocket[socketPath];
      if (runs instanceof Error) throw runs;
      if (runs === undefined) throw new Error(`unexpected socket: ${socketPath}`);
      if (connectCount <= 2) {
        const id = connectCount === 1 ? listIds[0] : listIds[1];
        return makeIpcClient([{ kind: "response", id, result: { runs } }]);
      }
      return then(socketPath);
    };
  }

  test("run log streams a run owned by a non-invoking live daemon", async () => {
    // Inversion target: resolveRunOwnerSocket in run.ts — using deps.socketPath without cross-daemon owner lookup turns this test RED.
    const cap = captureIo();
    const sent: unknown[] = [];
    const connectSockets: string[] = [];
    const record = logRecord(1, "iteration_started");
    record.runId = "remote-run";

    const code = await withFixedUuid(
      [OPERATOR_SESSION_ID, LIST_REQUEST_INVOKING, LIST_REQUEST_OTHER, STREAM_REQUEST_ID],
      () =>
        main(["run", "log", "remote-run"], cap.io, {
          socketPath: INVOKING_SOCKET,
          socketDiscovery: async () => [OTHER_SOCKET],
          connectIpcClient: connectForTwoListsThen(
            LIST_IDS,
            runsForRemoteOwner("remote-run"),
            connectSockets,
            (socketPath) => {
              if (socketPath !== OTHER_SOCKET) {
                throw new Error(`stream must use owner socket, got ${socketPath}`);
              }
              return makeIpcClient(
                [
                  { kind: "stream-data", streamId: STREAM_REQUEST_ID, payload: JSON.stringify(record) },
                  { kind: "stream-end", streamId: STREAM_REQUEST_ID },
                ],
                { sent },
              );
            },
          ),
        }),
    );

    expect(code).toBe(0);
    expect(connectSockets).toEqual([INVOKING_SOCKET, OTHER_SOCKET, OTHER_SOCKET]);
    expect(sent).toEqual([
      { kind: "stream-open", streamId: STREAM_REQUEST_ID, payload: { runId: "remote-run", afterSeq: 0 } },
    ]);
    expect(cap.read().stdout).toBe(`${JSON.stringify(record)}\n`);
  });

  test("run log falls back to invoking socket when run is absent everywhere", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const connectSockets: string[] = [];
    const emptyEverywhere: RunsBySocket = {
      [INVOKING_SOCKET]: [],
      [OTHER_SOCKET]: [],
    };

    const code = await withFixedUuid(
      [OPERATOR_SESSION_ID, LIST_REQUEST_INVOKING, LIST_REQUEST_OTHER, STREAM_REQUEST_ID],
      () =>
        main(["run", "log", "run-404"], cap.io, {
          socketPath: INVOKING_SOCKET,
          socketDiscovery: async () => [OTHER_SOCKET],
          connectIpcClient: connectForTwoListsThen(LIST_IDS, emptyEverywhere, connectSockets, (socketPath) => {
            if (socketPath !== INVOKING_SOCKET) {
              throw new Error(`stream must use invoking socket, got ${socketPath}`);
            }
            return makeIpcClient([{ kind: "stream-end", streamId: STREAM_REQUEST_ID }], { sent });
          }),
        }),
    );

    expect(code).toBe(0);
    expect(connectSockets).toEqual([INVOKING_SOCKET, OTHER_SOCKET, INVOKING_SOCKET]);
    expect(sent).toEqual([
      { kind: "stream-open", streamId: STREAM_REQUEST_ID, payload: { runId: "run-404", afterSeq: 0 } },
    ]);
    expect(cap.read().stdout).toBe("");
  });

  test("run wait resolves a run owned by a non-invoking live daemon", async () => {
    // Inversion target: resolveRunOwnerSocket in run.ts — using deps.socketPath without cross-daemon owner lookup turns this test RED.
    const cap = captureIo();
    const sent: unknown[] = [];
    const connectSockets: string[] = [];

    const code = await withFixedUuid(
      [OPERATOR_SESSION_ID, LIST_REQUEST_INVOKING, LIST_REQUEST_OTHER, WAIT_REQUEST_ID],
      () =>
        main(["run", "wait", "remote-run"], cap.io, {
          socketPath: INVOKING_SOCKET,
          socketDiscovery: async () => [OTHER_SOCKET],
          connectIpcClient: connectForTwoListsThen(
            LIST_IDS,
            runsForRemoteOwner("remote-run"),
            connectSockets,
            (socketPath) => {
              if (socketPath !== OTHER_SOCKET) {
                throw new Error(`wait must use owner socket, got ${socketPath}`);
              }
              return makeIpcClient(
                [
                  waitResponse({
                    runStatus: "completed",
                    loopOutcomeKind: "complete",
                    iterationsConsumed: 1,
                    resumable: false,
                  }),
                ],
                { sent },
              );
            },
          ),
        }),
    );

    expect(code).toBe(0);
    expect(connectSockets).toEqual([INVOKING_SOCKET, OTHER_SOCKET, OTHER_SOCKET]);
    expect(sent).toEqual([{ kind: "request", id: WAIT_REQUEST_ID, method: "wait", params: { runId: "remote-run" } }]);
    expect(cap.read().stdout).toBe(
      '{"runStatus":"completed","loopOutcomeKind":"complete","iterationsConsumed":1,"resumable":false}\n',
    );
  });

  const UNREACHABLE_DAEMON_ERROR = "connect ENOENT /tmp/jarvis.sock";

  test("run log prints terse connection errors when no daemon is reachable", async () => {
    const cap = captureIo();

    const code = await main(["run", "log", "run-123"], cap.io, {
      socketPath: INVOKING_SOCKET,
      socketDiscovery: async () => [OTHER_SOCKET],
      connectIpcClient: async () => {
        throw new Error(UNREACHABLE_DAEMON_ERROR);
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: `${UNREACHABLE_DAEMON_ERROR}\n` });
  });

  test("run wait prints terse connection errors when no daemon is reachable", async () => {
    const cap = captureIo();

    const code = await main(["run", "wait", "run-123"], cap.io, {
      socketPath: INVOKING_SOCKET,
      socketDiscovery: async () => [OTHER_SOCKET],
      connectIpcClient: async () => {
        throw new Error(UNREACHABLE_DAEMON_ERROR);
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: `${UNREACHABLE_DAEMON_ERROR}\n` });
  });
});

describe("run control", () => {
  test("run list renders surviving-mutation columns independently and omits them when absent", async () => {
    const { code, rows } = await runSoloList([
      {
        runId: "mutation",
        project: "demo",
        branch: "main",
        status: "failed",
        isLive: false,
        error: {
          reason: "surviving_mutation_failed",
          retryable: true,
          nextAction: "resume",
          survivingMutation: "operator-flip",
          survivingMutationSourceFile: "src/guard.ts",
          survivingMutationSourceLine: 17,
        },
      },
      { runId: "plain", project: "demo", branch: "main", status: "completed", isLive: false },
    ]);

    expect(code).toBe(0);
    const [mutation, plain] = rows();
    expect(mutation?.[10]).toBe("operator-flip");
    expect(mutation?.[11]).toBe("src/guard.ts");
    expect(mutation?.[12]).toBe("17");
    expect(plain?.[10]).toBe("-");
    expect(plain?.[11]).toBe("-");
    expect(plain?.[12]).toBe("-");
  });

  test("run list renders completionCommitError in trailing column after prUrl", async () => {
    const { code, row } = await runSoloList([
      {
        runId: "shrink",
        project: "demo",
        branch: "main",
        status: "failed",
        isLive: false,
        prNumber: 42,
        prUrl: "https://github.com/demo/pull/42",
        error: {
          reason: "completion_commit_failed",
          retryable: true,
          nextAction: "resume",
          completionCommitError: COMPLETION_COMMIT_ERROR_MSG,
        },
      },
    ]);

    expect(code).toBe(0);
    expect(row()[13]).toBe("42");
    expect(row()[14]).toBe("https://github.com/demo/pull/42");
    expect(row()[15]).toBe(JSON.stringify(COMPLETION_COMMIT_ERROR_MSG));
    // @mutate v2/src/commands/run.ts "e?.completionCommitError === undefined ? \"-\" : JSON.stringify(e.completionCommitError)," -> "\"-\","
  });

  test("run list renders trailing completionCommitError column as - when absent", async () => {
    const { code, row } = await runSoloList([
      { runId: "plain", project: "demo", branch: "main", status: "completed", isLive: false },
    ]);

    expect(code).toBe(0);
    expect(row()[15]).toBe("-");
    // @mutate v2/src/commands/run.ts "e?.completionCommitError === undefined ? \"-\" : JSON.stringify(e.completionCommitError)," -> "JSON.stringify(e?.completionCommitError ?? \"-\"),"
  });

  test("run list confines tab and newline completionCommitError to trailing column", async () => {
    const completionCommitError = "line1\nline2\tcol";
    const { code, stdout, row } = await runSoloList([
      {
        runId: "shrink",
        project: "demo",
        branch: "main",
        status: "failed",
        isLive: false,
        error: {
          reason: "completion_commit_failed",
          retryable: true,
          nextAction: "resume",
          completionCommitError,
        },
      },
    ]);

    expect(code).toBe(0);
    expect(stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(row()[15]).toBe(JSON.stringify(completionCommitError));
    // @mutate v2/src/commands/run.ts "e?.completionCommitError === undefined ? \"-\" : JSON.stringify(e.completionCommitError)," -> "e?.completionCommitError ?? \"-\","
  });

  test("run wait passes through error.completionCommitError for completion_commit_failed", async () => {
    const cap = captureIo();
    const code = await runWait(cap, "run-shrink", [
      waitResponse({
        runStatus: "failed",
        loopOutcomeKind: "completion_commit_failed",
        resumable: true,
        error: {
          reason: "completion_commit_failed",
          retryable: true,
          nextAction: "resume",
          completionCommitError: COMPLETION_COMMIT_ERROR_MSG,
        },
      }),
    ]);

    expect(code).toBe(1);
    const parsed = JSON.parse(cap.read().stdout.trimEnd()) as {
      error?: { completionCommitError?: string };
    };
    expect(parsed.error?.completionCommitError).toBe(COMPLETION_COMMIT_ERROR_MSG);
    // @mutate v2/src/cli/run-completion.ts "if (result.error !== undefined) payload.error = result.error;" -> ""
  });

  test("run wait missing run ID prints run-control usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["run", "wait"], cap.io);

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain("usage: jarvis run");
    expect(cap.read().stderr).toContain("wait");
  });

  test("run wait sends one IPC wait request and prints minified JSON", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await runWait(
      cap,
      "run-123",
      [
        waitResponse({
          runStatus: "completed",
          loopOutcomeKind: "complete",
          iterationsConsumed: 2,
          resumable: false,
        }),
      ],
      sent,
    );

    expect(code).toBe(0);
    expect(sent).toEqual([
      {
        kind: "request",
        id: WAIT_REQUEST_ID,
        method: "wait",
        params: { runId: "run-123" },
      },
    ]);
    expect(cap.read()).toEqual({
      stdout: '{"runStatus":"completed","loopOutcomeKind":"complete","iterationsConsumed":2,"resumable":false}\n',
      stderr: "",
    });
    expect(cap.read().stdout).not.toContain('"error"');
  });

  test.each([
    [{ runStatus: "completed", loopOutcomeKind: "complete" }, 0],
    [{ runStatus: "failed", loopOutcomeKind: "complete" }, 0],
    [{ runStatus: "blocked", loopOutcomeKind: "blocked" }, 1],
    [{ runStatus: "blocked", loopOutcomeKind: "contract_miss" }, 1],
    [{ runStatus: "paused", loopOutcomeKind: "paused" }, 1],
    [{ runStatus: "in-progress", loopOutcomeKind: "progress" }, 1],
    [{ runStatus: "failed", loopOutcomeKind: "invocation_failure" }, 2],
    [{ runStatus: "failed", loopOutcomeKind: "iteration_timeout" }, 1],
    [{ runStatus: "completed", loopOutcomeKind: "ready_gate_failed" }, 1],
    [{ runStatus: "completed", loopOutcomeKind: "ready_gate_out_of_scope" }, 1],
    [{ runStatus: "completed", loopOutcomeKind: "ready_flip_failed" }, 1],
    [{ runStatus: "budget-soft-stopped", loopOutcomeKind: "budget-exhausted" }, 5],
    [{ runStatus: "failed" }, 3],
    [{ runStatus: "killed" }, 4],
    [{ runStatus: "budget-soft-stopped" }, 5],
    [{ runStatus: "completed" }, 1],
    [{ runStatus: "blocked" }, 1],
  ] as const)("run wait maps %p to exit %i", async (result, expectedExit) => {
    const cap = captureIo();

    const code = await runWait(cap, "run-123", [waitResponse(result)]);

    expect(code).toBe(expectedExit);
    if (!("loopOutcomeKind" in result)) {
      expect(cap.read().stdout).toBe(`${JSON.stringify({ runStatus: result.runStatus })}\n`);
    }
  });

  test("run wait passes through unknown_run errors", async () => {
    const cap = captureIo();

    const code = await runWait(cap, "run-404", [waitError("unknown_run", "Run run-404 not found")], [], []);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "unknown_run: Run run-404 not found\n" });
  });
});
