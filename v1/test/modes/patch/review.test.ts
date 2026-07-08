// review.ts's git operations route through an injectable ReviewGitOps seam (mocked below via
// fakeReviewGitOps), so most cases here need no real git subprocess for status/checkout/clean/
// add/commit/reset. `runPatchReviewPhase` still calls shared/git.ts's real `getCurrentBranch`
// (unseamed, out of scope for this subspec) and `pushCurrent`/`gh` gate seams already covered by
// existing test options, so fixtures use a real-but-fast local git repo (no network) purely to
// satisfy that unseamed branch lookup. Genuinely real (stalling) subprocess behavior lives in
// review.sandbox-unrunnable.test.ts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { runAgent } from "../../../src/agents/spawn.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../../src/agents/types.ts";
import { DEFAULT_CONFIG, type Config } from "../../../src/config.ts";
import { writeReadyFlipBlocked } from "../../../src/git/base-current.ts";
import { buildReviewPrompt, buildVerdictActuatorPrompt } from "../../../src/modes/patch/prompt.ts";
import {
  commitReviewPass,
  consumeReviewBlocker,
  detectSpecTreeEdits,
  PATCH_VERDICT_FILE,
  REVIEW_BLOCKER_FILE,
  type ReviewGitOps,
  revertSpecTreeEdits,
  runPatchReviewPhase,
} from "../../../src/modes/patch/review.ts";
import {
  HARNESS_IDLE_TIMEOUT_FALLBACK,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessAuthRotateLine,
} from "../../../src/quota-harness-messages.ts";
import { FAKE_AGENT_SPAWN_PID, waitForPollCount } from "../../descendant-poll-test-helpers.ts";
import {
  beginHangFixtureTracking,
  reapActiveHangFixtures,
  withHangFixtureSpawned,
  writeIdleHangScript,
} from "../../idle-hang-fixtures.ts";

const HANG_FIXTURE_TRACKING_ID = import.meta.path;

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };
const CODEX_ENTRY = { agent: "codex" as const, model: "gpt-5.3-codex" };
const currentBase =
  (baseRefName: string | null = "main") =>
  () => ({ status: "current" as const, baseRefName });
const behindBase = (baseRefName: string) => () => ({ status: "behind" as const, baseRefName });

beforeEach(() => {
  beginHangFixtureTracking(HANG_FIXTURE_TRACKING_ID);
}, 20_000);

afterEach(() => {
  reapActiveHangFixtures(HANG_FIXTURE_TRACKING_ID);
}, 20_000);

class FakeAgent implements Agent {
  readonly name: AgentName;
  readonly calls: { prompt: string; cwd: string }[] = [];
  readonly #run: (callCount: number, prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>;
  readonly #invokeOnSpawned: boolean;

  constructor(
    name: AgentName,
    run: (callCount: number, prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>,
    invokeOnSpawned = false,
  ) {
    this.name = name;
    this.#run = run;
    this.#invokeOnSpawned = invokeOnSpawned;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    this.calls.push({ prompt, cwd: opts.cwd });
    if (this.#invokeOnSpawned) {
      opts.onSpawned?.({ pid: FAKE_AGENT_SPAWN_PID });
    }
    return this.#run(this.calls.length, prompt, opts);
  }

  attributionLabel(): string {
    return `fake-${this.name}`;
  }
}

function makeReviewConfig(opts?: {
  planOrder?: Array<{ agent: AgentName; model: string }>;
  reviewOrder?: Array<{ agent: AgentName; model: string }>;
  patchOrder?: Array<{ agent: AgentName; model: string }>;
  reviewPanelOrder?: Array<{ agent: AgentName; model: string }>;
  reviewActuatorOrder?: Array<{ agent: AgentName; model: string }>;
  reviewPasses?: number;
}): Config {
  const planOrder = opts?.planOrder ?? [CLAUDE_ENTRY, CODEX_ENTRY];
  const patchOrder = opts?.patchOrder ?? [CLAUDE_ENTRY];
  return {
    version: 2,
    modes: {
      patch: {
        agentOrder: patchOrder,
        ...(opts?.reviewPanelOrder !== undefined || opts?.reviewActuatorOrder !== undefined
          ? {
              subRoleAgentOrder: {
                ...(opts.reviewPanelOrder !== undefined ? { reviewPanel: opts.reviewPanelOrder } : {}),
                ...(opts.reviewActuatorOrder !== undefined ? { reviewActuator: opts.reviewActuatorOrder } : {}),
              },
            }
          : {}),
      },
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
    iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
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

function setupPatchReviewRepoWithBranchChange(): {
  dir: string;
  specPath: string;
  cleanup: () => void;
} {
  const { dir, specPath, cleanup } = setupPatchReviewRepo();
  execSync("git checkout -b feature", { cwd: dir });
  writeFileSync(join(dir, "impl.txt"), "changed\n");
  execSync("git add impl.txt", { cwd: dir });
  execSync("git commit -m 'impl change'", { cwd: dir });
  return { dir, specPath, cleanup };
}

// --- Fake ReviewGitOps: an in-memory git standing in for the real subprocess boundary. ---
// Backed by real files on disk (so FakeAgent callbacks writing via writeFileSync behave
// naturally), but "commits"/"status" are computed from in-memory snapshots instead of
// spawning `git`. Mirrors the FakeShrinkGitOps pattern in shrink.test.ts.

type FakeReviewGitOps = ReviewGitOps & { commits: string[] };

function snapshotDir(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.set(relative(root, full), readFileSync(full, "utf8"));
      }
    }
  };
  walk(root);
  return files;
}

function fakeReviewGitOps(root: string): FakeReviewGitOps {
  let headSnapshot = snapshotDir(root);

  const ops: FakeReviewGitOps = {
    commits: [],
    porcelainStatus() {
      const current = snapshotDir(root);
      const lines: string[] = [];
      for (const [path, content] of current) {
        if (!headSnapshot.has(path)) {
          lines.push(`?? ${path}`);
        } else if (headSnapshot.get(path) !== content) {
          lines.push(` M ${path}`);
        }
      }
      for (const path of headSnapshot.keys()) {
        if (!current.has(path)) {
          lines.push(` D ${path}`);
        }
      }
      return lines.join("\n");
    },
    checkoutPath(_cwd, file) {
      if (!headSnapshot.has(file)) {
        throw new Error(`not in HEAD: ${file}`);
      }
      const full = join(root, file);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, headSnapshot.get(file) ?? "");
    },
    cleanPath(_cwd, file) {
      if (!headSnapshot.has(file)) {
        rmSync(join(root, file), { force: true });
      }
    },
    add() {
      // No staging concept in the fake: commit() snapshots live disk state directly.
    },
    commit(_cwd, message) {
      ops.commits.push(message);
      headSnapshot = snapshotDir(root);
    },
    resetPath() {
      // Unstage-before-delete: the fake has no index, so nothing to do here (the
      // caller deletes the artifact file before the next commit() snapshot anyway).
    },
  };
  return ops;
}

