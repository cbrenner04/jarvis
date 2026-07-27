import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentEntry,
  type Config,
  DEFAULT_CONFIG,
  effectiveGit,
  findProjectForPath,
  findProjectMatchForPath,
  loadConfig,
  openSessionLog,
  registerProject,
  resolvePlanFlags,
  resolveReviewAgentOrder,
  resolveReviewPasses,
  resolveSubRoleAgentOrder,
  setGit,
  setProjectGit,
  setProjectOrigin,
  writeConfig,
} from "../src/config.ts";
import { buildActiveAgents } from "../src/modes/patch/preflight.ts";
import type { RunCommandOptions } from "../src/modes/patch/run.ts";

let dir: string;

const DEFAULT_AGENT_ORDER: AgentEntry[] = [
  { agent: "claude", model: "haiku" },
  { agent: "codex", model: "gpt-5.4" },
  { agent: "cursor", model: "Composer 2.5" },
];

const CLAUDE_ONLY: AgentEntry[] = [{ agent: "claude", model: "haiku" }];

function testConfig(modes: Config["modes"], overrides: Partial<Config> = {}): Config {
  return {
    version: 2,
    quotaFallback: "lenient",
    weakQuotaExitCodes: [],
    maxIterations: 10,
    iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
    logServerUrl: "http://x/",
    logServerBind: "x",
    git: true,
    projects: {},
    modes,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("bootstraps from empty dir with defaults", () => {
    const file = join(dir, "config.json");
    expect(existsSync(file)).toBe(false);

    const cfg = loadConfig({ dir });

    expect(cfg.modes.patch).toEqual({ agentOrder: DEFAULT_AGENT_ORDER, prNarrative: "agent", shrink: "agent" });
    expect(cfg.modes.plan).toEqual({ agentOrder: DEFAULT_AGENT_ORDER, targetDir: "spec", prNarrative: "agent" });
    expect(cfg.modes.prompt).toEqual({ agentOrder: DEFAULT_AGENT_ORDER });
    expect(cfg.modes.review).toEqual({ passes: 1 });
    expect(cfg.version).toBe(2);
    expect(cfg.quotaFallback).toBe("lenient");
    expect(cfg.weakQuotaExitCodes).toEqual([]);
    expect(cfg.maxIterations).toBe(10);
    expect(cfg.iterationTimeoutMs).toBe(DEFAULT_CONFIG.iterationTimeoutMs);
    expect(cfg.logServerUrl).toBe("http://127.0.0.1:4310/logs");
    expect(cfg.logServerBind).toBe("127.0.0.1:4310");
    expect(cfg.telemetryPath).toBe(join(dir, "runs.jsonl"));
    expect(cfg.git).toBe(true);
    expect(cfg.projects).toEqual({});

    expect(existsSync(file)).toBe(true);
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as Config;
    expect(onDisk).toEqual(cfg);
  });

  test("is idempotent: second call does not overwrite", () => {
    const cfg = loadConfig({ dir });
    cfg.projects.foo = { root: "/tmp/foo" };
    writeConfig(cfg, { dir });

    const reloaded = loadConfig({ dir });
    expect(reloaded.projects.foo).toEqual({ root: "/tmp/foo" });
  });

  test("loads an existing valid config", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: [
              { agent: "codex", model: "gpt-5.3-codex" },
              { agent: "claude", model: "sonnet" },
            ],
          },
          plan: { agentOrder: [{ agent: "claude", model: "haiku" }] },
          prompt: { agentOrder: [{ agent: "claude", model: "haiku" }] },
          review: { passes: 2 },
        },
        quotaFallback: "strict",
        maxIterations: 7,
        projects: { jarvis: { root: "/Users/me/jarvis" } },
      }),
    );

    const cfg = loadConfig({ dir });
    expect(cfg.modes.patch.agentOrder).toEqual([
      { agent: "codex", model: "gpt-5.3-codex" },
      { agent: "claude", model: "sonnet" },
    ]);
    expect(cfg.modes.plan.agentOrder).toEqual([{ agent: "claude", model: "haiku" }]);
    expect(cfg.quotaFallback).toBe("strict");
    expect(cfg.maxIterations).toBe(7);
    expect(cfg.logServerUrl).toBe("http://127.0.0.1:4310/logs");
    expect(cfg.logServerBind).toBe("127.0.0.1:4310");
    expect(cfg.telemetryPath).toBe(join(dir, "runs.jsonl"));
    expect(cfg.projects.jarvis).toEqual({ root: "/Users/me/jarvis" });
  });

  test("rejects patchActuator in subRoleAgentOrder", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: CLAUDE_ONLY,
            subRoleAgentOrder: {
              patchActuator: [{ agent: "cursor", model: "Composer 2.5" }],
            },
          },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/unknown key.*patchActuator/i);
  });

  test("accepts patch config without sub-role agent orders", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );

    expect(loadConfig({ dir }).modes.patch.subRoleAgentOrder).toBeUndefined();
  });

  test("accepts patch sub-role agent orders with omitted keys", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: CLAUDE_ONLY,
            subRoleAgentOrder: {
              reviewPanel: [{ agent: "codex", model: "gpt-5.3-codex" }],
            },
          },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );

    expect(loadConfig({ dir }).modes.patch.subRoleAgentOrder).toEqual({
      reviewPanel: [{ agent: "codex", model: "gpt-5.3-codex" }],
    });
  });

  test("accepts codex gpt-5.4-mini in patch agentOrder via writeConfig round-trip", () => {
    const entry: AgentEntry = { agent: "codex", model: "gpt-5.4-mini" };
    const cfg = loadConfig({ dir });
    cfg.modes.patch.agentOrder = [entry];
    writeConfig(cfg, { dir });
    expect(loadConfig({ dir }).modes.patch.agentOrder).toEqual([entry]);
  });

  test("defaults maxIterations when an existing config omits it", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );

    expect(loadConfig({ dir }).maxIterations).toBe(10);
  });

  test("defaults prNarrative to agent when an existing config omits it", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );

    const cfg = loadConfig({ dir });
    expect(cfg.modes.patch.prNarrative).toBe("agent");
    expect(cfg.modes.plan.prNarrative).toBe("agent");
  });

  test("defaults quotaFallback when an existing config omits it", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );

    expect(loadConfig({ dir }).quotaFallback).toBe("lenient");
  });

  test("rejects invalid quotaFallback", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        quotaFallback: "off",
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/quotaFallback/);
  });

  test("rejects invalid maxIterations", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 0,
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/maxIterations/);
  });

  test("rejects invalid iterationTimeoutMs", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        iterationTimeoutMs: -1,
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/iterationTimeoutMs/);
  });

  test("rejects invalid runTimeoutMs", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        iterationTimeoutMs: 30 * 60_000,
        runTimeoutMs: 0,
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/runTimeoutMs/);
  });

  test("accepts telemetryPath as null", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        telemetryPath: null,
        projects: {},
      }),
    );
    expect(loadConfig({ dir }).telemetryPath).toBeNull();
  });

  test("accepts optional runTimeoutMs", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        iterationTimeoutMs: 30 * 60_000,
        runTimeoutMs: 60 * 60_000,
        git: true,
        projects: {},
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.runTimeoutMs).toBe(60 * 60_000);
  });

  test("rejects legacy patchModels key", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        patchModels: { claude: "haiku" },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/legacy keys found/);
  });

  test("rejects agentOrder entry missing model", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: [{ agent: "claude" }] },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.patch\.agentOrder\[0\]\.model/);
  });

  test("rejects agentOrder entry with empty model", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: [{ agent: "claude", model: "  " }] },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.patch\.agentOrder\[0\]\.model/);
  });

  test("rejects opencode agentOrder entry with empty model", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: [{ agent: "opencode", model: "  " }] },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.patch\.agentOrder\[0\]\.model/);
  });

  test("rejects agentOrder entry with non-string model", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: [{ agent: "claude", model: 1 }] },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.patch\.agentOrder\[0\]\.model/);
  });

  test("rejects agentOrder string entry (pre-{agent,model} v2)", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: ["claude"] },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/agent.*and.*model/);
  });

  test("rejects v1 config", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 1,
        agentOrder: ["claude"],
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/config version 1 is not supported/);
  });

  test("rejects config with legacy agentOrder key", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        agentOrder: ["claude"],
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/legacy keys found/);
  });

  test("rejects config with legacy planAgentOrder key", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        planAgentOrder: ["claude"],
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/legacy keys found/);
  });

  test("rejects missing modes object", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes/);
  });

  test("rejects missing modes.patch", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.patch/);
  });

  test("rejects missing modes.plan", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.plan/);
  });

  test("rejects removed per-mode agents config", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: CLAUDE_ONLY,
            agents: { claude: { outputFormat: "text" } },
          },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.patch\.agents is no longer supported/);
  });

  test("rejects empty patch agentOrder", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: [] },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.patch\.agentOrder.*non-empty/);
  });

  test("rejects empty plan agentOrder", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: [] },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.plan\.agentOrder.*non-empty/);
  });

  test("rejects duplicate agents in patch agentOrder", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: [
              { agent: "claude", model: "haiku" },
              { agent: "claude", model: "sonnet" },
            ],
          },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.patch\.agentOrder.*duplicate/);
  });

  test("rejects duplicate opencode entries in patch agentOrder", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: [
              { agent: "opencode", model: "opencode/deepseek-v4-flash-free" },
              { agent: "opencode", model: "opencode/gpt-5-nano" },
            ],
          },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.patch\.agentOrder.*duplicate/);
  });

  test("rejects duplicate agents in plan agentOrder", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: {
            agentOrder: [
              { agent: "claude", model: "haiku" },
              { agent: "codex", model: "gpt-5.3-codex" },
              { agent: "claude", model: "sonnet" },
            ],
          },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.plan\.agentOrder.*duplicate/);
  });

  test("rejects invalid patch sub-role agent order", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: CLAUDE_ONLY,
            subRoleAgentOrder: {
              reviewActuator: [{ agent: "claude", model: "not-a-model" }],
            },
          },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );

    expect(() => loadConfig({ dir })).toThrow(/modes\.patch\.subRoleAgentOrder\.reviewActuator/);
  });

  test("rejects unknown patch sub-role agent order key", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: CLAUDE_ONLY,
            subRoleAgentOrder: {
              reviewer: [{ agent: "claude", model: "haiku" }],
            },
          },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );

    expect(() => loadConfig({ dir })).toThrow(/modes\.patch\.subRoleAgentOrder: unknown key "reviewer"/);
  });

  test("rejects unknown agent", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: [{ agent: "gpt", model: "x" }] },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/unknown agent/);
  });

  test("rejects missing version", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/version/);
  });

  test("rejects non-absolute project root", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: { foo: { root: "relative/path" } },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/absolute/);
  });

  test("rejects duplicate project roots", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          a: { root: "/tmp/shared" },
          b: { root: "/tmp/shared" },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/duplicate/);
  });

  test("rejects malformed JSON, mentioning the path", () => {
    const file = join(dir, "config.json");
    writeFileSync(file, "{ not json");
    expect(() => loadConfig({ dir })).toThrow(file);
  });

  test("accepts an optional origin on a project", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        projects: {
          "app-a": {
            root: "/tmp/jarvis-with-origin",
            origin: "git@github.com:you/app-a.git",
          },
        },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects["app-a"]).toEqual({
      root: "/tmp/jarvis-with-origin",
      origin: "git@github.com:you/app-a.git",
    });
  });

  test("loads configs without origin", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        projects: { "app-a": { root: "/tmp/jarvis-legacy" } },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects["app-a"]).toEqual({ root: "/tmp/jarvis-legacy" });
  });

  test("rejects non-string project origin", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        projects: { "app-a": { root: "/tmp/jarvis-bad", origin: 42 } },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/origin/);
  });
});

