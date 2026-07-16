import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main } from "./cli.ts";
import type { CleanupDeps } from "./commands/cleanup.ts";
import type { AgentModelConfig } from "./config/agent-model-config.ts";
import type { BuildImplementWorkflowStepsInput } from "./execution/implement-workflow-steps.ts";
import type { AnyWorkflowStep } from "./execution/workflow-runner.ts";
import type { WriteLoopInput, WriteLoopResult } from "./execution/write-loop.ts";
import { applyOperatorSessionId } from "./execution/write-loop.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./execution/write-loop-input.ts";
import type { PersistedRecord } from "./persistence/log-stream.ts";
import { withFixedUuid } from "./testing/fixed-uuid.ts";
import { makeIpcClient } from "./testing/ipc-client-fake.ts";
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

test("cleanup previews without prompting and cancellation does not mutate", async () => {
  const preview = captureIo();
  const base = {
    readProjectRegistry: () => ({ demo: { root: "/repo" } }),
    createCleanupDeps: () => ({
      jarvisRoot: "/home",
      listDurableRuns: () => [],
      listLiveRuns: async () => [],
      runner: {
        async runAsync(command, args) {
          if (command === "git" && args[0] === "worktree" && args[1] === "list") {
            return "worktree /repo\nbranch refs/heads/main\n\nworktree /home/worktrees/demo/plan/test\nbranch refs/heads/plan/test\n\n";
          }
          if (command === "gh") return "MERGED\n";
          return "";
        },
      },
    } satisfies CleanupDeps),
    connectIpcClient: async () => makeIpcClient([{ kind: "response", id: "ignored", result: { runs: [] } }]),
  };
  expect(await main(["cleanup", "--dry-run"], preview.io, base)).toBe(0);
  expect(preview.read().stdout).toContain("plan/test");
  const cancelled = captureIo();
  expect(await main(["cleanup"], cancelled.io, { ...base, confirmCleanup: async () => false })).toBe(0);
  expect(cancelled.read().stdout).not.toContain("removed");
});

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
  "index.md",
];

let FAKE_IMPLEMENT_STEPS: AnyWorkflowStep[];

beforeAll(() => {
  mkdirSync("/tmp/repo/sub", { recursive: true });
  mkdirSync("/tmp/repo/v2/spec/my-spec", { recursive: true });
  mkdirSync("/tmp/unregistered", { recursive: true });
  writeFileSync("/tmp/repo/sub/index.md", "# Index\n", "utf8");
  writeFileSync("/tmp/repo/spec.md", "# Spec\n", "utf8");
  writeFileSync("/tmp/repo/v2/spec/my-spec/index.md", "# Index\n", "utf8");
  writeFileSync("/tmp/unregistered/index.md", "# Index\n", "utf8");
  FAKE_IMPLEMENT_STEPS = [
    {
      behavior: "write",
      stepId: "implement",
      role: "implement",
      promptId: "patch.prompt.body",
      stepRules: DEFAULT_WRITE_STEP_RULES,
      agents: ["claude"],
      agentModelConfig: {},
      worktree: {
        projectRoot: realpathSync("/tmp/repo"),
        projectName: "demo",
        branchName: "implement-run",
        baseRef: "HEAD",
      },
      specPath: "spec.md",
      expectedArtifactPath: "proof.txt",
    },
  ];
});

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

const TEST_RUNG = { rungs: [{ adapterModel: "m1", priceKey: "p1" }] };

function stubAgentModelConfig(agents: readonly string[]): AgentModelConfig {
  return Object.fromEntries(agents.map((agent) => [agent, { implement: TEST_RUNG }]));
}

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

function workflowFrames(startRequestId: string, waitRequestId: string, runId: string, waitResult: unknown): unknown[] {
  return [
    { kind: "response", id: startRequestId, result: { runId } },
    { kind: "response", id: waitRequestId, result: waitResult },
  ];
}

/** `main()` consumes one uuid for its operator session id before any RPC id is minted, so a
 * workflow's id sequence is: session, then the `start` request, then the `wait` request. */
const SESSION_UUID = "00000000-0000-4000-8000-0000000000ff";

function makeWorkflowUuidManager(startId: string, waitId: string): () => string {
  let callCount = 0;
  return () => {
    const ids: readonly string[] = [SESSION_UUID, startId, waitId];
    return ids[callCount++] ?? waitId;
  };
}

/** Stubs the session/start/wait uuid sequence for a `run workflow` invocation. */
function withWorkflowUuids<T>(startId: string, waitId: string, fn: () => Promise<T>): Promise<T> {
  return withFixedUuid([SESSION_UUID, startId, waitId], fn);
}

const COMPLETED_WAIT_RESULT = {
  runStatus: "completed",
  loopOutcomeKind: "complete",
  iterationsConsumed: 1,
  resumable: false,
} as const;

