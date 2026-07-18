import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import type { Config } from "../src/config.ts";
import { runDraftPhase, validateDraftOutput } from "../src/modes/plan/draft.ts";
import { HARNESS_MODEL_CONFIG_FALLBACK } from "../src/quota-harness-messages.ts";

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
    prompt: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
    review: { passes: 2 },
  },
  quotaFallback: "strict",
  weakQuotaExitCodes: [],
  maxIterations: 10,
  iterationTimeoutMs: 30 * 60_000,
  git: true,
  projects: {},
};

function setupDraftRepo(tmpPrefix: string): { dir: string; name: string } {
  const dir = mkdtempSync(join(tmpdir(), tmpPrefix));
  execSync("git init -b main", { cwd: dir });
  execSync("git config user.email 'test@example.com'", { cwd: dir });
  execSync("git config user.name 'Test User'", { cwd: dir });
  const name = "p-draft";
  const specDir = join(dir, "spec", name);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n# Intent\n\nseed\n");
  return { dir, name };
}

function codexWritesOkDraft(name: string): FakeAgent {
  return new FakeAgent("codex", (_c, _p, opts) => {
    const d = join(opts.cwd, "spec", name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "index.md"), "# Draft spec\n\n- [ ] [00](./00-one.md)\n");
    writeFileSync(join(d, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");
    return { kind: "ok", stdout: "", stderr: "" };
  });
}

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

  test("draft prompt contains prerequisite gate instructions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-gate-text-"));
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n## Prerequisites\n\nsome-behavior-here\n");

      const claude = new FakeAgent("claude", (_c, _p, opts) => {
        const d = join(opts.cwd, "spec", name);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, "index.md"), "# Draft spec\n\n- [ ] [00](./00-one.md)\n");
        writeFileSync(join(d, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const prompts: string[] = [];
      await runDraftPhase({
        worktreePath: dir,
        name,
        config: testConfig,
        onOutboundPrompt: (prompt) => prompts.push(prompt),
        createAgent: () => claude,
      });

      const prompt = prompts[0];
      expect(prompt).toBeDefined();
      expect(prompt).toContain("## Prerequisite Gate");
      expect(prompt).toContain("Your first action is to read existing repo files");
      expect(prompt).toContain("## Prerequisites");
      expect(prompt).toContain("Judgment rubric:");
      expect(prompt).toContain("committed code, tests, or docs");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validateDraftOutput reports blocker even when no index.md exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-blocker-no-index-"));
    try {
      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });

      const intentBefore = "---\nname: p-draft\n---\n\n## Prerequisites\n\nmissing-behavior\n";
      const intentAfter = `${intentBefore}\n## Blocker\n\nCannot confirm: missing-behavior is not present in repo files.\n`;

      writeFileSync(join(specDir, "intent.md"), intentAfter);

      const result = validateDraftOutput(dir, name, intentBefore, undefined, undefined);

      expect(result.valid).toBe(true);
      expect(result.blocker).toBeDefined();
      expect(result.blocker).toContain("Cannot confirm: missing-behavior");
      expect(result.error).toBeNull();
      expect(result.warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validateDraftOutput with partial files and blocker reports blocker not index error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-partial-blocker-"));
    try {
      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });

      const intentBefore = "---\nname: p-draft\n---\n\n## Prerequisites\n\nmissing-behavior\n";
      const intentAfter = `${intentBefore}\n## Blocker\n\nCannot confirm missing-behavior.\n`;

      writeFileSync(join(specDir, "intent.md"), intentAfter);
      // Write some subspecs but not index.md (partial write before blocker)
      writeFileSync(join(specDir, "00-partial.md"), "# Partial\n\n## Acceptance criteria\n\n- [ ] x\n");

      const result = validateDraftOutput(dir, name, intentBefore, undefined, undefined);

      expect(result.valid).toBe(true);
      expect(result.blocker).toBeDefined();
      expect(result.error).toBeNull();
      expect(result.warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("satisfied prerequisites draft normally produces index and subspecs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-satisfied-prereq-"));
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, "intent.md"),
        "---\nname: p-draft\n---\n\n## Prerequisites\n\nsome-existing-behavior\n",
      );

      const claude = new FakeAgent("claude", (_c, _p, opts) => {
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
        createAgent: () => claude,
      });

      expect(out.result.kind).toBe("ok");
      expect(out.subspecCount).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty or 'none' prerequisites skip gate and draft normally", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-empty-prereq-"));
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n## Prerequisites\n\n");

      const claude = new FakeAgent("claude", (_c, _p, opts) => {
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
        createAgent: () => claude,
      });

      expect(out.result.kind).toBe("ok");
      expect(out.subspecCount).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validateDraftOutput rejects near-miss acceptance criteria heading", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-near-miss-ac-"));
    try {
      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n# Intent\n");
      writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00](./00-one.md)\n");
      writeFileSync(join(specDir, "00-one.md"), "# One\n\n### Acceptance criteria\n\n- [ ] x\n");

      const result = validateDraftOutput(dir, name, undefined, undefined, undefined);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("00-one.md");
      expect(result.error).toContain("Acceptance criteria");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validateDraftOutput rejects duplicate acceptance criteria sections", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-dup-ac-"));
    try {
      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n# Intent\n");
      writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00](./00-one.md)\n");
      writeFileSync(
        join(specDir, "00-one.md"),
        "# One\n\n## Acceptance criteria\n\n- [ ] x\n\n## Acceptance criteria\n\n- [ ] y\n",
      );

      const result = validateDraftOutput(dir, name, undefined, undefined, undefined);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("00-one.md");
      expect(result.error).toContain("Duplicate");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validateDraftOutput rejects subspec with no acceptance criteria", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-no-ac-"));
    try {
      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n# Intent\n");
      writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00](./00-one.md)\n");
      writeFileSync(join(specDir, "00-one.md"), "# One\n\nJust some body text, no acceptance criteria.\n");

      const result = validateDraftOutput(dir, name, undefined, undefined, undefined);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("00-one.md");
      expect(result.error).toContain("no acceptance criteria");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validateDraftOutput warns on structural ACs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-structural-ac-"));
    try {
      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n# Intent\n");
      writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00](./00-one.md)\n");
      writeFileSync(
        join(specDir, "00-one.md"),
        "# One\n\n## Acceptance criteria\n\n- [ ] X lives in src/core\n- [ ] Y returns invalid when Z\n",
      );

      const result = validateDraftOutput(dir, name, undefined, undefined, undefined);

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("structural AC");
      expect(result.warnings[0]).toContain("lives in src/core");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validateDraftOutput passes valid draft with behavioral ACs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-valid-"));
    try {
      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n# Intent\n");
      writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00](./00-one.md)\n");
      writeFileSync(
        join(specDir, "00-one.md"),
        "# One\n\n## Acceptance criteria\n\n- [ ] `validateDraftOutput` returns invalid when near-miss heading\n- [ ] Parser emits categorized warnings\n",
      );

      const result = validateDraftOutput(dir, name, undefined, undefined, undefined);

      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("draft phase tries the next agent after model_config", async () => {
    const { dir, name } = setupDraftRepo("jarvis-plan-draft-model-config-");
    const stderrLines: string[] = [];
    try {
      const claude = new FakeAgent("claude", () => ({
        kind: "model_config",
        stderr: "unknown model",
      }));

      const out = await runDraftPhase({
        worktreePath: dir,
        name,
        config: testConfig,
        stderr: (line) => stderrLines.push(line),
        createAgent: (agentName) => {
          if (agentName === "claude") {
            return claude;
          }
          if (agentName === "codex") {
            return codexWritesOkDraft(name);
          }
          throw new Error(`unexpected agent: ${agentName}`);
        },
      });

      expect(out.result.kind).toBe("ok");
      expect(out.subspecCount).toBe(1);
      expect(claude.calls).toHaveLength(1);
      expect(stderrLines.join("")).toContain(`plan: claude: ${HARNESS_MODEL_CONFIG_FALLBACK}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("draft phase returns model_config when every agent rejects the model", async () => {
    const { dir, name } = setupDraftRepo("jarvis-plan-draft-all-model-config-");
    const stderrLines: string[] = [];
    try {
      const claude = new FakeAgent("claude", () => ({
        kind: "model_config",
        stderr: "bad claude model",
      }));
      const codex = new FakeAgent("codex", () => ({
        kind: "model_config",
        stderr: "bad codex model",
      }));

      const out = await runDraftPhase({
        worktreePath: dir,
        name,
        config: testConfig,
        stderr: (line) => stderrLines.push(line),
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

      expect(out.result.kind).toBe("model_config");
      const err = stderrLines.join("");
      expect(err).toContain(`plan: claude: ${HARNESS_MODEL_CONFIG_FALLBACK}`);
      expect(err).toContain(`plan: codex: ${HARNESS_MODEL_CONFIG_FALLBACK}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validateDraftOutput rejects unsatisfiable AC asserting CI status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-unsatisfiable-ac-"));
    try {
      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n# Intent\n");
      writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00](./00-one.md)\n");
      writeFileSync(
        join(specDir, "00-one.md"),
        "# One\n\n## Acceptance criteria\n\n- [ ] Implementation works correctly\n- [ ] CI is green\n",
      );

      const result = validateDraftOutput(dir, name, undefined, undefined, undefined);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("00-one.md");
      expect(result.error).toContain("Unsatisfiable AC");
      expect(result.error).toContain("CI is green");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validateDraftOutput rejects unsatisfiable AC asserting PR body state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-unsatisfiable-pr-body-"));
    try {
      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n# Intent\n");
      writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00](./00-one.md)\n");
      writeFileSync(
        join(specDir, "00-one.md"),
        "# One\n\n## Acceptance criteria\n\n- [ ] PR body lists the breaking changes\n",
      );

      const result = validateDraftOutput(dir, name, undefined, undefined, undefined);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("00-one.md");
      expect(result.error).toContain("Unsatisfiable AC");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validateDraftOutput exempts human-only ACs from unsatisfiability check", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-draft-human-only-unsatisfiable-"));
    try {
      const name = "p-draft";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-draft\n---\n\n# Intent\n");
      writeFileSync(join(specDir, "index.md"), "# Index\n\n- [ ] [00](./00-one.md)\n");
      writeFileSync(
        join(specDir, "00-one.md"),
        "# One\n\n## Acceptance criteria\n\n- [ ] CI is green. (Manual)\n- [ ] Implementation works correctly\n",
      );

      const result = validateDraftOutput(dir, name, undefined, undefined, undefined);

      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