describe("registerProject / findProjectForPath", () => {
  test("registers and resolves a project by descendant path", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-proj-"));
    try {
      registerProject("proj", root, { dir });
      expect(findProjectForPath(root, { dir })).toEqual({ root });
      expect(findProjectForPath(join(root, "spec", "x.md"), { dir })).toEqual({
        root,
      });
      expect(findProjectForPath(tmpdir(), { dir })).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("registerProject refuses non-absolute root", () => {
    expect(() => registerProject("x", "relative", { dir })).toThrow(/absolute/);
  });

  test("registerProject refuses duplicate root under a different name", () => {
    registerProject("a", "/tmp/jarvis-dup", { dir });
    expect(() => registerProject("b", "/tmp/jarvis-dup", { dir })).toThrow(/already registered/);
  });

  test("findProjectForPath picks the longest matching root", () => {
    registerProject("outer", "/tmp/jarvis-outer", { dir });
    registerProject("inner", "/tmp/jarvis-outer/inner", { dir });
    expect(findProjectForPath("/tmp/jarvis-outer/inner/file.md", { dir })).toEqual({
      root: "/tmp/jarvis-outer/inner",
    });
    expect(findProjectForPath("/tmp/jarvis-outer/other/file.md", { dir })).toEqual({
      root: "/tmp/jarvis-outer",
    });
  });

  test("findProjectMatchForPath returns the matching project key", () => {
    registerProject("outer", "/tmp/jarvis-keyed", { dir });
    registerProject("inner", "/tmp/jarvis-keyed/nested", { dir });

    expect(
      findProjectMatchForPath("/tmp/jarvis-keyed/nested/spec/index.md", {
        dir,
      }),
    ).toEqual({
      key: "inner",
      root: "/tmp/jarvis-keyed/nested",
    });
  });

  test("registerProject stores origin when provided", () => {
    registerProject("with-origin", "/tmp/jarvis-with-origin", {
      dir,
      origin: "git@github.com:you/app.git",
    });
    expect(findProjectMatchForPath("/tmp/jarvis-with-origin", { dir })).toEqual({
      key: "with-origin",
      root: "/tmp/jarvis-with-origin",
      origin: "git@github.com:you/app.git",
    });
  });

  test("setProjectOrigin updates an existing project's origin", () => {
    registerProject("lazy", "/tmp/jarvis-lazy", { dir });
    setProjectOrigin("lazy", "https://github.com/you/lazy.git", { dir });
    const cfg = loadConfig({ dir });
    expect(cfg.projects.lazy).toEqual({
      root: "/tmp/jarvis-lazy",
      origin: "https://github.com/you/lazy.git",
    });
  });

  test("findProjectForPath returns plan field from registered project", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-plan-field-"));
    try {
      // Register a project with a plan override via writeConfig, since
      // registerProject only takes root + origin.
      registerProject("planproj", root, { dir });
      const cfg = loadConfig({ dir });
      const project = cfg.projects.planproj;
      if (!project) {
        throw new Error("expected registered project");
      }
      project.plan = { specTimestamp: false, commit: false };
      writeConfig(cfg, { dir });

      const result = findProjectForPath(root, { dir });
      expect(result?.plan).toEqual({ specTimestamp: false, commit: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("registerProject on existing name preserves origin, git, siblings, and plan", () => {
    const cfg = loadConfig({ dir });
    cfg.projects.reregister = {
      root: "/tmp/jarvis-old",
      origin: "git@github.com:test/repo.git",
      git: false,
      siblings: ["/tmp/sibling1"],
      plan: { specTimestamp: false },
    };
    writeConfig(cfg, { dir });

    // Re-register with a new root but no origin specified
    registerProject("reregister", "/tmp/jarvis-new", { dir });

    const reloaded = loadConfig({ dir });
    expect(reloaded.projects.reregister).toEqual({
      root: "/tmp/jarvis-new",
      origin: "git@github.com:test/repo.git",
      git: false,
      siblings: ["/tmp/sibling1"],
      plan: { specTimestamp: false },
    });
  });

  test("registerProject on existing name with new origin overwrites origin", () => {
    const cfg = loadConfig({ dir });
    cfg.projects.reregister2 = {
      root: "/tmp/jarvis-old2",
      origin: "git@github.com:test/old.git",
      git: true,
      siblings: ["/tmp/sibling2"],
      plan: { commit: false },
    };
    writeConfig(cfg, { dir });

    // Re-register with a new root and new origin
    registerProject("reregister2", "/tmp/jarvis-new2", {
      dir,
      origin: "git@github.com:test/new.git",
    });

    const reloaded = loadConfig({ dir });
    expect(reloaded.projects.reregister2).toEqual({
      root: "/tmp/jarvis-new2",
      origin: "git@github.com:test/new.git",
      git: true,
      siblings: ["/tmp/sibling2"],
      plan: { commit: false },
    });
  });

  test("registerProject on brand-new name still writes root and optional origin", () => {
    registerProject("brandnew", "/tmp/jarvis-brandnew", { dir });
    expect(loadConfig({ dir }).projects.brandnew).toEqual({
      root: "/tmp/jarvis-brandnew",
    });

    registerProject("brandnewwithorigin", "/tmp/jarvis-brandnew-origin", {
      dir,
      origin: "git@github.com:test/brand.git",
    });
    expect(loadConfig({ dir }).projects.brandnewwithorigin).toEqual({
      root: "/tmp/jarvis-brandnew-origin",
      origin: "git@github.com:test/brand.git",
    });
  });

  test("setProjectOrigin preserves git, siblings, and plan", () => {
    const cfg = loadConfig({ dir });
    cfg.projects.origtest = {
      root: "/tmp/jarvis-orig",
      git: false,
      siblings: ["/tmp/sibling3"],
      plan: { specTimestamp: true },
    };
    writeConfig(cfg, { dir });

    setProjectOrigin("origtest", "git@github.com:test/updated.git", { dir });

    const reloaded = loadConfig({ dir });
    expect(reloaded.projects.origtest).toEqual({
      root: "/tmp/jarvis-orig",
      origin: "git@github.com:test/updated.git",
      git: false,
      siblings: ["/tmp/sibling3"],
      plan: { specTimestamp: true },
    });
  });
});

describe("git toggle", () => {
  test("defaults to true on bootstrap", () => {
    const cfg = loadConfig({ dir });
    expect(cfg.git).toBe(true);
  });

  test("loads configs with default git as true", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        projects: {},
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.git).toBe(true);
  });

  test("loads explicit git: false", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        git: false,
        projects: {},
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.git).toBe(false);
  });

  test("rejects non-boolean top-level git with file path in error", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        git: "yes",
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(file);
    expect(() => loadConfig({ dir })).toThrow(/git must be a boolean/);
  });

  test("accepts optional project git override", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        projects: { app: { root: "/tmp/jarvis-git-app", git: false } },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects.app).toEqual({
      root: "/tmp/jarvis-git-app",
      git: false,
    });
  });

  test("rejects non-boolean project git with file path in error", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        projects: { app: { root: "/tmp/jarvis-git-bad", git: "no" } },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(file);
    expect(() => loadConfig({ dir })).toThrow(/git must be a boolean/);
  });

  test("effectiveGit returns project override when set", () => {
    const cfg = testConfig(
      {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: CLAUDE_ONLY },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      { projects: { app: { root: "/tmp/a", git: false } } },
    );
    expect(effectiveGit(cfg, "app")).toBe(false);
  });

  test("effectiveGit falls back to top-level value when no override", () => {
    const cfg = testConfig(
      {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: CLAUDE_ONLY },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      { git: false, projects: { app: { root: "/tmp/a" } } },
    );
    expect(effectiveGit(cfg, "app")).toBe(false);
  });

  test("effectiveGit returns top-level value when project not provided", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: CLAUDE_ONLY },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: false,
      projects: {},
    };
    expect(effectiveGit(cfg)).toBe(false);
  });

  test("setGit round-trips through disk", () => {
    setGit(false, { dir });
    expect(loadConfig({ dir }).git).toBe(false);
    setGit(true, { dir });
    expect(loadConfig({ dir }).git).toBe(true);
  });

  test("setProjectGit writes, clears, and rejects unknown", () => {
    registerProject("app", "/tmp/jarvis-git-set", { dir });
    setProjectGit("app", false, { dir });
    expect(loadConfig({ dir }).projects.app).toEqual({
      root: "/tmp/jarvis-git-set",
      git: false,
    });
    setProjectGit("app", undefined, { dir });
    expect(loadConfig({ dir }).projects.app).toEqual({
      root: "/tmp/jarvis-git-set",
    });
    expect(() => setProjectGit("ghost", true, { dir })).toThrow(/not registered/);
  });

  test("setProjectGit preserves origin, siblings, and plan fields", () => {
    const cfg = loadConfig({ dir });
    cfg.projects.preserve = {
      root: "/tmp/jarvis-preserve",
      origin: "git@github.com:test/repo.git",
      siblings: ["/tmp/sibling1", "/tmp/sibling2"],
      plan: { specTimestamp: false, commit: true },
    };
    writeConfig(cfg, { dir });

    // Set git to true
    setProjectGit("preserve", true, { dir });
    let reloaded = loadConfig({ dir });
    expect(reloaded.projects.preserve).toEqual({
      root: "/tmp/jarvis-preserve",
      origin: "git@github.com:test/repo.git",
      siblings: ["/tmp/sibling1", "/tmp/sibling2"],
      plan: { specTimestamp: false, commit: true },
      git: true,
    });

    // Set git to false
    setProjectGit("preserve", false, { dir });
    reloaded = loadConfig({ dir });
    expect(reloaded.projects.preserve).toEqual({
      root: "/tmp/jarvis-preserve",
      origin: "git@github.com:test/repo.git",
      siblings: ["/tmp/sibling1", "/tmp/sibling2"],
      plan: { specTimestamp: false, commit: true },
      git: false,
    });

    // Clear git (set to undefined)
    setProjectGit("preserve", undefined, { dir });
    reloaded = loadConfig({ dir });
    expect(reloaded.projects.preserve).toEqual({
      root: "/tmp/jarvis-preserve",
      origin: "git@github.com:test/repo.git",
      siblings: ["/tmp/sibling1", "/tmp/sibling2"],
      plan: { specTimestamp: false, commit: true },
    });
  });

  test("accepts optional project siblings array", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          app: {
            root: "/tmp/jarvis-siblings",
            siblings: ["/tmp/sibling1", "/tmp/sibling2"],
          },
        },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects.app).toEqual({
      root: "/tmp/jarvis-siblings",
      siblings: ["/tmp/sibling1", "/tmp/sibling2"],
    });
  });

  test("rejects relative path in project siblings", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          app: {
            root: "/tmp/jarvis-siblings",
            siblings: ["relative/path"],
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(file);
    expect(() => loadConfig({ dir })).toThrow(/absolute path/);
  });

  test("rejects non-string sibling entries", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          app: {
            root: "/tmp/jarvis-siblings",
            siblings: ["/tmp/valid", 123],
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(file);
    expect(() => loadConfig({ dir })).toThrow(/must be a string/);
  });

  test("rejects non-array siblings", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          app: {
            root: "/tmp/jarvis-siblings",
            siblings: "not-an-array",
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(file);
    expect(() => loadConfig({ dir })).toThrow(/must be an array/);
  });

  test("rejects empty string sibling entries", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          app: {
            root: "/tmp/jarvis-siblings",
            siblings: ["   "],
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(file);
    expect(() => loadConfig({ dir })).toThrow(/non-empty string/);
  });
});