const COMPLETED_WAIT_JSON =
  '{"runStatus":"completed","loopOutcomeKind":"complete","iterationsConsumed":1,"resumable":false}';

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

  test("invalid --max-iterations prints usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main([...WRITE_ARGS, "--max-iterations", "0"], cap.io, {
      loadAgentModelConfig: stubAgentModelConfig,
    });

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toBe(
      "usage: jarvis write --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> [--max-iterations <n>]\n",
    );
  });

  test("unknown write args print usage and exit 1", async () => {
    const cap = captureIo();

    const code = await main([...WRITE_ARGS, "--unknown", "x"], cap.io);

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain("usage: jarvis write");
  });

  test.each([
    [{ kind: "complete", runId: "run-123", iterationsConsumed: 1, resumable: false }, 0],
    [{ kind: "blocked", runId: "run-456", iterationsConsumed: 1, resumable: false }, 1],
    [{ kind: "invocation_failure", runId: "run-789", iterationsConsumed: 0, resumable: false }, 2],
    [{ kind: "iteration_timeout", runId: "run-timeout", iterationsConsumed: 1, resumable: false }, 1],
    [{ kind: "budget-exhausted", runId: "run-999", iterationsConsumed: 5, resumable: true }, 5],
    [
      {
        kind: "ready_gate_failed",
        runId: "run-gate",
        iterationsConsumed: 1,
        resumable: true,
        readyGateError: "gate red",
      },
      1,
    ],
    [
      {
        kind: "ready_flip_failed",
        runId: "run-flip",
        iterationsConsumed: 1,
        resumable: true,
        readyFlipError: "flip failed",
      },
      1,
    ],
  ] as const)("write command maps %p to exit %i", async (result, expectedExit) => {
    const cap = captureIo();

    const code = await main(WRITE_ARGS, cap.io, {
      loadAgentModelConfig: stubAgentModelConfig,
      executeWriteLoop: async () => result as WriteLoopResult,
    });

    expect(code).toBe(expectedExit);
    expect(cap.read().stdout).toContain(`"kind": "${result.kind}"`);
    if (result.kind === "ready_gate_failed") expect(cap.read().stdout).toContain('"readyGateError": "gate red"');
    if (result.kind === "ready_flip_failed") expect(cap.read().stdout).toContain('"readyFlipError": "flip failed"');
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
      await main(WRITE_ARGS, cap.io, {
        loadAgentModelConfig: stubAgentModelConfig,
        executeWriteLoop: async () => result,
      });
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
    await main(WRITE_ARGS, cap.io, {
      loadAgentModelConfig: stubAgentModelConfig,
      executeWriteLoop: async () => withDetail,
    });
    const parsed = JSON.parse(cap.read().stdout) as Record<string, unknown>;
    expect(parsed.failureKind).toBe("quota");
    expect(parsed.bindingAttempts).toEqual(withDetail.bindingAttempts);
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
      loadAgentModelConfig: (agents) => {
        capturedAgents = agents;
        return stubAgentModelConfig(agents);
      },
      executeWriteLoop: async () => completeResult(),
    });

    expect(writeCode).toBe(0);
    expect(capturedAgents).toEqual(["claude", "codex"]);
  });

  test("write resolves iterationTimeoutMs from machine config", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ iterationTimeoutMs: 123 });
    let capturedTimeout: number | undefined;

    const code = await main(WRITE_ARGS, cap.io, {
      machineConfigPath: configPath,
      loadAgentModelConfig: stubAgentModelConfig,
      executeWriteLoop: async (input) => {
        capturedTimeout = input.iterationTimeoutMs;
        return completeResult();
      },
    });

    expect(code).toBe(0);
    expect(capturedTimeout).toBe(123);
  });

  test("config set-agents creates missing parent state", async () => {
    const cap = captureIo();
    const configPath = absentMachineConfigPath();

    const code = await setAgents(configPath, "claude,codex", cap.io);

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: '{"agents":["claude","codex"]}\n', stderr: "" });
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ agents: ["claude", "codex"] });
  });

  test.each([
    [
      "an empty CSV segment",
      "claude,,codex",
      absentMachineConfigPath,
      () => 'Error: invalid agents CSV "claude,,codex": empty segment at position 2\n',
    ],
    [
      "agent:model entries",
      "claude,codex:gpt-5",
      absentMachineConfigPath,
      () => 'Error: invalid agent "codex:gpt-5": expected bare agent name\n',
    ],
    [
      "duplicate names",
      "claude,claude",
      () => writeMachineConfig({ agents: ["cursor"], keep: true }),
      () => "Machine config 'agents' contains duplicate entry: \"claude\"\n",
    ],
    [
      "an invalid machine-config file",
      "claude,codex",
      () => writeRawMachineConfig("{ invalid json"),
      (configPath: string) => `Failed to parse machine config at ${configPath}: invalid JSON\n`,
    ],
    [
      "a non-object machine-config file",
      "claude,codex",
      () => writeRawMachineConfig('["claude"]\n'),
      (configPath: string) => `Machine config at ${configPath} must be a JSON object, got array\n`,
    ],
    [
      "a machine-config file with invalid agents",
      "claude,codex",
      () => writeMachineConfig({ agents: [] }),
      () => "Machine config 'agents' array must not be empty\n",
    ],
  ])("config set-agents rejects %s without touching prior state", async (_label, csv, makeConfigPath, expectStderr) => {
    const cap = captureIo();
    const configPath = makeConfigPath();
    const before = existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined;

    const code = await setAgents(configPath, csv, cap.io);

    expect(code).toBe(1);
    expect(cap.read()).toEqual({ stdout: "", stderr: expectStderr(configPath) });
    if (before === undefined) {
      expect(existsSync(configPath)).toBe(false);
      expect(existsSync(dirname(configPath))).toBe(false);
    } else {
      expect(readFileSync(configPath, "utf8")).toBe(before);
    }
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

  test("run start forwards machine-config agents into IPC start payload", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ agents: ["codex", "cursor"] });
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000022";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code = NaN;
    try {
      code = await main(RUN_START_ARGS, cap.io, {
        loadAgentModelConfig: stubAgentModelConfig,
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
          bindings: [],
          bindingResolution: { role: "implement", agents: ["codex", "cursor"] },
        },
      },
    });
  });

  test("mints an operatorSessionId when no caller-supplied telemetry is present", async () => {
    const cap = captureIo();
    let capturedInput: WriteLoopInput | undefined;

    await main(WRITE_ARGS, cap.io, {
      loadAgentModelConfig: stubAgentModelConfig,
      executeWriteLoop: async (input) => {
        capturedInput = input;
        return completeResult();
      },
    });

    expect(typeof capturedInput?.telemetry?.operatorSessionId).toBe("string");
    expect(capturedInput?.telemetry?.operatorSessionId.length).toBeGreaterThan(0);
  });

  test("applyOperatorSessionId overwrites caller-supplied operatorSessionId, preserves other telemetry fields", () => {
    const callerTelemetry = { sinkPath: "/tmp/t.jsonl", operatorSessionId: "caller-id", workflow: "w", role: "r" };
    const input: WriteLoopInput = { ...mockWriteLoopInput(), telemetry: callerTelemetry };

    const result = applyOperatorSessionId(input, "minted-id");

    expect(result.telemetry?.operatorSessionId).toBe("minted-id");
    expect(result.telemetry?.sinkPath).toBe(callerTelemetry.sinkPath);
    expect(result.telemetry?.workflow).toBe(callerTelemetry.workflow);
    expect(result.telemetry?.role).toBe(callerTelemetry.role);
  });

  test("defaults to the claude agent when machine config has no override", async () => {
    const cap = captureIo();
    let capturedAgents: readonly string[] | undefined;

    await main(WRITE_ARGS, cap.io, {
      machineConfigPath: absentMachineConfigPath(),
      loadAgentModelConfig: (agents) => {
        capturedAgents = agents;
        return stubAgentModelConfig(agents);
      },
      executeWriteLoop: async () => completeResult(),
    });

    expect(capturedAgents).toEqual(["claude"]);
  });

  test("valid machine config supplies fallback agents", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({ agents: ["codex", "cursor"] });
    let capturedAgents: readonly string[] | undefined;

    const code = await main(WRITE_ARGS, cap.io, {
      machineConfigPath: configPath,
      loadAgentModelConfig: (agents) => {
        capturedAgents = agents;
        return stubAgentModelConfig(agents);
      },
      executeWriteLoop: async () => completeResult(),
    });

    expect(code).toBe(0);
    expect(capturedAgents).toEqual(["codex", "cursor"]);
  });

  test("invalid machine config exits nonzero without invoking any agent", async () => {
    const cap = captureIo();
    const configPath = writeRawMachineConfig("{ invalid json");
    let loadAgentModelConfigCalled = false;

    const code = await main(WRITE_ARGS, cap.io, {
      machineConfigPath: configPath,
      loadAgentModelConfig: (agents) => {
        loadAgentModelConfigCalled = true;
        return stubAgentModelConfig(agents);
      },
      executeWriteLoop: async () => completeResult(),
    });

    expect(code).toBe(1);
    expect(loadAgentModelConfigCalled).toBe(false);
    expect(cap.read().stderr).toContain("Failed to parse machine config");
  });

  test("write resolves bindings from the agent model config before the loop", async () => {
    const cap = captureIo();
    let captured: WriteLoopInput | undefined;

    await main(WRITE_ARGS, cap.io, {
      loadAgentModelConfig: stubAgentModelConfig,
      machineConfigPath: absentMachineConfigPath(),
      executeWriteLoop: async (input) => {
        captured = input;
        return completeResult();
      },
    });

    expect(captured?.bindings).toHaveLength(1);
    expect(captured?.bindings[0]?.metadata).toEqual({ agent: "claude", model: "m1" });
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

  test("daemon stop reports refusal and does not print stopped", async () => {
    const cap = captureIo();
    const code = await main(["daemon", "stop"], cap.io, {
      stopDaemon: async () => {
        throw new Error("DaemonStopRefusedError: active durable runs: queued-id, live-id");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "Error: DaemonStopRefusedError: active durable runs: queued-id, live-id\n",
    });
  });

  test("daemon stop --force passes force and unsupported args print usage", async () => {
    const cap = captureIo();
    let force: boolean | undefined;
    const forcedCode = await main(["daemon", "stop", "--force"], cap.io, {
      stopDaemon: async (_socket, options) => {
        force = options?.force;
      },
    });
    expect(forcedCode).toBe(0);
    expect(force).toBe(true);
    expect(cap.read().stdout).toBe("stopped\n");

    const invalid = captureIo();
    const invalidCode = await main(["daemon", "stop", "--unexpected"], invalid.io);
    expect(invalidCode).toBe(1);
    expect(invalid.read().stderr).toBe("usage: jarvis daemon <start|stop|status|log>\n");
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

  test("daemon log writes retained bytes to stdout and exits 0", async () => {
    const cap = captureIo();
    const dir = mkdtempSync(join(tmpdir(), "jarvis-cli-daemon-log-"));
    const logPath = join(dir, "daemon.log");
    writeFileSync(logPath, "line one\nline two\n");

    const code = await main(["daemon", "log"], cap.io, { logPath });

    expect(code).toBe(0);
    expect(cap.read()).toEqual({ stdout: "line one\nline two\n", stderr: "" });
  });

  test("daemon log reports the missing configured path on stderr and exits nonzero", async () => {
    const cap = captureIo();
    const dir = mkdtempSync(join(tmpdir(), "jarvis-cli-daemon-log-"));
    const logPath = join(dir, "absent.log");

    const code = await main(["daemon", "log"], cap.io, { logPath });

    expect(code).not.toBe(0);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain(logPath);
  });

  test("daemon log --follow replays retained content then stops on SIGINT with exit 130", async () => {
    const cap = captureIo();
    const dir = mkdtempSync(join(tmpdir(), "jarvis-cli-daemon-log-"));
    const logPath = join(dir, "daemon.log");
    writeFileSync(logPath, "retained\n");
    let sigintHandler: (() => void) | undefined;

    const code = await main(["daemon", "log", "--follow"], cap.io, {
      logPath,
      onSigint: (handler) => {
        sigintHandler = handler;
        queueMicrotask(() => sigintHandler?.());
        return () => {
          sigintHandler = undefined;
        };
      },
    });

    expect(code).toBe(130);
    expect(cap.read().stdout).toBe("retained\n");
  });

  test("daemon log rejects unknown flags and other forms with usage and exit 1", async () => {
    const cap = captureIo();

    const code = await main(["daemon", "log", "--bogus"], cap.io, {});

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain("usage: jarvis daemon log");
  });

  test("daemon rejects unknown subcommands with usage and exit 1", async () => {
    const cap = captureIo();

    const code = await main(["daemon", "bogus"], cap.io, {});

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("usage: jarvis daemon");
  });

  test("run start sends one IPC start request carrying write-loop input and prints run ID", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000001";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;

    let code = NaN;
    try {
      code = await main([...RUN_START_ARGS, "--max-iterations", "4"], cap.io, {
        loadAgentModelConfig: stubAgentModelConfig,
        machineConfigPath: absentMachineConfigPath(),
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
          stepRules: DEFAULT_WRITE_STEP_RULES,
          expectedArtifactPath: "proof.txt",
          maxIterations: 4,
          bindings: [],
          bindingResolution: { role: "implement", agents: ["claude"] },
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

  test("run workflow implement sends start and wait IPC requests, blocks on completion, and prints run ID and wait JSON", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const startRequestId = "00000000-0000-4000-8000-000000000004" as const;
    const waitRequestId = "00000000-0000-4000-8000-000000000040" as const;
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = makeWorkflowUuidManager(startRequestId, waitRequestId) as typeof crypto.randomUUID;

    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    let code = NaN;
    try {
      code = await main(RUN_WORKFLOW_IMPLEMENT_ARGS, cap.io, {
        cwd: () => "/tmp/repo/sub",
        readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
        workflowPresetBuilders: {
          implement: (input) => {
            builtInput = input;
            return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(
            [
              {
                kind: "response",
                id: startRequestId,
                result: { runId: "run-888" },
              },
              {
                kind: "response",
                id: waitRequestId,
                result: {
                  runStatus: "completed",
                  loopOutcomeKind: "complete",
                  iterationsConsumed: 1,
                  resumable: false,
                },
              },
            ],
            { sent },
          ),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(0);
    expect(cap.read()).toEqual({
      stdout:
        'run-888\n{"runStatus":"completed","loopOutcomeKind":"complete","iterationsConsumed":1,"resumable":false}\n',
      stderr: "",
    });
    expect(builtInput).toMatchObject({
      cwd: "/tmp/repo/sub",
      branchName: "implement-run",
      baseRef: "HEAD",
      specPath: "index.md",
      configPath: expect.any(String),
      projectRegistry: { "test-project": { root: "/tmp/repo" } },
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      kind: "request",
      method: "start",
      params: { steps: FAKE_IMPLEMENT_STEPS },
    });
    expect(sent[1]).toMatchObject({
      kind: "request",
      method: "wait",
      params: { runId: "run-888" },
    });
  });

  test("run workflow implement blocks on completion and exits with proper exit code when workflow fails", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const startRequestId = "00000000-0000-4000-8000-000000000041" as const;
    const waitRequestId = "00000000-0000-4000-8000-000000000410" as const;
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = makeWorkflowUuidManager(startRequestId, waitRequestId) as typeof crypto.randomUUID;

    let code = NaN;
    try {
      code = await main(RUN_WORKFLOW_IMPLEMENT_ARGS, cap.io, {
        cwd: () => "/tmp/repo/sub",
        readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: FAKE_IMPLEMENT_STEPS }),
        },
        connectIpcClient: async () =>
          makeIpcClient(
            workflowFrames(startRequestId, waitRequestId, "run-failed", {
              runStatus: "failed",
            }),
            { sent },
          ),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(3);
    expect(cap.read().stdout).toContain("run-failed");
    expect(cap.read().stdout).toContain('{"runStatus":"failed"}');
    expect(sent).toHaveLength(2);
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
        readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: FAKE_IMPLEMENT_STEPS }),
        },
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
        readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
        workflowPresetBuilders: {
          implement: () => ({ ok: true, steps: FAKE_IMPLEMENT_STEPS }),
        },
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
      stderr:
        "usage: jarvis run workflow implement --base <ref> --spec <path> [--branch <name>] [--artifact <path>] [--review-passes <n>] [--review-behavior debate|light]\n",
    });
  });

  test("run workflow implement accepts review-passes before daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const startRequestId = "00000000-0000-4000-8000-000000000009" as const;
    const waitRequestId = "00000000-0000-4000-8000-000000000090" as const;
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = makeWorkflowUuidManager(startRequestId, waitRequestId) as typeof crypto.randomUUID;

    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    let code = NaN;
    try {
      code = await main([...RUN_WORKFLOW_IMPLEMENT_ARGS, "--review-passes", "2"], cap.io, {
        cwd: () => "/tmp/repo/sub",
        readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
        workflowPresetBuilders: {
          implement: (input) => {
            builtInput = input;
            return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(
            workflowFrames(startRequestId, waitRequestId, "run-review-passes", {
              runStatus: "completed",
              loopOutcomeKind: "complete",
              iterationsConsumed: 1,
              resumable: false,
            }),
            { sent },
          ),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(0);
    expect(builtInput).toMatchObject({ reviewPasses: 2 });
    expect(sent).toHaveLength(2);
  });

  test("run workflow implement rejects invalid review-passes before daemon contact", async () => {
    const cap = captureIo();
    const code = await main([...RUN_WORKFLOW_IMPLEMENT_ARGS, "--review-passes", "1x"], cap.io, {
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr:
        "usage: jarvis run workflow implement --base <ref> --spec <path> [--branch <name>] [--artifact <path>] [--review-passes <n>] [--review-behavior debate|light]\n",
    });
  });

  test("run workflow implement uses project implement.reviewPasses when flag is omitted", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({
      projects: { "test-project": { root: "/tmp/repo", implement: { reviewPasses: 3 } } },
    });
    const startRequestId = "00000000-0000-4000-8000-000000000010" as const;
    const waitRequestId = "00000000-0000-4000-8000-000000000100" as const;
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = makeWorkflowUuidManager(startRequestId, waitRequestId) as typeof crypto.randomUUID;

    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    let code = NaN;
    try {
      code = await main(RUN_WORKFLOW_IMPLEMENT_ARGS, cap.io, {
        cwd: () => "/tmp/repo/sub",
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
        workflowPresetBuilders: {
          implement: (input) => {
            builtInput = input;
            return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(
            workflowFrames(startRequestId, waitRequestId, "run-project-default", {
              runStatus: "completed",
              loopOutcomeKind: "complete",
              iterationsConsumed: 1,
              resumable: false,
            }),
          ),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(0);
    expect(builtInput).not.toHaveProperty("reviewPasses");
  });

  test("run workflow implement --review-passes overrides project implement.reviewPasses", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({
      projects: { "test-project": { root: "/tmp/repo", implement: { reviewPasses: 3 } } },
    });
    const startRequestId = "00000000-0000-4000-8000-000000000011" as const;
    const waitRequestId = "00000000-0000-4000-8000-000000000110" as const;
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = makeWorkflowUuidManager(startRequestId, waitRequestId) as typeof crypto.randomUUID;

    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    let code = NaN;
    try {
      code = await main([...RUN_WORKFLOW_IMPLEMENT_ARGS, "--review-passes", "1"], cap.io, {
        cwd: () => "/tmp/repo/sub",
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
        workflowPresetBuilders: {
          implement: (input) => {
            builtInput = input;
            return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(
            workflowFrames(startRequestId, waitRequestId, "run-cli-override", {
              runStatus: "completed",
              loopOutcomeKind: "complete",
              iterationsConsumed: 1,
              resumable: false,
            }),
          ),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(0);
    expect(builtInput).toMatchObject({ reviewPasses: 1 });
  });

  test("run workflow implement rejects invalid project implement.reviewPasses before daemon contact", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({
      projects: { "test-project": { root: "/tmp/repo", implement: { reviewPasses: -1 } } },
    });

    const code = await main(RUN_WORKFLOW_IMPLEMENT_ARGS, cap.io, {
      cwd: () => "/tmp/repo/sub",
      machineConfigPath: configPath,
      readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe("projects.test-project.implement.reviewPasses must be a non-negative integer\n");
  });

  test("run workflow implement rejects unknown review-behavior before daemon contact", async () => {
    const cap = captureIo();
    const code = await main([...RUN_WORKFLOW_IMPLEMENT_ARGS, "--review-behavior", "heavy"], cap.io, {
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr:
        "usage: jarvis run workflow implement --base <ref> --spec <path> [--branch <name>] [--artifact <path>] [--review-passes <n>] [--review-behavior debate|light]\n",
    });
  });

  test("run workflow implement uses project implement.reviewBehavior when flag is omitted", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({
      projects: { "test-project": { root: "/tmp/repo", implement: { reviewBehavior: "light" } } },
    });
    const startRequestId = "00000000-0000-4000-8000-000000000012" as const;
    const waitRequestId = "00000000-0000-4000-8000-000000000120" as const;
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = makeWorkflowUuidManager(startRequestId, waitRequestId) as typeof crypto.randomUUID;

    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    let code = NaN;
    try {
      code = await main(RUN_WORKFLOW_IMPLEMENT_ARGS, cap.io, {
        cwd: () => "/tmp/repo/sub",
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
        workflowPresetBuilders: {
          implement: (input) => {
            builtInput = input;
            return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(
            workflowFrames(startRequestId, waitRequestId, "run-project-review-behavior", {
              runStatus: "completed",
              loopOutcomeKind: "complete",
              iterationsConsumed: 1,
              resumable: false,
            }),
          ),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(0);
    expect(builtInput).not.toHaveProperty("reviewBehavior");
  });

  test("run workflow implement --review-behavior debate overrides project implement.reviewBehavior", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({
      projects: { "test-project": { root: "/tmp/repo", implement: { reviewBehavior: "light" } } },
    });
    const startRequestId = "00000000-0000-4000-8000-000000000013" as const;
    const waitRequestId = "00000000-0000-4000-8000-000000000130" as const;
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = makeWorkflowUuidManager(startRequestId, waitRequestId) as typeof crypto.randomUUID;

    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    let code = NaN;
    try {
      code = await main([...RUN_WORKFLOW_IMPLEMENT_ARGS, "--review-behavior", "debate"], cap.io, {
        cwd: () => "/tmp/repo/sub",
        machineConfigPath: configPath,
        readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
        workflowPresetBuilders: {
          implement: (input) => {
            builtInput = input;
            return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(
            workflowFrames(startRequestId, waitRequestId, "run-review-behavior-override", {
              runStatus: "completed",
              loopOutcomeKind: "complete",
              iterationsConsumed: 1,
              resumable: false,
            }),
          ),
      });
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(0);
    expect(builtInput).toMatchObject({ reviewBehavior: "debate" });
  });

  test("run workflow implement rejects invalid project implement.reviewBehavior before daemon contact", async () => {
    const cap = captureIo();
    const configPath = writeMachineConfig({
      projects: { "test-project": { root: "/tmp/repo", implement: { reviewBehavior: "heavy" } } },
    });

    const code = await main(RUN_WORKFLOW_IMPLEMENT_ARGS, cap.io, {
      cwd: () => "/tmp/repo/sub",
      machineConfigPath: configPath,
      readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toBe('projects.test-project.implement.reviewBehavior must be "debate" or "light"\n');
  });

  test("run workflow implement derives branch from spec parent dirname when branch is omitted", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const startRequestId = "00000000-0000-4000-8000-000000000008" as const;
    const waitRequestId = "00000000-0000-4000-8000-000000000080" as const;
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = makeWorkflowUuidManager(startRequestId, waitRequestId) as typeof crypto.randomUUID;

    let builtInput: BuildImplementWorkflowStepsInput | undefined;

    let code = NaN;
    try {
      code = await main(
        ["run", "workflow", "implement", "--base", "main", "--spec", "v2/spec/my-spec/index.md"],
        cap.io,
        {
          cwd: () => "/tmp/repo",
          readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
          workflowPresetBuilders: {
            implement: (input) => {
              builtInput = input;
              return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
            },
          },
          connectIpcClient: async () =>
            makeIpcClient(
              workflowFrames(startRequestId, waitRequestId, "run-derived-branch", {
                runStatus: "completed",
                loopOutcomeKind: "complete",
                iterationsConsumed: 1,
                resumable: false,
              }),
              { sent },
            ),
        },
      );
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("run-derived-branch");
    expect(cap.read().stdout).toContain('{"runStatus":"completed"');
    expect(builtInput).toMatchObject({
      cwd: "/tmp/repo",
      baseRef: "main",
      specPath: "v2/spec/my-spec/index.md",
      configPath: expect.any(String),
      projectRegistry: { "test-project": { root: "/tmp/repo" } },
    });
  });

  test("run workflow implement requires --artifact for non-index specs and surfaces error without daemon contact", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow", "implement", "--base", "main", "--spec", "spec.md"], cap.io, {
      cwd: () => "/tmp/repo",
      readProjectRegistry: () => ({ "test-project": { root: "/tmp/repo" } }),
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("Non-index spec requires --artifact");
  });

  test("run workflow implement rejects a missing spec before builder or daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    const cap = captureIo();
    const built = false;

    const code = await main(["run", "workflow", "implement", "--base", "main", "--spec", "missing.md"], cap.io, {
      cwd: () => root,
      readProjectRegistry: () => ({ project: { root } }),
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(built).toBe(false);
    expect(cap.read().stderr).toContain(`Spec path does not exist: ${join(root, "missing.md")}`);
  });

  test("run workflow implement rejects a missing non-index artifact before daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    writeFileSync(join(root, "spec.md"), "# Spec\n", "utf8");
    const cap = captureIo();

    const code = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "spec.md", "--artifact", "missing.md"],
      cap.io,
      {
        cwd: () => root,
        readProjectRegistry: () => ({ project: { root } }),
        connectIpcClient: async () => {
          throw new Error("should not contact daemon");
        },
      },
    );

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain(`Artifact path does not exist: ${join(root, "missing.md")}`);
  });

  test("run workflow implement rejects escaping spec and artifact symlinks before builder or daemon contact", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    const outside = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-outside-"));
    writeFileSync(join(outside, "outside.md"), "# Outside\n", "utf8");
    symlinkSync(join(outside, "outside.md"), join(root, "escaped.md"));
    writeFileSync(join(root, "spec.md"), "# Spec\n", "utf8");
    const specCap = captureIo();

    const specCode = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "escaped.md"],
      specCap.io,
      {
        cwd: () => root,
        readProjectRegistry: () => ({ project: { root } }),
        connectIpcClient: async () => {
          throw new Error("should not contact daemon");
        },
      },
    );
    expect(specCode).toBe(1);
    expect(specCap.read().stderr).toContain("Spec path outside registered project roots");

    symlinkSync(join(outside, "outside.md"), join(root, "escaped-artifact.md"));
    const artifactCap = captureIo();
    const artifactCode = await main(
      ["run", "workflow", "implement", "--base", "main", "--spec", "spec.md", "--artifact", "escaped-artifact.md"],
      artifactCap.io,
      {
        cwd: () => root,
        readProjectRegistry: () => ({ project: { root } }),
        connectIpcClient: async () => {
          throw new Error("should not contact daemon");
        },
      },
    );
    expect(artifactCode).toBe(1);
    expect(artifactCap.read().stderr).toContain("Artifact path outside registered project root");
  });

  test("run workflow implement accepts contained symlinks and passes relative paths to the builder", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    mkdirSync(join(root, "specs"));
    writeFileSync(join(root, "specs", "spec.md"), "# Spec\n", "utf8");
    writeFileSync(join(root, "specs", "artifact.md"), "# Artifact\n", "utf8");
    symlinkSync(join(root, "specs", "spec.md"), join(root, "spec-link.md"));
    symlinkSync(join(root, "specs", "artifact.md"), join(root, "artifact-link.md"));
    const cap = captureIo();
    let builtInput: BuildImplementWorkflowStepsInput | undefined;
    const startId = "00000000-0000-4000-8000-000000000020";
    const waitId = "00000000-0000-4000-8000-000000000200";

    const code = await withWorkflowUuids(startId, waitId, () =>
      main(
        ["run", "workflow", "implement", "--base", "main", "--spec", "spec-link.md", "--artifact", "artifact-link.md"],
        cap.io,
        {
          cwd: () => root,
          readProjectRegistry: () => ({ project: { root } }),
          workflowPresetBuilders: {
            implement: (input) => {
              builtInput = input;
              return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
            },
          },
          connectIpcClient: async () =>
            makeIpcClient(
              workflowFrames(startId, waitId, "run-1", {
                runStatus: "completed",
                loopOutcomeKind: "complete",
                iterationsConsumed: 1,
                resumable: false,
              }),
            ),
        },
      ),
    );

    expect(code).toBe(0);
    expect(builtInput).toMatchObject({
      specPath: "spec-link.md",
      artifactPath: "artifact-link.md",
    });
  });

  test("run workflow implement ignores an unresolved registry root unrelated to the spec", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    writeFileSync(join(root, "index.md"), "# Index\n", "utf8");
    const cap = captureIo();
    const startId = "00000000-0000-4000-8000-000000000022";
    const waitId = "00000000-0000-4000-8000-000000000220";

    const code = await withWorkflowUuids(startId, waitId, () =>
      main(["run", "workflow", "implement", "--base", "main", "--spec", "index.md"], cap.io, {
        cwd: () => root,
        readProjectRegistry: () => ({ stale: { root: join(root, "missing") }, project: { root } }),
        workflowPresetBuilders: { implement: () => ({ ok: true, steps: FAKE_IMPLEMENT_STEPS }) },
        connectIpcClient: async () =>
          makeIpcClient(
            workflowFrames(startId, waitId, "run-1", {
              runStatus: "completed",
              loopOutcomeKind: "complete",
              iterationsConsumed: 1,
              resumable: false,
            }),
          ),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("run-1");
    expect(cap.read().stdout).toContain('{"runStatus":"completed"');
  });

  test("run workflow implement ignores --artifact for index specs", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cli-implement-project-"));
    writeFileSync(join(root, "index.md"), "# Index\n", "utf8");
    const cap = captureIo();
    let builtInput: BuildImplementWorkflowStepsInput | undefined;
    const startId = "00000000-0000-4000-8000-000000000021";
    const waitId = "00000000-0000-4000-8000-000000000210";

    const code = await withWorkflowUuids(startId, waitId, () =>
      main(
        ["run", "workflow", "implement", "--base", "main", "--spec", "index.md", "--artifact", "missing.md"],
        cap.io,
        {
          cwd: () => root,
          readProjectRegistry: () => ({ project: { root } }),
          workflowPresetBuilders: {
            implement: (input) => {
              builtInput = input;
              return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
            },
          },
          connectIpcClient: async () =>
            makeIpcClient(
              workflowFrames(startId, waitId, "run-1", {
                runStatus: "completed",
                loopOutcomeKind: "complete",
                iterationsConsumed: 1,
                resumable: false,
              }),
            ),
        },
      ),
    );

    expect(code).toBe(0);
    expect(builtInput).toMatchObject({ specPath: "index.md", artifactPath: "missing.md" });
  });

  test("run workflow implement surfaces a builder error without contacting the daemon", async () => {
    const cap = captureIo();

    const code = await main(RUN_WORKFLOW_IMPLEMENT_ARGS, cap.io, {
      cwd: () => "/tmp/unregistered",
      readProjectRegistry: () => ({}),
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("Spec path outside registered project roots");
  });

  test("run workflow intent builds seed text before one daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const startRequestId = "00000000-0000-4000-8000-000000000007" as const;
    const waitRequestId = "00000000-0000-4000-8000-000000000070" as const;
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = makeWorkflowUuidManager(startRequestId, waitRequestId) as typeof crypto.randomUUID;
    let received: unknown;
    try {
      const code = await main(["run", "workflow", "intent", "--seed-text", "Improve API"], cap.io, {
        cwd: () => "/tmp/repo",
        workflowPresetBuilders: {
          intent: (input) => {
            received = input;
            return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(
            workflowFrames(startRequestId, waitRequestId, "intent-1", {
              runStatus: "completed",
              loopOutcomeKind: "complete",
              iterationsConsumed: 1,
              resumable: false,
            }),
            { sent },
          ),
      });
      expect(code).toBe(0);
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }
    expect(received).toMatchObject({ cwd: "/tmp/repo", seedText: "Improve API" });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start", params: { steps: FAKE_IMPLEMENT_STEPS } });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "intent-1" } });
    expect(cap.read().stdout).toContain("intent-1");
    expect(cap.read().stdout).toContain('{"runStatus":"completed"');
  });

  test("run workflow intent rejects invalid seed arguments before daemon contact", async () => {
    const cap = captureIo();
    const code = await main(["run", "workflow", "intent", "--seed", "one", "--seed-text", "two"], cap.io, {
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });
    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr:
        "usage: jarvis run workflow intent (--seed <path> | --seed-text <text>) [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]\n",
    });
  });

  test("run workflow intent-reviewed builds seed text with default review passes before one daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const startRequestId = "00000000-0000-4000-8000-000000000008" as const;
    const waitRequestId = "00000000-0000-4000-8000-000000000080" as const;
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = makeWorkflowUuidManager(startRequestId, waitRequestId) as typeof crypto.randomUUID;
    let received: unknown;
    try {
      const code = await main(["run", "workflow", "intent-reviewed", "--seed-text", "Improve API"], cap.io, {
        cwd: () => "/tmp/repo",
        workflowPresetBuilders: {
          "intent-reviewed": (input) => {
            received = input;
            return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
          },
        },
        connectIpcClient: async () =>
          makeIpcClient(
            workflowFrames(startRequestId, waitRequestId, "intent-reviewed-1", {
              runStatus: "completed",
              loopOutcomeKind: "complete",
              iterationsConsumed: 1,
              resumable: false,
            }),
            { sent },
          ),
      });
      expect(code).toBe(0);
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }
    expect(received).toMatchObject({ cwd: "/tmp/repo", seedText: "Improve API" });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start", params: { steps: FAKE_IMPLEMENT_STEPS } });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "intent-reviewed-1" } });
    expect(cap.read().stdout).toContain("intent-reviewed-1");
    expect(cap.read().stdout).toContain('{"runStatus":"completed"');
  });

  test("run workflow intent-reviewed accepts review-passes before daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000009";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;
    let received: unknown;
    try {
      const code = await main(
        ["run", "workflow", "intent-reviewed", "--seed-text", "Improve API", "--review-passes", "2"],
        cap.io,
        {
          cwd: () => "/tmp/repo",
          workflowPresetBuilders: {
            "intent-reviewed": (input) => {
              received = input;
              return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
            },
          },
          connectIpcClient: async () =>
            makeIpcClient(
              [
                { kind: "response", id: requestId, result: { runId: "intent-reviewed-2" } },
                { kind: "response", id: requestId, result: COMPLETED_WAIT_RESULT },
              ],
              { sent },
            ),
        },
      );
      expect(code).toBe(0);
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }
    expect(received).toMatchObject({ cwd: "/tmp/repo", seedText: "Improve API", reviewPasses: 2 });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start", params: { steps: FAKE_IMPLEMENT_STEPS } });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "intent-reviewed-2" } });
    expect(cap.read()).toEqual({
      stdout: `intent-reviewed-2\n${COMPLETED_WAIT_JSON}\n`,
      stderr: "deprecated: use intent --review-passes 1 --review-behavior light\n",
    });
  });

  test("run workflow intent-reviewed rejects invalid review-passes before daemon contact", async () => {
    const cap = captureIo();
    const code = await main(
      ["run", "workflow", "intent-reviewed", "--seed-text", "Improve API", "--review-passes", "invalid"],
      cap.io,
      {
        connectIpcClient: async () => {
          throw new Error("should not contact daemon");
        },
      },
    );
    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr:
        "usage: jarvis run workflow intent (--seed <path> | --seed-text <text>) [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]\n",
    });
  });

  test("run workflow intent rejects review-passes before daemon contact", async () => {
    const cap = captureIo();
    const code = await main(
      ["run", "workflow", "intent", "--seed-text", "Improve API", "--review-passes", "1x"],
      cap.io,
      {
        connectIpcClient: async () => {
          throw new Error("should not contact daemon");
        },
      },
    );
    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr:
        "usage: jarvis run workflow intent (--seed <path> | --seed-text <text>) [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]\n",
    });
  });

  test("run workflow plan-reviewed routes review passes before one daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000010";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;
    let received: unknown;
    try {
      const code = await main(
        ["run", "workflow", "plan-reviewed", "--ready-intent", "spec/ready-intents/demo.md", "--review-passes", "2"],
        cap.io,
        {
          cwd: () => "/tmp/repo",
          workflowPresetBuilders: {
            "plan-reviewed": (input) => {
              received = input;
              return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
            },
          },
          connectIpcClient: async () =>
            makeIpcClient(
              [
                { kind: "response", id: requestId, result: { runId: "plan-reviewed-2" } },
                { kind: "response", id: requestId, result: COMPLETED_WAIT_RESULT },
              ],
              { sent },
            ),
        },
      );
      expect(code).toBe(0);
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }
    expect(received).toMatchObject({
      cwd: "/tmp/repo",
      readyIntent: "spec/ready-intents/demo.md",
      reviewPasses: 2,
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start" });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "plan-reviewed-2" } });
    expect(cap.read()).toEqual({
      stdout: `plan-reviewed-2\n${COMPLETED_WAIT_JSON}\n`,
      stderr: "deprecated: use plan --review-passes 1 --review-behavior debate\n",
    });
  });

  test("run workflow plan-reviewed rejects invalid review passes before daemon contact", async () => {
    const cap = captureIo();
    const code = await main(
      ["run", "workflow", "plan-reviewed", "--ready-intent", "spec/ready-intents/demo.md", "--review-passes", "-1"],
      cap.io,
      {
        connectIpcClient: async () => {
          throw new Error("should not contact daemon");
        },
      },
    );
    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr:
        "usage: jarvis run workflow plan --ready-intent <path> [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]\n",
    });
  });

  test("run workflow plan-reviewed-light routes review passes before one daemon start", async () => {
    const cap = captureIo();
    const sent: unknown[] = [];
    const requestId = "00000000-0000-4000-8000-000000000011";
    const originalRandomUuid = crypto.randomUUID;
    crypto.randomUUID = () => requestId;
    let received: unknown;
    try {
      const code = await main(
        [
          "run",
          "workflow",
          "plan-reviewed-light",
          "--ready-intent",
          "spec/ready-intents/demo.md",
          "--review-passes",
          "2",
        ],
        cap.io,
        {
          cwd: () => "/tmp/repo",
          workflowPresetBuilders: {
            "plan-reviewed-light": (input) => {
              received = input;
              return { ok: true, steps: FAKE_IMPLEMENT_STEPS };
            },
          },
          connectIpcClient: async () =>
            makeIpcClient(
              [
                { kind: "response", id: requestId, result: { runId: "plan-reviewed-light-2" } },
                { kind: "response", id: requestId, result: COMPLETED_WAIT_RESULT },
              ],
              { sent },
            ),
        },
      );
      expect(code).toBe(0);
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }
    expect(received).toMatchObject({
      cwd: "/tmp/repo",
      readyIntent: "spec/ready-intents/demo.md",
      reviewPasses: 2,
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "request", method: "start" });
    expect(sent[1]).toMatchObject({ kind: "request", method: "wait", params: { runId: "plan-reviewed-light-2" } });
    expect(cap.read()).toEqual({
      stdout: `plan-reviewed-light-2\n${COMPLETED_WAIT_JSON}\n`,
      stderr: "deprecated: use plan --review-passes 1 --review-behavior light\n",
    });
  });

  test("run workflow plan-reviewed-light rejects invalid review passes before daemon contact", async () => {
    for (const passes of ["-1", "1x", "1.5"]) {
      const cap = captureIo();
      const code = await main(
        [
          "run",
          "workflow",
          "plan-reviewed-light",
          "--ready-intent",
          "spec/ready-intents/demo.md",
          "--review-passes",
          passes,
        ],
        cap.io,
        {
          connectIpcClient: async () => {
            throw new Error("should not contact daemon");
          },
        },
      );
      expect(code).toBe(1);
      expect(cap.read()).toEqual({
        stdout: "",
        stderr:
          "usage: jarvis run workflow plan --ready-intent <path> [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]\n",
      });
    }
  });

  test("run workflow plan-reviewed-light rejects review-behavior before daemon contact", async () => {
    const cap = captureIo();
    const code = await main(
      [
        "run",
        "workflow",
        "plan-reviewed-light",
        "--ready-intent",
        "spec/ready-intents/demo.md",
        "--review-behavior",
        "heavy",
      ],
      cap.io,
      {
        connectIpcClient: async () => {
          throw new Error("should not contact daemon");
        },
      },
    );
    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr:
        "usage: jarvis run workflow plan --ready-intent <path> [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]\n",
    });
  });

  test("run workflow plan rejects review-passes before daemon contact", async () => {
    const cap = captureIo();
    const code = await main(
      ["run", "workflow", "plan", "--ready-intent", "spec/ready-intents/demo.md", "--review-passes", "1x"],
      cap.io,
      {
        connectIpcClient: async () => {
          throw new Error("should not contact daemon");
        },
      },
    );
    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr:
        "usage: jarvis run workflow plan --ready-intent <path> [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]\n",
    });
  });

  test("run workflow with an unrecognized preset name prints workflow usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow", "bogus"], cap.io, {
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "usage: jarvis run workflow <intent|plan|implement> [flags]\n",
    });
  });

  test("run workflow rejects inherited preset names without contacting the daemon", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow", "toString"], cap.io, {
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "usage: jarvis run workflow <intent|plan|implement> [flags]\n",
    });
  });

  test("bare run workflow prints workflow usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["run", "workflow"], cap.io, {
      connectIpcClient: async () => {
        throw new Error("should not contact daemon");
      },
    });

    expect(code).toBe(1);
    expect(cap.read()).toEqual({
      stdout: "",
      stderr: "usage: jarvis run workflow <intent|plan|implement> [flags]\n",
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
      {
        runId: "run-123",
        seq: 4,
        ts: "2026-01-01T00:00:04.000Z",
        event: { kind: "run_reconciled", runStatus: "killed", reason: "daemon_restart" },
      },
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
              { kind: "stream-data", streamId, payload: JSON.stringify(records[3]) },
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
      stdout: `${JSON.stringify(records[0])}\n${JSON.stringify(records[1])}\n${JSON.stringify(records[2])}\n${JSON.stringify(records[3])}\n`,
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