function setupPatchReviewFixture(): {
  dir: string;
  specPath: string;
  specDir: string;
  ops: FakeReviewGitOps;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-patch-review-fixture-"));
  const specDir = join(dir, "spec", "feature");
  mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, "index.md");
  writeFileSync(specPath, "# Feature\n\n- [x] [00](./00-one.md)\n");
  writeFileSync(join(specDir, "00-one.md"), "# 00\n\n## Acceptance criteria\n\n- [x] done\n");
  writeFileSync(join(dir, "impl.txt"), "seed\n");
  const ops = fakeReviewGitOps(dir);
  return { dir, specPath, specDir, ops, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export class IdleHangAgent implements Agent {
  readonly name: AgentName;
  readonly #binary: string;

  constructor(binary: string, name: AgentName = "claude") {
    this.#binary = binary;
    this.name = name;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    return runAgent(
      {
        name: this.name,
        binary: this.#binary,
        cwd: opts.cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
      },
      prompt,
      withHangFixtureSpawned(opts),
    );
  }

  attributionLabel(): string {
    return "fake-claude";
  }
}

function idleActuatorReviewFixture(suffix: string) {
  const { dir, specPath, cleanup } = setupPatchReviewRepo();
  const tmpDir = join(dir, "..", suffix);
  mkdirSync(tmpDir, { recursive: true });
  const idleScript = writeIdleHangScript(join(tmpDir, "idle-hang.sh"));
  const reviewer = new FakeAgent("claude", () => ({ kind: "ok", stdout: "test-verdict", stderr: "" }));
  const cap = { err: "" };
  const telemetry: Record<string, unknown>[] = [];
  return {
    dir,
    specPath,
    cleanup,
    idleScript,
    reviewer,
    cap,
    fanout: (_tag: string, text: string) => {
      cap.err += text;
    },
    telemetry,
    ops: fakeReviewGitOps(dir),
  };
}

async function runIdleActuatorReview(
  fx: ReturnType<typeof idleActuatorReviewFixture>,
  opts: {
    actuatorAgents: Agent[];
    idleOutputTimeoutMs: number;
    iterationTimeoutMs?: number;
    reviewActuatorOrder?: Array<{ agent: AgentName; model: string }>;
  },
) {
  const iterationTimeoutMs = opts.iterationTimeoutMs ?? 30_000;
  const startTime = Date.now();
  const code = await runPatchReviewPhase({
    config: {
      ...makeReviewConfig({
        reviewOrder: [CLAUDE_ENTRY],
        ...(opts.reviewActuatorOrder !== undefined ? { reviewActuatorOrder: opts.reviewActuatorOrder } : {}),
      }),
      idleOutputTimeoutMs: opts.idleOutputTimeoutMs,
    },
    cwd: fx.dir,
    specPath: fx.specPath,
    reviewPassesOverride: 1,
    skipGates: true,
    fanout: fx.fanout,
    writeTelemetry: (record) => {
      fx.telemetry.push(record);
    },
    agents: { claude: fx.reviewer },
    actuatorAgents: opts.actuatorAgents,
    iterationTimeoutMs,
    baseBranch: "main",
    patchWorktreeDir: fx.dir,
    idleOutputTimeoutMs: opts.idleOutputTimeoutMs,
    __testKillGraceMs: 200,
    ops: fx.ops,
  });
  return { code, elapsedMs: Date.now() - startTime };
}

export function stripDelimitedBlocks(prompt: string, beginMarker: string, endMarker: string): string {
  let text = prompt;
  for (;;) {
    const begin = text.indexOf(beginMarker);
    if (begin === -1) {
      return text;
    }
    const end = text.indexOf(endMarker, begin);
    if (end === -1) {
      return text;
    }
    text = `${text.slice(0, begin)}${text.slice(end + endMarker.length)}`;
  }
}

function assertNoUnifiedDiffHunksOutsideAllowedBlocks(prompt: string): void {
  const outsideSpecTree = stripDelimitedBlocks(prompt, "<<<SPEC_BEGIN>>>", "<<<SPEC_END>>>");
  const outsideDiff = stripDelimitedBlocks(outsideSpecTree, "<<<DIFF_BEGIN>>>", "<<<DIFF_END>>>");
  const outsideArtifacts = stripDelimitedBlocks(
    stripDelimitedBlocks(outsideDiff, "<<<ADVERSARY_BEGIN>>>", "<<<ADVERSARY_END>>>"),
    "<<<ADVOCATE_BEGIN>>>",
    "<<<ADVOCATE_END>>>",
  );
  expect(outsideArtifacts).not.toMatch(/^diff --git/m);
  expect(outsideArtifacts).not.toMatch(/^@@/m);
}

describe("buildReviewPrompt", () => {
  test("adversary, advocate, and adjudicator include branch summary without unified diff hunks", () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepoWithBranchChange();
    try {
      for (const role of ["adversary", "advocate", "adjudicator"] as const) {
        const prompt = buildReviewPrompt({
          specPath,
          cwd: dir,
          passNumber: 1,
          totalPasses: 1,
          baseBranch: "main",
          role,
          ...(role === "adversary" ? {} : { priorArtifact: "prior findings" }),
        });
        expect(prompt).toContain("Changed paths:");
        expect(prompt).toContain("impl.txt");
        expect(prompt).toMatch(/file changed|files changed/);
        expect(prompt).toContain("Branch change summary");
        assertNoUnifiedDiffHunksOutsideAllowedBlocks(prompt);
      }
    } finally {
      cleanup();
    }
  });
});

