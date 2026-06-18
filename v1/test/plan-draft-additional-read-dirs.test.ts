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
  readonly calls: { prompt: string; opts: AgentRunOptions }[] = [];
  readonly #run: (callCount: number, prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>;

  constructor(
    name: AgentName,
    run: (callCount: number, prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>,
  ) {
    this.name = name;
    this.#run = run;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    this.calls.push({ prompt, opts });
    return this.#run(this.calls.length, prompt, opts);
  }

  attributionLabel(): string {
    return `fake-${this.name}`;
  }
}

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };

const testConfig: Config = {
  version: 2,
  modes: {
    patch: { agentOrder: [CLAUDE_ENTRY] },
    plan: { agentOrder: [CLAUDE_ENTRY] },
    prompt: { agentOrder: [CLAUDE_ENTRY] },
    review: { passes: 2 },
  },
  quotaFallback: "strict",
  weakQuotaExitCodes: [],
  maxIterations: 10,
  iterationTimeoutMs: 30 * 60_000,
  git: true,
  projects: {},
};

describe("runDraftPhase (additionalReadDirs threading)", () => {
  test("AC#1: no-commit draft phase passes additionalReadDirs to agent.run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-add-dirs-"));
    const externalSpecDir = mkdtempSync(join(tmpdir(), "jarvis-plan-external-spec-"));

    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      const name = "test-spec";

      // Write intent.md to external spec dir
      mkdirSync(externalSpecDir, { recursive: true });
      writeFileSync(join(externalSpecDir, "intent.md"), "---\nname: test-spec\n---\n\n# Intent\n\ntest\n");

      const claude = new FakeAgent("claude", (_c, _p, opts) => {
        // Create spec files in the external dir
        writeFileSync(join(externalSpecDir, "index.md"), "# Draft spec\n\n- [ ] [00](./00-one.md)\n");
        writeFileSync(join(externalSpecDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const out = await runDraftPhase({
        worktreePath: dir,
        name,
        specDirPath: externalSpecDir,
        additionalReadDirs: [externalSpecDir],
        config: testConfig,
        createAgent: () => claude,
      });

      expect(out.result.kind).toBe("ok");
      expect(out.subspecCount).toBe(1);
      expect(claude.calls).toHaveLength(1);

      // Verify additionalReadDirs was passed to agent.run
      const callOpts = claude.calls[0]?.opts;
      expect(callOpts).toBeDefined();
      expect(callOpts?.additionalReadDirs).toEqual([externalSpecDir]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(externalSpecDir, { recursive: true, force: true });
    }
  });

  test("AC#2: no-commit draft phase with blocker passes additionalReadDirs to agent.run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-blocker-add-dirs-"));
    const externalSpecDir = mkdtempSync(join(tmpdir(), "jarvis-plan-external-spec-blocker-"));

    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      const name = "test-spec";
      const intentBefore = "---\nname: test-spec\n---\n\n## Prerequisites\n\nmissing-behavior\n";

      // Write intent.md to external spec dir
      mkdirSync(externalSpecDir, { recursive: true });
      writeFileSync(join(externalSpecDir, "intent.md"), intentBefore);

      const claude = new FakeAgent("claude", (_c, _p, opts) => {
        // Agent appends blocker instead of creating full spec
        const intentAfter = `${intentBefore}\n## Blocker\n\nCannot confirm missing-behavior in repo.\n`;
        writeFileSync(join(externalSpecDir, "intent.md"), intentAfter);
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const out = await runDraftPhase({
        worktreePath: dir,
        name,
        specDirPath: externalSpecDir,
        additionalReadDirs: [externalSpecDir],
        intentBefore,
        config: testConfig,
        createAgent: () => claude,
      });

      expect(out.result.kind).toBe("ok");
      expect(claude.calls).toHaveLength(1);

      // Verify additionalReadDirs was passed to agent.run
      const callOpts = claude.calls[0]?.opts;
      expect(callOpts).toBeDefined();
      expect(callOpts?.additionalReadDirs).toEqual([externalSpecDir]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(externalSpecDir, { recursive: true, force: true });
    }
  });

  test("AC#5: committed draft phase does not pass additionalReadDirs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-no-add-dirs-"));

    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      const name = "test-spec";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: test-spec\n---\n\n# Intent\n\ntest\n");

      const claude = new FakeAgent("claude", (_c, _p, opts) => {
        const d = join(opts.cwd, "spec", name);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, "index.md"), "# Draft spec\n\n- [ ] [00](./00-one.md)\n");
        writeFileSync(join(d, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      // Run without specDirPath and additionalReadDirs (committed case)
      const out = await runDraftPhase({
        worktreePath: dir,
        name,
        config: testConfig,
        createAgent: () => claude,
      });

      expect(out.result.kind).toBe("ok");
      expect(claude.calls).toHaveLength(1);

      // Verify additionalReadDirs was NOT passed
      const callOpts = claude.calls[0]?.opts;
      expect(callOpts).toBeDefined();
      expect(callOpts?.additionalReadDirs).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
