// This test requires real git history rewriting / branch movement semantics.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  ShrinkTerminalError,
  snapshotAllAcceptanceCriteria,
} from "../../../src/modes/patch/shrink.ts";
import type { AcceptanceCriterion } from "../../../src/modes/patch/subspec.ts";
import {
  HARNESS_IDLE_TIMEOUT_FALLBACK,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessAuthRotateLine,
} from "../../../src/quota-harness-messages.ts";
import {
  beginHangFixtureTracking,
  IDLE_HANG_BODY,
  reapActiveHangFixtures,
  trackHangFixtureScript,
  writeIdleHangScript,
} from "../../idle-hang-fixtures.ts";
import { IdleHangAgent, stripDelimitedBlocks } from "./review.sandbox-unrunnable.test.ts";

const HANG_FIXTURE_TRACKING_ID = import.meta.path;

beforeEach(() => {
  beginHangFixtureTracking(HANG_FIXTURE_TRACKING_ID);
});

afterEach(() => {
  reapActiveHangFixtures(HANG_FIXTURE_TRACKING_ID);
});

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };
const CODEX_ENTRY = { agent: "codex" as const, model: "gpt-5.4" };

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

function makeShrinkConfig(shrink: "off" | "agent" = "agent"): Config {
  return {
    version: 2,
    modes: {
      patch: { agentOrder: [CLAUDE_ENTRY], shrink },
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

function makeShrinkConfigWithReviewActuator(order: Array<{ agent: AgentName; model: string }>): Config {
  const cfg = makeShrinkConfig();
  cfg.modes.patch.subRoleAgentOrder = { reviewActuator: order };
  return cfg;
}

function idleShrinkFixture() {
  const { dir, specPath, cleanup } = setupShrinkRepo();
  const tmpDir = join(dir, "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const idleScript = writeIdleHangScript(join(tmpDir, "idle-hang.sh"));
  const harness: string[] = [];
  const telemetry: Array<{ exitReason?: string; kind?: string; agent?: string }> = [];
  return {
    dir,
    specPath,
    cleanup,
    idleScript,
    harness,
    telemetry,
    fanout: (tag: string, text: string) => {
      if (tag === "harness") harness.push(text.trim());
    },
  };
}

async function runIdleShrink(
  fx: ReturnType<typeof idleShrinkFixture>,
  opts: {
    shrinkAgents: Agent[];
    idleOutputTimeoutMs: number;
    iterationTimeoutMs?: number;
    reviewActuatorOrder?: Array<{ agent: AgentName; model: string }>;
  },
): Promise<void> {
  await runPatchShrinkPhase({
    config: makeShrinkConfigWithReviewActuator(opts.reviewActuatorOrder ?? [CLAUDE_ENTRY, CODEX_ENTRY]),
    cwd: fx.dir,
    specPath: fx.specPath,
    allowlist: new Set(["impl.txt"]),
    skipPreShrinkGate: true,
    fanout: fx.fanout,
    writeTelemetry: (row) => {
      fx.telemetry.push(row);
    },
    shrinkAgents: opts.shrinkAgents,
    iterationTimeoutMs: opts.iterationTimeoutMs ?? 30_000,
    baseBranch: "main",
    patchWorktreeDir: fx.dir,
    idleOutputTimeoutMs: opts.idleOutputTimeoutMs,
    __testKillGraceMs: 200,
  });
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

/** Writes a `git` shim that hangs only when invoked with `stallArgs`, forwarding everything else to the real git. */
function writeSelectiveGitStallScript(path: string, realGitPath: string, stallArgs: string[]): void {
  const matchExpr = stallArgs.map((arg, i) => `"$${i + 1}" = "${arg}"`).join(" -a ");
  const script = `#!/usr/bin/env bash
set -euo pipefail
if [ $# -ge ${stallArgs.length} ] && [ ${matchExpr} ]; then
${IDLE_HANG_BODY}
fi
exec "${realGitPath}" "$@"
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  trackHangFixtureScript(path);
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
    const before = new Map<string, AcceptanceCriterion[]>([
      ["subspec.md", [{ text: "done", checked: true, humanOnly: false }]],
    ]);
    const after = new Map<string, AcceptanceCriterion[]>([
      ["subspec.md", [{ text: "done", checked: false, humanOnly: false }]],
    ]);
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

  test("includes branch summary and allowlisted unified diff only inside run-scoped block", () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    try {
      writeFileSync(join(dir, "impl.txt"), "changed\n");
      writeFileSync(join(dir, "other.txt"), "extra\n");
      execSync("git checkout -b feature", { cwd: dir });
      execSync("git add impl.txt other.txt", { cwd: dir });
      execSync("git commit -m 'branch changes'", { cwd: dir });

      const prompt = buildShrinkPrompt({
        specPath,
        cwd: dir,
        allowlist: ["impl.txt"],
        baseBranch: "main",
      });

      expect(prompt).toContain("Changed paths:");
      expect(prompt).toContain("other.txt");

      const outsideRunScoped = stripDelimitedBlocks(
        stripDelimitedBlocks(prompt, "<<<SPEC_BEGIN>>>", "<<<SPEC_END>>>"),
        "<<<BRANCH_SUMMARY_BEGIN>>>",
        "<<<BRANCH_SUMMARY_END>>>",
      );
      const outsideAllowedDiff = stripDelimitedBlocks(outsideRunScoped, "<<<DIFF_BEGIN>>>", "<<<DIFF_END>>>");
      expect(outsideAllowedDiff).not.toMatch(/^diff --git/m);
      expect(outsideAllowedDiff).not.toMatch(/^@@/m);
      expect(outsideAllowedDiff).not.toContain("other.txt");

      const runScopedMatch = prompt.match(/<<<DIFF_BEGIN>>>\n([\s\S]*?)\n<<<DIFF_END>>>/);
      expect(runScopedMatch?.[1]).toMatch(/^diff --git/m);
      expect(runScopedMatch?.[1]).toContain("impl.txt");
      expect(runScopedMatch?.[1]).not.toContain("other.txt");
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

  test("no-op shrink leaves worktree unchanged without contract tests", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const harness: string[] = [];
    let contractTestsRan = false;
    try {
      const headBefore = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      const agent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "done", stderr: "" }));
      await runPatchShrinkPhase({
        config: makeShrinkConfig(),
        cwd: dir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        skipPreShrinkGate: true,
        runContractTests: () => {
          contractTestsRan = true;
          return true;
        },
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
      expect(contractTestsRan).toBe(false);
      expect(harness.some((line) => line.includes("no changes"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("spec-only shrink edits collapse to no-op without contract tests", async () => {
    const { dir, specPath, specDir, cleanup } = setupShrinkRepo();
    let contractTestsRan = false;
    try {
      const headBefore = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      const agent = new FakeAgent("claude", () => {
        writeFileSync(join(specDir, "00-one.md"), "# 00\n\n## Acceptance criteria\n\n- [ ] done\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });
      await runPatchShrinkPhase({
        config: makeShrinkConfig(),
        cwd: dir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        skipPreShrinkGate: true,
        runContractTests: () => {
          contractTestsRan = true;
          return true;
        },
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude: agent },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      const headAfter = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      expect(headAfter).toBe(headBefore);
      expect(contractTestsRan).toBe(false);
      expect(readFileSync(join(specDir, "00-one.md"), "utf8")).toContain("- [x] done");
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
      expect(body).toContain("Jarvis-Agent: fake-claude");
      expect(harness.some((line) => line.includes("committed simplifications"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("uses full reviewActuator order for shrink quota fallback", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const harness: string[] = [];
    try {
      const codex = new FakeAgent("codex", () => ({ kind: "quota", stderr: "limit" }));
      const cursor = new FakeAgent("cursor", () => ({ kind: "ok", stdout: "", stderr: "" }));

      await runPatchShrinkPhase({
        config: makeShrinkConfigWithReviewActuator([
          { agent: "codex", model: "gpt-5.4" },
          { agent: "cursor", model: "Composer 2.5" },
        ]),
        cwd: dir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        skipPreShrinkGate: true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { codex, cursor },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });

      expect(codex.calls).toHaveLength(1);
      expect(cursor.calls).toHaveLength(1);
      expect(harness.join("\n")).toContain(HARNESS_QUOTA_FALLBACK_STRICT);
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

  test("shrink off emits no telemetry on shrink-eligible completion", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const telemetry: Array<{ patch_phase?: string }> = [];
    try {
      const agent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      await runPatchShrinkPhase({
        config: makeShrinkConfig("off"),
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
      expect(telemetry).toHaveLength(0);
      expect(agent.calls).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  test("idle watchdog timeout fires in shrink phase", async () => {
    const shrinkIdleTimeoutMs = 1000;
    const { dir, specPath, cleanup } = setupShrinkRepo();
    try {
      const tmpDir = join(dir, "tmp");
      mkdirSync(tmpDir, { recursive: true });

      const idleScript = writeIdleHangScript(join(tmpDir, "idle-hang.sh"));

      const cap = { out: "", err: "" };
      const fanout = (_tag: string, text: string) => {
        cap.err += text;
      };
      const telemetry: Record<string, unknown>[] = [];
      const startTime = Date.now();
      await expect(
        runPatchShrinkPhase({
          config: makeShrinkConfig(),
          cwd: dir,
          specPath,
          allowlist: new Set(["impl.txt"]),
          fanout,
          writeTelemetry: (record) => {
            telemetry.push(record);
          },
          agents: { claude: new IdleHangAgent(idleScript) },
          iterationTimeoutMs: 30_000,
          skipPreShrinkGate: true,
          baseBranch: "main",
          patchWorktreeDir: dir,
          idleOutputTimeoutMs: shrinkIdleTimeoutMs,
          __testKillGraceMs: 200,
        }),
      ).rejects.toBeInstanceOf(ShrinkTerminalError);
      const elapsedMs = Date.now() - startTime;

      expect(elapsedMs).toBeLessThan(5000);
      const idleTimeoutRecord = telemetry.find((r) => r.exitReason === "watchdog-idle-timeout");
      expect(idleTimeoutRecord, `Telemetry: ${JSON.stringify(telemetry)}`).toBeDefined();
      expect(idleTimeoutRecord?.kind).toBe("error");
      expect(telemetry.some((r) => r.exitReason === "watchdog-idle-timeout-fallback")).toBe(false);
      expect(cap.err).not.toContain(HARNESS_IDLE_TIMEOUT_FALLBACK);
    } finally {
      cleanup();
    }
  });

  test("stalled real git subprocess on shrink path fails within 30s with fixture reaped", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const binDir = mkdtempSync(join(tmpdir(), "jarvis-shrink-git-stall-bin-"));
    const originalPath = process.env.PATH;
    try {
      writeIdleHangScript(join(binDir, "git"));
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      const agent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const startTime = Date.now();
      await expect(
        runPatchShrinkPhase({
          config: makeShrinkConfig(),
          cwd: dir,
          specPath,
          allowlist: new Set(["impl.txt"]),
          skipPreShrinkGate: true,
          fanout: () => {},
          writeTelemetry: () => {},
          agents: { claude: agent },
          iterationTimeoutMs: 30_000,
          baseBranch: "main",
        }),
      ).rejects.toThrow();
      expect(Date.now() - startTime).toBeLessThan(25_000);
      expect(agent.calls).toHaveLength(0);
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
      cleanup();
    }
  });

  test("stalled getCurrentBranch git subprocess fails within 25s", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const binDir = mkdtempSync(join(tmpdir(), "jarvis-shrink-branch-stall-bin-"));
    const originalPath = process.env.PATH;
    try {
      const realGitPath = execSync("command -v git", { encoding: "utf8" }).trim();
      writeSelectiveGitStallScript(join(binDir, "git"), realGitPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      const agent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const startTime = Date.now();
      await expect(
        runPatchShrinkPhase({
          config: makeShrinkConfig(),
          cwd: dir,
          specPath,
          allowlist: new Set(["impl.txt"]),
          skipPreShrinkGate: true,
          fanout: () => {},
          writeTelemetry: () => {},
          agents: { claude: agent },
          iterationTimeoutMs: 30_000,
          baseBranch: "main",
        }),
      ).rejects.toThrow();
      expect(Date.now() - startTime).toBeLessThan(25_000);
      expect(agent.calls).toHaveLength(0);
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
      cleanup();
    }
  });

  test("stalled git push in commitShrinkPass fails within 25s and reverts", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const binDir = mkdtempSync(join(tmpdir(), "jarvis-shrink-push-stall-bin-"));
    const originalPath = process.env.PATH;
    const harness: string[] = [];
    try {
      const headBefore = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      const realGitPath = execSync("command -v git", { encoding: "utf8" }).trim();
      writeSelectiveGitStallScript(join(binDir, "git"), realGitPath, ["push"]);
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      const agent = new FakeAgent("claude", () => {
        writeFileSync(join(dir, "impl.txt"), "smaller\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const startTime = Date.now();
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
      expect(Date.now() - startTime).toBeLessThan(25_000);
      expect(harness.some((line) => line.includes("commit failed"))).toBe(true);
      const headAfter = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      expect(headAfter).toBe(headBefore);
    } finally {
      process.env.PATH = originalPath;
      rmSync(binDir, { recursive: true, force: true });
      cleanup();
    }
  });

  test("invokes fixCommand at pre-shrink gate site", async () => {
    const { dir: repoDir, specPath, cleanup } = setupShrinkRepo();
    const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-shrink-fix-cmd-"));
    const sentinel = join(sentinelDir, "fix-invoked");
    const script = join(sentinelDir, "fix.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);
    const harness: string[] = [];
    try {
      const agent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      await runPatchShrinkPhase({
        config: makeShrinkConfig(),
        cwd: repoDir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        fixCommand: script,
        runReady: () => {},
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { claude: agent },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(sentinelDir, { recursive: true, force: true });
      cleanup();
    }
  });

  test("invokes readyCommand at pre-shrink gate site", async () => {
    const { dir: repoDir, specPath, cleanup } = setupShrinkRepo();
    const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-shrink-ready-cmd-"));
    const sentinel = join(sentinelDir, "ready-invoked");
    const script = join(sentinelDir, "ready.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);
    const harness: string[] = [];
    try {
      const agent = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
      await runPatchShrinkPhase({
        config: makeShrinkConfig(),
        cwd: repoDir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        readyCommand: script,
        runFix: () => {},
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { claude: agent },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(sentinelDir, { recursive: true, force: true });
      cleanup();
    }
  });

  test("emits auth note on auth failure in shrink quota rotation", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const harness: string[] = [];
    try {
      const agent = new FakeAgent("claude", () => ({
        kind: "quota",
        stderr: "refresh token revoked",
        authFailure: true,
      }));
      await runPatchShrinkPhase({
        config: makeShrinkConfig(),
        cwd: dir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        skipPreShrinkGate: true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { claude: agent },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      const emitted = harness.join("\n");
      expect(emitted).toContain(`claude: ${harnessAuthRotateLine("claude")}`);
      expect(emitted).not.toContain(HARNESS_QUOTA_FALLBACK_STRICT);
    } finally {
      cleanup();
    }
  });

  test("emits quota line (not auth note) on plain quota in shrink rotation", async () => {
    const { dir, specPath, cleanup } = setupShrinkRepo();
    const harness: string[] = [];
    try {
      const agent = new FakeAgent("claude", () => ({
        kind: "quota",
        stderr: "limit exceeded",
      }));
      await runPatchShrinkPhase({
        config: makeShrinkConfig(),
        cwd: dir,
        specPath,
        allowlist: new Set(["impl.txt"]),
        skipPreShrinkGate: true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { claude: agent },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
      });
      const emitted = harness.join("\n");
      expect(emitted).toContain(`claude: ${HARNESS_QUOTA_FALLBACK_STRICT}`);
      expect(emitted).not.toContain("auth failed");
    } finally {
      cleanup();
    }
  });

  test("idle watchdog escalates through reviewActuator when fallback rung remains", async () => {
    const fx = idleShrinkFixture();
    const codexAgent = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
    try {
      await runIdleShrink(fx, {
        shrinkAgents: [new IdleHangAgent(fx.idleScript), codexAgent],
        idleOutputTimeoutMs: 1000,
      });

      expect(codexAgent.calls).toHaveLength(1);
      expect(fx.harness.join("\n")).toContain(`shrink: claude: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
      const fallbackRow = fx.telemetry.find((r) => r.exitReason === "watchdog-idle-timeout-fallback");
      expect(fallbackRow).toBeDefined();
      expect(fallbackRow?.kind).toBe("timeout");
      expect(fallbackRow?.agent).toBe("claude");
      expect(fx.telemetry.some((r) => r.exitReason === "watchdog-idle-timeout")).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("non-final idle escalation retains partial shrink edits for next rung", async () => {
    const fx = idleShrinkFixture();
    const partialEdit = "partial-from-stalled-rung\n";
    const claudeStalled = new FakeAgent("claude", (_callCount, prompt, opts) => {
      writeFileSync(join(opts.cwd, "impl.txt"), partialEdit);
      return new IdleHangAgent(fx.idleScript).run(prompt, opts);
    });
    let implAtCodexStart = "";
    const codexAgent = new FakeAgent("codex", (_callCount, _prompt, opts) => {
      implAtCodexStart = readFileSync(join(opts.cwd, "impl.txt"), "utf8");
      writeFileSync(join(opts.cwd, "impl.txt"), "final\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });
    try {
      await runIdleShrink(fx, {
        shrinkAgents: [claudeStalled, codexAgent],
        idleOutputTimeoutMs: 1000,
      });

      expect(codexAgent.calls).toHaveLength(1);
      expect(implAtCodexStart).toBe(partialEdit);
    } finally {
      fx.cleanup();
    }
  });

  test("terminal idle reverts shrink edits to preShrinkHead", async () => {
    const fx = idleShrinkFixture();
    const headBefore = execSync("git rev-parse HEAD", { cwd: fx.dir, encoding: "utf8" }).trim();
    const claudeStalled = new FakeAgent("claude", (_callCount, prompt, opts) => {
      writeFileSync(join(opts.cwd, "impl.txt"), "partial-from-stalled-rung\n");
      return new IdleHangAgent(fx.idleScript).run(prompt, opts);
    });
    try {
      await expect(
        runIdleShrink(fx, {
          shrinkAgents: [claudeStalled, new IdleHangAgent(fx.idleScript, "codex")],
          idleOutputTimeoutMs: 1000,
        }),
      ).rejects.toMatchObject({ exitCode: 8 });

      const headAfter = execSync("git rev-parse HEAD", { cwd: fx.dir, encoding: "utf8" }).trim();
      expect(headAfter).toBe(headBefore);
      expect(readFileSync(join(fx.dir, "impl.txt"), "utf8")).toBe("seed\n");
    } finally {
      fx.cleanup();
    }
  });

  test("shrink does not idle-escalate on idle-timeout stderr without error kind", async () => {
    const fx = idleShrinkFixture();
    const codexAgent = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
    try {
      await runIdleShrink(fx, {
        shrinkAgents: [
          new FakeAgent("claude", () => ({
            kind: "ok",
            stdout: "",
            stderr: "aborted: idle-timeout",
          })),
          codexAgent,
        ],
        idleOutputTimeoutMs: 1000,
      });

      expect(codexAgent.calls).toHaveLength(0);
      expect(fx.harness.join("\n")).not.toContain(HARNESS_IDLE_TIMEOUT_FALLBACK);
      expect(fx.telemetry.some((r) => r.exitReason === "watchdog-idle-timeout-fallback")).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("idle watchdog on final reviewActuator rung exits 8 with terminal watchdog-idle-timeout", async () => {
    const fx = idleShrinkFixture();
    try {
      await expect(
        runIdleShrink(fx, {
          shrinkAgents: [new IdleHangAgent(fx.idleScript, "claude"), new IdleHangAgent(fx.idleScript, "codex")],
          idleOutputTimeoutMs: 1000,
        }),
      ).rejects.toMatchObject({ exitCode: 8 });

      expect(fx.harness.join("\n")).toContain(`shrink: claude: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
      const fallbackRow = fx.telemetry.find((r) => r.exitReason === "watchdog-idle-timeout-fallback");
      const terminalRow = fx.telemetry.find((r) => r.exitReason === "watchdog-idle-timeout");
      expect(fallbackRow).toBeDefined();
      expect(terminalRow).toBeDefined();
      expect(terminalRow?.kind).toBe("error");
      expect(terminalRow?.agent).toBe("codex");
      expect(fx.telemetry.filter((r) => r.exitReason === "watchdog-idle-timeout")).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });

  test("shrink with idleOutputTimeoutMs 0 does not idle-escalate", async () => {
    const fx = idleShrinkFixture();
    const codexAgent = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const iterationTimeoutMs = 800;
    const startTime = Date.now();
    try {
      await runIdleShrink(fx, {
        shrinkAgents: [new IdleHangAgent(fx.idleScript), codexAgent],
        idleOutputTimeoutMs: 0,
        iterationTimeoutMs,
      });

      expect(Date.now() - startTime).toBeGreaterThanOrEqual(iterationTimeoutMs - 200);
      expect(fx.harness.join("\n")).not.toContain(HARNESS_IDLE_TIMEOUT_FALLBACK);
      expect(codexAgent.calls).toHaveLength(0);
      expect(fx.telemetry.some((r) => r.exitReason === "watchdog-idle-timeout-fallback")).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("shrink iteration wall abort is terminal with no ladder advance", async () => {
    const fx = idleShrinkFixture();
    const codexAgent = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const iterationTimeoutMs = 800;
    const idleOutputTimeoutMs = 5000;
    const startTime = Date.now();
    try {
      await runIdleShrink(fx, {
        shrinkAgents: [new IdleHangAgent(fx.idleScript), codexAgent],
        idleOutputTimeoutMs,
        iterationTimeoutMs,
      });

      expect(Date.now() - startTime).toBeLessThan(idleOutputTimeoutMs);
      expect(fx.harness.join("\n")).not.toContain(HARNESS_IDLE_TIMEOUT_FALLBACK);
      expect(codexAgent.calls).toHaveLength(0);
      expect(fx.telemetry.some((r) => r.exitReason === "watchdog-idle-timeout-fallback")).toBe(false);
      expect(fx.telemetry.some((r) => r.exitReason === "watchdog-idle-timeout")).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});
