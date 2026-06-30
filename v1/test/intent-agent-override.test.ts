import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { intentCommand, parseIntentArgs } from "../src/commands/intent.ts";
import type { AgentEntry, Config } from "../src/config.ts";
import { loadConfig, writeConfig } from "../src/config.ts";
import { runIntentSplitTurn } from "../src/modes/plan/intent-split.ts";
import { HARNESS_MODEL_CONFIG_FALLBACK } from "../src/quota-harness-messages.ts";

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };
const CODEX_ENTRY = { agent: "codex" as const, model: "gpt-5.3-codex" };
const LADDER = [CLAUDE_ENTRY, CODEX_ENTRY];

class FakeAgent implements Agent {
  readonly name: AgentName;
  readonly calls: { prompt: string; cwd: string }[] = [];
  readonly #run: (prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>;

  constructor(name: AgentName, run: (prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>) {
    this.name = name;
    this.#run = run;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    this.calls.push({ prompt, cwd: opts.cwd });
    return this.#run(prompt, opts);
  }

  attributionLabel(): string {
    return `fake-${this.name}`;
  }
}

function captureStderr() {
  let err = "";
  return {
    io: {
      stdout: () => {},
      stderr: (s: string) => {
        err += s;
      },
    },
    err: () => err,
  };
}

function initGit(dir: string): void {
  execSync("git init -b main", { cwd: dir });
  execSync("git config user.email 'test@example.com'", { cwd: dir });
  execSync("git config user.name 'Test User'", { cwd: dir });
}

function withPlanOrder(cfg: Config, order: AgentEntry[]): Config {
  return { ...cfg, modes: { ...cfg.modes, plan: { ...cfg.modes.plan, agentOrder: order } } };
}

function writeSplitOutput(worktreePath: string, stagingDir: string, names: string[]): void {
  const stagePath = join(worktreePath, stagingDir);
  mkdirSync(stagePath, { recursive: true });
  for (const name of names) {
    writeFileSync(join(stagePath, `${name}.md`), `---\nname: ${name}\n---\n\n## Intent\n\nbody\n\n## Prerequisites\n`);
  }
}

describe("intent --agent override", () => {
  test("missing --agent value exits from parseIntentArgs", () => {
    const result = parseIntentArgs(["--agent"], "/tmp");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.exitCode).toBe(1);
      expect(result.message).toBe("intent: missing value for --agent");
    }
  });

  test("invalid --agent exits before agent spawn or worktree setup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-agent-invalid-"));
    const cfgDir = join(dir, "cfg");
    try {
      mkdirSync(cfgDir);
      const cap = captureStderr();
      const code = await intentCommand({
        io: cap.io,
        args: ["--agent", "bogus", "inline seed"],
        config: { dir: cfgDir },
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("intent:");
      expect(cap.err()).toContain('unknown agent "bogus"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("override ladder drives intent-split binding selection without mutating config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-agent-split-"));
    const cfgDir = join(dir, "cfg");
    try {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.plan.agentOrder = LADDER;
      writeConfig(cfg, { dir: cfgDir });
      const configBefore = readFileSync(join(cfgDir, "config.json"), "utf8");

      const repo = mkdtempSync(join(tmpdir(), "jarvis-intent-agent-split-repo-"));
      try {
        initGit(repo);
        const claude = new FakeAgent("claude", () => {
          throw new Error("claude should be skipped by override");
        });
        const codex = new FakeAgent("codex", (_prompt, opts) => {
          writeSplitOutput(opts.cwd, ".jarvis-intent-stage", ["feat"]);
          return { kind: "ok", stdout: "", stderr: "" };
        });

        const out = await runIntentSplitTurn({
          worktreePath: repo,
          seedLabel: "inline",
          seedContent: "split me",
          stagingDir: ".jarvis-intent-stage",
          config: withPlanOrder(cfg, [CODEX_ENTRY]),
          createAgent: (agentName) => {
            if (agentName === "claude") return claude;
            if (agentName === "codex") return codex;
            throw new Error(`unexpected agent: ${agentName}`);
          },
        });

        expect(out.result.kind).toBe("ok");
        expect(claude.calls).toHaveLength(0);
        expect(codex.calls).toHaveLength(1);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }

      expect(readFileSync(join(cfgDir, "config.json"), "utf8")).toBe(configBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("intent-split model_config cascade advances through the overridden ladder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-agent-cascade-"));
    const cfgDir = join(dir, "cfg");
    try {
      const rawCfg = loadConfig({ dir: cfgDir });
      rawCfg.modes.plan.agentOrder = LADDER;
      writeConfig(rawCfg, { dir: cfgDir });
      const repo = mkdtempSync(join(tmpdir(), "jarvis-intent-agent-cascade-repo-"));
      const stderrLines: string[] = [];
      try {
        initGit(repo);
        const claude = new FakeAgent("claude", () => ({
          kind: "model_config",
          stderr: "unknown model",
        }));
        const codex = new FakeAgent("codex", (_prompt, opts) => {
          writeSplitOutput(opts.cwd, ".jarvis-intent-stage", ["feat"]);
          return { kind: "ok", stdout: "", stderr: "" };
        });

        const out = await runIntentSplitTurn({
          worktreePath: repo,
          seedLabel: "inline",
          seedContent: "split me",
          stagingDir: ".jarvis-intent-stage",
          config: withPlanOrder(rawCfg, LADDER),
          stderr: (line) => stderrLines.push(line),
          createAgent: (agentName) => {
            if (agentName === "claude") return claude;
            if (agentName === "codex") return codex;
            throw new Error(`unexpected agent: ${agentName}`);
          },
        });

        expect(out.result.kind).toBe("ok");
        expect(claude.calls).toHaveLength(1);
        expect(codex.calls).toHaveLength(1);
        expect(stderrLines.join("")).toContain(`intent: claude: ${HARNESS_MODEL_CONFIG_FALLBACK}`);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
