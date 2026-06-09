import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../../src/agents/types.ts";
import type { Config } from "../../../src/config.ts";
import {
  consumeReviewBlocker,
  detectSpecTreeEdits,
  REVIEW_BLOCKER_FILE,
  revertSpecTreeEdits,
  runPatchReviewPhase,
} from "../../../src/modes/patch/review.ts";

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };
const CODEX_ENTRY = { agent: "codex" as const, model: "gpt-5.3-codex" };

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

function makeReviewConfig(opts?: {
  planOrder?: Array<{ agent: AgentName; model: string }>;
  reviewOrder?: Array<{ agent: AgentName; model: string }>;
  reviewPasses?: number;
}): Config {
  const planOrder = opts?.planOrder ?? [CLAUDE_ENTRY, CODEX_ENTRY];
  return {
    version: 2,
    modes: {
      patch: { agentOrder: [CLAUDE_ENTRY] },
      plan: { agentOrder: planOrder },
      prompt: { agentOrder: planOrder },
      review: {
        passes: opts?.reviewPasses ?? 2,
        ...(opts?.reviewOrder !== undefined ? { agentOrder: opts.reviewOrder } : {}),
      },
    },
    quotaFallback: "strict",
    weakQuotaExitCodes: [],
    maxIterations: 10,
    iterationTimeoutMs: 30 * 60_000,
    git: true,
    projects: {},
  };
}

