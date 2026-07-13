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

function writeStepTelemetry(rows: InvocationCompletedRecord[], invocationIds: readonly string[]) {
  return {
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
    invocationIds,
  } as const;
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
    const telemetry = writeStepTelemetry(rows, ["inv-1"]);

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
      contracts: [{ id: "artifact", check: () => false }],
      telemetry: writeStepTelemetry(rows, ["inv-2"]),
    });

    expect(contractMiss.kind).toBe("contract_miss");
    expect(invalidToken.kind).toBe("invalid_token");
    // The token-less response also fires the runner's one token-only re-prompt, which
    // emits its own row keyed by a freshly minted invocation id.
    expect(rows.map((row) => row.invocation_id).slice(0, 2)).toEqual(["inv-1", "inv-2"]);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.exit_kind)).toEqual(["ok", "ok", "ok"]);
  });
});

describe("step runner token re-prompt", () => {
  function sequencedBinding(replies: readonly string[]): InvocationBinding {
    let call = 0;
    return {
      id: "agent",
      metadata: { agent: "claude", model: "m1" },
      invoke: async () => {
        const reply = replies[call] ?? replies[replies.length - 1] ?? "";
        call += 1;
        return { kind: "ok", stdout: reply, stderr: "" };
      },
    };
  }

  test("token-less response triggers exactly one re-prompt whose token classifies normally", async () => {
    let invocations = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async () => {
          invocations += 1;
          return { kind: "ok", stdout: invocations === 1 ? "I did some work." : "done", stderr: "" };
        },
      },
    ];

    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings,
      contracts: [{ id: "pass", check: () => true }],
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("complete");
    if (result.kind === "complete") expect(result.token).toBe("done");
    expect(result.reprompt?.responseText).toBe("I did some work.");
  });

  test("empty first response triggers the re-prompt", async () => {
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [sequencedBinding(["", "progress"])],
      contracts: [],
    });

    expect(result.kind).toBe("progress");
    expect(result.reprompt?.responseText).toBe("");
  });

  test("missing token with passing contracts returns complete with done", async () => {
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [sequencedBinding(["wrote the artifact", "still no token"])],
      contracts: [{ id: "artifact.exists", check: () => true }],
    });

    expect(result.kind).toBe("complete");
    if (result.kind === "complete") expect(result.token).toBe("done");
  });

  test("missing token with failing contract returns invalid_token not contract_miss", async () => {
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [sequencedBinding(["wrote the artifact", "still no token"])],
      contracts: [{ id: "artifact.exists", check: () => false }],
    });

    expect(result.kind).toBe("invalid_token");
    if (result.kind === "invalid_token") expect(result.tokenText).toBe("wrote the artifact");
  });

  test("missing token with plan draft contracts passes when shape is valid", async () => {
    const contracts: StepContract[] = [
      { id: "plan.draft.blocker", check: () => true },
      { id: "artifact.exists", check: () => true },
    ];

    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [sequencedBinding(["created index.md and 00-subspec.md", "no token here"])],
      contracts,
    });

    expect(result.kind).toBe("complete");
    if (result.kind === "complete") expect(result.token).toBe("done");
  });

  test("missing token with plan draft blocker contract does not complete", async () => {
    const contracts: StepContract[] = [
      { id: "plan.draft.blocker", check: () => false },
      { id: "artifact.exists", check: () => true },
    ];

    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [sequencedBinding(["appended blocker to intent.md", "no token here"])],
      contracts,
    });

    expect(result.kind).toBe("invalid_token");
    if (result.kind === "invalid_token") expect(result.tokenText).toBe("appended blocker to intent.md");
  });

  test("second miss classifies as invalid_token with the first response's text", async () => {
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [sequencedBinding(["not a token", "still not a token"])],
      contracts: [{ id: "artifact.exists", check: () => false }],
    });

    expect(result.kind).toBe("invalid_token");
    if (result.kind === "invalid_token") expect(result.tokenText).toBe("not a token");
  });

  test("hedging re-prompt reply is a second miss, not progress", async () => {
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [sequencedBinding(["", "done, no-work, blocked, or progress?"])],
      contracts: [{ id: "artifact.exists", check: () => false }],
    });

    expect(result.kind).toBe("invalid_token");
  });

  test("first invocation failure classifies as invocation_failure and triggers no re-prompt", async () => {
    let invocations = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async () => {
          invocations += 1;
          return { kind: "quota", stderr: "quota" };
        },
      },
    ];

    const result = await runStep({ prompt: "p", cwd: "/tmp", bindings, contracts: [] });

    expect(result.kind).toBe("invocation_failure");
    if (result.kind === "invocation_failure") expect(result.failureKind).toBe("quota");
    expect(invocations).toBe(1);
    expect(result.reprompt).toBeUndefined();
  });

  test("first response carrying a token triggers no re-prompt", async () => {
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
      contracts: [{ id: "pass", check: () => true }],
    });

    expect(invocations).toBe(1);
    expect(result.kind).toBe("complete");
    expect(result.reprompt).toBeUndefined();
  });

  test("re-prompt fires at most once: a token-less re-prompt reply does not trigger a third invocation", async () => {
    let invocations = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async () => {
          invocations += 1;
          return { kind: "ok", stdout: "not a token", stderr: "" };
        },
      },
    ];

    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings,
      contracts: [{ id: "artifact.exists", check: () => false }],
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("invalid_token");
  });

  test("a failed re-prompt invocation classifies as invalid_token when contracts fail", async () => {
    let invocations = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async () => {
          invocations += 1;
          if (invocations === 1) return { kind: "ok", stdout: "not a token", stderr: "" };
          return { kind: "quota", stderr: "quota" };
        },
      },
    ];

    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings,
      contracts: [{ id: "artifact.exists", check: () => false }],
    });

    expect(result.kind).toBe("invalid_token");
    if (result.kind === "invalid_token") expect(result.tokenText).toBe("not a token");
  });

  test("a failed re-prompt invocation classifies as complete when contracts pass", async () => {
    let invocations = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async () => {
          invocations += 1;
          if (invocations === 1) return { kind: "ok", stdout: "wrote files", stderr: "" };
          return { kind: "quota", stderr: "quota" };
        },
      },
    ];

    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings,
      contracts: [{ id: "artifact.exists", check: () => true }],
    });

    expect(result.kind).toBe("complete");
    if (result.kind === "complete") expect(result.token).toBe("done");
  });

  test("a re-prompted done whose expected artifact is absent classifies as contract_miss", async () => {
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [sequencedBinding(["", "done"])],
      contracts: [{ id: "artifact", check: () => false }],
    });

    expect(result.kind).toBe("contract_miss");
    if (result.kind === "contract_miss") expect(result.failedContractId).toBe("artifact");
  });

  test("returned invocation stays the original step invocation, not the re-prompt's", async () => {
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [sequencedBinding(["not a token", "done"])],
      contracts: [{ id: "pass", check: () => true }],
    });

    expect(result.kind).toBe("complete");
    expect(result.invocation.final?.result).toEqual({ kind: "ok", stdout: "not a token", stderr: "" });
    expect(result.reprompt?.invocation.final?.result).toEqual({ kind: "ok", stdout: "done", stderr: "" });
  });

  test("re-prompt mints one fresh invocation id per binding, distinct from the step's", async () => {
    const rows: InvocationCompletedRecord[] = [];
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [sequencedBinding(["not a token", "done"])],
      contracts: [{ id: "pass", check: () => true }],
      telemetry: writeStepTelemetry(rows, ["step-inv-1"]),
    });

    expect(result.kind).toBe("complete");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.invocation_id).toBe("step-inv-1");
    expect(rows[1]?.invocation_id).not.toBe("step-inv-1");
  });
});