describe("unknown top-level keys", () => {
  test("preserves v2 keys like machineProfile and agents across a v1 write", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        projects: {},
        machineProfile: { hostname: "example" },
        agents: { claude: { model: "opus" } },
      }),
    );

    const loaded = loadConfig({ dir });
    expect((loaded as unknown as Record<string, unknown>).machineProfile).toEqual({ hostname: "example" });
    expect((loaded as unknown as Record<string, unknown>).agents).toEqual({ claude: { model: "opus" } });

    setGit(false, { dir });

    const reloaded = loadConfig({ dir });
    expect((reloaded as unknown as Record<string, unknown>).machineProfile).toEqual({ hostname: "example" });
    expect((reloaded as unknown as Record<string, unknown>).agents).toEqual({ claude: { model: "opus" } });
    expect(reloaded.git).toBe(false);
  });
});

describe("openSessionLog", () => {
  test("creates sessions dir under the configured jarvis dir and appends", () => {
    const fd = openSessionLog("project-name", "2026-05-10T14:30Z", { dir });
    try {
      expect(existsSync(join(dir, "sessions"))).toBe(true);
      expect(existsSync(join(dir, "sessions", "project-name-2026-05-10T14:30Z.log"))).toBe(true);
    } finally {
      closeSync(fd);
    }
  });
});

