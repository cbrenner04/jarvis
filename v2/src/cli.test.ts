import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./cli.ts";
import type { IpcClient } from "./ipc/client.ts";
import type { PersistedRecord } from "./log-stream.ts";
import { simulatedBindings } from "./testing/bindings.ts";
import type { WriteLoopInput, WriteLoopResult } from "./write-loop.ts";

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: (s: string) => {
        stderr += s;
      },
    },
    read: () => ({ stdout, stderr }),
  };
}

function tempPaths() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-cli-test-"));
  return {
    socketPath: join(dir, "daemon.sock"),
    pidPath: join(dir, "daemon.pid"),
  };
}

const WRITE_ARGS = [
  "write",
  "--project-root",
  "/tmp/repo",
  "--project",
  "demo",
  "--branch",
  "write-run",
  "--base",
  "HEAD",
  "--spec",
  "spec.md",
  "--artifact",
  "proof.txt",
];

const RUN_START_ARGS = [
  "run",
  "start",
  "--project-root",
  "/tmp/repo",
  "--project",
  "demo",
  "--branch",
  "write-run",
  "--base",
  "HEAD",
  "--spec",
  "spec.md",
  "--artifact",
  "proof.txt",
];

function completeResult(): WriteLoopResult {
  return {
    kind: "complete",
    runId: "run-123",
    iterationsConsumed: 1,
    resumable: false,
  };
}

