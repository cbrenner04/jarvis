import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../../src/agents/types.ts";
import type { Config } from "../../../src/config.ts";
import { buildShrinkPrompt } from "../../../src/modes/patch/prompt.ts";
import {
  accumulateImplementationTouchedFiles,
  detectDeletedTestInScope,
  hasAcceptanceCriteriaRegression,
  revertOutOfScopeEdits,
  runPatchShrinkPhase,
  snapshotAllAcceptanceCriteria,
} from "../../../src/modes/patch/shrink.ts";
import type { AcceptanceCriterion } from "../../../src/modes/patch/subspec.ts";

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };

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

function makeShrinkConfig(): Config {
  return {
    version: 2,
    modes: {
      patch: { agentOrder: [CLAUDE_ENTRY] },
      plan: { agentOrder: [CLAUDE_ENTRY] },
      prompt: { agentOrder: [CLAUDE_ENTRY] },
      review: { passes: 0 },
    },
    quotaFallback: "strict",
    weakQuotaExitCodes: [],
    maxIterations: 10,
    iterationTimeoutMs: 30 * 60_000,
    git: true,
    projects: {},
  };
}

function setupShrinkRepo(): { dir: string; specPath: string; specDir: string; cleanup: () => void } {
  const parent = mkdtempSync(join(tmpdir(), "jarvis-patch-shrink-parent-"));
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

describe("shrink helpers", () => {
  test("accumulateImplementationTouchedFiles skips spec paths", () => {
    const { dir, specDir, cleanup } = setupShrinkRepo();
    try {
      const head = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      writeFileSync(join(dir, "impl.txt"), "changed\n");
      writeFileSync(join(specDir, "00-one.md"), "tampered\n");
      const touched = new Set<string>();
      accumulateImplementationTouchedFiles(dir, specDir, head, touched);
      expect(touched.has("impl.txt")).toBe(true);
      expect([...touched].some((p) => p.includes("spec/"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("hasAcceptanceCriteriaRegression detects unchecked regression", () => {
    const before = new Map<string, AcceptanceCriterion[]>([["subspec.md", [{ text: "done", checked: true }]]]);
    const after = new Map<string, AcceptanceCriterion[]>([["subspec.md", [{ text: "done", checked: false }]]]);
    expect(hasAcceptanceCriteriaRegression(before, after)).toBe(true);
  });

  test("revertOutOfScopeEdits restores files outside allowlist", () => {
    const { dir, specDir, cleanup } = setupShrinkRepo();
    try {
      const outOfScope = join(dir, "rogue.txt");
      writeFileSync(outOfScope, "rogue\n");
      const reverted = revertOutOfScopeEdits(dir, new Set(["impl.txt"]), specDir);
      expect(reverted).toContain("rogue.txt");
      expect(() => readFileSync(outOfScope, "utf8")).toThrow();
    } finally {
      cleanup();
    }
  });

  test("detectDeletedTestInScope catches deleted scoped test files", () => {
    const { dir, cleanup } = setupShrinkRepo();
    try {
      const testPath = join(dir, "foo.test.ts");
      writeFileSync(testPath, "test\n");
      execSync("git add foo.test.ts", { cwd: dir });
      execSync("git commit -m 'add test'", { cwd: dir });
      const head = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      execSync("git rm foo.test.ts", { cwd: dir });
      execSync("git commit -m 'remove test'", { cwd: dir });
      expect(detectDeletedTestInScope(dir, new Set(["foo.test.ts"]), head)).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("snapshotAllAcceptanceCriteria reads linked subspecs", () => {
    const { specPath, cleanup } = setupShrinkRepo();
    try {
      const snapshots = snapshotAllAcceptanceCriteria(specPath);
      expect(snapshots.size).toBe(1);
      const criteria = [...snapshots.values()][0];
      expect(criteria?.[0]?.checked).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("buildShrinkPrompt", () => {
  test("includes allowlist and omits patch rules", () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    try {
      const prompt = buildShrinkPrompt({
        specPath,
        cwd: dir,
        allowlist: ["impl.txt"],
        baseBranch: "main",
      });
      expect(prompt).toContain("impl.txt");
      expect(prompt).toContain("Simplification checklist");
      expect(prompt).toContain("read-only");
      expect(prompt).not.toContain("Follow these Jarvis rules:");
    } finally {
      cleanup();
    }
  });
});

describe("runPatchShrinkPhase", () => {
  test("skips shrink when pre-shrink gate fails", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const harness: string[] = [];
    const telemetry: unknown[] = [];
    try {
      const agent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      await runPatchShrinkPhase({
        config: makeShrinkConfig(),
        cwd: dir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        skipPreShrinkGate: false,
        runPreShrinkGate: () => {
          throw new Error("ready failed");
        },
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: (row) => {
          telemetry.push(row);
        },
        agents: { claude: agent },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      expect(agent.calls).toHaveLength(0);
      expect(harness.some((line) => line.includes("skipping shrink"))).toBe(true);
      expect(telemetry).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  test("no-op shrink leaves worktree unchanged", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const harness: string[] = [];
    try {
      const headBefore = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      const agent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "done", stderr: "" }));
      await runPatchShrinkPhase({
        config: makeShrinkConfig(),
        cwd: dir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        skipPreShrinkGate: true,
        runContractTests: () => true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { claude: agent },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      const headAfter = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      expect(headAfter).toBe(headBefore);
      expect(harness.some((line) => line.includes("no changes"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("contract miss reverts shrink edits", async () => {
    const { dir, specPath, specDir, cleanup } = setupShrinkRepo();
    const harness: string[] = [];
    try {
      const headBefore = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      const agent = new FakeAgent("claude", () => {
        writeFileSync(join(dir, "impl.txt"), "broken\n");
        writeFileSync(join(specDir, "00-one.md"), "# 00\n\n## Acceptance criteria\n\n- [ ] done\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });
      await runPatchShrinkPhase({
        config: makeShrinkConfig(),
        cwd: dir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        skipPreShrinkGate: true,
        runContractTests: () => true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { claude: agent },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      const headAfter = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      expect(headAfter).toBe(headBefore);
      expect(readFileSync(join(dir, "impl.txt"), "utf8")).toBe("seed\n");
      expect(harness.some((line) => line.includes("contract miss"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("records shrink telemetry with patch_phase shrink", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const telemetry: Array<{ patch_phase?: string }> = [];
    try {
      const agent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      await runPatchShrinkPhase({
        config: makeShrinkConfig(),
        cwd: dir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        skipPreShrinkGate: true,
        fanout: () => {},
        writeTelemetry: (row) => {
          telemetry.push(row);
        },
        agents: { claude: agent },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      expect(telemetry).toHaveLength(1);
      expect(telemetry[0]?.patch_phase).toBe("shrink");
    } finally {
      cleanup();
    }
  });

  test("successful shrink commits simplifications once", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const harness: string[] = [];
    try {
      const headBefore = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      const agent = new FakeAgent("claude", () => {
        writeFileSync(join(dir, "impl.txt"), "smaller\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });
      await runPatchShrinkPhase({
        config: makeShrinkConfig(),
        cwd: dir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        skipPreShrinkGate: true,
        runContractTests: () => true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { claude: agent },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      const headAfter = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      expect(headAfter).not.toBe(headBefore);
      const subject = execSync("git log -1 --format=%s", { cwd: dir, encoding: "utf8" }).trim();
      expect(subject).toBe("shrink: simplify implementation diff");
      const body = execSync("git log -1 --format=%B", { cwd: dir, encoding: "utf8" });
      expect(body).toContain("Jarvis-Agent:");
      expect(harness.some((line) => line.includes("committed simplifications"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("unsuccessful invocation discards without throwing", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const harness: string[] = [];
    try {
      const headBefore = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      writeFileSync(join(dir, "impl.txt"), "pre-shrink\n");
      execSync("git add impl.txt", { cwd: dir });
      execSync("git commit -m 'wip'", { cwd: dir });
      const agent = new FakeAgent("claude", () => {
        writeFileSync(join(dir, "impl.txt"), "agent-edit\n");
        return { kind: "error", exitCode: 1, stderr: "spawn failed", stdout: "" };
      });
      await runPatchShrinkPhase({
        config: makeShrinkConfig(),
        cwd: dir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        skipPreShrinkGate: true,
        runContractTests: () => true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { claude: agent },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      expect(readFileSync(join(dir, "impl.txt"), "utf8")).toBe("pre-shrink\n");
      expect(harness.some((line) => line.includes("discarded"))).toBe(true);
      const headAfter = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      expect(headAfter).not.toBe(headBefore);
    } finally {
      cleanup();
    }
  });
});
