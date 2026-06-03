import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  Agent,
  AgentName,
  AgentResult,
  AgentRunOptions,
} from "../../../src/agents/types.ts";
import type { Config } from "../../../src/config.ts";
import { runInlineDraftTurn } from "../../../src/modes/plan/inline-draft.ts";

class FakeAgent implements Agent {
  readonly name: AgentName;
  readonly #run: () => AgentResult | Promise<AgentResult>;

  constructor(name: AgentName, run: () => AgentResult | Promise<AgentResult>) {
    this.name = name;
    this.#run = run;
  }

  async run(prompt: string, _opts: AgentRunOptions): Promise<AgentResult> {
    this.lastPrompt = prompt;
    return this.#run();
  }

  lastPrompt = "";

  attributionLabel(): string {
    return `fake-${this.name}`;
  }
}

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };
const CODEX_ENTRY = { agent: "codex" as const, model: "gpt-5.3-codex" };

const testConfig: Config = {
  version: 2,
  modes: {
    patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
    plan: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
    review: { passes: 2 },
  },
  quotaFallback: "strict",
  weakQuotaExitCodes: [],
  maxIterations: 10,
  iterationTimeoutMs: 30 * 60_000,
  git: true,
  projects: {},
};

describe("runInlineDraftTurn", () => {
  test("passes intentPath through to the agent prompt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-inline-draft-intent-path-"));
    const intentPath = join(dir, "spec", "wip-intents", "my-feature.md");
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      const agent = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "draft",
        stderr: "",
      }));

      await runInlineDraftTurn({
        worktreePath: dir,
        inlineIntent: "add login",
        intentPath,
        config: testConfig,
        createAgent: () => agent,
      });

      expect(agent.lastPrompt).toContain(intentPath);
      expect(agent.lastPrompt).toContain("add login");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("falls back to the next agent after quota on the first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-inline-draft-quota-"));
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      const claude = new FakeAgent("claude", () => ({
        kind: "quota",
        stderr: "You've hit your session limit",
      }));
      const codex = new FakeAgent("codex", () => ({
        kind: "ok",
        stdout: "expanded intent",
        stderr: "",
      }));

      const { result, agentLabel } = await runInlineDraftTurn({
        worktreePath: dir,
        inlineIntent: "foo bar baz",
        intentPath: "text",
        config: testConfig,
        createAgent: (name) => (name === "claude" ? claude : codex),
      });

      expect(result.kind).toBe("ok");
      expect(agentLabel).toBe("fake-codex");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns quota only after every agent in order is exhausted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-inline-draft-all-quota-"));
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      const claude = new FakeAgent("claude", () => ({
        kind: "quota",
        stderr: "quota a",
      }));
      const codex = new FakeAgent("codex", () => ({
        kind: "quota",
        stderr: "quota b",
      }));

      const { result } = await runInlineDraftTurn({
        worktreePath: dir,
        inlineIntent: "foo bar baz",
        config: testConfig,
        intentPath: "test",
        createAgent: (name) => (name === "claude" ? claude : codex),
      });

      expect(result.kind).toBe("quota");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
