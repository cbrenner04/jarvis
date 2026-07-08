import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type LoadError,
  loadAgentModelConfig,
  resolveExecutableRole,
  resolveInvocationBindings,
} from "./agent-model-config.ts";

function createTempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-config-test-"));
  const filePath = join(dir, "config.json");
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function isError(result: unknown): result is LoadError {
  return (
    typeof result === "object" && result !== null && "errors" in result && Array.isArray((result as LoadError).errors)
  );
}

const VALID_CONFIG = {
  claude: {
    plan: { rungs: [{ adapterModel: "m1", priceKey: "p1" }] },
    implement: { rungs: [{ adapterModel: "m2", priceKey: "p2" }] },
    shrink: { rungs: [{ adapterModel: "m7", priceKey: "p7" }] },
    adversary: { rungs: [{ adapterModel: "m3", priceKey: "p3" }] },
    advocate: { rungs: [{ adapterModel: "m4", priceKey: "p4" }] },
    adjudicator: { rungs: [{ adapterModel: "m5", priceKey: "p5" }] },
    actuator: { rungs: [{ adapterModel: "m6", priceKey: "p6" }] },
  },
};

describe("loadAgentModelConfig", () => {
  test("missing required role fails with agent and role name", () => {
    const config = {
      claude: {
        plan: { rungs: [{ adapterModel: "m1", priceKey: "p1" }] },
        implement: { rungs: [{ adapterModel: "m2", priceKey: "p2" }] },
        shrink: { rungs: [{ adapterModel: "m7", priceKey: "p7" }] },
        adversary: { rungs: [{ adapterModel: "m3", priceKey: "p3" }] },
        advocate: { rungs: [{ adapterModel: "m4", priceKey: "p4" }] },
        adjudicator: { rungs: [{ adapterModel: "m5", priceKey: "p5" }] },
        // missing actuator
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("claude") && e.includes("actuator"))).toBe(true);
    }
  });

  test("missing shrink role fails with agent and role name", () => {
    const config = {
      claude: {
        ...VALID_CONFIG.claude,
        shrink: undefined,
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("claude") && e.includes("shrink"))).toBe(true);
    }
  });

  test("empty rungs array fails with agent and role", () => {
    const config = {
      claude: {
        ...VALID_CONFIG.claude,
        plan: { rungs: [] },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("claude") && e.includes("plan") && e.includes("empty"))).toBe(true);
    }
  });

  test("missing rungs field fails with agent and role", () => {
    const config = {
      claude: {
        ...VALID_CONFIG.claude,
        plan: {},
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("claude") && e.includes("plan") && e.includes("rungs"))).toBe(true);
    }
  });

  test("non-array rungs fails with agent and role", () => {
    const config = {
      claude: {
        ...VALID_CONFIG.claude,
        plan: { rungs: "not-array" },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("claude") && e.includes("plan") && e.includes("array"))).toBe(true);
    }
  });

  test("rung missing adapterModel fails with agent, role, and index", () => {
    const config = {
      claude: {
        ...VALID_CONFIG.claude,
        plan: { rungs: [{ priceKey: "p1" }] },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(
        result.errors.some(
          (e) => e.includes("claude") && e.includes("plan") && e.includes("0") && e.includes("adapterModel"),
        ),
      ).toBe(true);
    }
  });

  test("rung missing priceKey fails with agent, role, and index", () => {
    const config = {
      claude: {
        ...VALID_CONFIG.claude,
        plan: { rungs: [{ adapterModel: "m1" }] },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(
        result.errors.some(
          (e) => e.includes("claude") && e.includes("plan") && e.includes("0") && e.includes("priceKey"),
        ),
      ).toBe(true);
    }
  });

  test("rung with non-string adapterModel fails", () => {
    const config = {
      claude: {
        ...VALID_CONFIG.claude,
        plan: { rungs: [{ adapterModel: 123, priceKey: "p1" }] },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("adapterModel") && e.includes("string"))).toBe(true);
    }
  });

  test("rung with non-string priceKey fails", () => {
    const config = {
      claude: {
        ...VALID_CONFIG.claude,
        plan: { rungs: [{ adapterModel: "m1", priceKey: 123 }] },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("priceKey") && e.includes("string"))).toBe(true);
    }
  });

  test("rung as non-object fails", () => {
    const config = {
      claude: {
        ...VALID_CONFIG.claude,
        plan: { rungs: ["not-object"] },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("rung") && e.includes("object"))).toBe(true);
    }
  });

  test("operator role absent succeeds", () => {
    const filePath = createTempFile(JSON.stringify(VALID_CONFIG));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      const claudeConfig = result.claude;
      expect(claudeConfig).toBeDefined();
      if (claudeConfig !== undefined) {
        expect(claudeConfig.operator).toBeUndefined();
      }
    }
  });

  test("agent in file but not in agents list is ignored", () => {
    const config = {
      claude: VALID_CONFIG.claude,
      extraAgent: {
        plan: { rungs: [{ adapterModel: "m1", priceKey: "p1" }] },
        implement: { rungs: [{ adapterModel: "m2", priceKey: "p2" }] },
        shrink: { rungs: [{ adapterModel: "m7", priceKey: "p7" }] },
        adversary: { rungs: [{ adapterModel: "m3", priceKey: "p3" }] },
        advocate: { rungs: [{ adapterModel: "m4", priceKey: "p4" }] },
        adjudicator: { rungs: [{ adapterModel: "m5", priceKey: "p5" }] },
        actuator: { rungs: [{ adapterModel: "m6", priceKey: "p6" }] },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.extraAgent).toBeUndefined();
    }
  });

  test("unrecognized role key in agent entry is ignored", () => {
    const config = {
      claude: {
        ...VALID_CONFIG.claude,
        unknownRole: { rungs: [{ adapterModel: "m1", priceKey: "p1" }] },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(false);
  });

  test("duplicate agent names fail with error", () => {
    const config = VALID_CONFIG;
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude", "codex", "claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("duplicate") && e.includes("claude"))).toBe(true);
    }
  });

  test("duplicate agent name aggregates with an independent violation", () => {
    const config = {
      claude: {
        ...VALID_CONFIG.claude,
        plan: { rungs: [] },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude", "claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("duplicate") && e.includes("claude"))).toBe(true);
      expect(result.errors.some((e) => e.includes("claude") && e.includes("plan") && e.includes("empty"))).toBe(true);
    }
  });

  test("empty agents list succeeds", () => {
    const config = VALID_CONFIG;
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, []);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      const keys = Object.keys(result).filter((k) => result[k] !== undefined);
      expect(keys.length).toBe(0);
    }
  });

  test("malformed JSON fails", () => {
    const filePath = createTempFile("{ invalid json }");
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("malformed JSON"))).toBe(true);
    }
  });

  test("non-object top-level fails", () => {
    const filePath = createTempFile('["array", "not", "object"]');
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("object"))).toBe(true);
    }
  });

  test("non-object per-agent value fails", () => {
    const config = {
      claude: ["array", "not", "object"],
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("claude") && e.includes("object"))).toBe(true);
    }
  });

  test("multiple independent violations reported together", () => {
    const config = {
      claude: {
        plan: { rungs: [{ adapterModel: "m1", priceKey: "p1" }] },
        implement: { rungs: [{ adapterModel: "m2", priceKey: "p2" }] },
        // missing shrink, adversary, advocate, adjudicator, actuator
      },
      codex: {
        plan: { rungs: [{ adapterModel: "m1", priceKey: "p1" }] },
        // missing implement, shrink, adversary, advocate, adjudicator, actuator
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude", "codex"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors.some((e) => e.includes("claude"))).toBe(true);
      expect(result.errors.some((e) => e.includes("codex"))).toBe(true);
    }
  });

  test("operator role present is accepted", () => {
    const config = {
      claude: {
        ...VALID_CONFIG.claude,
        operator: { rungs: [{ adapterModel: "op1", priceKey: "op-p1" }] },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      const claudeConfig = result.claude;
      expect(claudeConfig?.operator).toBeDefined();
      expect(claudeConfig?.operator?.rungs.length).toBe(1);
    }
  });

  test("valid config loads successfully", () => {
    const filePath = createTempFile(JSON.stringify(VALID_CONFIG));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      const claudeConfig = result.claude;
      expect(claudeConfig).toBeDefined();
      expect(claudeConfig?.plan).toBeDefined();
      expect(claudeConfig?.plan?.rungs.length).toBe(1);
    }
  });

  test("multiple agents load successfully", () => {
    const config = {
      claude: VALID_CONFIG.claude,
      codex: {
        plan: { rungs: [{ adapterModel: "gpt-1", priceKey: "gpt-p1" }] },
        implement: { rungs: [{ adapterModel: "gpt-2", priceKey: "gpt-p2" }] },
        shrink: { rungs: [{ adapterModel: "gpt-7", priceKey: "gpt-p7" }] },
        adversary: { rungs: [{ adapterModel: "gpt-3", priceKey: "gpt-p3" }] },
        advocate: { rungs: [{ adapterModel: "gpt-4", priceKey: "gpt-p4" }] },
        adjudicator: { rungs: [{ adapterModel: "gpt-5", priceKey: "gpt-p5" }] },
        actuator: { rungs: [{ adapterModel: "gpt-6", priceKey: "gpt-p6" }] },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude", "codex"]);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.claude).toBeDefined();
      expect(result.codex).toBeDefined();
    }
  });

  test("multiple rungs load successfully", () => {
    const config = {
      claude: {
        plan: {
          rungs: [
            { adapterModel: "m1", priceKey: "p1" },
            { adapterModel: "m2", priceKey: "p2" },
            { adapterModel: "m3", priceKey: "p3" },
          ],
        },
        implement: { rungs: [{ adapterModel: "m2", priceKey: "p2" }] },
        shrink: { rungs: [{ adapterModel: "m7", priceKey: "p7" }] },
        adversary: { rungs: [{ adapterModel: "m3", priceKey: "p3" }] },
        advocate: { rungs: [{ adapterModel: "m4", priceKey: "p4" }] },
        adjudicator: { rungs: [{ adapterModel: "m5", priceKey: "p5" }] },
        actuator: { rungs: [{ adapterModel: "m6", priceKey: "p6" }] },
      },
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude"]);

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.claude?.plan?.rungs.length).toBe(3);
    }
  });

  test("missing agent entry in file fails", () => {
    const config = {
      claude: VALID_CONFIG.claude,
      // codex not in file
    };
    const filePath = createTempFile(JSON.stringify(config));
    const result = loadAgentModelConfig(filePath, ["claude", "codex"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("codex") && e.includes("missing"))).toBe(true);
    }
  });

  test("file not found fails gracefully", () => {
    const result = loadAgentModelConfig("/nonexistent/path/config.json", ["claude"]);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.errors.some((e) => e.includes("file not found") || e.includes("failed to read"))).toBe(true);
    }
  });
});

