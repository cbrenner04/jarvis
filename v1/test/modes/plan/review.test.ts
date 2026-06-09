import { describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../../src/agents/types.ts";
import type { Config } from "../../../src/config.ts";
import {
  hasWorkingTreeChanges,
  runPlanReviewPhase,
  snapshotSpecFiles,
  validateReviewOutput,
} from "../../../src/modes/plan/review.ts";
import { setupPlanRemote } from "../../helpers/plan-fixtures.ts";

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

function setupReviewRepo(name = "p-review"): { dir: string; specDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-review-"));
  execSync("git init -b main", { cwd: dir });
  execSync("git config user.email 'test@example.com'", { cwd: dir });
  execSync("git config user.name 'Test User'", { cwd: dir });
  const specDir = join(dir, "spec", name);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "intent.md"), "---\nname: p-review\n---\n\n# Intent\n\nseed\n");
  writeFileSync(join(specDir, "index.md"), "# Draft\n\n- [ ] [00](./00-one.md)\n");
  writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");
  execSync("git add -A", { cwd: dir });
  execSync("git commit -m 'seed'", { cwd: dir });
  return { dir, specDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function setupReviewWorktree(name = "p-review"): { worktreePath: string; specDir: string; cleanup: () => void } {
  const { worktreeRoot, cleanup } = setupPlanRemote();
  execSync(`git branch plan/${name}`, { cwd: worktreeRoot });
  const worktreePath = join(worktreeRoot, "worktree");
  mkdirSync(worktreePath);
  execSync(`git worktree add --no-checkout worktree plan/${name}`, { cwd: worktreeRoot });
  execSync(`git checkout plan/${name}`, { cwd: worktreePath });
  const specDir = join(worktreePath, "spec", name);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "intent.md"), "---\nname: p-review\n---\n\n# Intent\n\nseed\n");
  writeFileSync(join(specDir, "index.md"), "# Draft\n\n- [ ] [00](./00-one.md)\n");
  writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] x\n");
  execSync("git add -A", { cwd: worktreePath });
  execSync("git commit -m 'seed'", { cwd: worktreePath });
  execSync("git push -u origin HEAD", { cwd: worktreePath });
  return { worktreePath, specDir, cleanup };
}

describe("snapshotSpecFiles", () => {
  test("returns files in deterministic sorted order regardless of disk order", () => {
    // Create a temporary directory with files in reverse alphabetical order on disk
    const tmpPath = join(tmpdir(), `spec-test-${randomBytes(4).toString("hex")}`);
    const specDir = join(tmpPath, "spec", "test-spec");
    mkdirSync(specDir, { recursive: true });

    // Write files in reverse alphabetical order: z, y, x, ...
    const fileOrder = ["z-last.md", "m-middle.md", "a-first.md"];
    for (const file of fileOrder) {
      writeFileSync(join(specDir, file), `# ${file}\n`);
    }

    const snapshot = snapshotSpecFiles(tmpPath, "test-spec");

    // Extract the file order from the snapshot
    const fileMatches = snapshot.match(/<<<FILE name="([^"]+)" BEGIN>>>/g) || [];
    const extractedFiles = fileMatches.map((match) => match.match(/name="([^"]+)"/)?.[1]);

    // Files should be sorted alphabetically regardless of disk order
    expect(extractedFiles).toEqual(["a-first.md", "m-middle.md", "z-last.md"]);
  });
});