describe("atomic writes", () => {
  test("survives concurrent writes - first write is preserved", () => {
    const _cfg1 = loadConfig({ dir });
    registerProject("app1", "/app1", { dir });
    expect(loadConfig({ dir }).projects.app1).toBeDefined();

    registerProject("app2", "/app2", { dir });
    const loaded = loadConfig({ dir });

    // Both should be registered
    expect(loaded.projects.app1).toBeDefined();
    expect(loaded.projects.app2).toBeDefined();
  });

  test("config file is not corrupted by write", () => {
    const cfg = loadConfig({ dir });
    cfg.projects.test = { root: "/test/root" };
    writeConfig(cfg, { dir });

    // Read file and verify it's valid JSON
    const file = join(dir, "config.json");
    const content = readFileSync(file, "utf8");
    expect(() => JSON.parse(content)).not.toThrow();

    // Verify the write was successful
    const loaded = loadConfig({ dir });
    expect(loaded.projects.test).toBeDefined();
  });
});

describe("plan flags", () => {
  test("accepts optional plan.specTimestamp and plan.commit on a project", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        maxIterations: 10,
        projects: {
          "app-a": {
            root: "/tmp/jarvis-plan-flags",
            plan: {
              specTimestamp: false,
              commit: false,
            },
          },
        },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects["app-a"]).toEqual({
      root: "/tmp/jarvis-plan-flags",
      plan: {
        specTimestamp: false,
        commit: false,
      },
    });
  });

  test("accepts global plan.specTimestamp and plan.commit", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: {
            agentOrder: CLAUDE_ONLY,
            specTimestamp: true,
            commit: false,
          },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.modes.plan.specTimestamp).toBe(true);
    expect(cfg.modes.plan.commit).toBe(false);
  });

  test("loads configs without plan flags", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: { app: { root: "/tmp/jarvis-no-flags" } },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects.app).toEqual({ root: "/tmp/jarvis-no-flags" });
  });

  test("rejects non-boolean project plan.specTimestamp", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          app: {
            root: "/tmp/jarvis-bad-spec-timestamp",
            plan: { specTimestamp: "yes" },
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(file);
    expect(() => loadConfig({ dir })).toThrow(/plan\.specTimestamp must be a boolean/);
  });

  test("rejects non-boolean project plan.commit", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          app: {
            root: "/tmp/jarvis-bad-commit",
            plan: { commit: 1 },
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(file);
    expect(() => loadConfig({ dir })).toThrow(/plan\.commit must be a boolean/);
  });

  test("rejects non-object project plan", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          app: {
            root: "/tmp/jarvis-bad-plan-type",
            plan: "not-an-object",
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(file);
    expect(() => loadConfig({ dir })).toThrow(/plan must be an object/);
  });

  test("accepts partial plan object (only specTimestamp)", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          app: {
            root: "/tmp/jarvis-partial-plan",
            plan: { specTimestamp: false },
          },
        },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects.app?.plan).toEqual({ specTimestamp: false });
  });

  test("accepts partial plan object (only commit)", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          app: {
            root: "/tmp/jarvis-partial-plan-commit",
            plan: { commit: true },
          },
        },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects.app?.plan).toEqual({ commit: true });
  });

  test("rejects flat specTimestamp at project level with nesting hint", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          myproject: {
            root: "/tmp/jarvis-flat-spec-timestamp",
            specTimestamp: true,
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/myproject/);
    expect(() => loadConfig({ dir })).toThrow(/specTimestamp/);
    expect(() => loadConfig({ dir })).toThrow(/plan\.specTimestamp/);
  });

  test("rejects flat commit at project level with nesting hint", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          myproject: {
            root: "/tmp/jarvis-flat-commit",
            commit: false,
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/myproject/);
    expect(() => loadConfig({ dir })).toThrow(/commit/);
    expect(() => loadConfig({ dir })).toThrow(/plan\.commit/);
  });

  test("rejects other unknown project keys with allowed set", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          myproject: {
            root: "/tmp/jarvis-unknown-key",
            oringn: "git@github.com:example/repo.git",
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/myproject/);
    expect(() => loadConfig({ dir })).toThrow(/oringn/);
    expect(() => loadConfig({ dir })).toThrow(
      /root, origin, git, siblings, plan, updateSnapshotsCommand, readyCommand, fixCommand/,
    );
  });

  test("rejects unknown keys under project.plan", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          myproject: {
            root: "/tmp/jarvis-unknown-plan-key",
            plan: { comit: true },
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/myproject/);
    expect(() => loadConfig({ dir })).toThrow(/plan/);
    expect(() => loadConfig({ dir })).toThrow(/comit/);
    expect(() => loadConfig({ dir })).toThrow(/specTimestamp, commit/);
  });

  test("round-trips readyCommand", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          myproject: {
            root: "/tmp/jarvis-ready-cmd",
            readyCommand: "my-script.sh --ci",
          },
        },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects.myproject?.readyCommand).toBe("my-script.sh --ci");
  });

  test("rejects empty readyCommand", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          myproject: {
            root: "/tmp/jarvis-ready-cmd-empty",
            readyCommand: "",
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/readyCommand/);
    expect(() => loadConfig({ dir })).toThrow(/non-empty/);
  });

  test("rejects whitespace-only readyCommand", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          myproject: {
            root: "/tmp/jarvis-ready-cmd-ws",
            readyCommand: "   ",
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/readyCommand/);
    expect(() => loadConfig({ dir })).toThrow(/non-empty/);
  });

  test("rejects non-string readyCommand", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          myproject: {
            root: "/tmp/jarvis-ready-cmd-type",
            readyCommand: 42,
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/readyCommand/);
    expect(() => loadConfig({ dir })).toThrow(/string/);
  });

  test("accepts correctly-shaped config with all allowed keys", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          app: {
            root: "/tmp/jarvis-full-project",
            origin: "git@github.com:example/repo.git",
            git: true,
            siblings: ["/tmp/other"],
            plan: { specTimestamp: false, commit: true },
            readyCommand: "my-ready.sh",
          },
        },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects.app).toEqual({
      root: "/tmp/jarvis-full-project",
      origin: "git@github.com:example/repo.git",
      git: true,
      siblings: ["/tmp/other"],
      plan: { specTimestamp: false, commit: true },
      readyCommand: "my-ready.sh",
    });
  });

  test("round-trips fixCommand", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          myproject: {
            root: "/tmp/jarvis-fix-cmd",
            fixCommand: "npm run lint-fix",
          },
        },
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.projects.myproject?.fixCommand).toBe("npm run lint-fix");
  });

  test("rejects empty fixCommand", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          myproject: {
            root: "/tmp/jarvis-fix-cmd-empty",
            fixCommand: "",
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/fixCommand/);
  });

  test("rejects whitespace-only fixCommand", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          myproject: {
            root: "/tmp/jarvis-fix-cmd-ws",
            fixCommand: "   ",
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/fixCommand/);
  });

  test("rejects non-string fixCommand", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {
          myproject: {
            root: "/tmp/jarvis-fix-cmd-bad",
            fixCommand: 42,
          },
        },
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/fixCommand/);
  });
});

