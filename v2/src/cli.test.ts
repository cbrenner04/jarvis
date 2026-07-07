import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main, withOperatorSessionId } from "./cli.ts";
import type { BuildImplementWorkflowStepsInput } from "./execution/implement-workflow-steps.ts";
import type { AnyWorkflowStep } from "./execution/workflow-runner.ts";
import type { WriteLoopInput, WriteLoopResult } from "./execution/write-loop.ts";
import type { IpcFrame } from "./ipc/types.ts";
import type { PersistedRecord } from "./persistence/log-stream.ts";
import { simulatedBindings } from "./testing/bindings.ts";
import { withFixedUuid } from "./testing/fixed-uuid.ts";
import { createDeferredIpcClient, makeIpcClient } from "./testing/ipc-client-fake.ts";
import { mockWriteLoopInput } from "./testing/run-control.ts";

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

function writeRawMachineConfig(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-cli-machine-config-"));
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, text);
  return configPath;
}

function writeMachineConfig(value: unknown): string {
  return writeRawMachineConfig(JSON.stringify(value));
}

function absentMachineConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-cli-machine-config-"));
  return join(dir, ".jarvis", "config.json");
}

async function runConfig(configPath: string, args: readonly string[], io = captureIo().io): Promise<number> {
  return main(["config", ...args], io, { machineConfigPath: configPath });
}

