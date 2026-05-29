import { describe, expect, test } from "bun:test";
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import { parseStepOutcomeToken, runStep, type StepContract } from "./step-runner.ts";

function okBinding(stdout: string): InvocationBinding {
  return {
    id: "agent",
    invoke: async () => ({ kind: "ok", stdout, stderr: "" }),
  };
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
});
