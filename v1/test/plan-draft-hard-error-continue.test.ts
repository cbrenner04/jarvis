import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import type { Config } from "../src/config.ts";
import { runDraftPhase } from "../src/modes/plan/draft.ts";

class FakeAgent implements Agent {
  readonly name: AgentName;
  readonly calls: { prompt: string; cwd: string }[] = [];
  readonly #run: (callCount: number, prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>;

  constructor(
    name: AgentName,
    run: (callCount: number, prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>,
  ) {
    this.name = name;
    this.#run = run;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    this.calls.push({ prompt, cwd: opts.cwd });
    return this.#run(this.calls.length, prompt, opts);
  }

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

describe("runDraftPhase (plan inner loop on hard error)", () => {
  test("draft phase tries the next agent after a classified hard error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-hard-err-"));
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n# Intent\n\nseed\n");

      const claude = new FakeAgent("claude", () => ({
        kind: "error",
        exitCode: 1,
        stderr: "synthetic hard error",
      }));
      const codex = new FakeAgent("codex", (_c, _p, opts) => {
        const d = join(opts.cwd, "spec", name);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, "index.md"), "# Draft spec\n\n- [ ] [00](./00-one.md)\n");
        writeFileSync(join(d, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const out = await runDraftPhase({
        worktreePath: dir,
        name,
        config: testConfig,
        createAgent: (agentName) => {
          if (agentName === "claude") {
            return claude;
          }
          if (agentName === "codex") {
            return codex;
          }
          throw new Error(`unexpected agent: ${agentName}`);
        },
      });

      expect(out.result.kind).toBe("ok");
      expect(out.subspecCount).toBe(1);
      expect(claude.calls).toHaveLength(1);
      expect(codex.calls).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("draft phase logs the assembled prompt once via onOutboundPrompt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-outbound-"));
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n# Intent\n\nseed\n");

      const claude = new FakeAgent("claude", (_c, _p, opts) => {
        const d = join(opts.cwd, "spec", name);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, "index.md"), "# Draft spec\n\n- [ ] [00](./00-one.md)\n");
        writeFileSync(join(d, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const logged: string[] = [];
      await runDraftPhase({
        worktreePath: dir,
        name,
        config: testConfig,
        onOutboundPrompt: (prompt) => logged.push(prompt),
        createAgent: () => claude,
      });

      expect(logged).toHaveLength(1);
      expect(logged[0]).toBe(claude.calls[0]?.prompt);
      expect(logged[0]).toContain("Be terse in communication artifacts (specs, PRs, commits, intents).");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
