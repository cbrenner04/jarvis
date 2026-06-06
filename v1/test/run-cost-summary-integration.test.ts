import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { loadConfig, registerProject, writeConfig } from "../src/config.ts";
import type { RunIo } from "../src/modes/patch/run.ts";
import { runCommand } from "../src/modes/patch/run.ts";

class FakeAgent implements Agent {
  readonly name: AgentName = "claude";

  async run(_prompt: string, _opts: AgentRunOptions): Promise<AgentResult> {
    return {
      kind: "ok",
      stdout: "",
      stderr: "",
      usage_source: "agent",
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      cost_usd: 0.25,
    };
  }

  attributionLabel(): string {
    return "fake-claude";
  }
}

const CODEX_ENTRY = { agent: "codex" as const, model: "gpt-5.4" };

class FakeCodexNoUsd implements Agent {
  readonly name: AgentName = "codex";

  constructor(private readonly specPath: string) {}

  async run(_prompt: string, _opts: AgentRunOptions): Promise<AgentResult> {
    writeFileSync(this.specPath, "- [x] todo\n");
    return {
      kind: "ok",
      stdout: "",
      stderr: "",
      usage_source: "agent",
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };
  }

  attributionLabel(): string {
    return "fake-codex";
  }
}

function captureIo(): { io: RunIo; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
    },
    out: () => out,
    err: () => err,
  };
}

describe("run summary integration", () => {
  test("prints totals sourced from run telemetry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-summary-integration-"));
    const projectRoot = join(dir, "project");
    const cfgDir = join(dir, "cfg");
    mkdirSync(projectRoot);
    registerProject("project", projectRoot, { dir: cfgDir });
    const specPath = join(projectRoot, "index.md");
    writeFileSync(specPath, "- [ ] todo\n");
    const agent = new FakeAgent();
    const cap = captureIo();

    const code = await runCommand({
      specPath,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude: agent },
      skipGhCheck: true,
      logClient: {
        assertReachable: async () => {},
        send: async () => {},
      },
      handleSignals: false,
    });

    expect(code).toBe(4);
    const out = cap.out();
    expect(out).toContain("run summary");
    expect(out).toContain("iterations: 1");
    expect(out).toContain("attempts: 1");
    expect(out).toContain("claude (haiku) (1 iteration(s))");
    expect(out).toContain("1,200");
    expect(out).toContain("300");
    expect(out).toContain("$0.25");
    const telemetry = readFileSync(join(cfgDir, "runs.jsonl"), "utf8");
    expect(telemetry).toContain('"cost_usd":0.25');

    rmSync(dir, { recursive: true, force: true });
  });

  test("does not print summary when zero iterations run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-summary-zero-iterations-"));
    const projectRoot = join(dir, "project");
    const cfgDir = join(dir, "cfg");
    mkdirSync(projectRoot);
    registerProject("project", projectRoot, { dir: cfgDir });
    const specPath = join(projectRoot, "index.md");
    writeFileSync(specPath, "- [x] done\n");
    const agent = new FakeAgent();
    const cap = captureIo();

    const code = await runCommand({
      specPath,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude: agent },
      skipGhCheck: true,
      logClient: {
        assertReachable: async () => {},
        send: async () => {},
      },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.out()).not.toContain("run summary");
    expect(cap.out()).toContain("spec complete");
    rmSync(dir, { recursive: true, force: true });
  });

  test("computes USD from usage using configured model id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-summary-computed-"));
    const projectRoot = join(dir, "project");
    const cfgDir = join(dir, "cfg");
    mkdirSync(projectRoot);
    registerProject("project", projectRoot, { dir: cfgDir });
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CODEX_ENTRY];
    writeConfig(cfg, { dir: cfgDir });
    const specPath = join(projectRoot, "index.md");
    writeFileSync(specPath, "- [ ] todo\n");
    const cap = captureIo();
    const code = await runCommand({
      specPath,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { codex: new FakeCodexNoUsd(specPath) },
      skipGhCheck: true,
      logClient: {
        assertReachable: async () => {},
        send: async () => {},
      },
      handleSignals: false,
    });
    expect(code).toBe(0);
    const out = cap.out();
    expect(out).toContain("computed");
    expect(out).toContain("$2.50");
    const telemetry = readFileSync(join(cfgDir, "runs.jsonl"), "utf8");
    expect(telemetry).toContain('"cost_source":"computed"');
    expect(telemetry).toContain('"configured_model":"gpt-5.4"');
    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects unknown priced-model values at config load", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-summary-no-price-"));
    const cfgDir = join(dir, "cfg");
    mkdirSync(cfgDir, { recursive: true });
    registerProject("project", join(dir, "project"), { dir: cfgDir });
    const cfg = loadConfig({ dir: cfgDir });
    cfg.modes.patch.agentOrder = [{ agent: "codex", model: "not-a-priced-model-xyz" }];
    expect(() => writeConfig(cfg, { dir: cfgDir })).toThrow(/not a known priced model for agent "codex"/);
    rmSync(dir, { recursive: true, force: true });
  });
});
