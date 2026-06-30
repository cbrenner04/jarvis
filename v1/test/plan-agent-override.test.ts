import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { planCommand } from "../src/commands/plan.ts";
import type { AgentEntry, Config } from "../src/config.ts";
import { loadConfig, registerProject, resolveReviewAgentOrder, writeConfig } from "../src/config.ts";
import { runDraftPhase } from "../src/modes/plan/draft.ts";
import { generatePrDescription } from "../src/modes/plan/pr.ts";
import { runPlanReviewPhase } from "../src/modes/plan/review.ts";
import { HARNESS_MODEL_CONFIG_FALLBACK, HARNESS_QUOTA_FALLBACK_STRICT } from "../src/quota-harness-messages.ts";

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

function productionReviewWiring(rawCfg: Config, overrideOrder: AgentEntry[]) {
  return {
    config: withPlanOrder(rawCfg, overrideOrder),
    reviewAgentOrder: resolveReviewAgentOrder(rawCfg),
  };
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
      expect(cap.err()).toContain("plan:");
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
    {
      label: "default review resolution",
      cfg: baseCfg({ passes: 1 }),
      useProductionWiring: true,
      verdict: "Default wiring verdict.",
    },
  ])("$label: panel on pre-override order, verdict actuator on override", async ({
    label,
    cfg,
    reviewAgentOrder,
    verdict,
    startPassNumber,
    subjectSuffix,
    useProductionWiring,
  }) => {
    const name = `p-${label.replace(/\s+/g, "-")}`;
    const { dir, specDir } = seedReviewRepo(name, label === "fresh review");
    try {
      const { claude, codex, createAgent } = agentsForSplitLadder(verdict);
      const wiring = useProductionWiring === true ? productionReviewWiring(cfg, [CODEX_ENTRY]) : undefined;
      const resolvedReviewAgentOrder = wiring?.reviewAgentOrder ?? reviewAgentOrder;
      if (!resolvedReviewAgentOrder) {
        throw new Error("reviewAgentOrder required");
      }
      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name,
        specDirBasename: name,
        specDirPath: specDir,
        config: wiring?.config ?? withPlanOrder(cfg, [CODEX_ENTRY]),
        reviewAgentOrder: [...resolvedReviewAgentOrder],
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
  });

  test("panel quota rotation uses pre-override plan order under override", async () => {
    const rawCfg = baseCfg({ passes: 1 });
    const { config, reviewAgentOrder } = productionReviewWiring(rawCfg, [CODEX_ENTRY]);
    const name = "p-panel-quota-default";
    const { dir, specDir } = seedReviewRepo(name);
    const stderrLines: string[] = [];
    try {
      const claude = new FakeAgent("claude", (prompt) => {
        if (isPanel(prompt) && prompt.includes("Plan Mode — Review: Adversary")) {
          return { kind: "quota", stderr: "limit" };
        }
        if (isPanel(prompt)) {
          return {
            kind: "ok",
            stdout: prompt.includes("Plan Mode — Review: Adjudicator") ? "Verdict.\n" : "",
            stderr: "",
          };
        }
        throw new Error("claude must not run actuator under override");
      });
      const codex = new FakeAgent("codex", (prompt) => {
        if (isPanel(prompt)) {
          return {
            kind: "ok",
            stdout: prompt.includes("Plan Mode — Review: Adjudicator") ? "Verdict.\n" : "",
            stderr: "",
          };
        }
        if (isActuator(prompt)) {
          return { kind: "ok", stdout: "", stderr: "" };
        }
        throw new Error("unexpected codex prompt");
      });
      const result = await runPlanReviewPhase({
        worktreePath: dir,
        name,
        specDirBasename: name,
        specDirPath: specDir,
        config,
        reviewAgentOrder,
        reviewPassesOverride: 1,
        commit: false,
        gitEnabled: false,
        stderr: (line) => stderrLines.push(line),
        createAgent: (agentName) => {
          if (agentName === "claude") return claude;
          if (agentName === "codex") return codex;
          throw new Error(`unexpected agent: ${agentName}`);
        },
      });

      expect(result.exitCode).toBe(0);
      expect(stderrLines.join("")).toContain(`plan: claude: ${HARNESS_QUOTA_FALLBACK_STRICT}`);
      expect(claude.calls.filter((c) => isPanel(c.prompt))).toHaveLength(3);
      expect(codex.calls.filter((c) => isPanel(c.prompt))).toHaveLength(1);
      expect(codex.calls.filter((c) => isActuator(c.prompt))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("draft model_config cascade advances through the overridden ladder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-agent-draft-cascade-"));
    const cfgDir = join(dir, "cfg");
    try {
      const rawCfg = loadConfig({ dir: cfgDir });
      rawCfg.modes.plan.agentOrder = LADDER;
      writeConfig(rawCfg, { dir: cfgDir });
      const repo = mkdtempSync(join(tmpdir(), "jarvis-plan-agent-draft-cascade-repo-"));
      const name = "p-draft-cascade";
      const stderrLines: string[] = [];
      try {
        initGit(repo);
        mkdirSync(join(repo, "spec", name), { recursive: true });
        writeFileSync(join(repo, "spec", name, "intent.md"), "---\nname: p-draft-cascade\n---\n\n# Intent\n\nseed\n");

        const claude = new FakeAgent("claude", () => ({
          kind: "model_config",
          stderr: "unknown model",
        }));
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
        expect(stderrLines.join("")).toContain(`plan: claude: ${HARNESS_MODEL_CONFIG_FALLBACK}`);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("PR narrative agent follows the overridden plan ladder head", async () => {
    const rawCfg = baseCfg({ passes: 1 });
    const planCfg = withPlanOrder(rawCfg, [CODEX_ENTRY]);
    expect(planCfg.modes.plan.agentOrder[0]).toEqual(CODEX_ENTRY);

    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-pr-override-"));
    const specDir = join(dir, "spec", "feat");
    mkdirSync(specDir, { recursive: true });
    const indexPath = join(specDir, "index.md");
    writeFileSync(indexPath, "# Feature\n\n- [ ] [00](./00-one.md)\n");
    writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");

    const claude = new FakeAgent("claude", () => {
      throw new Error("claude must not author PR narrative under override");
    });
    const codex = new FakeAgent("codex", () => ({
      kind: "ok",
      stdout: "<<<PR_DESCRIPTION_BEGIN>>>\nOverride narrative.\n\nDecisions:\n- one\n<<<PR_DESCRIPTION_END>>>",
      stderr: "",
    }));

    const narrative = await generatePrDescription({
      indexPath,
      intent: "intent body",
      agent: codex,
      cwd: dir,
    });

    expect(narrative).toContain("Override narrative.");
    expect(claude.calls).toHaveLength(0);
    expect(codex.calls).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