describe("resolvePlanFlags", () => {
  test("returns defaults when no config overrides are present", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: CLAUDE_ONLY },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {},
    };
    expect(resolvePlanFlags(cfg, undefined)).toEqual({
      specTimestamp: true,
      commit: true,
      targetDir: "spec",
    });
  });

  test("returns project-level values when set, regardless of global", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: {
          agentOrder: CLAUDE_ONLY,
          specTimestamp: true,
          commit: true,
        },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {
        app: {
          root: "/tmp/a",
          plan: { specTimestamp: false, commit: false },
        },
      },
    };
    const project = cfg.projects.app;
    expect(resolvePlanFlags(cfg, project)).toEqual({
      specTimestamp: false,
      commit: false,
      targetDir: "spec",
    });
  });

  test("returns global plan values when no project override is set", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: {
          agentOrder: CLAUDE_ONLY,
          specTimestamp: false,
          commit: true,
        },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: { app: { root: "/tmp/a" } },
    };
    const project = cfg.projects.app;
    expect(resolvePlanFlags(cfg, project)).toEqual({
      specTimestamp: false,
      commit: true,
      targetDir: "spec",
    });
  });

  test("uses project value for specTimestamp when global is different", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: {
          agentOrder: CLAUDE_ONLY,
          specTimestamp: true,
          commit: true,
        },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {
        app: {
          root: "/tmp/a",
          plan: { specTimestamp: false },
        },
      },
    };
    const project = cfg.projects.app;
    expect(resolvePlanFlags(cfg, project)).toEqual({
      specTimestamp: false,
      commit: true,
      targetDir: "spec",
    });
  });

  test("uses project value for commit when global is different", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: {
          agentOrder: CLAUDE_ONLY,
          specTimestamp: false,
          commit: true,
        },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {
        app: {
          root: "/tmp/a",
          plan: { commit: false },
        },
      },
    };
    const project = cfg.projects.app;
    expect(resolvePlanFlags(cfg, project)).toEqual({
      specTimestamp: false,
      commit: false,
      targetDir: "spec",
    });
  });

  test("falls back to hardcoded defaults for both when undefined everywhere", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: CLAUDE_ONLY },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: { app: { root: "/tmp/a" } },
    };
    const project = cfg.projects.app;
    expect(resolvePlanFlags(cfg, project)).toEqual({
      specTimestamp: true,
      commit: true,
      targetDir: "spec",
    });
  });

  test("accepts undefined project and falls through to defaults", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: CLAUDE_ONLY },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {},
    };
    expect(resolvePlanFlags(cfg, undefined)).toEqual({
      specTimestamp: true,
      commit: true,
      targetDir: "spec",
    });
  });

  test("resolves targetDir with project override", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: {
          agentOrder: CLAUDE_ONLY,
          targetDir: "spec",
        },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {
        app: {
          root: "/tmp/a",
          plan: { targetDir: "v1/spec" },
        },
      },
    };
    const project = cfg.projects.app;
    expect(resolvePlanFlags(cfg, project)).toEqual({
      specTimestamp: true,
      commit: true,
      targetDir: "v1/spec",
    });
  });

  test("resolves targetDir with global default when project has no override", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: {
          agentOrder: CLAUDE_ONLY,
          targetDir: "specs",
        },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {
        app: {
          root: "/tmp/a",
        },
      },
    };
    const project = cfg.projects.app;
    expect(resolvePlanFlags(cfg, project)).toEqual({
      specTimestamp: true,
      commit: true,
      targetDir: "specs",
    });
  });
});

