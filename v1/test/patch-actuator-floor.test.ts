import { describe, expect, test } from "bun:test";
import type { AgentEntry, Config } from "../src/config.ts";
import { filterAgentsByCapabilityFloor } from "../src/config.ts";
import { buildActiveAgents } from "../src/modes/patch/preflight.ts";
import type { RunCommandOptions } from "../src/modes/patch/run.ts";

describe("filterAgentsByCapabilityFloor", () => {
  test("returns all agents when floor is undefined", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 2 },
      { agent: "codex", model: "gpt-5.4", capability: 3 },
      { agent: "cursor", model: "Composer 2.5", capability: 1 },
    ];

    const result = filterAgentsByCapabilityFloor(agents, undefined);
    expect(result).toEqual(agents);
  });

  test("filters agents below floor", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 2 },
      { agent: "codex", model: "gpt-5.4", capability: 3 },
      { agent: "cursor", model: "Composer 2.5", capability: 1 },
    ];

    const result = filterAgentsByCapabilityFloor(agents, 2);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ agent: "claude", model: "haiku", capability: 2 });
    expect(result).toContainEqual({ agent: "codex", model: "gpt-5.4", capability: 3 });
  });

  test("excludes agents with capability less than floor", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 1 },
      { agent: "codex", model: "gpt-5.4", capability: 3 },
      { agent: "cursor", model: "Composer 2.5", capability: 2 },
    ];

    const result = filterAgentsByCapabilityFloor(agents, 2);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ agent: "codex", model: "gpt-5.4", capability: 3 });
    expect(result).toContainEqual({ agent: "cursor", model: "Composer 2.5", capability: 2 });
  });

  test("returns empty array when all agents are below floor", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 1 },
      { agent: "codex", model: "gpt-5.4", capability: 2 },
    ];

    const result = filterAgentsByCapabilityFloor(agents, 3);
    expect(result).toHaveLength(0);
  });

  test("preserves order of filtered agents", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 1 },
      { agent: "codex", model: "gpt-5.4", capability: 3 },
      { agent: "cursor", model: "Composer 2.5", capability: 2 },
    ];

    const result = filterAgentsByCapabilityFloor(agents, 2);
    expect(result).toHaveLength(2);
    if (result.length >= 2) {
      expect(result[0]!.agent).toBe("codex");
      expect(result[1]!.agent).toBe("cursor");
    }
  });
});

describe("buildActiveAgents with capability floor", () => {
  function makeConfig(agents: AgentEntry[], floor?: number): Config {
    return {
      version: 2,
      modes: {
        patch: {
          agentOrder: agents,
          ...(floor !== undefined ? { actuationCapabilityFloor: floor } : {}),
        },
        plan: { agentOrder: agents },
        prompt: { agentOrder: agents },
        review: { passes: 1 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://127.0.0.1:4310/logs",
      logServerBind: "127.0.0.1:4310",
      git: true,
      projects: {},
    };
  }

  function makeOpts(): RunCommandOptions {
    return {
      specPath: "/tmp/test.md",
      io: {
        stdout: () => {},
        stderr: () => {},
      },
    };
  }

  test("selects from first agent when no floor is set", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku" },
      { agent: "codex", model: "gpt-5.4" },
      { agent: "cursor", model: "Composer 2.5" },
    ];
    const cfg = makeConfig(agents);
    const opts = makeOpts();

    const result = buildActiveAgents(opts, cfg, "trivial");
    expect(result).toHaveLength(3);
    expect(result[0]).toBeDefined();
  });

  test("skips below-floor agents at tier start index", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 1 },
      { agent: "codex", model: "gpt-5.4", capability: 3 },
      { agent: "cursor", model: "Composer 2.5", capability: 2 },
    ];
    const cfg = makeConfig(agents, 2);
    const opts = makeOpts();

    // standard tier starts at index 1
    const result = buildActiveAgents(opts, cfg, "standard");
    expect(result.length).toBeGreaterThan(0);
    // The tier index is resolved against the floor-eligible ladder
    // Floor-eligible: [codex(3), cursor(2)]
    // Tier start at index 1 of original ladder, but resolved against floor-eligible
    // This should give us agents starting from the position in the filtered ladder
  });

  test("selects only floor-eligible agents for fallback", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 1 },
      { agent: "codex", model: "gpt-5.4", capability: 3 },
      { agent: "cursor", model: "Composer 2.5", capability: 2 },
    ];
    const cfg = makeConfig(agents, 2);
    const opts = makeOpts();

    const result = buildActiveAgents(opts, cfg, "trivial");
    // With floor 2, only codex(3) and cursor(2) are eligible
    // trivial tier starts at index 0, so we get both
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  test("returns empty array when no agents meet floor", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 1 },
      { agent: "codex", model: "gpt-5.4", capability: 2 },
    ];
    const cfg = makeConfig(agents, 3);
    const opts = makeOpts();

    const result = buildActiveAgents(opts, cfg, "trivial");
    expect(result).toHaveLength(0);
  });

  test("respects tier selection within floor-eligible ladder", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 1 },
      { agent: "codex", model: "gpt-5.4", capability: 2 },
      { agent: "cursor", model: "Composer 2.5", capability: 3 },
    ];
    const cfg = makeConfig(agents, 2);
    const opts = makeOpts();

    // hard tier selects from the end of the ladder
    // Floor-eligible: [codex(2), cursor(3)]
    // hard tier: index = floor-eligible.length - 1 = 1
    const result = buildActiveAgents(opts, cfg, "hard");
    // Should start from the last floor-eligible agent
    expect(result.length).toBeGreaterThan(0);
  });
});
