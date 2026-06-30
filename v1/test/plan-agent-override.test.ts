import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { planCommand } from "../src/commands/plan.ts";
import { parsePlanArgs } from "../src/commands/plan-args.ts";
import type { AgentEntry, Config } from "../src/config.ts";
import { loadConfig, registerProject, writeConfig } from "../src/config.ts";
import { runDraftPhase } from "../src/modes/plan/draft.ts";
import { runPlanReviewPhase } from "../src/modes/plan/review.ts";

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };
const CODEX_ENTRY = { agent: "codex" as const, model: "gpt-5.3-codex" };

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

function isPlanReviewPanelPrompt(prompt: string): boolean {
  return prompt.includes("Plan Mode — Review:");
}

function isPlanVerdictActuatorPrompt(prompt: string): boolean {
  return prompt.includes("Plan Mode — Review Actuator");
}

function captureIo() {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s: string) => {
        out += s;
      },
      stderr: (s: string) => {
        err += s;
      },
    },
    out: () => out,
    err: () => err,
  };
}

function setupDraftRepo(tmpPrefix: string): { dir: string; name: string } {
  const dir = mkdtempSync(join(tmpdir(), tmpPrefix));
  execSync("git init -b main", { cwd: dir });
  execSync("git config user.email 'test@example.com'", { cwd: dir });
  execSync("git config user.name 'Test User'", { cwd: dir });
  const name = "p-override";
  const specDir = join(dir, "spec", name);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "intent.md"), "---\nname: p-override\n---\n\n# Intent\n\nseed\n");
  return { dir, name };
}

function withPlanOrder(cfg: Config, order: AgentEntry[]): Config {
  return {
    ...cfg,
    modes: {
      ...cfg.modes,
      plan: {
        ...cfg.modes.plan,
        agentOrder: order,
      },
    },
  };
}

describe("plan --agent override", () => {
  test("parsePlanArgs collects repeatable --agent values", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-agent-args-"));
    try {
      const intent = join(dir, "ready-intents", "feat.md");
      mkdirSync(join(dir, "ready-intents"), { recursive: true });
      writeFileSync(intent, "---\nname: feat\n---\n\n## Prerequisites\n\nnone\n");
      const res = parsePlanArgs(["--agent", "codex", "--agent", "claude:haiku", intent], dir);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.invocation.agentFlags).toEqual(["codex", "claude:haiku"]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
      const cap = captureIo();
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
      cfg.modes.plan.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY];
      writeConfig(cfg, { dir: cfgDir });
      const configBefore = readFileSync(join(cfgDir, "config.json"), "utf8");

      const { dir: repo, name } = setupDraftRepo("jarvis-plan-agent-draft-repo-");
      try {
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

  test("review panel and quota ignore override; verdict actuator uses override", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-agent-review-"));
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });
      const name = "p-review-override";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-review-override\n---\n\n# Intent\n\nseed\n");
      writeFileSync(join(specDir, "index.md"), "# Draft\n\n- [ ] [00](./00-one.md)\n");
      writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");
      execSync("git add -A", { cwd: dir });
      execSync("git commit -m seed", { cwd: dir });

      const baseCfg: Config = {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          review: { passes: 1, agentOrder: [CLAUDE_ENTRY] },
        },
        quotaFallback: "strict",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: 30 * 60_000,
        git: true,
        projects: {},
      };
      const planCfg = withPlanOrder(baseCfg, [CODEX_ENTRY]);

      let codexReviewCalls = 0;
      const codex = new FakeAgent("codex", (prompt) => {
        if (isPlanReviewPanelPrompt(prompt)) {
          codexReviewCalls += 1;
          throw new Error("review panel must not use override plan ladder");
        }
        if (isPlanVerdictActuatorPrompt(prompt)) {
          return { kind: "ok", stdout: "", stderr: "" };
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const claude = new FakeAgent("claude", (prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Plan Mode — Review: Adjudicator") ? "Apply this verdict.\n" : "",
        stderr: "",
      }));

      const reviewAgentOrder = baseCfg.modes.review.agentOrder ?? [];
      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name,
        specDirBasename: name,
        specDirPath: specDir,
        config: planCfg,
        reviewAgentOrder,
        reviewPassesOverride: 1,
        commit: false,
        gitEnabled: false,
        createAgent: (agentName) => {
          if (agentName === "claude") return claude;
          if (agentName === "codex") return codex;
          throw new Error(`unexpected agent: ${agentName}`);
        },
      });

      expect(result.exitCode).toBe(0);
      expect(codexReviewCalls).toBe(0);
      expect(claude.calls.filter((c) => isPlanReviewPanelPrompt(c.prompt))).toHaveLength(3);
      expect(codex.calls.filter((c) => isPlanVerdictActuatorPrompt(c.prompt))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resume-style review keeps panel on pre-override order with --agent override on actuator only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-agent-resume-"));
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });
      const name = "p-resume-override";
      const specDir = join(dir, "spec", name);
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "intent.md"), "---\nname: p-resume-override\n---\n\n# Intent\n\nseed\n");
      writeFileSync(join(specDir, "index.md"), "# Draft\n\n- [ ] [00](./00-one.md)\n");
      execSync("git add -A", { cwd: dir });
      execSync("git commit -m seed", { cwd: dir });

      const baseCfg: Config = {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          review: { passes: 1 },
        },
        quotaFallback: "strict",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: 30 * 60_000,
        git: true,
        projects: {},
      };
      const planCfg = withPlanOrder(baseCfg, [CODEX_ENTRY]);
      const reviewAgentOrder = [CLAUDE_ENTRY];

      const claude = new FakeAgent("claude", (prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Plan Mode — Review: Adjudicator") ? "Resume verdict.\n" : "",
        stderr: "",
      }));
      const codex = new FakeAgent("codex", (prompt) => {
        if (isPlanReviewPanelPrompt(prompt)) {
          throw new Error("resume review panel must stay on pre-override snapshot");
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name,
        specDirBasename: name,
        specDirPath: specDir,
        config: planCfg,
        reviewAgentOrder,
        startPassNumber: 2,
        subjectSuffix: "r1",
        reviewPassesOverride: 1,
        commit: false,
        gitEnabled: false,
        createAgent: (agentName) => {
          if (agentName === "claude") return claude;
          if (agentName === "codex") return codex;
          throw new Error(`unexpected agent: ${agentName}`);
        },
      });

      expect(result.exitCode).toBe(0);
      expect(claude.calls.filter((c) => isPlanReviewPanelPrompt(c.prompt))).toHaveLength(3);
      expect(codex.calls.filter((c) => isPlanVerdictActuatorPrompt(c.prompt))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