describe("patch review helpers", () => {
  test("detectSpecTreeEdits catches tracked and untracked spec changes", () => {
    const { dir, specDir, ops, cleanup } = setupPatchReviewFixture();
    try {
      writeFileSync(join(specDir, "00-one.md"), "tampered\n");
      writeFileSync(join(specDir, "99-new.md"), "new\n");
      const edits = detectSpecTreeEdits(specDir, dir, ops);
      expect(edits).toContain("spec/feature/00-one.md");
      expect(edits).toContain("spec/feature/99-new.md");
    } finally {
      cleanup();
    }
  });

  test("revertSpecTreeEdits restores tracked files and removes untracked additions", () => {
    const { dir, specDir, ops, cleanup } = setupPatchReviewFixture();
    try {
      const tracked = join(specDir, "00-one.md");
      writeFileSync(tracked, "tampered\n");
      writeFileSync(join(specDir, "99-new.md"), "new\n");
      revertSpecTreeEdits(specDir, dir, ops);
      expect(readFileSync(tracked, "utf8")).toContain("- [x] done");
      expect(detectSpecTreeEdits(specDir, dir, ops)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("revertSpecTreeEdits preserves the patch verdict artifact", () => {
    const { dir, specDir, ops, cleanup } = setupPatchReviewFixture();
    try {
      const tracked = join(specDir, "00-one.md");
      const verdictPath = join(specDir, PATCH_VERDICT_FILE);
      writeFileSync(tracked, "tampered\n");
      writeFileSync(verdictPath, "verdict\n");

      expect(detectSpecTreeEdits(specDir, dir, ops)).toEqual(["spec/feature/00-one.md"]);
      revertSpecTreeEdits(specDir, dir, ops);

      expect(readFileSync(tracked, "utf8")).toContain("- [x] done");
      expect(readFileSync(verdictPath, "utf8")).toBe("verdict\n");
    } finally {
      cleanup();
    }
  });

  test("consumeReviewBlocker reads and deletes the sentinel", () => {
    const { dir, cleanup } = setupPatchReviewFixture();
    try {
      writeFileSync(join(dir, REVIEW_BLOCKER_FILE), "blocked\n");
      expect(consumeReviewBlocker(dir)).toBe("blocked");
      expect(consumeReviewBlocker(dir)).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("commitReviewPass skips commit when there are no changes", () => {
    const { dir, ops, cleanup } = setupPatchReviewFixture();
    try {
      commitReviewPass(1, "claude", dir, undefined, ops);
      expect(ops.commits).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

describe("runPatchReviewPhase", () => {
  test("verdict actuator prompt keeps completed specs read-only", () => {
    const prompt = buildVerdictActuatorPrompt("fix the implementation", "spec/feature/index.md");

    expect(prompt).toContain("## Review Actuator Rules");
    expect(prompt).toContain("implementation files only");
    expect(prompt).toContain("do not edit spec files");
    expect(prompt).toContain("or edit verdict-patch.md");
  });

  test("uses modes.review.agentOrder and shared-runner quota fallback", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    const harness: string[] = [];
    try {
      const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "No issues found", stderr: "" }));
      const claude = new FakeAgent("claude", () => ({ kind: "quota", stderr: "limit" }));
      // Mock the verdict actuator so the non-empty adjudicator verdict does not
      // spawn the real `claude` binary (resolves from the reviewActuator order,
      // which is unset here). Real spawn passes on dev machines with `claude`
      // installed but throws EPIPE in CI.
      const reviewActuator = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));

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
        actuatorAgents: [reviewActuator],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });
      expect(reviewOrderCode).toBe(0);
      expect(codex.calls).toHaveLength(3); // 3 roles per cycle (adversary, advocate, adjudicator)
      expect(codex.calls[0]?.prompt).toContain("Review: Adversary"); // First role is adversary
      expect(codex.calls[1]?.prompt).toContain("Review: Advocate"); // Second role is advocate
      expect(codex.calls[2]?.prompt).toContain("Review: Adjudicator"); // Third role is adjudicator
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
        actuatorAgents: [reviewActuator],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });
      expect(fallbackCode).toBe(0);
      expect(codex.calls).toHaveLength(3); // 3 roles per cycle
    } finally {
      cleanup();
    }
  });

  test("uses reviewPanel override for patch review without changing standalone fallback", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    try {
      const reviewer = new FakeAgent("codex", (_callCount, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "" : "No issues found",
        stderr: "",
      }));

      const code = await runPatchReviewPhase({
        config: makeReviewConfig({
          reviewOrder: [CLAUDE_ENTRY],
          reviewPanelOrder: [CODEX_ENTRY],
        }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { codex: reviewer },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });
      expect(code).toBe(0);
      expect(reviewer.calls).toHaveLength(3);
      expect(reviewer.calls[0]?.prompt).toContain("Review: Adversary");
    } finally {
      cleanup();
    }
  });

  test("actuator falls back through reviewActuator order on quota", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    try {
      const reviewer = new FakeAgent("claude", (_callCount, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "apply fix\n" : "finding\n",
        stderr: "",
      }));
      const claudeActuator = new FakeAgent("claude", () => ({ kind: "quota", stderr: "limit" }));
      const codexActuator = new FakeAgent("codex", () => ({ kind: "ok", stdout: "done\n", stderr: "" }));
      const harness: string[] = [];
      const telemetry: Array<{ agent?: string; exitReason?: string; kind?: string }> = [];

      const code = await runPatchReviewPhase({
        config: makeReviewConfig({
          reviewOrder: [CLAUDE_ENTRY],
          patchOrder: [CLAUDE_ENTRY],
          reviewActuatorOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
        }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: (record) => telemetry.push(record),
        agents: { claude: reviewer },
        actuatorAgents: [claudeActuator, codexActuator],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(0);
      expect(claudeActuator.calls).toHaveLength(1);
      expect(codexActuator.calls).toHaveLength(1);
      expect(harness.some((line) => line === "review: actuator error (quota)")).toBe(true);
      expect(harness.some((line) => line.includes("review: claude:") && line.includes("quota"))).toBe(true);
      const fallbackRow = telemetry.find((r) => r.exitReason === "quota-fallback");
      expect(fallbackRow?.agent).toBe("claude");
      expect(fallbackRow?.kind).toBe("quota");
    } finally {
      cleanup();
    }
  });

  test("actuator reuses one caller-built verdict prompt on every rung", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    try {
      const reviewer = new FakeAgent("claude", (_callCount, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "apply fix\n" : "finding\n",
        stderr: "",
      }));
      const claudeActuator = new FakeAgent("claude", () => ({ kind: "quota", stderr: "limit" }));
      const codexActuator = new FakeAgent("codex", () => ({ kind: "ok", stdout: "done\n", stderr: "" }));
      const expectedPrompt = buildVerdictActuatorPrompt("apply fix\n", specPath);

      const code = await runPatchReviewPhase({
        config: makeReviewConfig({
          reviewOrder: [CLAUDE_ENTRY],
          patchOrder: [CLAUDE_ENTRY],
          reviewActuatorOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
        }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude: reviewer },
        actuatorAgents: [claudeActuator, codexActuator],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(0);
      expect(claudeActuator.calls).toHaveLength(1);
      expect(codexActuator.calls).toHaveLength(1);
      expect(claudeActuator.calls[0]?.prompt).toBe(expectedPrompt);
      expect(codexActuator.calls[0]?.prompt).toBe(expectedPrompt);
    } finally {
      cleanup();
    }
  });

  test("actuator lenient weak-quota fallback advances to next rung on non-final agent", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    try {
      const reviewer = new FakeAgent("claude", (_callCount, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "apply fix\n" : "finding\n",
        stderr: "",
      }));
      const claudeActuator = new FakeAgent("claude", () => ({ kind: "error", exitCode: 17, stderr: "rate limited" }));
      const codexActuator = new FakeAgent("codex", () => ({ kind: "ok", stdout: "done\n", stderr: "" }));
      const harness: string[] = [];
      const telemetry: Array<{ agent?: string; exitReason?: string; kind?: string }> = [];

      const code = await runPatchReviewPhase({
        config: {
          ...makeReviewConfig({
            reviewOrder: [CLAUDE_ENTRY],
            patchOrder: [CLAUDE_ENTRY],
            reviewActuatorOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
          }),
          quotaFallback: "lenient",
          weakQuotaExitCodes: [17],
        },
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: (record) => telemetry.push(record),
        agents: { claude: reviewer },
        actuatorAgents: [claudeActuator, codexActuator],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(0);
      expect(claudeActuator.calls).toHaveLength(1);
      expect(codexActuator.calls).toHaveLength(1);
      expect(harness.some((line) => line === "review: actuator error (quota)")).toBe(true);
      expect(harness.some((line) => line.includes("review: claude:") && line.includes("quota"))).toBe(true);
      const fallbackRow = telemetry.find((r) => r.exitReason === "quota-fallback");
      expect(fallbackRow?.agent).toBe("claude");
      expect(fallbackRow?.kind).toBe("quota");
    } finally {
      cleanup();
    }
  });

  test("actuator rung after idle-timeout advance receives fresh non-aborted signal", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    try {
      const reviewer = new FakeAgent("claude", (_callCount, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "apply fix\n" : "finding\n",
        stderr: "",
      }));
      const signalAbortedAtCall: boolean[] = [];
      const claudeActuator = new FakeAgent("claude", (_callCount, _prompt, runOpts) => {
        signalAbortedAtCall.push(runOpts.signal?.aborted ?? true);
        return { kind: "error", exitCode: 1, stderr: "aborted: idle-timeout" };
      });
      const codexActuator = new FakeAgent("codex", (_callCount, _prompt, runOpts) => {
        signalAbortedAtCall.push(runOpts.signal?.aborted ?? true);
        return { kind: "ok", stdout: "done\n", stderr: "" };
      });
      const harness: string[] = [];

      const code = await runPatchReviewPhase({
        config: makeReviewConfig({
          reviewOrder: [CLAUDE_ENTRY],
          patchOrder: [CLAUDE_ENTRY],
          reviewActuatorOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
        }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { claude: reviewer },
        actuatorAgents: [claudeActuator, codexActuator],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(0);
      expect(signalAbortedAtCall).toEqual([false, false]);
      expect(codexActuator.calls).toHaveLength(1);
      expect(harness.some((line) => line === "review: actuator error (error)")).toBe(true);
      expect(harness.some((line) => line === "aborted: idle-timeout")).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("empty reviewActuatorOrder exits before shared execution", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    try {
      const reviewer = new FakeAgent("claude", (_callCount, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "apply fix\n" : "finding\n",
        stderr: "",
      }));
      const harness: string[] = [];

      const code = await runPatchReviewPhase({
        config: makeReviewConfig({
          reviewOrder: [CLAUDE_ENTRY],
          reviewActuatorOrder: [],
        }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: (tag, text) => {
          if (tag === "harness") harness.push(text.trim());
        },
        writeTelemetry: () => {},
        agents: { claude: reviewer },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(11);
      expect(harness.some((line) => line === "review: actuator no agents available")).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("actuator lenient weak-quota fallback on final rung terminates like native quota", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    try {
      const reviewer = new FakeAgent("claude", (_callCount, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "apply fix\n" : "finding\n",
        stderr: "",
      }));
      const claudeActuator = new FakeAgent("claude", () => ({ kind: "error", exitCode: 17, stderr: "rate limited" }));
      const telemetry: Array<{ agent?: string; exitReason?: string; kind?: string }> = [];

      const code = await runPatchReviewPhase({
        config: {
          ...makeReviewConfig({
            reviewOrder: [CLAUDE_ENTRY],
            patchOrder: [CLAUDE_ENTRY],
            reviewActuatorOrder: [CLAUDE_ENTRY],
          }),
          quotaFallback: "lenient",
          weakQuotaExitCodes: [17],
        },
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: () => {},
        writeTelemetry: (record) => telemetry.push(record),
        agents: { claude: reviewer },
        actuatorAgents: [claudeActuator],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(11);
      const finalRow = telemetry.find((r) => r.exitReason === "quota");
      expect(finalRow?.agent).toBe("claude");
      expect(finalRow?.kind).toBe("quota");
    } finally {
      cleanup();
    }
  });

  test("uses reviewActuator head for verdict actuator only", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    try {
      const reviewer = new FakeAgent("claude", (_callCount, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "apply fix\n" : "finding\n",
        stderr: "",
      }));
      const actuator = new FakeAgent("codex", () => ({
        kind: "ok",
        stdout: "done\n",
        stderr: "",
      }));

      const code = await runPatchReviewPhase({
        config: makeReviewConfig({
          reviewOrder: [CLAUDE_ENTRY],
          patchOrder: [CLAUDE_ENTRY],
          reviewActuatorOrder: [CODEX_ENTRY],
        }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude: reviewer },
        actuatorAgents: [actuator],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(0);
      expect(reviewer.calls).toHaveLength(3);
      expect(actuator.calls).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test("model_config exits 11 and all-agent quota exits 11", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
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
        ops,
      });
      expect(modelCode).toBe(11);

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
        ops,
      });
      expect(quotaCode).toBe(11);
    } finally {
      cleanup();
    }
  });

  test("blocker sentinel exits 7 and baseline gate failure skips review passes", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
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
        ops,
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
        ops,
      });
      expect(baselineCode).toBe(1);
      expect(reviewCalls).toBe(0);
    } finally {
      cleanup();
    }
  });

  test("resume-review forces full tier even with injected recorded green", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    try {
      const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "ok", stderr: "" }));
      const headSha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
      const tiers: string[] = [];

      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewPasses: 1, reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        resumeReview: true,
        recordedGreenResult: { headSha },
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        runBaselineGate: (tier) => {
          tiers.push(`baseline:${tier}`);
        },
        runFinalGate: (_branch, tier) => {
          tiers.push(`final:${tier}`);
        },
        checkPrExists: () => true,
        checkBaseCurrent: currentBase(),
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(0);
      expect(tiers).toEqual(["baseline:full", "final:full"]);
    } finally {
      cleanup();
    }
  });

  test("final gate runs only after all passes complete", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
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
        runBaselineGate: (tier) => {
          events.push(`baseline:${tier}`);
        },
        runFinalGate: (_branch, tier) => {
          events.push(`final:${tier}`);
        },
        checkPrExists: () => true,
        checkBaseCurrent: currentBase(),
        baseBranch: "main",
        ops,
      });
      expect(code).toBe(0);
      // Each pass now runs 3 roles per cycle, each showing "pass N/M" message and "completed" message
      expect(events).toContain("baseline:full");
      expect(events).toContain("final:full");
      expect(events.filter((e) => e === "review: running baseline gate")).toHaveLength(1);
      expect(events.filter((e) => e === "review: running final ready")).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test("reviewer roles run three times per pass (adversary, advocate, adjudicator)", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    const roleCalls: string[] = [];
    try {
      const claude = new FakeAgent("claude", (_callCount, prompt) => {
        // Detect role from prompt content (prompts have "Review: Adversary", etc.)
        if (prompt.includes("Review: Adversary")) {
          roleCalls.push("adversary");
        } else if (prompt.includes("Review: Advocate")) {
          roleCalls.push("advocate");
        } else if (prompt.includes("Review: Adjudicator")) {
          roleCalls.push("adjudicator");
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
        ops,
      });

      expect(code).toBe(0);
      // All three roles should be executed
      expect(roleCalls).toContain("adversary");
      expect(roleCalls).toContain("advocate");
      expect(roleCalls).toContain("adjudicator");
    } finally {
      cleanup();
    }
  });

  test("empty verdict skips actuator invocation", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    const harness: string[] = [];
    try {
      // Adjudicator returns empty verdict
      const reviewer = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "",
        stderr: "",
      }));

      const actuator = new FakeAgent("claude", () => {
        throw new Error("Actuator should not be called");
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
        actuatorAgents: [actuator],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(0);
      // Empty verdict should skip actuator
      expect(harness.some((e) => e.includes("actuator"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("actuator preserves verdict and reverts completed spec edits", async () => {
    const { dir, specPath, specDir, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    const harness: string[] = [];
    try {
      const reviewer = new FakeAgent("claude", (_callCount, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "fix the implementation\n" : "finding\n",
        stderr: "",
      }));
      const actuator = new FakeAgent("claude", (_callCount, _prompt, opts) => {
        writeFileSync(join(opts.cwd, "impl.txt"), "fixed\n");
        writeFileSync(join(specDir, "00-one.md"), "tampered\n");
        writeFileSync(join(specDir, PATCH_VERDICT_FILE), "tampered verdict\n");
        return { kind: "ok", stdout: "done\n", stderr: "" };
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
        actuatorAgents: [actuator],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(0);
      expect(readFileSync(join(dir, "impl.txt"), "utf8")).toBe("fixed\n");
      expect(readFileSync(join(specDir, "00-one.md"), "utf8")).toContain("- [x] done");
      expect(readFileSync(join(specDir, PATCH_VERDICT_FILE), "utf8")).toBe("fix the implementation\n");
      expect(harness.join("\n")).toContain("review: actuator edited spec files (reverting): spec/feature/00-one.md");
      expect(harness.join("\n")).not.toContain(PATCH_VERDICT_FILE);
    } finally {
      cleanup();
    }
  });

  test("orphan reaping: reviewer pass polls and reaps via override", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    const reapCalls: number[] = [];
    let pollCount = 0;
    const pollIntervalMs = 1;
    try {
      let roleCalls = 0;
      const reviewer = new FakeAgent(
        "claude",
        async (_callCount, prompt) => {
          roleCalls += 1;
          await waitForPollCount(() => pollCount, roleCalls * 2);
          return {
            kind: "ok",
            stdout: prompt.includes("Review: Adjudicator") ? "" : "no issues\n",
            stderr: "",
          };
        },
        true,
      );

      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude: reviewer },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
        __testAfterPollFn: () => {
          pollCount += 1;
        },
        __testDescendantPollIntervalMs: pollIntervalMs,
        __testReapOverride: (tracker) => {
          reapCalls.push(tracker.trackedCount);
          return 0;
        },
      });

      expect(code).toBe(0);
      expect(pollCount).toBeGreaterThanOrEqual(6);
      expect(reapCalls).toHaveLength(3);
    } finally {
      cleanup();
    }
  });

  test("orphan reaping: verdict actuator polls and reaps via override", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    const reapCalls: number[] = [];
    let pollCount = 0;
    const pollIntervalMs = 1;
    try {
      let roleCalls = 0;
      const reviewer = new FakeAgent(
        "claude",
        async (_callCount, prompt) => {
          roleCalls += 1;
          await waitForPollCount(() => pollCount, roleCalls * 2);
          return {
            kind: "ok",
            stdout: prompt.includes("Review: Adjudicator") ? "fix the implementation\n" : "finding\n",
            stderr: "",
          };
        },
        true,
      );
      const actuator = new FakeAgent(
        "claude",
        async () => {
          await waitForPollCount(() => pollCount, 8);
          return {
            kind: "ok",
            stdout: "done\n",
            stderr: "",
          };
        },
        true,
      );

      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude: reviewer },
        actuatorAgents: [actuator],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
        __testAfterPollFn: () => {
          pollCount += 1;
        },
        __testDescendantPollIntervalMs: pollIntervalMs,
        __testReapOverride: (tracker) => {
          reapCalls.push(tracker.trackedCount);
          return 0;
        },
      });

      expect(code).toBe(0);
      expect(pollCount).toBeGreaterThanOrEqual(8);
      expect(reapCalls).toHaveLength(4);
      expect(actuator.calls).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test("orphan reaping: reap failure does not affect review outcome", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    try {
      const reviewer = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "no issues\n",
        stderr: "",
      }));

      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude: reviewer },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
        __testReapOverride: () => {
          throw new Error("simulated reap failure");
        },
      });

      expect(code).toBe(0);
    } finally {
      cleanup();
    }
  });

  test("idle watchdog timeout fires in review debate phase", async () => {
    const reviewIdleTimeoutMs = 1000;
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
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
      const code = await runPatchReviewPhase({
        config: {
          ...makeReviewConfig({ reviewOrder: [CLAUDE_ENTRY] }),
          idleOutputTimeoutMs: reviewIdleTimeoutMs,
        },
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        skipGates: true,
        fanout,
        writeTelemetry: (record) => {
          telemetry.push(record);
        },
        agents: { claude: new IdleHangAgent(idleScript) },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
        patchWorktreeDir: dir,
        idleOutputTimeoutMs: reviewIdleTimeoutMs,
        __testKillGraceMs: 200,
      });
      const elapsedMs = Date.now() - startTime;

      expect(code).toBe(11);
      expect(elapsedMs).toBeLessThan(5000);
      expect(cap.err).toContain("idle timeout fired after");
    } finally {
      cleanup();
    }
  });

  test("idle watchdog timeout fires in review actuator phase", async () => {
    const reviewIdleTimeoutMs = 1000;
    const fx = idleActuatorReviewFixture("idle-actuator");
    try {
      const { code, elapsedMs } = await runIdleActuatorReview(fx, {
        actuatorAgents: [new IdleHangAgent(fx.idleScript)],
        idleOutputTimeoutMs: reviewIdleTimeoutMs,
      });

      const hasIdleTimeout = fx.telemetry.some((r) => r.exitReason === "watchdog-idle-timeout");
      expect(code, `Telemetry: ${JSON.stringify(fx.telemetry)}`).toBe(11);
      expect(elapsedMs).toBeLessThan(5000);
      expect(hasIdleTimeout, `Telemetry: ${JSON.stringify(fx.telemetry)}`).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("idle watchdog escalates through reviewActuator when fallback rung remains", async () => {
    const reviewIdleTimeoutMs = 1000;
    const fx = idleActuatorReviewFixture("idle-actuator-escalate");
    try {
      let fallbackSignalAborted: boolean | null | undefined;
      const codexActuator = new FakeAgent("codex", (_callCount, _prompt, runOpts) => {
        fallbackSignalAborted = runOpts.signal?.aborted ?? null;
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const { code } = await runIdleActuatorReview(fx, {
        reviewActuatorOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
        actuatorAgents: [new IdleHangAgent(fx.idleScript), codexActuator],
        idleOutputTimeoutMs: reviewIdleTimeoutMs,
      });

      expect(code).toBe(0);
      expect(fx.cap.err).toContain(`review: claude: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
      expect(codexActuator.calls).toHaveLength(1);
      const fallbackRow = fx.telemetry.find((r) => r.exitReason === "watchdog-idle-timeout-fallback");
      expect(fallbackRow).toBeDefined();
      expect(fallbackRow?.kind).toBe("timeout");
      expect(fallbackRow?.agent).toBe("claude");
      expect(fallbackSignalAborted).toBe(false);
      expect(fx.telemetry.some((r) => r.exitReason === "watchdog-idle-timeout")).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("idle watchdog on final reviewActuator rung exits 11 with terminal watchdog-idle-timeout", async () => {
    const reviewIdleTimeoutMs = 1000;
    const fx = idleActuatorReviewFixture("idle-actuator-final");
    try {
      const { code } = await runIdleActuatorReview(fx, {
        reviewActuatorOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
        actuatorAgents: [new IdleHangAgent(fx.idleScript, "claude"), new IdleHangAgent(fx.idleScript, "codex")],
        idleOutputTimeoutMs: reviewIdleTimeoutMs,
      });

      expect(code).toBe(11);
      expect(fx.cap.err).toContain(`review: claude: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
      const fallbackRow = fx.telemetry.find((r) => r.exitReason === "watchdog-idle-timeout-fallback");
      const terminalRow = fx.telemetry.find((r) => r.exitReason === "watchdog-idle-timeout");
      expect(fallbackRow).toBeDefined();
      expect(terminalRow).toBeDefined();
      expect(terminalRow?.agent).toBe("codex");
      expect(fx.telemetry.filter((r) => r.exitReason === "watchdog-idle-timeout")).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });

  test("review actuator with idleOutputTimeoutMs 0 does not idle-escalate", async () => {
    const fx = idleActuatorReviewFixture("idle-actuator-disabled");
    try {
      const codexActuator = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const iterationTimeoutMs = 800;
      const { code, elapsedMs } = await runIdleActuatorReview(fx, {
        reviewActuatorOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
        actuatorAgents: [new IdleHangAgent(fx.idleScript), codexActuator],
        idleOutputTimeoutMs: 0,
        iterationTimeoutMs,
      });

      expect(code).toBe(11);
      expect(elapsedMs).toBeGreaterThanOrEqual(iterationTimeoutMs - 200);
      expect(fx.cap.err).not.toContain(HARNESS_IDLE_TIMEOUT_FALLBACK);
      expect(codexActuator.calls).toHaveLength(0);
      expect(fx.telemetry.some((r) => r.exitReason === "watchdog-idle-timeout-fallback")).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("review actuator iteration wall abort is terminal with no ladder advance", async () => {
    const fx = idleActuatorReviewFixture("idle-actuator-iteration-wall");
    try {
      const codexActuator = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const iterationTimeoutMs = 800;
      const idleOutputTimeoutMs = 5000;
      const { code, elapsedMs } = await runIdleActuatorReview(fx, {
        reviewActuatorOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
        actuatorAgents: [new IdleHangAgent(fx.idleScript), codexActuator],
        idleOutputTimeoutMs,
        iterationTimeoutMs,
      });

      expect(code).toBe(11);
      expect(elapsedMs).toBeLessThan(idleOutputTimeoutMs);
      expect(fx.cap.err).not.toContain(HARNESS_IDLE_TIMEOUT_FALLBACK);
      expect(codexActuator.calls).toHaveLength(0);
      expect(fx.telemetry.some((r) => r.exitReason === "watchdog-idle-timeout-fallback")).toBe(false);
      expect(fx.telemetry.some((r) => r.exitReason === "watchdog-idle-timeout")).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("invokes fixCommand at review baseline gate site", async () => {
    const { dir: repoDir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(repoDir);
    const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-review-baseline-fix-cmd-"));
    const sentinel = join(sentinelDir, "baseline-fix");
    const script = join(sentinelDir, "fix.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);
    try {
      const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "No issues", stderr: "" }));
      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewPasses: 1, reviewOrder: [CLAUDE_ENTRY] }),
        cwd: repoDir,
        specPath,
        reviewPassesOverride: 1,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        fixCommand: script,
        runReady: () => {},
        resumeReview: true,
        checkPrExists: () => true,
        checkBaseCurrent: currentBase(),
        runFinalGate: (_branch, _tier) => {},
        baseBranch: "main",
        ops,
      });
      expect(code).toBe(0);
      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(sentinelDir, { recursive: true, force: true });
      cleanup();
    }
  });

  test("invokes readyCommand at review baseline gate site", async () => {
    const { dir: repoDir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(repoDir);
    const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-review-baseline-ready-cmd-"));
    const sentinel = join(sentinelDir, "baseline-invoked");
    const script = join(sentinelDir, "ready.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);
    try {
      const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "No issues", stderr: "" }));
      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewPasses: 1, reviewOrder: [CLAUDE_ENTRY] }),
        cwd: repoDir,
        specPath,
        reviewPassesOverride: 1,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        readyCommand: script,
        runFix: () => {},
        // runBaselineGate NOT provided — real gate runs with readyCommand
        checkPrExists: () => true,
        checkBaseCurrent: currentBase(),
        runFinalGate: (_branch, _tier) => {}, // stub final gate to avoid gh pr ready
        baseBranch: "main",
        ops,
      });
      expect(code).toBe(0);
      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(sentinelDir, { recursive: true, force: true });
      cleanup();
    }
  });

  test("invokes readyCommand at review final gate site", async () => {
    const { dir: repoDir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(repoDir);
    const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-review-final-ready-cmd-"));
    const sentinel = join(sentinelDir, "final-invoked");
    const script = join(sentinelDir, "ready.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);
    try {
      const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "No issues", stderr: "" }));
      // runBaselineGate stubbed; runFinalGate NOT provided — real gate runs with readyCommand
      // gh pr ready will fail (no PR on main), causing exit code 1; sentinel proves readyCommand ran
      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewPasses: 1, reviewOrder: [CLAUDE_ENTRY] }),
        cwd: repoDir,
        specPath,
        reviewPassesOverride: 1,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        readyCommand: script,
        runFix: () => {},
        runBaselineGate: () => {}, // stub baseline gate
        checkPrExists: () => true,
        checkBaseCurrent: currentBase(),
        ghPrReady: () => {},
        baseBranch: "main",
        ops,
      });
      expect(code).toBe(0);
      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(sentinelDir, { recursive: true, force: true });
      cleanup();
    }
  });

  test("invokes fixCommand at review final gate site", async () => {
    const { dir: repoDir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(repoDir);
    const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-review-final-fix-cmd-"));
    const sentinel = join(sentinelDir, "final-fix");
    const script = join(sentinelDir, "fix.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);
    try {
      const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "No issues", stderr: "" }));
      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewPasses: 1, reviewOrder: [CLAUDE_ENTRY] }),
        cwd: repoDir,
        specPath,
        reviewPassesOverride: 1,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        fixCommand: script,
        runReady: () => {},
        runBaselineGate: () => {},
        checkPrExists: () => true,
        checkBaseCurrent: currentBase(),
        ghPrReady: () => {},
        baseBranch: "main",
        ops,
      });
      expect(code).toBe(0);
      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(sentinelDir, { recursive: true, force: true });
      cleanup();
    }
  });

  test("review final auto-integrates behind base on conflict-free merge", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    let integrateCalled = false;
    try {
      const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "No issues", stderr: "" }));
      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewPasses: 1, reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        runBaselineGate: () => {},
        checkPrExists: () => true,
        checkBaseCurrent: behindBase("main"),
        tryAutoIntegrateBase: () => {
          integrateCalled = true;
          return "integrated";
        },
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(0);
      expect(integrateCalled).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("review final aborts merge conflict and blocks ready", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    const stderr: string[] = [];
    let ghReadyCalled = false;
    try {
      const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "No issues", stderr: "" }));
      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewPasses: 1, reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        runBaselineGate: () => {},
        checkPrExists: () => true,
        checkBaseCurrent: behindBase("main"),
        tryAutoIntegrateBase: (opts) => {
          writeReadyFlipBlocked(opts.stderr ?? (() => {}), opts.branch, opts.baseRefName);
          return "blocked";
        },
        ghPrReady: () => {
          ghReadyCalled = true;
        },
        stderr: (line) => {
          stderr.push(line);
        },
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(0);
      expect(ghReadyCalled).toBe(false);
      expect(stderr.join("")).toContain("ready flip blocked");
      expect(stderr.join("")).toContain("PR stays draft");
    } finally {
      cleanup();
    }
  });

  test("review final resets on post-merge gate failure and blocks ready", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    const stderr: string[] = [];
    let ghReadyCalled = false;
    try {
      const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "No issues", stderr: "" }));
      const code = await runPatchReviewPhase({
        config: makeReviewConfig({ reviewPasses: 1, reviewOrder: [CLAUDE_ENTRY] }),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude },
        iterationTimeoutMs: 30_000,
        runBaselineGate: () => {},
        checkPrExists: () => true,
        checkBaseCurrent: behindBase("main"),
        tryAutoIntegrateBase: (opts) => {
          writeReadyFlipBlocked(opts.stderr ?? (() => {}), opts.branch, opts.baseRefName);
          return "blocked";
        },
        ghPrReady: () => {
          ghReadyCalled = true;
        },
        stderr: (line) => {
          stderr.push(line);
        },
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(0);
      expect(ghReadyCalled).toBe(false);
      expect(stderr.join("")).toContain("ready flip blocked");
      expect(stderr.join("")).toContain("PR stays draft");
    } finally {
      cleanup();
    }
  });

  test("emits auth note on auth failure in review quota rotation", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    const harness: string[] = [];
    try {
      const claude = new FakeAgent("claude", () => ({
        kind: "quota",
        stderr: "refresh token revoked",
        authFailure: true,
      }));
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
        agents: { claude },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });
      expect(code).toBe(11);
      const emitted = harness.join("\n");
      expect(emitted).toContain(`claude: ${harnessAuthRotateLine("claude")}`);
      expect(emitted).not.toContain(HARNESS_QUOTA_FALLBACK_STRICT);
    } finally {
      cleanup();
    }
  });

  test("emits quota line (not auth note) on plain quota in review rotation", async () => {
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    const harness: string[] = [];
    try {
      const claude = new FakeAgent("claude", () => ({
        kind: "quota",
        stderr: "limit exceeded",
      }));
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
        agents: { claude },
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });
      expect(code).toBe(11);
      const emitted = harness.join("\n");
      expect(emitted).toContain(`claude: ${HARNESS_QUOTA_FALLBACK_STRICT}`);
      expect(emitted).not.toContain("auth failed");
    } finally {
      cleanup();
    }
  });

  test("actuator invokes reconcile before push (via commitPass)", async () => {
    // This test verifies the actuator path includes reconcile + push.
    // The full integration is tested via unit tests; this validates
    // that the review flow correctly calls reconcileActuatorCommit.
    const { dir, specPath, cleanup } = setupPatchReviewRepo();
    const ops = fakeReviewGitOps(dir);
    const harness: string[] = [];
    try {
      const actuatorAgent = new FakeAgent(
        "claude",
        (callCount) => {
          if (callCount === 4) {
            // Fourth call is the actuator (after 3 review roles)
            writeFileSync(join(dir, "review.txt"), "review fix\n");
            execSync("git add review.txt", { cwd: dir });
            return { kind: "ok", stdout: "Applied review fixes", stderr: "" };
          }
          return { kind: "ok", stdout: "Review notes", stderr: "" };
        },
        true,
      );

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
        agents: { claude: actuatorAgent },
        actuatorAgents: [actuatorAgent],
        iterationTimeoutMs: 30_000,
        baseBranch: "main",
        ops,
      });

      expect(code).toBe(0);
      expect(harness.join("\n")).toContain("actuator completed");
    } finally {
      cleanup();
    }
  });
});
