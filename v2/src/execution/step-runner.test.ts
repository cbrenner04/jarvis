import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationBinding, InvocationCompletedRecord } from "../../../shared/invocation/execute.ts";
import type { SessionLog, SessionLogTag } from "../../../shared/invocation/session-log.ts";
import { resolveInvocationBindings } from "../config/agent-model-config.ts";
import { parseStepOutcomeToken, runStep, type StepContract } from "./step-runner.ts";

function fakeSessionLog(): { log: SessionLog; lines: { tag: SessionLogTag; text: string }[] } {
  const lines: { tag: SessionLogTag; text: string }[] = [];
  return {
    lines,
    log: {
      append(tag, text) {
        if (text === "") return;
        lines.push({ tag, text });
      },
      close() {},
    },
  };
}

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
      contracts: [{ id: "artifact", reason: "static", check: () => false }],
    });

    expect(result.kind).toBe("contract_miss");
    if (result.kind === "contract_miss") {
      expect(result.failedContractId).toBe("artifact");
      expect(result.token).toBe("no-work");
      expect(result.failureReason).toBe("static");
    }
  });

  test("contract miss prefers check-returned reason over static contract reason", async () => {
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [okBinding("done")],
      contracts: [
        {
          id: "artifact",
          reason: "static",
          check: () => ({ ok: false, reason: "dynamic" }),
        },
      ],
    });

    expect(result.kind).toBe("contract_miss");
    if (result.kind === "contract_miss") {
      expect(result.failedContractId).toBe("artifact");
      expect(result.failureReason).toBe("dynamic");
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

  test("zero-exit codex quota advances to next binding", async () => {
    const invocations: string[] = [];
    const bindings = createImplementBindings(({ agentId, adapterModel }) => async () => {
      invocations.push(`${agentId}/${adapterModel}`);
      if (adapterModel === "M1") {
        return { kind: "quota", stderr: "You've hit your usage limit" } as const;
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

  test("session log gets harness/outbound for the first invocation and the re-prompt", async () => {
    const { log, lines } = fakeSessionLog();

    await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [sequencedBinding(["", "progress"])],
      contracts: [],
      sessionLog: log,
    });

    expect(lines.filter((l) => l.tag === "harness")).toHaveLength(2);
    expect(lines.filter((l) => l.tag === "outbound").map((l) => l.text)).toEqual(["p", expect.any(String)]);
    expect(lines.filter((l) => l.tag === "inbound_stdout").map((l) => l.text)).toEqual(["progress"]);
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

  // Simulates a real agent's own idle-output watchdog: it only stalls the reprompt call when
  // it actually received an armed (positive) idleOutputMs, same as shared/invocation/agents.ts.
  function armedStallOnRepromptBinding(): InvocationBinding {
    let call = 0;
    return {
      id: "agent",
      metadata: { agent: "claude", model: "opus" },
      invoke: async ({ idleOutputMs }) => {
        call += 1;
        if (call === 1) return { kind: "ok", stdout: "no token here", stderr: "" };
        if (idleOutputMs !== undefined && idleOutputMs > 0) return { kind: "stall", stderr: "no output" };
        return { kind: "ok", stdout: "still no token", stderr: "" };
      },
    };
  }

  test("a silent token reprompt settles idle_output_timeout, not invalid_token", async () => {
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [armedStallOnRepromptBinding()],
      contracts: [],
      idleOutputMs: 5,
    });

    expect(result.kind).toBe("stall");
    if (result.kind === "stall") {
      expect(result.boundMs).toBe(5);
      expect(result.agent).toBe("claude");
      expect(result.model).toBe("opus");
    }
  });

  test("a healthy token reprompt that emits a terminal token settles on that token, no idle outcome", async () => {
    let call = 0;
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            call += 1;
            return { kind: "ok", stdout: call === 1 ? "no token here" : "done", stderr: "" };
          },
        },
      ],
      contracts: [{ id: "pass", check: () => true }],
      idleOutputMs: 5,
    });

    expect(result.kind).toBe("complete");
    if (result.kind === "complete") expect(result.token).toBe("done");
  });

  test("idleOutputTimeoutMs 0 disables the watchdog: a silent token reprompt settles invalid_token, not idle_output_timeout", async () => {
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [armedStallOnRepromptBinding()],
      contracts: [{ id: "fail", check: () => false }],
      idleOutputMs: 0,
    });

    expect(result.kind).toBe("invalid_token");
  });
});