describe("targetDir validation", () => {
  test("rejects absolute paths", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: [{ agent: "claude", model: "haiku" }],
          },
          plan: {
            agentOrder: [{ agent: "claude", model: "haiku" }],
            targetDir: "/absolute/path",
          },
        },
        quotaFallback: "lenient",
        projects: {},
      }),
    );

    expect(() => loadConfig({ dir })).toThrow(/relative path/);
  });

  test("rejects paths with .. traversal", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: [{ agent: "claude", model: "haiku" }],
          },
          plan: {
            agentOrder: [{ agent: "claude", model: "haiku" }],
            targetDir: "../specs",
          },
        },
        quotaFallback: "lenient",
        projects: {},
      }),
    );

    expect(() => loadConfig({ dir })).toThrow(/\.\./);
  });

  test("rejects project-level targetDir with absolute paths", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: [{ agent: "claude", model: "haiku" }],
          },
          plan: {
            agentOrder: [{ agent: "claude", model: "haiku" }],
          },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        projects: {
          app: {
            root: "/tmp/a",
            plan: { targetDir: "/absolute" },
          },
        },
      }),
    );

    expect(() => loadConfig({ dir })).toThrow(/relative path/);
  });

  test("rejects project-level targetDir with .. traversal", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: [{ agent: "claude", model: "haiku" }],
          },
          plan: {
            agentOrder: [{ agent: "claude", model: "haiku" }],
          },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        projects: {
          app: {
            root: "/tmp/a",
            plan: { targetDir: "../../specs" },
          },
        },
      }),
    );

    expect(() => loadConfig({ dir })).toThrow(/\.\./);
  });

  test("accepts relative paths with subdirectories", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: [{ agent: "claude", model: "haiku" }],
          },
          plan: {
            agentOrder: [{ agent: "claude", model: "haiku" }],
            targetDir: "v1/spec",
          },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        projects: {},
      }),
    );

    const cfg = loadConfig({ dir });
    expect(cfg.modes.plan.targetDir).toBe("v1/spec");
  });
});