describe("resolveInvocationBindings", () => {
  const config = {
    claude: {
      implement: {
        rungs: [
          { adapterModel: "M1", priceKey: "P1" },
          { adapterModel: "M2", priceKey: "P2" },
        ],
      },
      shrink: {
        rungs: [
          { adapterModel: "S1", priceKey: "shrink-1" },
          { adapterModel: "S2", priceKey: "shrink-2" },
        ],
      },
      plan: {
        rungs: [
          { adapterModel: "P1", priceKey: "plan-1" },
          { adapterModel: "P2", priceKey: "plan-2" },
        ],
      },
      adversary: {
        rungs: [
          { adapterModel: "A1", priceKey: "adv-1" },
          { adapterModel: "A2", priceKey: "adv-2" },
        ],
      },
      advocate: {
        rungs: [
          { adapterModel: "V1", priceKey: "arg-1" },
          { adapterModel: "V2", priceKey: "arg-2" },
        ],
      },
      adjudicator: {
        rungs: [
          { adapterModel: "J1", priceKey: "judge-1" },
          { adapterModel: "J2", priceKey: "judge-2" },
        ],
      },
      actuator: {
        rungs: [
          { adapterModel: "X1", priceKey: "act-1" },
          { adapterModel: "X2", priceKey: "act-2" },
        ],
      },
    },
    codex: {
      implement: {
        rungs: [{ adapterModel: "M3", priceKey: "P3" }],
      },
      shrink: {
        rungs: [{ adapterModel: "S3", priceKey: "shrink-3" }],
      },
      plan: {
        rungs: [{ adapterModel: "P3", priceKey: "plan-3" }],
      },
      adversary: {
        rungs: [{ adapterModel: "A3", priceKey: "adv-3" }],
      },
      advocate: {
        rungs: [{ adapterModel: "V3", priceKey: "arg-3" }],
      },
      adjudicator: {
        rungs: [{ adapterModel: "J3", priceKey: "judge-3" }],
      },
      actuator: {
        rungs: [{ adapterModel: "X3", priceKey: "act-3" }],
      },
    },
  };

  test("implement resolves the flat per-agent rung order shared invocation consumes", () => {
    const bindings = resolveInvocationBindings(
      "implement",
      ["claude", "codex"],
      config,
      ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
      }),
    );

    expect(bindings).toEqual([{ id: "claude/M1" }, { id: "claude/M2" }, { id: "codex/M3" }]);
  });

  test("shrink resolves every per-agent rung in order", () => {
    const bindings = resolveInvocationBindings("shrink", ["claude", "codex"], config, ({ agentId, adapterModel }) => ({
      id: `${agentId}/${adapterModel}`,
    }));

    expect(bindings).toEqual([{ id: "claude/S1" }, { id: "claude/S2" }, { id: "codex/S3" }]);
  });

  test("plan, adversary, advocate, and adjudicator all consume the full per-agent rung list", () => {
    expect(
      resolveInvocationBindings(
        "plan",
        ["claude", "codex"],
        config,
        ({ agentId, adapterModel }) => `${agentId}/${adapterModel}`,
      ),
    ).toEqual(["claude/P1", "claude/P2", "codex/P3"]);
    expect(
      resolveInvocationBindings(
        "adversary",
        ["claude", "codex"],
        config,
        ({ agentId, adapterModel }) => `${agentId}/${adapterModel}`,
      ),
    ).toEqual(["claude/A1", "claude/A2", "codex/A3"]);
    expect(
      resolveInvocationBindings(
        "advocate",
        ["claude", "codex"],
        config,
        ({ agentId, adapterModel }) => `${agentId}/${adapterModel}`,
      ),
    ).toEqual(["claude/V1", "claude/V2", "codex/V3"]);
    expect(
      resolveInvocationBindings(
        "adjudicator",
        ["claude", "codex"],
        config,
        ({ agentId, adapterModel }) => `${agentId}/${adapterModel}`,
      ),
    ).toEqual(["claude/J1", "claude/J2", "codex/J3"]);
  });

  test("actuator resolves head-only bindings", () => {
    const bindings = resolveInvocationBindings(
      "actuator",
      ["claude", "codex"],
      config,
      ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
      }),
    );

    expect(bindings).toEqual([{ id: "claude/X1" }, { id: "codex/X3" }]);
  });

  test("binding construction receives one resolved agent, model, and price key per rung", () => {
    const bindings = resolveInvocationBindings(
      "implement",
      ["claude", "codex"],
      config,
      ({ agentId, adapterModel, priceKey }) => ({
        agentId,
        adapterModel,
        priceKey,
      }),
    );

    expect(bindings).toEqual([
      { agentId: "claude", adapterModel: "M1", priceKey: "P1" },
      { agentId: "claude", adapterModel: "M2", priceKey: "P2" },
      { agentId: "codex", adapterModel: "M3", priceKey: "P3" },
    ]);
  });

  test("executable-role boundary rejects operator", () => {
    expect(() => resolveExecutableRole("operator")).toThrow("not executable");
  });
});
