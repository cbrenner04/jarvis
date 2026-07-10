import { describe, expect, test } from "bun:test";
import {
  type LoadError,
  resolveExecutableRole,
  resolveInvocationBindings,
  validateAgentModelConfig,
} from "./agent-model-config.ts";

function isError(result: unknown): result is LoadError {
  return (
    typeof result === "object" && result !== null && "errors" in result && Array.isArray((result as LoadError).errors)
  );
}

const VALID_CLAUDE = {
  plan: { rungs: [{ adapterModel: "m1", priceKey: "p1" }] },
  implement: { rungs: [{ adapterModel: "m2", priceKey: "p2" }] },
  shrink: { rungs: [{ adapterModel: "m7", priceKey: "p7" }] },
  adversary: { rungs: [{ adapterModel: "m3", priceKey: "p3" }] },
  advocate: { rungs: [{ adapterModel: "m4", priceKey: "p4" }] },
  adjudicator: { rungs: [{ adapterModel: "m5", priceKey: "p5" }] },
  actuator: { rungs: [{ adapterModel: "m6", priceKey: "p6" }] },
};

describe("validateAgentModelConfig", () => {
  test.each([
    ["missing required role (actuator)", { ...VALID_CLAUDE, actuator: undefined }, ["claude", "actuator", "missing"]],
    ["missing required role (shrink)", { ...VALID_CLAUDE, shrink: undefined }, ["claude", "shrink", "missing"]],
    ["missing rungs field", { ...VALID_CLAUDE, plan: {} }, ["claude", "plan", "non-empty array"]],
    ["empty rungs array", { ...VALID_CLAUDE, plan: { rungs: [] } }, ["claude", "plan", "non-empty array"]],
    ["non-array rungs", { ...VALID_CLAUDE, plan: { rungs: "not-array" } }, ["claude", "plan", "non-empty array"]],
    ["non-object role entry", { ...VALID_CLAUDE, plan: "not-object" }, ["claude", "plan"]],
    ["rung missing adapterModel", { ...VALID_CLAUDE, plan: { rungs: [{ priceKey: "p1" }] } }, ["claude", "plan", "rung 0"]],
    ["rung missing priceKey", { ...VALID_CLAUDE, plan: { rungs: [{ adapterModel: "m1" }] } }, ["claude", "plan", "rung 0"]],
    [
      "rung non-string adapterModel",
      { ...VALID_CLAUDE, plan: { rungs: [{ adapterModel: 123, priceKey: "p1" }] } },
      ["claude", "plan", "rung 0"],
    ],
    [
      "rung non-string priceKey",
      { ...VALID_CLAUDE, plan: { rungs: [{ adapterModel: "m1", priceKey: 123 }] } },
      ["claude", "plan", "rung 0"],
    ],
    ["rung non-object", { ...VALID_CLAUDE, plan: { rungs: ["not-object"] } }, ["claude", "plan", "rung 0"]],
  ])("%s fails naming the offending entry", (_name, claudeEntry, expectedSubstrings) => {
    const result = validateAgentModelConfig({ claude: claudeEntry }, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => expectedSubstrings.every((s) => e.includes(s)))).toBe(true);
    }
  });

  test("second invalid rung is reported with its own index", () => {
    const config = {
      claude: { ...VALID_CLAUDE, plan: { rungs: [{ adapterModel: "m1", priceKey: "p1" }, { adapterModel: "m2" }] } },
    };
    const result = validateAgentModelConfig(config, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("rung 1"))).toBe(true);
    }
  });

  test("non-object top-level fails", () => {
    const result = validateAgentModelConfig(["array", "not", "object"], ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("object"))).toBe(true);
    }
  });

  test("non-object per-agent value fails", () => {
    const result = validateAgentModelConfig({ claude: ["array"] }, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("claude") && e.includes("object"))).toBe(true);
    }
  });

  test("missing agent entry fails naming every required role", () => {
    const result = validateAgentModelConfig({ claude: VALID_CLAUDE }, ["claude", "codex"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("codex") && e.includes("missing"))).toBe(true);
    }
  });

  test("duplicate agent name aggregates with an independent violation", () => {
    const config = { claude: { ...VALID_CLAUDE, plan: { rungs: [] } } };
    const result = validateAgentModelConfig(config, ["claude", "claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("duplicate") && e.includes("claude"))).toBe(true);
      expect(result.errors.some((e) => e.includes("plan") && e.includes("non-empty array"))).toBe(true);
    }
  });

  test("violations across agents are reported together", () => {
    const config = {
      claude: { plan: VALID_CLAUDE.plan },
      codex: { plan: VALID_CLAUDE.plan },
    };
    const result = validateAgentModelConfig(config, ["claude", "codex"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors.some((e) => e.includes("claude"))).toBe(true);
      expect(result.errors.some((e) => e.includes("codex"))).toBe(true);
    }
  });

  test("valid config loads: multiple agents, multiple rungs, listed agents only", () => {
    const config = {
      claude: {
        ...VALID_CLAUDE,
        plan: {
          rungs: [
            { adapterModel: "m1", priceKey: "p1" },
            { adapterModel: "m2", priceKey: "p2" },
          ],
        },
        unknownRole: { rungs: [{ adapterModel: "x", priceKey: "x" }] },
      },
      codex: VALID_CLAUDE,
      extraAgent: VALID_CLAUDE,
    };
    const result = validateAgentModelConfig(config, ["claude", "codex"]);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.claude?.plan?.rungs.length).toBe(2);
      expect(result.codex).toBeDefined();
      expect(result.extraAgent).toBeUndefined();
    }
  });

  test("operator role is optional but accepted when present", () => {
    const absent = validateAgentModelConfig({ claude: VALID_CLAUDE }, ["claude"]);
    expect(isError(absent)).toBe(false);
    if (!isError(absent)) {
      expect(absent.claude?.operator).toBeUndefined();
    }

    const present = validateAgentModelConfig(
      { claude: { ...VALID_CLAUDE, operator: { rungs: [{ adapterModel: "op1", priceKey: "op-p1" }] } } },
      ["claude"],
    );
    expect(isError(present)).toBe(false);
    if (!isError(present)) {
      expect(present.claude?.operator?.rungs.length).toBe(1);
    }
  });

  test("empty agents list succeeds with an empty config", () => {
    const result = validateAgentModelConfig({ claude: VALID_CLAUDE }, []);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(Object.keys(result).filter((k) => result[k] !== undefined).length).toBe(0);
    }
  });
});

