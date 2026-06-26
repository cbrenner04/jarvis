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

  test("filters agents by capability floor, preserving order", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 1 },
      { agent: "codex", model: "gpt-5.4", capability: 3 },
      { agent: "cursor", model: "Composer 2.5", capability: 2 },
    ];

    const result = filterAgentsByCapabilityFloor(agents, 2);
    expect(result).toEqual([
      { agent: "codex", model: "gpt-5.4", capability: 3 },
      { agent: "cursor", model: "Composer 2.5", capability: 2 },
    ]);
  });

  test("returns empty array when all agents are below floor", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 1 },
      { agent: "codex", model: "gpt-5.4", capability: 2 },
    ];

    const result = filterAgentsByCapabilityFloor(agents, 3);
    expect(result).toHaveLength(0);
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

  test("selects all agents when no floor is set", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku" },
      { agent: "codex", model: "gpt-5.4" },
      { agent: "cursor", model: "Composer 2.5" },
    ];
    const cfg = makeConfig(agents);
    const opts = makeOpts();

    const result = buildActiveAgents(opts, cfg, "trivial");
    expect(result).toHaveLength(3);
  });

  test("skips below-floor agents in tier selection", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 1 },
      { agent: "codex", model: "gpt-5.4", capability: 3 },
      { agent: "cursor", model: "Composer 2.5", capability: 2 },
    ];
    const cfg = makeConfig(agents, 2);
    const opts = makeOpts();

    // Floor 2: claude(1) filtered, codex(3) and cursor(2) remain
    const result = buildActiveAgents(opts, cfg, "trivial");
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.attributionLabel())).toEqual(["gpt-5.4", "Composer 2.5"]);
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

  test("tier standard: starts from index 1 in floor-eligible ladder", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 1 },
      { agent: "codex", model: "gpt-5.4", capability: 3 },
      { agent: "cursor", model: "Composer 2.5", capability: 2 },
    ];
    const cfg = makeConfig(agents, 2);
    const opts = makeOpts();

    // Floor 2: claude(1) filtered, codex(3) and cursor(2) remain
    // Standard tier start index = min(1, 2-1) = 1
    // slice(1) = [cursor]
    const result = buildActiveAgents(opts, cfg, "standard");
    expect(result).toHaveLength(1);
    expect(result.map((a) => a.attributionLabel())).toEqual(["Composer 2.5"]);
  });

  test("tier hard: starts from last index in floor-eligible ladder", () => {
    const agents: AgentEntry[] = [
      { agent: "claude", model: "haiku", capability: 1 },
      { agent: "codex", model: "gpt-5.4", capability: 3 },
      { agent: "cursor", model: "Composer 2.5", capability: 2 },
    ];
    const cfg = makeConfig(agents, 2);
    const opts = makeOpts();

    // Floor 2: claude(1) filtered, codex(3) and cursor(2) remain
    // Hard tier start index = 2 - 1 = 1
    // slice(1) = [cursor]
    const result = buildActiveAgents(opts, cfg, "hard");
    expect(result).toHaveLength(1);
    expect(result.map((a) => a.attributionLabel())).toEqual(["Composer 2.5"]);
  });
});