describe("hasWorkingTreeChanges", () => {
  test("returns false when worktree has no changes", () => {
    const tmpPath = join(tmpdir(), `review-test-${randomBytes(4).toString("hex")}`);
    mkdirSync(tmpPath, { recursive: true });

    // Initialize a git repo
    execFileSync("git", ["init", "-b", "main"], {
      cwd: tmpPath,
      stdio: "pipe",
    });

    // Configure git for commits
    execFileSync("git", ["config", "user.email", "test@test.com"], {
      cwd: tmpPath,
      stdio: "pipe",
    });
    execFileSync("git", ["config", "user.name", "Test"], {
      cwd: tmpPath,
      stdio: "pipe",
    });

    // Create a file and commit it
    const testFile = join(tmpPath, "test.txt");
    writeFileSync(testFile, "content", "utf8");
    execFileSync("git", ["add", "."], { cwd: tmpPath, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "Initial commit"], {
      cwd: tmpPath,
      stdio: "pipe",
    });

    // At this point, there should be no working tree changes
    expect(hasWorkingTreeChanges(tmpPath)).toBe(false);
  });

  test("returns true when worktree has uncommitted changes", () => {
    const tmpPath = join(tmpdir(), `review-test-${randomBytes(4).toString("hex")}`);
    mkdirSync(tmpPath, { recursive: true });

    // Initialize a git repo
    execFileSync("git", ["init", "-b", "main"], {
      cwd: tmpPath,
      stdio: "pipe",
    });

    // Configure git for commits
    execFileSync("git", ["config", "user.email", "test@test.com"], {
      cwd: tmpPath,
      stdio: "pipe",
    });
    execFileSync("git", ["config", "user.name", "Test"], {
      cwd: tmpPath,
      stdio: "pipe",
    });

    // Create a file and commit it
    const testFile = join(tmpPath, "test.txt");
    writeFileSync(testFile, "content", "utf8");
    execFileSync("git", ["add", "."], { cwd: tmpPath, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "Initial commit"], {
      cwd: tmpPath,
      stdio: "pipe",
    });

    // Modify the file
    writeFileSync(testFile, "modified content", "utf8");

    // Now there should be working tree changes
    expect(hasWorkingTreeChanges(tmpPath)).toBe(true);
  });
});