async function setAgents(configPath: string, csv: string, io = captureIo().io): Promise<number> {
  return runConfig(configPath, ["set-agents", csv], io);
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

const RUN_WORKFLOW_IMPLEMENT_ARGS = [
  "run",
  "workflow",
  "implement",
  "--branch",
  "implement-run",
  "--base",
  "HEAD",
  "--spec",
  "spec.md",
  "--artifact",
  "proof.txt",
];

const FAKE_IMPLEMENT_STEPS: AnyWorkflowStep[] = [
  {
    behavior: "write",
    stepId: "implement",
    role: "implement",
    promptId: "patch.prompt.body",
    stepRules: "Return exactly one terminal token: done|no-work|blocked|progress.",
    agents: ["claude"],
    agentModelConfig: {},
    worktree: {
      projectRoot: "/tmp/repo",
      projectName: "demo",
      branchName: "implement-run",
      baseRef: "HEAD",
    },
    specPath: "spec.md",
    expectedArtifactPath: "proof.txt",
  },
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

  test("write stdout failureKind and bindingAttempts attach only on binding-chain invocation_failure", async () => {
    const withoutDetail: WriteLoopResult[] = [
      { kind: "invocation_failure", runId: "run-invalid", iterationsConsumed: 1, resumable: false },
      { kind: "complete", runId: "r1", iterationsConsumed: 1, resumable: false },
      { kind: "blocked", runId: "r2", iterationsConsumed: 1, resumable: false },
      { kind: "contract_miss", runId: "r3", iterationsConsumed: 1, resumable: false },
      { kind: "budget-exhausted", runId: "r4", iterationsConsumed: 2, resumable: true },
    ];

    for (const result of withoutDetail) {
      const cap = captureIo();
      await main(WRITE_ARGS, cap.io, { executeWriteLoop: async () => result });
      const parsed = JSON.parse(cap.read().stdout) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty("failureKind");
      expect(parsed).not.toHaveProperty("bindingAttempts");
    }

    const cap = captureIo();
    const withDetail: WriteLoopResult = {
      kind: "invocation_failure",
      runId: "run-detail",
      iterationsConsumed: 1,
      resumable: false,
      failureKind: "quota",
      bindingAttempts: [
        { bindingId: "sim.1", resultKind: "quota" },
        { bindingId: "sim.2", resultKind: "quota" },
      ],
    };
    await main(WRITE_ARGS, cap.io, { executeWriteLoop: async () => withDetail });
    const parsed = JSON.parse(cap.read().stdout) as Record<string, unknown>;
    expect(parsed.failureKind).toBe("quota");
    expect(parsed.bindingAttempts).toEqual(withDetail.bindingAttempts);
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

  test("config set-agents writes agents, preserves unrelated keys, and later write uses the persisted order", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ other: "value", agents: ["cursor"] });

    const configCode = await setAgents(configPath, "claude,codex", cap.io);

    expect(configCode).toBe(0);
    expect(cap.read()).toEqual({ stdout: '{"agents":["claude","codex"]}\n', stderr: "" });
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      other: "value",
      agents: ["claude", "codex"],
    });

    let capturedAgents: readonly string[] | undefined;
    const writeCap = captureIo();
    const writeCode = await main(WRITE_ARGS, writeCap.io, {
      machineConfigPath: configPath,
      createBindings: (agentIds) => {
        capturedAgents = agentIds;
        return simulatedBindings(["done"]);
      },
      executeWriteLoop: async () => completeResult(),
    });

    expect(writeCode).toBe(0);
    expect(capturedAgents).toEqual(["claude", "codex"]);
  });

  test("config set-agents creates missing parent state", async () => {
    const cap = captureIo();
    const configPath = absentMachineConfigPath();

    const code = await setAgents(configPath, "claude,codex", cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: '{"agents":["claude","codex"]}\n', stderr: "" });
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ agents: ["claude", "codex"] });
  });

  test("config set-agents rejects an empty CSV segment without creating bootstrap state", async () => {
    const cap = captureIo();
    const configPath = absentMachineConfigPath();

    const code = await setAgents(configPath, "claude,,codex", cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: 'Error: invalid agents CSV "claude,,codex": empty segment at position 2\n',
    });
    expect(existsSync(configPath)).toBe(false);
    expect(existsSync(dirname(configPath))).toBe(false);
  });

  test("config set-agents rejects duplicate names without mutating the prior file", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ agents: ["cursor"], keep: true });
    const before = readFileSync(configPath, "utf8");

    const code = await setAgents(configPath, "claude,claude", cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "Machine config 'agents' contains duplicate entry: \"claude\"\n",
    });
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  test("config set-agents rejects agent:model entries without creating bootstrap state", async () => {
    const cap = captureIo();
    const configPath = absentMachineConfigPath();

    const code = await setAgents(configPath, "claude,codex:gpt-5", cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: 'Error: invalid agent "codex:gpt-5": expected bare agent name\n',
    });
    expect(existsSync(configPath)).toBe(false);
  });

  test("config set-agents refuses to overwrite an invalid machine-config file", async () => {
    const cap = captureIo();
    const configPath = writeRawMachineConfig("{ invalid json");
    const before = readFileSync(configPath, "utf8");

    const code = await setAgents(configPath, "claude,codex", cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: `Failed to parse machine config at ${configPath}: invalid JSON\n`,
    });
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  test("config set-agents refuses to overwrite a non-object machine-config file", async () => {
    const cap = captureIo();
    const configPath = writeRawMachineConfig('["claude"]\n');
    const before = readFileSync(configPath, "utf8");

    const code = await setAgents(configPath, "claude,codex", cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: `Machine config at ${configPath} must be a JSON object, got array\n`,
    });
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  test("config set-agents refuses to overwrite a machine-config file with invalid agents", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ agents: [] });
    const before = readFileSync(configPath, "utf8");

    const code = await setAgents(configPath, "claude,codex", cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "Machine config 'agents' array must not be empty\n",
    });
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  test("config show prints configured agents one per line", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ agents: ["claude", "codex", "cursor"] });

    const code = await runConfig(configPath, ["show"], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "claude\ncodex\ncursor\n", stderr: "" });
  });

  test.each([
    ["absent", absentMachineConfigPath],
    ["without agents", () => writeMachineConfig({ other: "value" })],
  ])("config show prints no-override line when machine config is %s", async (_label, configPathFn) => {
    const cap = captureIo();
    const configPath = configPathFn();

    const code = await runConfig(configPath, ["show"], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "No machine agent override configured.\n", stderr: "" });
  });

  test("config show exits non-zero on malformed machine config", async () => {
    const cap = captureIo();
    const configPath = writeRawMachineConfig("{ invalid json");

    const code = await runConfig(configPath, ["show"], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: `Failed to parse machine config at ${configPath}: invalid JSON\n`,
    });
  });

  test("config show exits non-zero when agents fail validation", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ agents: [] });

    const code = await runConfig(configPath, ["show"], cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "Machine config 'agents' array must not be empty\n",
    });
  });

  test("config path prints the expanded machine config path", async () => {
    const cap = captureIo();
    const configPath = absentMachineConfigPath();

    const code = await runConfig(configPath, ["path"], cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: `${configPath}\n`, stderr: "" });
  });

  test("write --agents still overrides the persisted machine order after config set-agents", async () => {
    const configPath = absentMachineConfigPath();
    await setAgents(configPath, "claude,codex");

    let capturedAgents: readonly string[] | undefined;
    const writeCap = captureIo();
    const code = await main([...WRITE_ARGS, "--agents", "cursor"], writeCap.io, {
      machineConfigPath: configPath,
      createBindings: (agentIds) => {
        capturedAgents = agentIds;
        return simulatedBindings(["done"]);
      },
      executeWriteLoop: async () => completeResult(),
    });

    expect(code).toBe(0);
    expect(capturedAgents).toEqual(["cursor"]);
  });

  test("run start --agents still overrides the persisted machine order after config set-agents", async () => {
    const configPath = absentMachineConfigPath();
    await setAgents(configPath, "claude,codex");

    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000021";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code = NaN;
    try {
      code = await main([...RUN_START_ARGS, "--agents", "cursor"], cap.io, {
        machineConfigPath: configPath,
        connectIpcClient: async () =>
          makeIpcClient(
            [
              {
                kind: "response",
                id: requestId,
                result: { runId: "run-override" },
              },
            ],
            { sent },
          ),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "run-override\n", stderr: "" });
    expect(sent[0]).toMatchObject({
      params: {
        input: {
          bindings: [{ id: "cursor" }],
        },
      },
    });
  });

  test("run start forwards machine-config agents into IPC start payload when --agents is omitted", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ agents: ["codex", "cursor"] });
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000022";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code = NaN;
    try {
      code = await main(RUN_START_ARGS, cap.io, {
        machineConfigPath: configPath,
        connectIpcClient: async () =>
          makeIpcClient(
            [
              {
                kind: "response",
                id: requestId,
                result: { runId: "run-machine-config" },
              },
            ],
            { sent },
          ),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "run-machine-config\n", stderr: "" });
    expect(sent[0]).toMatchObject({
      params: {
        input: {
          bindings: [{ id: "codex" }, { id: "cursor" }],
        },
      },
    });
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

  test("mints an operatorSessionId when no caller-supplied telemetry is present", async () => {
    const cap = captureIo();
    let capturedInput: WriteLoopInput | undefined;

    await main(WRITE_ARGS, cap.io, {
      executeWriteLoop: async (input) => {
        capturedInput = input;
        return completeResult();
      },
    });

    expect(typeof capturedInput?.telemetry?.operatorSessionId).toBe("string");
    expect(capturedInput?.telemetry?.operatorSessionId.length).toBeGreaterThan(0);
  });

  test("mints a different operatorSessionId for each main() invocation", async () => {
    const capturedIds: string[] = [];

    for (let i = 0; i < 2; i++) {
      const cap = captureIo();
      await main(WRITE_ARGS, cap.io, {
        executeWriteLoop: async (input) => {
          capturedIds.push(input.telemetry?.operatorSessionId ?? "");
          return completeResult();
        },
      });
    }

    expect(capturedIds).toHaveLength(2);
    expect(capturedIds[0]).not.toEqual(capturedIds[1]);
  });

  test("withOperatorSessionId does not overwrite caller-supplied telemetry", () => {
    const callerTelemetry = { sinkPath: "/tmp/t.jsonl", operatorSessionId: "caller-id", workflow: "w", role: "r" };
    const input: WriteLoopInput = { ...mockWriteLoopInput(), telemetry: callerTelemetry };

    const result = withOperatorSessionId(input, "minted-id");

    expect(result.telemetry).toEqual(callerTelemetry);
  });

  test("defaults to the claude agent when --agents is omitted", async () => {
    const cap = captureIo();
    let capturedAgents: readonly string[] | undefined;

    await main(WRITE_ARGS, cap.io, {
      machineConfigPath: absentMachineConfigPath(),
      createBindings: (agentIds) => {
        capturedAgents = agentIds;
        return simulatedBindings(["done"]);
      },
      executeWriteLoop: async () => completeResult(),
    });

    expect(capturedAgents).toEqual(["claude"]);
  });

  test("valid machine config supplies fallback agents when --agents is omitted", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ agents: ["codex", "cursor"] });
    let capturedAgents: readonly string[] | undefined;

    const code = await main(WRITE_ARGS, cap.io, {
      machineConfigPath: configPath,
      createBindings: (agentIds) => {
        capturedAgents = agentIds;
        return simulatedBindings(["done"]);
      },
      executeWriteLoop: async () => completeResult(),
    });

    expect(code).toBe(0);
    expect(capturedAgents).toEqual(["codex", "cursor"]);
  });

  test("invalid machine config exits nonzero without invoking any agent when --agents is omitted", async () => {
    const cap = captureIo();
    const configPath = writeRawMachineConfig("{ invalid json");
    let createBindingsCalled = false;

    const code = await main(WRITE_ARGS, cap.io, {
      machineConfigPath: configPath,
      createBindings: () => {
        createBindingsCalled = true;
        return simulatedBindings(["done"]);
      },
      executeWriteLoop: async () => completeResult(),
    });

    expect(code).toBe(1);
    expect(createBindingsCalled).toBe(false);
    expect(cap.read().stderr).toContain("Failed to parse machine config");
  });

  test("--agents wins over a broken machine config file", async () => {
    const cap = captureIo();
    const configPath = writeRawMachineConfig("{ invalid json");
    let capturedAgents: readonly string[] | undefined;

    const code = await main([...WRITE_ARGS, "--agents", "claude,codex"], cap.io, {
      machineConfigPath: configPath,
      createBindings: (agentIds) => {
        capturedAgents = agentIds;
        return simulatedBindings(["done"]);
      },
      executeWriteLoop: async () => completeResult(),
    });

    expect(code).toBe(0);
    expect(capturedAgents).toEqual(["claude", "codex"]);
  });

  test("default binding factory yields not-wired error bindings", async () => {
    const cap = captureIo();
    let captured: WriteLoopInput | undefined;

    await main(WRITE_ARGS, cap.io, {
      machineConfigPath: absentMachineConfigPath(),
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

    let code = NaN;
    try {
      code = await main([...RUN_START_ARGS, "--agents", "claude,codex", "--max-iterations", "4"], cap.io, {
        connectIpcClient: async () =>
          makeIpcClient(
            [
              {
                kind: "response",
                id: requestId,
                result: { runId: "run-999" },
              },
            ],
            { sent },
          ),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(0);
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

    let code = NaN;
    try {
      code = await main(RUN_START_ARGS, cap.io, {
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
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "run_in_progress: A run is already in progress; at most one in-flight run globally\n",
    });
  });

  test("run workflow implement sends one IPC start request carrying built workflow steps and prints run ID", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000004";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    let code = NaN;
    try {
      code = await main(RUN_WORKFLOW_IMPLEMENT_ARGS, cap.io, {
        cwd: () => "/tmp/repo/sub",
        buildImplementWorkflowSteps: (input) => {
          builtInput = input;
          return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
        },
        connectIpcClient: async () =>
          makeIpcClient(
            [
              {
                kind: "response",
                id: requestId,
                result: { runId: "run-888" },
              },
            ],
            { sent },
          ),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "run-888\n", stderr: "" });
    expect(builtInput).toEqual({
      cwd: "/tmp/repo/sub",
      branchName: "implement-run",
      baseRef: "HEAD",
      specPath: "spec.md",
      artifactPath: "proof.txt",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "request",
      method: "start",
      params: { steps: FAKE_IMPLEMENT_STEPS },
    });
  });

  test("run workflow implement passes through daemon guard errors without local workflow logic", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000005";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code = NaN;
    try {
      code = await main(RUN_WORKFLOW_IMPLEMENT_ARGS, cap.io, {
        cwd: () => "/tmp/repo/sub",
        buildImplementWorkflowSteps: () => ({ ok: true, steps: FAKE_IMPLEMENT_STEPS }),
        connectIpcClient: async () =>
          makeIpcClient([
            {
              kind: "error",
              id: requestId,
              code: "run_in_progress",
              message: "A run is already in progress; at most one in-flight run globally",
            },
          ]),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "run_in_progress: A run is already in progress; at most one in-flight run globally\n",
    });
  });

  test("run workflow implement exits nonzero on an invalid daemon response", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000006";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code = NaN;
    try {
      code = await main(RUN_WORKFLOW_IMPLEMENT_ARGS, cap.io, {
        cwd: () => "/tmp/repo/sub",
        buildImplementWorkflowSteps: () => ({ ok: true, steps: FAKE_IMPLEMENT_STEPS }),
        connectIpcClient: async () =>
          makeIpcClient([
            {
              kind: "response",
              id: requestId,
              result: { runId: 123 },
            },
          ]),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "invalid daemon response\n" });
  });

  test("run workflow implement missing required flags prints usage and exits 1 without contacting the daemon", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow", "implement", "--branch", "implement-run"], cap.io, {
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "usage: jarvis run workflow implement --branch <name> --base <ref> --spec <path> --artifact <path>\n",
    });
  });

  test("run workflow implement surfaces a builder error without contacting the daemon", async () => {
    const cap = captureIo();

    const code = await main(RUN_WORKFLOW_IMPLEMENT_ARGS, cap.io, {
      cwd: () => "/tmp/unregistered",
      buildImplementWorkflowSteps: () => ({
        ok: false,
        error: "No registered project matches cwd: /tmp/unregistered",
      }),
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "No registered project matches cwd: /tmp/unregistered\n",
    });
  });

  test("run workflow with an unrecognized preset name falls through to run usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow", "bogus"], cap.io, {
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "usage: jarvis run <start|list|log|pause|resume|kill|wait> [args]\n",
    });
  });

  test("bare run workflow falls through to run usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow"], cap.io, {
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "usage: jarvis run <start|list|log|pause|resume|kill|wait> [args]\n",
    });
  });

  test("run list prints daemon rows with liveness", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000003";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code = NaN;
    try {
      code = await main(["run", "list"], cap.io, {
        connectIpcClient: async () =>
          makeIpcClient([
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
                    workflow: {
                      steps: [{ stepId: "step-1", role: "implement", status: "in_progress", attemptCount: 1 }],
                    },
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

    expect(code).toBe(0);
    expect(cap.read()).toEqual({
      stdout: "run-1\tdemo\tfeature\tin-progress\tlive\t-\t-\t-\nrun-2\tdemo\tdone\tcompleted\tnot-live\t-\t-\t-\n",
      stderr: "",
    });
  });

  test("run list prints error columns from daemon error when present", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000003";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code = NaN;
    try {
      code = await main(["run", "list"], cap.io, {
        connectIpcClient: async () =>
          makeIpcClient([
            {
              kind: "response",
              id: requestId,
              result: {
                runs: [
                  {
                    runId: "run-ok",
                    project: "demo",
                    branch: "feature",
                    status: "completed",
                    isLive: false,
                  },
                  {
                    runId: "run-fail",
                    project: "demo",
                    branch: "broken",
                    status: "failed",
                    isLive: false,
                    error: {
                      reason: "harness_failure",
                      retryable: false,
                      nextAction: "stop",
                    },
                  },
                ],
              },
            },
          ]),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(0);
    expect(cap.read()).toEqual({
      stdout:
        "run-ok\tdemo\tfeature\tcompleted\tnot-live\t-\t-\t-\nrun-fail\tdemo\tbroken\tfailed\tnot-live\tharness_failure\tfalse\tstop\n",
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
          makeIpcClient(
            [
              { kind: "stream-data", streamId, payload: JSON.stringify(records[0]) },
              { kind: "stream-data", streamId, payload: JSON.stringify(records[1]) },
              { kind: "stream-data", streamId, payload: JSON.stringify(records[2]) },
              { kind: "stream-end", streamId },
            ],
            { sent },
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

    let code = NaN;
    try {
      code = await main(["run", "pause", "run-123"], cap.io, {
        connectIpcClient: async () =>
          makeIpcClient([
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

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "paused run-123\n", stderr: "" });
  });

  test("run resume passes through terminal_run errors", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000006";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code = NaN;
    try {
      code = await main(["run", "resume", "run-123"], cap.io, {
        connectIpcClient: async () =>
          makeIpcClient([
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

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "terminal_run: Cannot resume a completed run\n" });
  });

  test("run kill passes through unknown_run errors", async () => {
    const cap = captureIo();
    const requestId = "00000000-0000-4000-8000-000000000007";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code = NaN;
    try {
      code = await main(["run", "kill", "run-404"], cap.io, {
        connectIpcClient: async () =>
          makeIpcClient([
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

  test("run wait includes error in stdout JSON when daemon result carries error", async () => {
    const cap = captureIo();

    const code = await runWait(cap, "run-fail", [
      waitResponse({
        runStatus: "failed",
        loopOutcomeKind: "invocation_failure",
        error: {
          reason: "harness_failure",
          retryable: false,
          nextAction: "stop",
        },
      }),
    ]);

    expect(code).toBe(2);
    expect(cap.read()).toEqual({
      stdout:
        '{"runStatus":"failed","loopOutcomeKind":"invocation_failure","error":{"reason":"harness_failure","retryable":false,"nextAction":"stop"}}\n',
      stderr: "",
    });
  });

  test("run wait blocks until the correlated wait response arrives", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const { client, push } = createDeferredIpcClient(sent);

    const pending = withFixedUuid(WAIT_REQUEST_ID, async () =>
      main(["run", "wait", "run-123"], cap.io, {
        connectIpcClient: async () => client,
      }),
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(cap.read().stdout).toBe("");

    push(
      waitResponse({
        runStatus: "completed",
        loopOutcomeKind: "complete",
        iterationsConsumed: 1,
        resumable: false,
      }) as IpcFrame,
    );

    const code = await pending;

    expect(code).toBe(0);
    expect(cap.read().stdout).toBe(
      '{"runStatus":"completed","loopOutcomeKind":"complete","iterationsConsumed":1,"resumable":false}\n',
    );
  });

  test("run wait returns immediately for an already-quiescent run", async () => {
    const cap = captureIo();

    const code = await runWait(cap, "run-paused", [
      waitResponse({
        runStatus: "paused",
        loopOutcomeKind: "paused",
        iterationsConsumed: 3,
        resumable: true,
      }),
    ]);

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe(
      '{"runStatus":"paused","loopOutcomeKind":"paused","iterationsConsumed":3,"resumable":true}\n',
    );
  });

  test.each([
    [{ runStatus: "completed", loopOutcomeKind: "complete" }, 0],
    [{ runStatus: "failed", loopOutcomeKind: "complete" }, 0],
    [{ runStatus: "blocked", loopOutcomeKind: "blocked" }, 1],
    [{ runStatus: "blocked", loopOutcomeKind: "contract_miss" }, 1],
    [{ runStatus: "paused", loopOutcomeKind: "paused" }, 1],
    [{ runStatus: "in-progress", loopOutcomeKind: "progress" }, 1],
    [{ runStatus: "failed", loopOutcomeKind: "invocation_failure" }, 2],
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

  test("run wait with empty run ID forwards to daemon for invalid_params", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];

    const code = await runWait(cap, "", [waitError("invalid_params", "runId is required")], sent);

    expect(code).toBe(1);
    expect(sent[0]).toMatchObject({ method: "wait", params: { runId: "" } });
    expect(cap.read()).toEqual({ stdout: "", stderr: "invalid_params: runId is required\n" });
  });

  test("run wait passes through unknown_run errors", async () => {
    const cap = captureIo();

    const code = await runWait(cap, "run-404", [waitError("unknown_run", "Run run-404 not found")]);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "unknown_run: Run run-404 not found\n" });
  });

  test("run wait prints terse connection errors when the socket is unavailable", async () => {
    const cap = captureIo();

    const code = await main(["run", "wait", "run-123"], cap.io, {
      connectIpcClient: async () => {
        throw new Error("connect ENOENT /tmp/jarvis.sock");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: "connect ENOENT /tmp/jarvis.sock\n" });
  });

  test("jarvis tui dispatches to runTuiEntry with the production socket path", async () => {
    const paths = tempPaths();
    let seenSocketPath: string | undefined;

    const code = await main(["tui"], captureIo().io, {
      socketPath: paths.socketPath,
      runTuiEntry: async (deps) => {
        seenSocketPath = deps?.socketPath;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(seenSocketPath).toBe(paths.socketPath);
  });

  test("jarvis tui with extra args prints usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["tui", "--foo"], cap.io, {
      runTuiEntry: async () => {
        throw new Error("should not run");
      },
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("usage: jarvis tui");
  });

  test("jarvis tui log dispatches to runTuiLogFollow with run id and production socket path", async () => {
    const paths = tempPaths();
    let seenRunId: string | undefined;
    let seenSocketPath: string | undefined;

    const code = await main(["tui", "log", "run-abc"], captureIo().io, {
      socketPath: paths.socketPath,
      runTuiLogFollow: async (runId, deps) => {
        seenRunId = runId;
        seenSocketPath = deps?.socketPath;
        return 0;
      },
    });

    expect(code).toBe(0);
    expect(seenRunId).toBe("run-abc");
    expect(seenSocketPath).toBe(paths.socketPath);
  });

  test("jarvis tui log with missing or extra arguments prints usage and exits 1", async () => {
    const cap = captureIo();

    const missingRunId = await main(["tui", "log"], cap.io, {
      runTuiLogFollow: async () => {
        throw new Error("should not run");
      },
    });
    const extraArgs = await main(["tui", "log", "run-abc", "extra"], cap.io, {
      runTuiLogFollow: async () => {
        throw new Error("should not run");
      },
    });

    expect(missingRunId).toBe(1);
    expect(extraArgs).toBe(1);
    expect(cap.read().stderr).toContain("usage: jarvis tui log <run-id>");
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