describe("step runner blocker-text contract", () => {
  function tempSpecPath(): { dir: string; specPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "blocker-spec-"));
    return { dir, specPath: join(dir, "spec.md") };
  }

  test("blocked with a new blocker section returns blocked", async () => {
    const { dir, specPath } = tempSpecPath();
    const specBefore = "- [ ] work\n";
    writeFileSync(specPath, specBefore, "utf8");
    try {
      const result = await runStep({
        prompt: "p",
        cwd: dir,
        bindings: [
          {
            id: "agent",
            invoke: async () => {
              appendFileSync(specPath, "\n## Blocker\n\nstuck\n", "utf8");
              return { kind: "ok", stdout: "blocked", stderr: "" };
            },
          },
        ],
        contracts: [],
        blockerTextContract: { id: "write.blocker-text", specPath, specBefore },
      });

      expect(result.kind).toBe("blocked");
      expect(result.blockerReprompt).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("blocked with no new blocker triggers one blocker re-prompt", async () => {
    const { dir, specPath } = tempSpecPath();
    const specBefore = "- [ ] work\n";
    writeFileSync(specPath, specBefore, "utf8");
    let invocations = 0;
    try {
      const result = await runStep({
        prompt: "p",
        cwd: dir,
        bindings: [
          {
            id: "agent",
            invoke: async () => {
              invocations += 1;
              if (invocations === 1) {
                return { kind: "ok", stdout: "blocked", stderr: "" };
              }
              return { kind: "ok", stdout: "still stuck", stderr: "" };
            },
          },
        ],
        contracts: [],
        blockerTextContract: { id: "write.blocker-text", specPath, specBefore },
      });

      expect(invocations).toBe(2);
      expect(result.kind).toBe("missing_blocker");
      if (result.kind === "missing_blocker") {
        expect(result.responseText).toBe("still stuck");
      }
      expect(result.blockerReprompt?.responseText).toBe("still stuck");
      expect(result.reprompt).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a silent blocker reprompt settles idle_output_timeout, not missing_blocker", async () => {
    const { dir, specPath } = tempSpecPath();
    const specBefore = "- [ ] work\n";
    writeFileSync(specPath, specBefore, "utf8");
    let invocations = 0;
    try {
      const result = await runStep({
        prompt: "p",
        cwd: dir,
        bindings: [
          {
            id: "agent",
            metadata: { agent: "claude", model: "opus" },
            invoke: async ({ idleOutputMs }) => {
              invocations += 1;
              if (invocations === 1) return { kind: "ok", stdout: "blocked", stderr: "" };
              if (idleOutputMs !== undefined && idleOutputMs > 0) return { kind: "stall", stderr: "no output" };
              return { kind: "ok", stdout: "still stuck", stderr: "" };
            },
          },
        ],
        contracts: [],
        blockerTextContract: { id: "write.blocker-text", specPath, specBefore },
        idleOutputMs: 5,
      });

      expect(invocations).toBe(2);
      expect(result.kind).toBe("stall");
      if (result.kind === "stall") {
        expect(result.boundMs).toBe(5);
        expect(result.agent).toBe("claude");
        expect(result.model).toBe("opus");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pre-existing blocker without a new one is a miss", async () => {
    const { dir, specPath } = tempSpecPath();
    const specBefore = "- [ ] work\n\n## Blocker\n\nharness wrote this\n";
    writeFileSync(specPath, specBefore, "utf8");
    let invocations = 0;
    try {
      const result = await runStep({
        prompt: "p",
        cwd: dir,
        bindings: [
          {
            id: "agent",
            invoke: async () => {
              invocations += 1;
              return { kind: "ok", stdout: invocations === 1 ? "blocked" : "no file change", stderr: "" };
            },
          },
        ],
        contracts: [],
        blockerTextContract: { id: "write.blocker-text", specPath, specBefore },
      });

      expect(result.kind).toBe("missing_blocker");
      expect(invocations).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("blocker re-prompt that writes blocker text returns blocked", async () => {
    const { dir, specPath } = tempSpecPath();
    const specBefore = "- [ ] work\n";
    writeFileSync(specPath, specBefore, "utf8");
    let invocations = 0;
    try {
      const result = await runStep({
        prompt: "p",
        cwd: dir,
        bindings: [
          {
            id: "agent",
            invoke: async () => {
              invocations += 1;
              if (invocations === 1) {
                return { kind: "ok", stdout: "blocked", stderr: "" };
              }
              appendFileSync(specPath, "\n## Blocker\n\nexplained\n", "utf8");
              return { kind: "ok", stdout: "wrote blocker", stderr: "" };
            },
          },
        ],
        contracts: [],
        blockerTextContract: { id: "write.blocker-text", specPath, specBefore },
      });

      expect(result.kind).toBe("blocked");
      expect(result.blockerReprompt?.responseText).toBe("wrote blocker");
      expect(result.reprompt).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("implement path: blocked without blocker text triggers reprompt and missing_blocker", async () => {
    const { dir, specPath } = tempSpecPath();
    const specBefore = "## Acceptance criteria\n\n- [ ] work\n";
    writeFileSync(specPath, specBefore, "utf8");
    let invocations = 0;
    try {
      const result = await runStep({
        prompt: "p",
        cwd: dir,
        bindings: [
          {
            id: "agent",
            invoke: async () => {
              invocations += 1;
              if (invocations === 1) {
                return { kind: "ok", stdout: "blocked", stderr: "" };
              }
              return { kind: "ok", stdout: "still stuck on implement path", stderr: "" };
            },
          },
        ],
        contracts: [],
        blockerTextContract: { id: "write.blocker-text", specPath, specBefore },
      });

      expect(invocations).toBe(2);
      expect(result.kind).toBe("missing_blocker");
      if (result.kind === "missing_blocker") {
        expect(result.responseText).toBe("still stuck on implement path");
      }
      expect(result.blockerReprompt?.responseText).toBe("still stuck on implement path");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("implement path: blocked with new blocker text resolves as blocked", async () => {
    const { dir, specPath } = tempSpecPath();
    const specBefore = "## Acceptance criteria\n\n- [ ] work\n";
    writeFileSync(specPath, specBefore, "utf8");
    try {
      const result = await runStep({
        prompt: "p",
        cwd: dir,
        bindings: [
          {
            id: "agent",
            invoke: async () => {
              appendFileSync(specPath, "\n## Blocker\n\nimplementation blocked\n", "utf8");
              return { kind: "ok", stdout: "blocked", stderr: "" };
            },
          },
        ],
        contracts: [],
        blockerTextContract: { id: "write.blocker-text", specPath, specBefore },
      });

      expect(result.kind).toBe("blocked");
      expect(result.blockerReprompt).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("blocked outcome persists agent blocker text in result", async () => {
    const { dir, specPath } = tempSpecPath();
    const specBefore = "- [ ] work\n";
    writeFileSync(specPath, specBefore, "utf8");
    try {
      const result = await runStep({
        prompt: "p",
        cwd: dir,
        bindings: [
          {
            id: "agent",
            invoke: async () => {
              appendFileSync(specPath, "\n## Blocker\n\nStuck on the database migration\n", "utf8");
              return { kind: "ok", stdout: "blocked", stderr: "" };
            },
          },
        ],
        contracts: [],
        blockerTextContract: { id: "write.blocker-text", specPath, specBefore },
      });

      expect(result.kind).toBe("blocked");
      if (result.kind === "blocked") {
        expect(result.blockerText).toBe("Stuck on the database migration");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unreadable contract spec path is treated as unsatisfied, not satisfied", async () => {
    const { dir, specPath } = tempSpecPath();
    // Never create specPath: readFileSync throws in evaluateBlockerTextContract's try, which must
    // resolve to unsatisfied (reprompt -> missing_blocker), not silently pass as a genuine blocker.
    let invocations = 0;
    try {
      const result = await runStep({
        prompt: "p",
        cwd: dir,
        bindings: [
          {
            id: "agent",
            invoke: async () => {
              invocations += 1;
              return { kind: "ok", stdout: invocations === 1 ? "blocked" : "no file", stderr: "" };
            },
          },
        ],
        contracts: [],
        blockerTextContract: { id: "write.blocker-text", specPath, specBefore: "- [ ] work\n" },
      });

      expect(invocations).toBe(2);
      expect(result.kind).toBe("missing_blocker");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("blocked after blocker reprompt persists blocker text in result", async () => {
    const { dir, specPath } = tempSpecPath();
    const specBefore = "- [ ] work\n";
    writeFileSync(specPath, specBefore, "utf8");
    let invocations = 0;
    try {
      const result = await runStep({
        prompt: "p",
        cwd: dir,
        bindings: [
          {
            id: "agent",
            invoke: async () => {
              invocations += 1;
              if (invocations === 1) {
                return { kind: "ok", stdout: "blocked", stderr: "" };
              }
              appendFileSync(specPath, "\n## Blocker\n\nNeed API documentation\n", "utf8");
              return { kind: "ok", stdout: "wrote blocker", stderr: "" };
            },
          },
        ],
        contracts: [],
        blockerTextContract: { id: "write.blocker-text", specPath, specBefore },
      });

      expect(result.kind).toBe("blocked");
      if (result.kind === "blocked") {
        expect(result.blockerReprompt).toBeDefined();
        expect(result.blockerText).toBe("Need API documentation");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("idleOutputMs omitted from args leaves the invocation unarmed", async () => {
    let capturedIdleOutputMs: number | undefined;
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [
        {
          id: "agent",
          metadata: { agent: "claude", model: "opus" },
          invoke: async ({ idleOutputMs }) => {
            capturedIdleOutputMs = idleOutputMs;
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      contracts: [],
    });

    expect(result.kind).toBe("complete");
    expect(capturedIdleOutputMs).toBeUndefined();
  });

  test("the primary invocation receives idleOutputMs when the caller passes it", async () => {
    let capturedIdleOutputMs: number | undefined;
    const result = await runStep({
      prompt: "p",
      cwd: "/tmp",
      bindings: [
        {
          id: "agent",
          metadata: { agent: "claude", model: "opus" },
          invoke: async ({ idleOutputMs }) => {
            capturedIdleOutputMs = idleOutputMs;
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      contracts: [],
      idleOutputMs: 5,
    });

    expect(result.kind).toBe("complete");
    expect(capturedIdleOutputMs).toBe(5);
  });
});
