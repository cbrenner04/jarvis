import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WriteLoopInput, WriteLoopResult } from "../execution/write-loop.ts";
import { applyOperatorSessionId } from "../execution/write-loop.ts";
import {
  absentMachineConfigPath,
  type CliRepoFixture,
  captureIo,
  completeResult,
  cliMain as main,
  makeCliRepoFixture,
  stubAgentModelConfig,
  writeHomeMachineConfig,
  writeMachineConfig,
  writeRawMachineConfig,
} from "../testing/cli-test-helpers.ts";
import { mockWriteLoopInput } from "../testing/run-control.ts";

let fx: CliRepoFixture;

const homeWriteMachineConfigPath = writeHomeMachineConfig({ agents: ["claude"] });

beforeAll(() => {
  fx = makeCliRepoFixture();
});

afterAll(() => {
  fx.cleanup();
});

describe("write command", () => {
  test("missing required write args prints usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main(["write", "--project", "demo"], cap.io);

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toContain("usage: jarvis write");
  });

  test("invalid --max-iterations prints usage and exits 1", async () => {
    const cap = captureIo();

    const code = await main([...fx.writeArgs, "--max-iterations", "0"], cap.io, {
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

    const code = await main([...fx.writeArgs, "--unknown", "x"], cap.io);

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

    const code = await main(fx.writeArgs, cap.io, {
      machineConfigPath: homeWriteMachineConfigPath,
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
      await main(fx.writeArgs, cap.io, {
        machineConfigPath: homeWriteMachineConfigPath,
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
    await main(fx.writeArgs, cap.io, {
      machineConfigPath: homeWriteMachineConfigPath,
      loadAgentModelConfig: stubAgentModelConfig,
      executeWriteLoop: async () => withDetail,
    });
    const parsed = JSON.parse(cap.read().stdout) as Record<string, unknown>;
    expect(parsed.failureKind).toBe("quota");
    expect(parsed.bindingAttempts).toEqual(withDetail.bindingAttempts);
  });

  test("write resolves iterationTimeoutMs and iterationCeilingMs from machine config", async () => {
    const cap = captureIo();
    const configPath = writeHomeMachineConfig({
      iterationTimeoutMs: 600_000,
      iterationCeilingMs: 1_800_000,
      idleOutputTimeoutMs: 0,
    });
    let capturedTimeout: number | undefined;
    let capturedCeiling: number | undefined;

    const code = await main(fx.writeArgs, cap.io, {
      machineConfigPath: configPath,
      loadAgentModelConfig: stubAgentModelConfig,
      executeWriteLoop: async (input) => {
        capturedTimeout = input.iterationTimeoutMs;
        capturedCeiling = input.iterationCeilingMs;
        return completeResult();
      },
    });

    expect(code).toBe(0);
    expect(capturedTimeout).toBe(600_000);
    expect(capturedCeiling).toBe(1_800_000);
  });

  test("write rejects inverted write-path iteration bounds before the loop", async () => {
    const cap = captureIo();
    const configPath = writeHomeMachineConfig({
      iterationTimeoutMs: 60_000,
      idleOutputTimeoutMs: 120_000,
      iterationCeilingMs: 1_800_000,
    });
    let executeCalled = false;

    const code = await main(fx.writeArgs, cap.io, {
      machineConfigPath: configPath,
      loadAgentModelConfig: stubAgentModelConfig,
      executeWriteLoop: async () => {
        executeCalled = true;
        return completeResult();
      },
    });

    expect(code).toBe(1);
    expect(executeCalled).toBe(false);
    expect(cap.read().stderr).toContain("idleOutputTimeoutMs' (120000)");
    expect(cap.read().stderr).toContain("iterationTimeoutMs' (60000)");
  });

  test("mints an operatorSessionId when no caller-supplied telemetry is present", async () => {
    const cap = captureIo();
    let capturedInput: WriteLoopInput | undefined;

    await main(fx.writeArgs, cap.io, {
      machineConfigPath: homeWriteMachineConfigPath,
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

    await main(fx.writeArgs, cap.io, {
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
    const configPath = writeHomeMachineConfig({ agents: ["codex", "cursor"] });
    let capturedAgents: readonly string[] | undefined;

    const code = await main(fx.writeArgs, cap.io, {
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

    const code = await main(fx.writeArgs, cap.io, {
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

    await main(fx.writeArgs, cap.io, {
      loadAgentModelConfig: stubAgentModelConfig,
      machineConfigPath: homeWriteMachineConfigPath,
      executeWriteLoop: async (input) => {
        captured = input;
        return completeResult();
      },
    });

    expect(captured?.bindings).toHaveLength(1);
    expect(captured?.bindings[0]?.metadata).toEqual({ agent: "claude", model: "claude-sonnet-5" });
  });
});