function makeClient(frames: Array<unknown>, sent: unknown[] = []): IpcClient {
  let index = 0;
  return {
    send(frame: unknown): void {
      sent.push(frame);
    },
    async nextFrame(): Promise<any> {
      if (index < frames.length) {
        const frame = frames[index];
        index += 1;
        return frame;
      }
      throw new Error("connection closed");
    },
    close(): void {},
  };
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

describe("v2 cli", () => {
  test("no args prints v2 boundary message and exits 0", async () => {
    const cap = captureIo();

    const code = await main([], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "v2 not ready\n", stderr: "" });
  });

  test("--version prints package version and exits 0", async () => {
    const cap = captureIo();

    const code = await main(["--version"], cap.io);

    expect(code).toBe(0);
    expect(cap.read().stderr).toBe("");
    expect(cap.read().stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  test("missing required write args prints usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["write", "--project", "demo"], cap.io);

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain("usage: jarvis write");
  });

  test("unknown write args print usage and exit 1", async () => {
    const cap = captureIo();

    const code = await main([...WRITE_ARGS, "--unknown", "x"], cap.io);

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain("usage: jarvis write");
  });

  test("write command maps complete result to exit 0", async () => {
    const cap = captureIo();

    const code = await main(WRITE_ARGS, cap.io, {
      executeWriteLoop: async () => completeResult(),
    });

    expect(code).toBe(0);
    expect(cap.read().stderr).toBe("");
    expect(cap.read().stdout).toContain('"kind": "complete"');
  });

  test("write command maps blocked result to exit 1", async () => {
    const cap = captureIo();
    const result: WriteLoopResult = {
      kind: "blocked",
      runId: "run-456",
      iterationsConsumed: 1,
      resumable: false,
    };

    const code = await main(WRITE_ARGS, cap.io, {
      executeWriteLoop: async () => result,
    });

    expect(code).toBe(1);
    expect(cap.read().stdout).toContain('"kind": "blocked"');
  });

  test("write command maps invocation_failure to exit 2", async () => {
    const cap = captureIo();
    const result: WriteLoopResult = {
      kind: "invocation_failure",
      runId: "run-789",
      iterationsConsumed: 0,
      resumable: false,
    };

    const code = await main(WRITE_ARGS, cap.io, {
      executeWriteLoop: async () => result,
    });

    expect(code).toBe(2);
    expect(cap.read().stdout).toContain('"kind": "invocation_failure"');
  });

  test("write command maps budget-exhausted to exit 5", async () => {
    const cap = captureIo();
    const result: WriteLoopResult = {
      kind: "budget-exhausted",
      runId: "run-999",
      iterationsConsumed: 5,
      resumable: true,
    };

    const code = await main(WRITE_ARGS, cap.io, {
      executeWriteLoop: async () => result,
    });

    expect(code).toBe(5);
    expect(cap.read().stdout).toContain('"kind": "budget-exhausted"');
  });

  test("forwards parsed agents to the injected binding factory", async () => {
    const cap = captureIo();
    let capturedAgents: readonly string[] | undefined;
    let capturedInput: WriteLoopInput | undefined;

    const code = await main([...WRITE_ARGS, "--agents", "claude,codex"], cap.io, {
      createBindings: (agentIds) => {
        capturedAgents = agentIds;
        return simulatedBindings(["done"]);
      },
      executeWriteLoop: async (input) => {
        capturedInput = input;
        return completeResult();
      },
    });

    expect(code).toBe(0);
    expect(capturedAgents).toEqual(["claude", "codex"]);
    expect(capturedInput?.bindings).toHaveLength(1);
  });

  test("defaults to the claude agent when --agents is omitted", async () => {
    const cap = captureIo();
    let capturedAgents: readonly string[] | undefined;

    await main(WRITE_ARGS, cap.io, {
      createBindings: (agentIds) => {
        capturedAgents = agentIds;
        return simulatedBindings(["done"]);
      },
      executeWriteLoop: async () => completeResult(),
    });

    expect(capturedAgents).toEqual(["claude"]);
  });

  test("default binding factory yields not-wired error bindings", async () => {
    const cap = captureIo();
    let captured: WriteLoopInput | undefined;

    await main(WRITE_ARGS, cap.io, {
      executeWriteLoop: async (input) => {
        captured = input;
        return completeResult();
      },
    });

    expect(captured?.bindings).toHaveLength(1);
    expect(captured?.bindings[0]?.invoke({ prompt: "p", cwd: "/tmp" })).resolves.toMatchObject({ kind: "error" });
  });

  test("daemon start uses injected production paths and prints metadata", async () => {
    const cap = captureIo();
    const paths = tempPaths();
    let called: { socketPath: string; pidPath: string } | undefined;

    const code = await main(["daemon", "start"], cap.io, {
      socketPath: paths.socketPath,
      pidPath: paths.pidPath,
      startDaemon: async (socketPath, options) => {
        called = { socketPath, pidPath: options?.pidPath ?? "" };
        return { pid: 42, socketPath };
      },
      executeWriteLoop: async () => {
        throw new Error("write loop should not run");
      },
    });

    expect(code).toBe(0);
    expect(called).toEqual({ socketPath: paths.socketPath, pidPath: paths.pidPath });
    expect(cap.read()).toEqual({
      stdout: `${JSON.stringify({ pid: 42, socketPath: paths.socketPath })}\n`,
      stderr: "",
    });
  });

  test("daemon start passes through lifecycle errors tersely", async () => {
    const cap = captureIo();

    const code = await main(["daemon", "start"], cap.io, {
      startDaemon: async () => {
        const error = new Error("Daemon already running on socket /tmp/demo.sock");
        error.name = "DaemonAlreadyRunningError";
        throw error;
      },
    });

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toBe("DaemonAlreadyRunningError: Daemon already running on socket /tmp/demo.sock\n");
  });

  test("daemon stop calls the lifecycle helper once and exits 0", async () => {
    const cap = captureIo();
    const paths = tempPaths();
    let called = 0;

    const code = await main(["daemon", "stop"], cap.io, {
      socketPath: paths.socketPath,
      pidPath: paths.pidPath,
      stopDaemon: async (socketPath, options) => {
        called += 1;
        expect(socketPath).toBe(paths.socketPath);
        expect(options?.pidPath).toBe(paths.pidPath);
      },
    });

    expect(code).toBe(0);
    expect(called).toBe(1);
    expect(cap.read()).toEqual({ stdout: "stopped\n", stderr: "" });
  });

  test("daemon status prints running with exit 0", async () => {
    const cap = captureIo();
    const paths = tempPaths();
    writeFileSync(paths.pidPath, "77\n");

    const code = await main(["daemon", "status"], cap.io, {
      socketPath: paths.socketPath,
      pidPath: paths.pidPath,
      getDaemonStatus: async (pid, socketPath) => {
        expect(pid).toBe(77);
        expect(socketPath).toBe(paths.socketPath);
        return "running";
      },
    });

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "running\n", stderr: "" });
  });

  test("daemon status prints stopped with exit 1 when pid is missing", async () => {
    const cap = captureIo();
    const paths = tempPaths();

    const code = await main(["daemon", "status"], cap.io, {
      socketPath: paths.socketPath,
      pidPath: paths.pidPath,
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "stopped\n", stderr: "" });
  });

  test("run start sends one IPC start request carrying write-loop input and prints run ID", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000001";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code: number;
    try {
      code = await main([...RUN_START_ARGS, "--agents", "claude,codex", "--max-iterations", "4"], cap.io, {
        connectIpcClient: async () =>
          makeClient(
            [
              {
                kind: "response",
                id: requestId,
                result: { runId: "run-999" },
              },
            ],
            sent,
          ),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code!).toBe(0);
    expect(cap.read()).toEqual({ stdout: "run-999\n", stderr: "" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "request",
      method: "start",
      params: {
        input: {
          worktree: {
            projectRoot: "/tmp/repo",
            projectName: "demo",
            branchName: "write-run",
            baseRef: "HEAD",
          },
          specPath: "spec.md",
          stepRules: "Return exactly one terminal token: done|no-work|blocked|progress.",
          expectedArtifactPath: "proof.txt",
          maxIterations: 4,
          bindings: [{ id: "claude" }, { id: "codex" }],
        },
      },
    });
  });

  test("run start passes through daemon guard errors without local write-loop logic", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000002";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code: number;
    try {
      code = await main(RUN_START_ARGS, cap.io, {
        connectIpcClient: async () =>
          makeClient([
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
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code!).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "run_in_progress: A run is already in progress; at most one in-flight run globally\n",
    });
  });

  test("run list prints daemon rows with liveness", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000003";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code: number;
    try {
      code = await main(["run", "list"], cap.io, {
        connectIpcClient: async () =>
          makeClient([
            {
              kind: "response",
              id: requestId,
              result: {
                runs: [
                  {
                    runId: "run-1",
                    project: "demo",
                    branch: "feature",
                    status: "in-progress",
                    isLive: true,
                  },
                  {
                    runId: "run-2",
                    project: "demo",
                    branch: "done",
                    status: "completed",
                    isLive: false,
                  },
                ],
              },
            },
          ]),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code!).toBe(0);
    expect(cap.read()).toEqual({
      stdout: "run-1\tdemo\tfeature\tin-progress\tlive\nrun-2\tdemo\tdone\tcompleted\tnot-live\n",
      stderr: "",
    });
  });

  test("run log prints replay and follow records as compact JSONL in order", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const streamId = "00000000-0000-4000-8000-000000000004";
    const records = [
      logRecord(1, "iteration_started"),
      logRecord(2, "boundary_committed"),
      logRecord(3, "loop_finished"),
    ];

    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => streamId;

    try {
      const code = await main(["run", "log", "run-123"], cap.io, {
        connectIpcClient: async () =>
          makeClient(
            [
              { kind: "stream-data", streamId, payload: JSON.stringify(records[0]) },
              { kind: "stream-data", streamId, payload: JSON.stringify(records[1]) },
              { kind: "stream-data", streamId, payload: JSON.stringify(records[2]) },
              { kind: "stream-end", streamId },
            ],
            sent,
          ),
      });

      expect(code).toBe(0);
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(sent).toEqual([{ kind: "stream-open", streamId, payload: { runId: "run-123" } }]);
    expect(cap.read()).toEqual({
      stdout: `${JSON.stringify(records[0])}\n${JSON.stringify(records[1])}\n${JSON.stringify(records[2])}\n`,
      stderr: "",
    });
  });

  test("run pause reports daemon success", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000005";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code: number;
    try {
      code = await main(["run", "pause", "run-123"], cap.io, {
        connectIpcClient: async () =>
          makeClient([
            {
              kind: "response",
              id: requestId,
              result: { ok: true },
            },
          ]),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code!).toBe(0);
    expect(cap.read()).toEqual({ stdout: "paused run-123\n", stderr: "" });
  });

  test("run resume passes through terminal_run errors", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000006";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code: number;
    try {
      code = await main(["run", "resume", "run-123"], cap.io, {
        connectIpcClient: async () =>
          makeClient([
            {
              kind: "error",
              id: requestId,
              code: "terminal_run",
              message: "Cannot resume a completed run",
            },
          ]),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code!).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "terminal_run: Cannot resume a completed run\n" });
  });

  test("run kill passes through unknown_run errors", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000007";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code: number;
    try {
      code = await main(["run", "kill", "run-404"], cap.io, {
        connectIpcClient: async () =>
          makeClient([
            {
              kind: "error",
              id: requestId,
              code: "unknown_run",
              message: "Run run-404 not found",
            },
          ]),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code!).toBe(1);
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

describe("simulated bindings", () => {
  test("replays scripted outcomes and emits the artifact on success", () => {
    const cwd = mkdtempSync(join(tmpdir(), "jarvis-sim-bindings-"));
    const bindings = simulatedBindings(["quota", "model_config", "error", "done"], {
      artifactPath: "proof.txt",
      emitArtifact: true,
    });

    expect(bindings[0]?.invoke({ prompt: "p", cwd })).resolves.toEqual({
      kind: "quota",
      stderr: "quota",
    });
    expect(bindings[1]?.invoke({ prompt: "p", cwd })).resolves.toEqual({
      kind: "model_config",
      stderr: "model-config",
    });
    expect(bindings[2]?.invoke({ prompt: "p", cwd })).resolves.toEqual({
      kind: "error",
      exitCode: 1,
      stderr: "error",
    });
    expect(bindings[3]?.invoke({ prompt: "p", cwd })).resolves.toEqual({
      kind: "ok",
      stdout: "done",
      stderr: "",
    });
    expect(readFileSync(join(cwd, "proof.txt"), "utf8")).toBe("ok\n");
  });
});
