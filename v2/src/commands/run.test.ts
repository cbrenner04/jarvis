import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DaemonAlreadyRunningError } from "../daemon/daemon-lifecycle.ts";
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

describe("matching-daemon dispatch", () => {
  test("start reuses the same-key daemon race winner and dispatches without status or legacy IPC", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const sockets: string[] = [];
    const code = await withFixedUuid("start", () =>
      main(fx.runStartArgs, cap.io, {
        loadAgentModelConfig: stubAgentModelConfig,
        getExecutableDigest: async () => "new-digest",
        startDaemon: async () => {
          throw new DaemonAlreadyRunningError("same-key.sock");
        },
        connectIpcClient: async (socketPath) => {
          sockets.push(socketPath);
          return makeIpcClient([{ kind: "response", id: "start", result: { runId: "run-keyed" } }], { sent });
        },
      }),
    );

    expect(code).toBe(0);
    expect(sockets).toEqual([expect.stringContaining("jarvis-new-digest.sock")]);
    expect(sockets.join(" ")).not.toContain(" daemon.sock");
    expect(sent.map((frame) => (frame as { method?: string }).method)).toEqual(["start"]);
  });

  test("start propagates a non-race lifecycle error without IPC", async () => {
    const cap = captureIo();
    let connected = false;
    const code = await main(fx.runStartArgs, cap.io, {
      loadAgentModelConfig: stubAgentModelConfig,
      startDaemon: async () => {
        throw new Error("daemon start failed");
      },
      connectIpcClient: async () => {
        connected = true;
        return makeIpcClient([]);
      },
    });

    expect(code).toBe(1);
    expect(connected).toBe(false);
    expect(cap.read().stderr).toContain("daemon start failed");
  });

  test("list and wait connect only to the invoking executable's keyed daemon", async () => {
    const sockets: string[] = [];
    const list = captureIo();
    const wait = captureIo();
    const connect = async (socketPath: string) => {
      sockets.push(socketPath);
      return makeIpcClient([
        {
          kind: "response",
          id: WAIT_REQUEST_ID,
          result: { runStatus: "completed", loopOutcomeKind: "complete" },
        },
      ]);
    };

    const listCode = await withFixedUuid("list", () =>
      main(["run", "list"], list.io, {
        getExecutableDigest: async () => "selected",
        connectIpcClient: async (socketPath) => {
          sockets.push(socketPath);
          return makeIpcClient([{ kind: "response", id: "list", result: { runs: [] } }]);
        },
      }),
    );
    const waitCode = await withFixedUuid(WAIT_REQUEST_ID, () =>
      main(["run", "wait", "run-123"], wait.io, {
        getExecutableDigest: async () => "selected",
        connectIpcClient: connect,
      }),
    );

    expect(listCode).toBe(0);
    expect(waitCode).toBe(0);
    expect(sockets).toEqual([
      expect.stringContaining("jarvis-selected.sock"),
      expect.stringContaining("jarvis-selected.sock"),
    ]);
    expect(sockets.join(" ")).not.toContain(" daemon.sock");
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