describe("runPlanReviewPhase", () => {
  test("uses modes.review.agentOrder when set and falls back to modes.plan.agentOrder", async () => {
    const { dir, specDir, cleanup } = setupReviewRepo();
    try {
      const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const codex = new FakeAgent("codex", (_c, _p, opts) => {
        writeFileSync(join(opts.cwd, "spec", "p-review", "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] y\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const reviewOrderResult = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ reviewOrder: [CODEX_ENTRY], planOrder: [CLAUDE_ENTRY] }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: (agentName) => {
          if (agentName === "claude") return claude;
          if (agentName === "codex") return codex;
          throw new Error(`unexpected agent: ${agentName}`);
        },
      });
      expect(reviewOrderResult.exitCode).toBe(0);
      expect(claude.calls).toHaveLength(0);
      expect(codex.calls).toHaveLength(3); // 3 roles per cycle

      const fallbackClaude = new FakeAgent("claude", (_c, _p, opts) => {
        writeFileSync(join(opts.cwd, "spec", "p-review", "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] z\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const fallbackCodex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));

      const fallbackResult = await runPlanReviewPhase({
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ planOrder: [CLAUDE_ENTRY] }),
        reviewPassesOverride: 1,
        commit: false,
        specDirPath: specDir,
        createAgent: (agentName) => {
          if (agentName === "claude") return fallbackClaude;
          if (agentName === "codex") return fallbackCodex;
          throw new Error(`unexpected agent: ${agentName}`);
        },
      });
      expect(fallbackResult.exitCode).toBe(0);
      expect(fallbackClaude.calls).toHaveLength(3); // 3 roles per cycle
      expect(fallbackCodex.calls).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  test("honors --review-passes override, modes.review.passes, and default 2", async () => {
    const { dir, specDir, cleanup } = setupReviewRepo();
    try {
      const passStarts: number[] = [];
      const noop = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const base = {
        worktreePath: dir,
        name: "p-review",
        specDirBasename: "p-review",
        commit: false,
        specDirPath: specDir,
        createAgent: () => noop,
        onPassStart: (pass: number) => {
          passStarts.push(pass);
        },
      };

      await runPlanReviewPhase({
        ...base,
        config: makeReviewConfig({ reviewPasses: 7 }),
        reviewPassesOverride: 3,
      });
      expect(passStarts).toEqual([1, 2, 3]);

      passStarts.length = 0;
      await runPlanReviewPhase({
        ...base,
        config: makeReviewConfig({ reviewPasses: 4 }),
      });
      expect(passStarts).toEqual([1, 2, 3, 4]);

      passStarts.length = 0;
      await runPlanReviewPhase({
        ...base,
        config: makeReviewConfig({ reviewPasses: 2 }),
      });
      expect(passStarts).toEqual([1, 2]);
    } finally {
      cleanup();
    }
  });

  test("skips commit on no-change passes and appends blockers", async () => {
    const { worktreePath, cleanup } = setupReviewWorktree();
    try {
      let err = "";
      const noop = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const noChange = await runPlanReviewPhase({
        worktreePath,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ reviewPasses: 1 }),
        commit: true,
        logNoChangeSkip: true,
        stderr: (s) => {
          err += s;
        },
        createAgent: () => noop,
      });
      expect(noChange.exitCode).toBe(0);
      expect(err).toContain("made no changes; skipping commit");
      expect(execSync("git log --oneline", { cwd: worktreePath, encoding: "utf8" })).not.toContain("plan: review");

      const blockerAgent = new FakeAgent("claude", (_c, _p, opts) => {
        const intentPath = join(opts.cwd, "spec", "p-review", "intent.md");
        const intent = readFileSync(intentPath, "utf8");
        writeFileSync(intentPath, `${intent}\n\n## Blocker\n\nNeed input.\n`);
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const blocked = await runPlanReviewPhase({
        worktreePath,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ reviewPasses: 1 }),
        commit: true,
        createAgent: () => blockerAgent,
      });
      expect(blocked.exitCode).toBe(1);
      expect(blocked.blocker).toContain("Need input.");
      const log = execSync("git log -1 --format=%s", { cwd: worktreePath, encoding: "utf8" }).trim();
      expect(log).toBe("plan: blocker");
    } finally {
      cleanup();
    }
  });

  test("uses resume pass numbering, rK suffix, and refreshes PR body on commit", async () => {
    const { worktreePath, cleanup } = setupReviewWorktree();
    try {
      const agent = new FakeAgent("claude", (_c, _p, opts) => {
        writeFileSync(
          join(opts.cwd, "spec", "p-review", "00-one.md"),
          "# One\n\n## Acceptance criteria\n\n- [ ] resume\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });
      let prRefreshCount = 0;
      const result = await runPlanReviewPhase({
        worktreePath,
        name: "p-review",
        specDirBasename: "p-review",
        config: makeReviewConfig({ reviewPasses: 1 }),
        reviewPassesOverride: 1,
        startPassNumber: 3,
        subjectSuffix: "r2",
        commit: true,
        createAgent: () => agent,
        updatePrBody: async () => {
          prRefreshCount += 1;
        },
      });
      expect(result.exitCode).toBe(0);
      expect(prRefreshCount).toBe(1);
      const subject = execSync("git log -1 --format=%s", { cwd: worktreePath, encoding: "utf8" }).trim();
      expect(subject).toBe("plan: review 3 r2");
    } finally {
      cleanup();
    }
  });
});

describe("validateReviewOutput", () => {
  test("rejects frontmatter edits even when blocker is appended", () => {
    const tmpPath = join(tmpdir(), `review-frontmatter-${randomBytes(4).toString("hex")}`);
    const specDir = join(tmpPath, "spec", "test-spec");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# Index\n", "utf8");

    const intentBefore = "---\nname: alpha\n---\n\n# Intent\nbody\n";
    const intentAfter = "---\nname: beta\n---\n\n# Intent\nbody\n\n## Blocker\n\nNeed input.\n";
    writeFileSync(join(specDir, "intent.md"), intentAfter, "utf8");

    const result = validateReviewOutput(tmpPath, "test-spec", intentBefore);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("frontmatter is immutable");
  });
});