function setupPatchReviewRepo(): { dir: string; specPath: string; specDir: string; cleanup: () => void } {
  const parent = mkdtempSync(join(tmpdir(), "jarvis-patch-review-parent-"));
  const dir = join(parent, "repo");
  const origin = join(parent, "origin.git");
  mkdirSync(dir);
  execSync(`git init --bare ${origin}`);
  execSync("git init -b main", { cwd: dir });
  execSync("git config user.email 'test@example.com'", { cwd: dir });
  execSync("git config user.name 'Test User'", { cwd: dir });
  execSync(`git remote add origin ${origin}`, { cwd: dir });
  const specDir = join(dir, "spec", "feature");
  mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, "index.md");
  writeFileSync(specPath, "# Feature\n\n- [x] [00](./00-one.md)\n");
  writeFileSync(join(specDir, "00-one.md"), "# 00\n\n## Acceptance criteria\n\n- [x] done\n");
  writeFileSync(join(dir, "impl.txt"), "seed\n");
  execSync("git add -A", { cwd: dir });
  execSync("git commit -m 'seed'", { cwd: dir });
  execSync("git push -u origin main", { cwd: dir });
  return { dir, specPath, specDir, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

describe("patch review helpers", () => {
  test("detectSpecTreeEdits catches tracked and untracked spec changes", () => {
    const { dir, specDir, cleanup } = setupPatchReviewRepo();
    try {
      writeFileSync(join(specDir, "00-one.md"), "tampered\n");
      writeFileSync(join(specDir, "99-new.md"), "new\n");
      const edits = detectSpecTreeEdits(specDir, dir);
      expect(edits).toContain("spec/feature/00-one.md");
      expect(edits).toContain("spec/feature/99-new.md");
    } finally {
      cleanup();
    }
  });

  test("revertSpecTreeEdits restores tracked files and removes untracked additions", () => {
    const { dir, specDir, cleanup } = setupPatchReviewRepo();
    try {
      const tracked = join(specDir, "00-one.md");
      writeFileSync(tracked, "tampered\n");
      writeFileSync(join(specDir, "99-new.md"), "new\n");
      revertSpecTreeEdits(specDir, dir);
      expect(readFileSync(tracked, "utf8")).toContain("- [x] done");
      expect(detectSpecTreeEdits(specDir, dir)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("consumeReviewBlocker reads and deletes the sentinel", () => {
    const { dir, cleanup } = setupPatchReviewRepo();
    try {
      writeFileSync(join(dir, REVIEW_BLOCKER_FILE), "blocked\n");
      expect(consumeReviewBlocker(dir)).toBe("blocked");
      expect(consumeReviewBlocker(dir)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("runPatchReviewPhase", () => {
  test("uses modes.review.agentOrder and shared-runner quota fallback", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const harness: string[] = [];
    try {
      const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "No issues found", stderr: "" }));
      const claude = new FakeAgent("claude", () => ({ kind: "quota", stderr: "limit" }));

      const reviewOrderCode = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewOrder: [CODEX_ENTRY], planOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { codex },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      expect(reviewOrderCode).toBe(0);
      expect(codex.calls).toHaveLength(3); // 3 roles per cycle (adversary, defender, judge)
      expect(codex.calls[0]?.prompt).toContain("Review: Adversary"); // First role is adversary
      expect(codex.calls[1]?.prompt).toContain("Review: Defender"); // Second role is defender
      expect(codex.calls[2]?.prompt).toContain("Review: Judge"); // Third role is judge
      expect(claude.calls).toHaveLength(0);

      harness.length = 0;
      codex.calls.length = 0;
      const fallbackCode = await runPatchReviewPhase({
        config: makeReviewConfig({ planOrder: [CODEX_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { codex },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      expect(fallbackCode).toBe(0);
      expect(codex.calls).toHaveLength(3); // 3 roles per cycle
    } finally {
      cleanup();
    }
  });

  test("model_config exits 3 and all-agent quota exits 2", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    try {
      const claude = new FakeAgent("claude", () => ({ kind: "model_config", stderr: "bad model" }));
      const modelCode = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      expect(modelCode).toBe(3);

      const quotaCode = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude: new FakeAgent("claude", () => ({ kind: "quota", stderr: "limit" })) },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      expect(quotaCode).toBe(2);
    } finally {
      cleanup();
    }
  });

  test("blocker sentinel exits 7 and baseline gate failure skips review passes", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    let reviewCalls = 0;
    try {
      const claude = new FakeAgent("claude", (_n, _prompt, opts) => {
        reviewCalls += 1;
        writeFileSync(join(opts.cwd, REVIEW_BLOCKER_FILE), "needs human\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const blockerCode = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewPasses: 2, reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 2,
        skipGates: true,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      expect(blockerCode).toBe(7);
      expect(reviewCalls).toBe(1); // Blocker stops after first role (adversary)

      reviewCalls = 0;
      const baselineCode = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewPasses: 1, reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        runBaselineGate: () => {
          throw new Error("baseline failed");
        },
        baseBranch: "main",
      });
      expect(baselineCode).toBe(1);
      expect(reviewCalls).toBe(0);
    } finally {
      cleanup();
    }
  });

  test("final gate runs only after all passes complete", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const events: string[] = [];
    try {
      const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "No issues", stderr: "" }));
      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewPasses: 2, reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 2,
        fanout: (tag, text) => {
          if (tag === "harness") events.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        runBaselineGate: () => {
          events.push("baseline");
        },
        runFinalGate: () => {
          events.push("final");
        },
        baseBranch: "main",
      });
      expect(code).toBe(0);
      // Each pass now runs 3 roles per cycle, each showing "pass N/M" message and "completed" message
      expect(events).toContain("baseline");
      expect(events).toContain("final");
      expect(events.filter((e) => e === "review: running baseline gate")).toHaveLength(1);
      expect(events.filter((e) => e === "review: running final ready")).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test("reviewer roles run three times per pass (adversary, defender, judge)", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const roleCalls: string[] = [];
    try {
      const claude = new FakeAgent("claude", (_callCount, prompt) => {
        // Detect role from prompt content (prompts have "Review: Adversary", etc.)
        if (prompt.includes("Review: Adversary")) {
          roleCalls.push("adversary");
        } else if (prompt.includes("Review: Defender")) {
          roleCalls.push("defender");
        } else if (prompt.includes("Review: Judge")) {
          roleCalls.push("judge");
        }
        return { kind: "ok", stdout: "findings", stderr: "" };
      });

      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });

      expect(code).toBe(0);
      // All three roles should be executed
      expect(roleCalls).toContain("adversary");
      expect(roleCalls).toContain("defender");
      expect(roleCalls).toContain("judge");
    } finally {
      cleanup();
    }
  });

  test("empty verdict skips executor invocation", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const harness: string[] = [];
    try {
      // Judge returns empty verdict
      const reviewer = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "",
        stderr: "",
      }));

      const executor = new FakeAgent("claude", () => {
        throw new Error("Executor should not be called");
      });

      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { claude: reviewer },
        executorAgents: [executor],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });

      expect(code).toBe(0);
      // Empty verdict should skip executor
      expect(harness.some((e) => e.includes("executor"))).toBe(false);
    } finally {
      cleanup();
    }
  });
});