describe("resolveInvocationBindings", () => {
  const roles = ["plan", "implement", "shrink", "adversary", "advocate", "adjudicator", "actuator"] as const;
  const rungsFor = (agent: string, count: number, role: string) => ({
    rungs: Array.from({ length: count }, (_, i) => ({
      adapterModel: `${agent}-${role}-${i + 1}`,
      priceKey: `${agent}-${role}-price-${i + 1}`,
    })),
  });
  const config = {
    claude: Object.fromEntries(roles.map((role) => [role, rungsFor("claude", 2, role)])),
    codex: Object.fromEntries(roles.map((role) => [role, rungsFor("codex", 1, role)])),
  };

  test.each(["plan", "implement", "shrink", "adversary", "advocate", "adjudicator"] as const)(
    "%s resolves the flat per-agent rung order shared invocation consumes",
    (role) => {
      const bindings = resolveInvocationBindings(
        role,
        ["claude", "codex"],
        config,
        ({ agentId, adapterModel }) => `${agentId}/${adapterModel}`,
      );

      expect(bindings).toEqual([`claude/claude-${role}-1`, `claude/claude-${role}-2`, `codex/codex-${role}-1`]);
    },
  );

  test("actuator resolves head-only bindings", () => {
    const bindings = resolveInvocationBindings(
      "actuator",
      ["claude", "codex"],
      config,
      ({ agentId, adapterModel }) => `${agentId}/${adapterModel}`,
    );

    expect(bindings).toEqual(["claude/claude-actuator-1", "codex/codex-actuator-1"]);
  });

  test("binding construction receives one resolved agent, model, and price key per rung", () => {
    const bindings = resolveInvocationBindings("implement", ["codex"], config, (binding) => binding);

    expect(bindings).toEqual([
      { agentId: "codex", adapterModel: "codex-implement-1", priceKey: "codex-implement-price-1" },
    ]);
  });

  test("missing escalation for an agent/role throws naming both", () => {
    expect(() => resolveInvocationBindings("implement", ["claude", "ghost"], config, (b) => b)).toThrow(
      /ghost.*implement/,
    );
  });

  test("executable-role boundary rejects operator", () => {
    expect(() => resolveExecutableRole("operator")).toThrow("not executable");
  });
});