describe("resolveReviewPasses", () => {
  test("returns CLI override when provided", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: CLAUDE_ONLY },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 5 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {},
    };
    expect(resolveReviewPasses(cfg, 0)).toBe(0);
    expect(resolveReviewPasses(cfg, 3)).toBe(3);
    expect(resolveReviewPasses(cfg, 10)).toBe(10);
  });

  test("returns config value when no CLI override", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: CLAUDE_ONLY },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 7 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {},
    };
    expect(resolveReviewPasses(cfg)).toBe(7);
  });

  test("returns default 2 when no config or CLI override", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: CLAUDE_ONLY },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {},
    };
    expect(resolveReviewPasses(cfg)).toBe(2);
  });

  test("CLI override of 0 disables review", () => {
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: CLAUDE_ONLY },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 5 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {},
    };
    expect(resolveReviewPasses(cfg, 0)).toBe(0);
  });
});

describe("resolveReviewAgentOrder", () => {
  test("returns review agent order when configured", () => {
    const reviewOrder: AgentEntry[] = [{ agent: "codex", model: "gpt-5.3-codex" }];
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: CLAUDE_ONLY },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2, agentOrder: reviewOrder },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {},
    };
    expect(resolveReviewAgentOrder(cfg)).toEqual(reviewOrder);
  });

  test("falls back to plan agent order when review order is unset", () => {
    const planOrder: AgentEntry[] = [{ agent: "cursor", model: "Composer 2" }];
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: planOrder },
        prompt: { agentOrder: planOrder },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {},
    };
    expect(resolveReviewAgentOrder(cfg)).toEqual(planOrder);
  });

  test("prefers review order over plan order when both are set", () => {
    const planOrder: AgentEntry[] = [{ agent: "claude", model: "haiku" }];
    const reviewOrder: AgentEntry[] = [
      { agent: "codex", model: "gpt-5.3-codex" },
      { agent: "claude", model: "opus" },
    ];
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: planOrder },
        prompt: { agentOrder: planOrder },
        review: { passes: 2, agentOrder: reviewOrder },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {},
    };
    expect(resolveReviewAgentOrder(cfg)).toEqual(reviewOrder);
  });
});

