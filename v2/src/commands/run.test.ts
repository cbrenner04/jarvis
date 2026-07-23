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

function waitResponse(result: unknown): unknown {
  return { kind: "response", id: WAIT_REQUEST_ID, result };
}

function waitError(code: string, message: string): unknown {
  return { kind: "error", id: WAIT_REQUEST_ID, code, message };
}

async function runWait(
  cap: ReturnType<typeof captureIo>,
  runId: string,
  frames: unknown[],
  sent: unknown[] = [],
): Promise<number> {
  return withFixedUuid(WAIT_REQUEST_ID, () =>
    main(["run", "wait", runId], cap.io, {
      connectIpcClient: async () => makeIpcClient(frames, { sent }),
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

    const code = await withFixedUuid(streamId, () =>
      main(["run", "log", "run-123"], cap.io, {
        connectIpcClient: async () =>
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
      }),
    );

    expect(code).toBe(0);
    expect(sent).toEqual([{ kind: "stream-open", streamId, payload: { runId: "run-123" } }]);
    expect(cap.read()).toEqual({
      stdout: `${JSON.stringify(records[0])}\n${JSON.stringify(records[1])}\n${JSON.stringify(records[2])}\n${JSON.stringify(records[3])}\n`,
      stderr: "",
    });
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

  test("run list renders surviving-mutation columns independently and omits them when absent", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000011";
    const code = await withFixedUuid(requestId, () =>
      main(["run", "list"], cap.io, {
        connectIpcClient: async () =>
          makeIpcClient([
            {
              kind: "response",
              id: requestId,
              result: {
                runs: [
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
                ],
              },
            },
          ]),
      }),
    );

    expect(code).toBe(0);
    const [mutation, plain] = cap
      .read()
      .stdout.trimEnd()
      .split("\n")
      .map((row) => row.split("\t"));
    expect(mutation?.[10]).toBe("operator-flip");
    expect(mutation?.[11]).toBe("src/guard.ts");
    expect(mutation?.[12]).toBe("17");
    expect(plain?.[10]).toBe("-");
    expect(plain?.[11]).toBe("-");
    expect(plain?.[12]).toBe("-");
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

    const code = await runWait(cap, "run-404", [waitError("unknown_run", "Run run-404 not found")]);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "unknown_run: Run run-404 not found\n" });
  });
});

