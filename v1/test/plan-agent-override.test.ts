import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { planCommand } from "../src/commands/plan.ts";
import type { AgentEntry, Config } from "../src/config.ts";
import { loadConfig, registerProject, writeConfig } from "../src/config.ts";
import { runDraftPhase } from "../src/modes/plan/draft.ts";
import { runPlanReviewPhase } from "../src/modes/plan/review.ts";

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

const isPanel = (p: string) => p.includes("Plan Mode — Review:");
const isActuator = (p: string) => p.includes("Plan Mode — Review Actuator");

function captureStderr() {
  let err = "";
  return {
    io: { stdout: () => {}, stderr: (s: string) => { err += s; } },
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

function baseCfg(review: { passes: number; agentOrder?: AgentEntry[] }): Config {
  return {
    version: 2,
    modes: {
      patch: { agentOrder: LADDER },
      plan: { agentOrder: LADDER },
      prompt: { agentOrder: LADDER },
      review,
    },
    quotaFallback: "strict",
    weakQuotaExitCodes: [],
    maxIterations: 10,
    iterationTimeoutMs: 30 * 60_000,
    git: true,
    projects: {},
  };
}

function seedReviewRepo(name: string, withSubspec = true): { dir: string; specDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-review-"));
  initGit(dir);
  const specDir = join(dir, "spec", name);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "intent.md"), `---\nname: ${name}\n---\n\n# Intent\n\nseed\n`);
  writeFileSync(join(specDir, "index.md"), "# Draft\n\n- [ ] [00](./00-one.md)\n");
  if (withSubspec) {
    writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");
  }
  execSync("git add -A", { cwd: dir });
  execSync("git commit -m seed", { cwd: dir });
  return { dir, specDir };
}

function agentsForSplitLadder(verdict: string) {
  const claude = new FakeAgent("claude", (prompt) => ({
    kind: "ok",
    stdout: prompt.includes("Plan Mode — Review: Adjudicator") ? `${verdict}\n` : "",
    stderr: "",
  }));
  const codex = new FakeAgent("codex", (prompt) => {
    if (isPanel(prompt)) throw new Error("review panel must not use override plan ladder");
    return { kind: "ok", stdout: "", stderr: "" };
  });
  return {
    claude,
    codex,
    createAgent: (agentName: AgentName) => {
      if (agentName === "claude") return claude;
      if (agentName === "codex") return codex;
      throw new Error(`unexpected agent: ${agentName}`);
    },
  };
}

describe("plan --agent override", () => {
  test("invalid --agent exits before agent spawn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-agent-invalid-"));
    const cfgDir = join(dir, "cfg");
    const project = join(dir, "project");
    try {
      mkdirSync(project);
      registerProject("project", project, { dir: cfgDir });
      const intent = join(project, "ready-intents", "feat.md");
      mkdirSync(join(project, "ready-intents"), { recursive: true });
      writeFileSync(intent, "---\nname: feat\n---\n\n## Prerequisites\n\nnone\n");
      const cap = captureStderr();
      const code = await planCommand({
        io: cap.io,
        args: ["--agent", "bogus", intent],
        cwd: project,
        config: { dir: cfgDir },
        skipGhCheck: true,
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain('unknown agent "bogus"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("override ladder drives draft binding selection without mutating config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-agent-draft-"));
    const cfgDir = join(dir, "cfg");
    try {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.plan.agentOrder = LADDER;
      writeConfig(cfg, { dir: cfgDir });
      const configBefore = readFileSync(join(cfgDir, "config.json"), "utf8");

      const repo = mkdtempSync(join(tmpdir(), "jarvis-plan-agent-draft-repo-"));
      const name = "p-override";
      try {
        initGit(repo);
        mkdirSync(join(repo, "spec", name), { recursive: true });
        writeFileSync(join(repo, "spec", name, "intent.md"), "---\nname: p-override\n---\n\n# Intent\n\nseed\n");

        const claude = new FakeAgent("claude", () => {
          throw new Error("claude should be skipped by override");
        });
        const codex = new FakeAgent("codex", (_prompt, opts) => {
          const specDir = join(opts.cwd, "spec", name);
          mkdirSync(specDir, { recursive: true });
          writeFileSync(join(specDir, "index.md"), "# Draft\n\n- [ ] [00](./00-one.md)\n");
          writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");
          return { kind: "ok", stdout: "", stderr: "" };
        });

        const out = await runDraftPhase({
          worktreePath: repo,
          name,
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

  test.each([
    {
      label: "fresh review",
      cfg: baseCfg({ passes: 1, agentOrder: [CLAUDE_ENTRY] }),
      reviewAgentOrder: [CLAUDE_ENTRY],
      verdict: "Apply this verdict.",
    },
    {
      label: "resume review",
      cfg: baseCfg({ passes: 1 }),
      reviewAgentOrder: [CLAUDE_ENTRY],
      verdict: "Resume verdict.",
      startPassNumber: 2,
      subjectSuffix: "r1",
    },
  ])(
    "$label: panel on pre-override order, verdict actuator on override",
    async ({ label, cfg, reviewAgentOrder, verdict, startPassNumber, subjectSuffix }) => {
      const name = `p-${label.replace(/\s+/g, "-")}`;
      const { dir, specDir } = seedReviewRepo(name, label === "fresh review");
      try {
        const { claude, codex, createAgent } = agentsForSplitLadder(verdict);
        const result = await runPlanReviewPhase({
          worktreePath: dir,
          name,
          specDirBasename: name,
          specDirPath: specDir,
          config: withPlanOrder(cfg, [CODEX_ENTRY]),
          reviewAgentOrder: [...reviewAgentOrder],
          reviewPassesOverride: 1,
          ...(startPassNumber !== undefined ? { startPassNumber } : {}),
          ...(subjectSuffix !== undefined ? { subjectSuffix } : {}),
          commit: false,
          gitEnabled: false,
          createAgent,
        });

        expect(result.exitCode).toBe(0);
        expect(codex.calls.filter((c) => isPanel(c.prompt))).toHaveLength(0);
        expect(claude.calls.filter((c) => isPanel(c.prompt))).toHaveLength(3);
        expect(codex.calls.filter((c) => isActuator(c.prompt))).toHaveLength(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
