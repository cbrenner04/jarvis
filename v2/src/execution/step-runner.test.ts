import { describe, expect, test } from "bun:test";
import type { InvocationBinding, InvocationCompletedRecord } from "../../../shared/invocation/execute.ts";
import { resolveInvocationBindings } from "../config/agent-model-config.ts";
import { parseStepOutcomeToken, runStep, type StepContract } from "./step-runner.ts";

function okBinding(stdout: string): InvocationBinding {
  return {
    id: "agent",
    metadata: { agent: "claude", model: "m1" },
    invoke: async () => ({ kind: "ok", stdout, stderr: "" }),
  };
}

const IMPLEMENT_CONFIG = {
  claude: {
    implement: {
      rungs: [
        { adapterModel: "M1", priceKey: "P1" },
        { adapterModel: "M2", priceKey: "P2" },
      ],
    },
  },
  codex: {
    implement: {
      rungs: [{ adapterModel: "M3", priceKey: "P3" }],
    },
  },
};

function createImplementBindings(
  invoke: (binding: { agentId: string; adapterModel: string }) => InvocationBinding["invoke"],
): readonly InvocationBinding[] {
    return resolveInvocationBindings("implement", ["claude", "codex"], IMPLEMENT_CONFIG, (binding) => ({
      id: `${binding.agentId}/${binding.adapterModel}`,
      metadata: {
        agent: binding.agentId,
        model: binding.adapterModel,
      },
      invoke: invoke(binding),
    }));
}

describe("step runner token parsing", () => {
  test("accepts all terminal tokens", () => {
    expect(parseStepOutcomeToken("done")).toBe("done");
    expect(parseStepOutcomeToken("no-work\n")).toBe("no-work");
    expect(parseStepOutcomeToken(" blocked ")).toBe("blocked");
    expect(parseStepOutcomeToken("progress")).toBe("progress");
  });

  test("rejects unknown token", () => {
    expect(parseStepOutcomeToken("finished")).toBeNull();
  });

  test("extracts token from prose output", () => {
    expect(parseStepOutcomeToken("I updated the file.\nFinal: progress\n")).toBe("progress");
  });
});

describe("step runner classification", () => {
  test("progress returns typed non-complete result and skips contracts", async () => {
    let contractCalls = 0;
    const contracts: StepContract[] = [
      {
        id: "never",
        check: () => {
          contractCalls += 1;
          return true;
        },
      },
    ];

    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [okBinding("progress")],
      contracts,
    });

    expect(result.kind).toBe("progress");
    expect(contractCalls).toBe(0);
  });

  test("blocked returns typed blocked result and skips contracts", async () => {
    let contractCalls = 0;
    const contracts: StepContract[] = [
      {
        id: "never",
        check: () => {
          contractCalls += 1;
          return true;
        },
      },
    ];

    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [okBinding("blocked")],
      contracts,
    });

    expect(result.kind).toBe("blocked");
    expect(contractCalls).toBe(0);
  });

  test("done with passing contract returns complete", async () => {
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [okBinding("done")],
      contracts: [{ id: "pass", check: () => true }],
    });

    expect(result.kind).toBe("complete");
    if (result.kind === "complete") {
      expect(result.token).toBe("done");
    }
  });

  test("no-work with failing contract returns contract miss", async () => {
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [okBinding("no-work")],
      contracts: [{ id: "artifact", check: () => false }],
    });

    expect(result.kind).toBe("contract_miss");
    if (result.kind === "contract_miss") {
      expect(result.failedContractId).toBe("artifact");
      expect(result.token).toBe("no-work");
    }
  });

  test("contract miss does not trigger a second invocation", async () => {
    let invocations = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async () => {
          invocations += 1;
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings,
      contracts: [{ id: "artifact", check: () => false }],
    });

    expect(result.kind).toBe("contract_miss");
    expect(invocations).toBe(1);
  });

  test("quota advances across resolved bindings and lands on the next agent head rung", async () => {
    const invocations: string[] = [];
    const bindings = createImplementBindings(({ agentId, adapterModel }) => async () => {
      invocations.push(`${agentId}/${adapterModel}`);
      if (adapterModel !== "M3") {
        return { kind: "quota", stderr: "quota" } as const;
      }
      return { kind: "ok", stdout: "done", stderr: "" } as const;
    });

    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings,
      contracts: [],
    });

    expect(result.kind).toBe("complete");
    expect(invocations).toEqual(["claude/M1", "claude/M2", "codex/M3"]);
  });

  test("model_config after quota stops on the current resolved binding", async () => {
    const invocations: string[] = [];
    const bindings = createImplementBindings(({ agentId, adapterModel }) => async () => {
      invocations.push(`${agentId}/${adapterModel}`);
      if (adapterModel === "M1") {
        return { kind: "quota", stderr: "quota" } as const;
      }
      if (adapterModel === "M2") {
        return { kind: "model_config", stderr: "bad model" } as const;
      }
      return { kind: "ok", stdout: "done", stderr: "" } as const;
    });

    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings,
      contracts: [],
    });

    expect(result.kind).toBe("invocation_failure");
    if (result.kind === "invocation_failure") {
      expect(result.failureKind).toBe("model_config");
    }
    expect(invocations).toEqual(["claude/M1", "claude/M2"]);
  });

  test("error after quota stops on the current resolved binding", async () => {
    const invocations: string[] = [];
    const bindings = createImplementBindings(({ agentId, adapterModel }) => async () => {
      invocations.push(`${agentId}/${adapterModel}`);
      if (adapterModel === "M1") {
        return { kind: "quota", stderr: "quota" } as const;
      }
      if (adapterModel === "M2") {
        return { kind: "error", exitCode: 1, stderr: "boom" } as const;
      }
      return { kind: "ok", stdout: "done", stderr: "" } as const;
    });

    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings,
      contracts: [],
    });

    expect(result.kind).toBe("invocation_failure");
    if (result.kind === "invocation_failure") {
      expect(result.failureKind).toBe("error");
    }
    expect(invocations).toEqual(["claude/M1", "claude/M2"]);
  });

  test("settled invocations still emit telemetry when runner later returns contract_miss or invalid_token", async () => {
    const rows: InvocationCompletedRecord[] = [];
    const telemetry = {
      sink: {
        append(record: InvocationCompletedRecord) {
          rows.push(record);
        },
      },
      operatorSessionId: "session-1",
      runId: "run-1",
      attemptId: "attempt-1",
      project: "demo",
      workflow: "write",
      stepId: "step-1",
      role: "implement",
      worktreePath: "/tmp/worktree",
      branch: "demo-branch",
      specRef: "HEAD",
      invocationIds: ["inv-1"],
    } as const;

    const contractMiss = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [okBinding("done")],
      contracts: [{ id: "artifact", check: () => false }],
      telemetry,
    });
    const invalidToken = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [okBinding("not-a-token")],
      contracts: [],
      telemetry: { ...telemetry, invocationIds: ["inv-2"] },
    });

    expect(contractMiss.kind).toBe("contract_miss");
    expect(invalidToken.kind).toBe("invalid_token");
    expect(rows.map((row) => row.invocation_id)).toEqual(["inv-1", "inv-2"]);
    expect(rows.map((row) => row.exit_kind)).toEqual(["ok", "ok"]);
  });
});