describe("multi-daemon run list", () => {
  const DAEMON_A = "/keyed/daemon-a.sock";
  const DAEMON_B = "/keyed/daemon-b.sock";

  test("run list includes a run live on the non-invoking daemon", async () => {
    const cap = captureIo();
    const connectPaths: string[] = [];

    // 3 UUIDs: one for operatorSessionId in cli.ts, then one for each RPC request
    const code = await withFixedUuid(["operator", "daemon-a", "daemon-b"], () =>
      main(["run", "list"], cap.io, {
        socketPath: DAEMON_A,
        socketDiscovery: async () => [DAEMON_B],
        connectIpcClient: async (socketPath) => {
          connectPaths.push(socketPath);
          if (socketPath === DAEMON_A) {
            return makeIpcClient([{ kind: "response", id: "daemon-a", result: { runs: [] } }]);
          }
          if (socketPath === DAEMON_B) {
            return makeIpcClient([
              {
                kind: "response",
                id: "daemon-b",
                result: {
                  runs: [
                    {
                      runId: "run-on-b",
                      project: "demo",
                      branch: "main",
                      status: "in-progress",
                      isLive: true,
                    },
                  ],
                },
              },
            ]);
          }
          throw new Error("unknown socket");
        },
      }),
    );

    expect(code).toBe(0);
    expect(connectPaths).toEqual([DAEMON_A, DAEMON_B]);
    expect(cap.read().stdout).toContain("run-on-b");
  });

  test("run list dedupes duplicate rows and prefers isLive owner", async () => {
    const cap = captureIo();
    const uuids = ["op", "uuid0", "uuid1"];

    const code = await withFixedUuid(uuids, () =>
      main(["run", "list"], cap.io, {
        socketPath: DAEMON_A,
        socketDiscovery: async () => [DAEMON_B],
        connectIpcClient: async (socketPath) => {
          if (socketPath === DAEMON_A) {
            return makeIpcClient([
              {
                kind: "response",
                id: uuids[1],
                result: {
                  runs: [
                    {
                      runId: "shared-run",
                      project: "demo",
                      branch: "main",
                      status: "completed",
                      isLive: false,
                    },
                  ],
                },
              },
            ]);
          }
          if (socketPath === DAEMON_B) {
            return makeIpcClient([
              {
                kind: "response",
                id: uuids[2],
                result: {
                  runs: [
                    {
                      runId: "shared-run",
                      project: "demo",
                      branch: "main",
                      status: "completed",
                      isLive: true,
                    },
                  ],
                },
              },
            ]);
          }
          throw new Error("unknown socket");
        },
      }),
    );

    expect(code).toBe(0);
    const output = cap.read().stdout;
    const rows = output.trimEnd().split("\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("shared-run");
    expect(rows[0]).toContain("live");
  });

  test("run list skips an unreachable socket and lists remaining daemons", async () => {
    const cap = captureIo();
    const connectAttempts: string[] = [];
    const uuid = "00000000-0000-4000-8000-000000000021";

    const code = await withFixedUuid(uuid, () =>
      main(["run", "list"], cap.io, {
        socketPath: DAEMON_A,
        socketDiscovery: async () => [DAEMON_B],
        connectIpcClient: async (socketPath) => {
          connectAttempts.push(socketPath);
          if (socketPath === DAEMON_B) {
            throw new Error("ECONNREFUSED");
          }
          if (socketPath === DAEMON_A) {
            return makeIpcClient([
              {
                kind: "response",
                id: uuid,
                result: {
                  runs: [
                    {
                      runId: "run-a",
                      project: "demo",
                      branch: "main",
                      status: "in-progress",
                      isLive: true,
                    },
                  ],
                },
              },
            ]);
          }
          throw new Error("unknown socket");
        },
      }),
    );

    expect(code).toBe(0);
    expect(connectAttempts.toSorted()).toEqual([DAEMON_A, DAEMON_B]);
    const output = cap.read().stdout;
    expect(output).toContain("run-a");
  });

  test("run list output is byte-identical when only invoking daemon is live", async () => {
    const cap = captureIo();
    const uuid = "00000000-0000-4000-8000-000000000031";

    const code = await withFixedUuid(uuid, () =>
      main(["run", "list"], cap.io, {
        socketPath: DAEMON_A,
        socketDiscovery: async () => [],
        connectIpcClient: async (socketPath) => {
          if (socketPath === DAEMON_A) {
            return makeIpcClient([
              {
                kind: "response",
                id: uuid,
                result: {
                  runs: [
                    {
                      runId: "run-solo",
                      project: "demo",
                      branch: "main",
                      status: "completed",
                      isLive: false,
                    },
                  ],
                },
              },
            ]);
          }
          throw new Error("unexpected socket");
        },
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("run-solo");
  });

  test("run list always includes invoking socket when discovery returns empty", async () => {
    const cap = captureIo();
    const connectPaths: string[] = [];
    const uuid = "00000000-0000-4000-8000-000000000041";

    const code = await withFixedUuid(uuid, () =>
      main(["run", "list"], cap.io, {
        socketPath: DAEMON_A,
        socketDiscovery: async () => [],
        connectIpcClient: async (socketPath) => {
          connectPaths.push(socketPath);
          return makeIpcClient([
            {
              kind: "response",
              id: uuid,
              result: { runs: [] },
            },
          ]);
        },
      }),
    );

    expect(code).toBe(0);
    expect(connectPaths).toEqual([DAEMON_A]);
  });

  test("run list skips all sockets but reports first error when all fail", async () => {
    const cap = captureIo();

    const code = await withFixedUuid("00000000-0000-4000-8000-000000000051", () =>
      main(["run", "list"], cap.io, {
        socketPath: DAEMON_A,
        socketDiscovery: async () => [DAEMON_B],
        connectIpcClient: async (socketPath) => {
          if (socketPath === DAEMON_A) {
            throw new Error("ECONNREFUSED");
          }
          if (socketPath === DAEMON_B) {
            throw new Error("timeout");
          }
          throw new Error("unknown socket");
        },
      }),
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe("ECONNREFUSED\n");
  });

  test("read-only run list reports the missing daemon instead of starting one", async () => {
    const cap = captureIo();
    let started = 0;

    const code = await withFixedUuid("00000000-0000-4000-8000-000000000061", () =>
      main(["run", "list"], cap.io, {
        socketPath: DAEMON_A,
        socketDiscovery: async () => [],
        connectIpcClient: async () => {
          throw new Error("ECONNREFUSED");
        },
        startDaemon: async () => {
          started += 1;
          return { pid: 7, socketPath: DAEMON_A };
        },
      }),
    );

    expect(code).toBe(1);
    expect(started).toBe(0);
    expect(cap.read().stderr).toBe("ECONNREFUSED\n");
  });

  test("run list sorts results by runId for stable output", async () => {
    const cap = captureIo();
    const uuids = ["op", "id0", "id1"];

    const code = await withFixedUuid(uuids, () =>
      main(["run", "list"], cap.io, {
        socketPath: DAEMON_A,
        socketDiscovery: async () => [DAEMON_B],
        connectIpcClient: async (socketPath) => {
          if (socketPath === DAEMON_A) {
            return makeIpcClient([
              {
                kind: "response",
                id: uuids[1],
                result: {
                  runs: [
                    {
                      runId: "a-run",
                      project: "demo",
                      branch: "main",
                      status: "in-progress",
                      isLive: true,
                    },
                  ],
                },
              },
            ]);
          }
          if (socketPath === DAEMON_B) {
            return makeIpcClient([
              {
                kind: "response",
                id: uuids[2],
                result: {
                  runs: [
                    {
                      runId: "z-run",
                      project: "demo",
                      branch: "main",
                      status: "completed",
                      isLive: false,
                    },
                  ],
                },
              },
            ]);
          }
          throw new Error("unknown socket");
        },
      }),
    );

    expect(code).toBe(0);
    const output = cap.read().stdout;
    const rows = output
      .trimEnd()
      .split("\n")
      .filter((r) => r !== "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("a-run");
    expect(rows[1]).toContain("z-run");
  });

  test("run list with --since filters across all daemons", async () => {
    const cap = captureIo();
    const uuids = ["00000000-0000-4000-8000-000000000081", "00000000-0000-4000-8000-000000000082"];
    let requestsMadeToA = 0;
    let requestsMadeToB = 0;

    const code = await withFixedUuid(uuids, () =>
      main(["run", "list", "--since", "1000"], cap.io, {
        socketPath: DAEMON_A,
        socketDiscovery: async () => [DAEMON_B],
        connectIpcClient: async (socketPath) => {
          if (socketPath === DAEMON_B) {
            requestsMadeToB += 1;
            return makeIpcClient([
              {
                kind: "response",
                id: uuids[0],
                result: { runs: [] },
              },
            ]);
          }
          if (socketPath === DAEMON_A) {
            requestsMadeToA += 1;
            return makeIpcClient([
              {
                kind: "response",
                id: uuids[1],
                result: { runs: [] },
              },
            ]);
          }
          throw new Error("unknown socket");
        },
      }),
    );

    expect(code).toBe(0);
    expect(requestsMadeToA).toBe(1);
    expect(requestsMadeToB).toBe(1);
  });

  test("guard: removing isLive preference fails the dedup test", async () => {
    const cap = captureIo();
    const uuids = ["op", "a", "b"];

    const code = await withFixedUuid(uuids, () =>
      main(["run", "list"], cap.io, {
        socketPath: DAEMON_A,
        socketDiscovery: async () => [DAEMON_B],
        connectIpcClient: async (socketPath) => {
          if (socketPath === DAEMON_A) {
            return makeIpcClient([
              {
                kind: "response",
                id: uuids[1],
                result: {
                  runs: [
                    {
                      runId: "dup-run",
                      project: "demo",
                      branch: "main",
                      status: "completed",
                      isLive: false,
                    },
                  ],
                },
              },
            ]);
          }
          if (socketPath === DAEMON_B) {
            return makeIpcClient([
              {
                kind: "response",
                id: uuids[2],
                result: {
                  runs: [
                    {
                      runId: "dup-run",
                      project: "demo",
                      branch: "main",
                      status: "in-progress",
                      isLive: true,
                    },
                  ],
                },
              },
            ]);
          }
          throw new Error("unknown socket");
        },
      }),
    );

    expect(code).toBe(0);
    const output = cap.read().stdout;
    const rows = output.trimEnd().split("\n");
    expect(rows).toHaveLength(1);
    const rowColumns = rows[0]?.split("\t");
    if (rowColumns !== undefined) {
      expect(rowColumns[4]).toBe("live");
    }
  });

  test("guard: removing invoking socket inclusion fails when discovery returns only others", async () => {
    const cap = captureIo();
    const connectPaths: string[] = [];
    const uuids = ["op", "a", "b"];

    const code = await withFixedUuid(uuids, () =>
      main(["run", "list"], cap.io, {
        socketPath: DAEMON_A,
        socketDiscovery: async () => [DAEMON_B],
        connectIpcClient: async (socketPath) => {
          connectPaths.push(socketPath);
          if (socketPath === DAEMON_A) {
            return makeIpcClient([
              {
                kind: "response",
                id: uuids[1],
                result: { runs: [] },
              },
            ]);
          }
          if (socketPath === DAEMON_B) {
            return makeIpcClient([
              {
                kind: "response",
                id: uuids[2],
                result: { runs: [] },
              },
            ]);
          }
          throw new Error("unknown socket");
        },
      }),
    );

    expect(code).toBe(0);
    expect(connectPaths).toContain(DAEMON_A);
    expect(connectPaths).toContain(DAEMON_B);
  });
});