describe("resolveSubRoleAgentOrder", () => {
  test("falls back per sub-role when no override is set", () => {
    const patchOrder: AgentEntry[] = [{ agent: "claude", model: "haiku" }];
    const planOrder: AgentEntry[] = [{ agent: "cursor", model: "Composer 2" }];
    const reviewOrder: AgentEntry[] = [{ agent: "codex", model: "gpt-5.3-codex" }];
    const cfg: Config = {
      version: 2,
      modes: {
        patch: { agentOrder: patchOrder },
        plan: { agentOrder: planOrder },
        prompt: { agentOrder: planOrder },
        review: { passes: 2, agentOrder: reviewOrder },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {},
    };

    expect(resolveSubRoleAgentOrder(cfg, "reviewActuator")).toEqual(patchOrder);
    expect(resolveSubRoleAgentOrder(cfg, "reviewPanel")).toEqual(reviewOrder);
  });

  test("returns sub-role override when configured", () => {
    const patchOrder: AgentEntry[] = [{ agent: "claude", model: "haiku" }];
    const reviewActuator: AgentEntry[] = [{ agent: "codex", model: "gpt-5.4" }];
    const reviewPanel: AgentEntry[] = [{ agent: "opencode", model: "opencode/deepseek-v4-flash-free" }];
    const cfg: Config = {
      version: 2,
      modes: {
        patch: {
          agentOrder: patchOrder,
          subRoleAgentOrder: { reviewActuator, reviewPanel },
        },
        plan: { agentOrder: patchOrder },
        prompt: { agentOrder: patchOrder },
        review: { passes: 2 },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: 10,
      iterationTimeoutMs: 30 * 60_000,
      logServerUrl: "http://x/",
      logServerBind: "x",
      git: true,
      projects: {},
    };

    expect(resolveSubRoleAgentOrder(cfg, "reviewActuator")).toEqual(reviewActuator);
    expect(resolveSubRoleAgentOrder(cfg, "reviewPanel")).toEqual(reviewPanel);
  });
});

describe("review mode config validation", () => {
  test("rejects invalid review passes (negative)", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: -1 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.review\.passes/);
    expect(() => loadConfig({ dir })).toThrow(/non-negative/);
  });

  test("rejects invalid review passes (non-integer)", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: "2" },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.review\.passes/);
  });

  test("rejects empty review agent order", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2, agentOrder: [] },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.review\.agentOrder.*non-empty/);
  });

  test("rejects invalid agent in review agent order", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          review: {
            passes: 2,
            agentOrder: [{ agent: "invalid-agent", model: "model" }],
          },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.review\.agentOrder/);
    expect(() => loadConfig({ dir })).toThrow(/unknown agent/);
  });

  test("rejects duplicate agents in review agent order", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          review: {
            passes: 2,
            agentOrder: [
              { agent: "claude", model: "haiku" },
              { agent: "claude", model: "sonnet" },
            ],
          },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/modes\.review\.agentOrder.*duplicate/);
  });

  test("accepts valid review agent order", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          review: {
            passes: 3,
            agentOrder: [
              { agent: "codex", model: "gpt-5.3-codex" },
              { agent: "claude", model: "haiku" },
            ],
          },
        },
        projects: {},
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.modes.review.passes).toBe(3);
    expect(cfg.modes.review.agentOrder).toEqual([
      { agent: "codex", model: "gpt-5.3-codex" },
      { agent: "claude", model: "haiku" },
    ]);
  });

  test("defaults missing review mode", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
        },
        projects: {},
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.modes.review).toEqual({ passes: 1 });
  });

  test("defaults modes.patch.shrink to agent", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.modes.patch.shrink).toBe("agent");
  });

  test("accepts modes.patch.shrink set to off", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY, shrink: "off" },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.modes.patch.shrink).toBe("off");
  });

  test("accepts modes.patch.shrink set to agent", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY, shrink: "agent" },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    const cfg = loadConfig({ dir });
    expect(cfg.modes.patch.shrink).toBe("agent");
  });

  test("rejects invalid modes.patch.shrink value", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder: CLAUDE_ONLY, shrink: "invalid" },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(file);
    expect(() => loadConfig({ dir })).toThrow(/modes\.patch\.shrink/);
    expect(() => loadConfig({ dir })).toThrow(/off.*agent/);
  });

  test.each([
    [
      "modes.patch.agentOrder",
      {
        patch: { agentOrder: [{ agent: "claude", model: "haiku", capability: 3 }] },
        plan: { agentOrder: CLAUDE_ONLY },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
    ],
    [
      "modes.plan.agentOrder",
      {
        patch: { agentOrder: CLAUDE_ONLY },
        plan: { agentOrder: [{ agent: "claude", model: "haiku", capability: 3 }] },
        prompt: { agentOrder: CLAUDE_ONLY },
        review: { passes: 2 },
      },
    ],
  ])("rejects capability on %s", (_field, modes) => {
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ version: 2, modes, projects: {} }));
    expect(() => loadConfig({ dir })).toThrow(/capability/);
  });

  test("rejects actuationCapabilityFloor as unknown key", () => {
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: CLAUDE_ONLY,
            actuationCapabilityFloor: 3,
          },
          plan: { agentOrder: CLAUDE_ONLY },
          prompt: { agentOrder: CLAUDE_ONLY },
          review: { passes: 2 },
        },
        projects: {},
      }),
    );
    expect(() => loadConfig({ dir })).toThrow(/actuationCapabilityFloor/);
  });

  test("buildActiveAgents selects all agents from agentOrder with trivial tier", () => {
    const cfg = testConfig({
      patch: { agentOrder: DEFAULT_AGENT_ORDER },
      plan: { agentOrder: DEFAULT_AGENT_ORDER },
      prompt: { agentOrder: DEFAULT_AGENT_ORDER },
      review: { passes: 1 },
    });
    const opts: RunCommandOptions = {
      specPath: "/tmp/test.md",
      io: { stdout: () => {}, stderr: () => {} },
    };
    expect(buildActiveAgents(opts, cfg, "trivial")).toHaveLength(3);
  });
});
