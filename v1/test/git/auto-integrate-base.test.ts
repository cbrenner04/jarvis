import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../../src/config.ts";
import { tryAutoIntegrateBase } from "../../src/git/auto-integrate-base.ts";
import { maybeMarkReady } from "../../src/modes/patch/pr.ts";
import { runPatchReviewPhase } from "../../src/modes/patch/review.ts";
import type { RunReadyAndCommitOpts } from "../../src/ready-gate.ts";

const branch = "feature";
const cwd = "/tmp/worktree";
const baseRefName = "main";

type IntegrateHarness = {
  porcelain: string;
  headSha: string;
  mergeCalls: number;
  abortCalls: number;
  resetCalls: string[];
  gateCalls: number;
  pushCalls: number;
  ghReadyCalls: number;
  warnings: string[];
  stderr: string;
  mergeThrows: boolean;
  gateThrows: boolean;
  ghReadyThrows: boolean;
};

function makeHarness(overrides: Partial<IntegrateHarness> = {}): IntegrateHarness {
  return {
    porcelain: "",
    headSha: "abc123",
    mergeCalls: 0,
    abortCalls: 0,
    resetCalls: [],
    gateCalls: 0,
    pushCalls: 0,
    ghReadyCalls: 0,
    warnings: [],
    stderr: "",
    mergeThrows: false,
    gateThrows: false,
    ghReadyThrows: false,
    ...overrides,
  };
}

function integrateOpts(h: IntegrateHarness) {
  return {
    branch,
    cwd,
    baseRefName,
    agentLabel: "test",
    timeoutMs: 30_000,
    stderr: (s: string) => {
      h.stderr += s;
    },
    warn: (message: string) => {
      h.warnings.push(message);
    },
    readPorcelain: () => h.porcelain,
    getHeadSha: () => h.headSha,
    mergeOriginBase: () => {
      h.mergeCalls += 1;
      if (h.mergeThrows) {
        const err = new Error("merge conflict") as NodeJS.ErrnoException & { status?: number };
        err.status = 1;
        throw err;
      }
    },
    abortMerge: () => {
      h.abortCalls += 1;
    },
    resetHard: (sha: string) => {
      h.resetCalls.push(sha);
    },
    isMergeInProgress: () => false,
    runFullGate: (_opts: RunReadyAndCommitOpts) => {
      h.gateCalls += 1;
      if (h.gateThrows) {
        throw new Error("gate failed");
      }
    },
    pushCurrentFn: () => {
      h.pushCalls += 1;
    },
    ghPrReady: () => {
      h.ghReadyCalls += 1;
      if (h.ghReadyThrows) {
        throw new Error("gh pr ready failed");
      }
    },
  };
}

function makeReviewConfig(): Config {
  return {
    version: 2,
    modes: {
      patch: { agentOrder: [{ agent: "claude", model: "haiku" }] },
      plan: { agentOrder: [{ agent: "claude", model: "haiku" }] },
      prompt: { agentOrder: [{ agent: "claude", model: "haiku" }] },
      review: { passes: 1, agentOrder: [{ agent: "claude", model: "haiku" }] },
    },
    quotaFallback: "lenient",
    weakQuotaExitCodes: [],
    maxIterations: 10,
    iterationTimeoutMs: 30_000,
    git: true,
    projects: {},
  };
}

class ReviewOkAgent {
  readonly name = "claude" as const;

  async run() {
    return { kind: "ok" as const, stdout: "ok", stderr: "" };
  }

  attributionLabel() {
    return "fake-claude";
  }
}

describe("tryAutoIntegrateBase", () => {
  test("conflict-free behind merges, full gates, pushes, and marks ready", () => {
    const h = makeHarness();
    expect(tryAutoIntegrateBase(integrateOpts(h))).toBe("integrated");
    expect(h.mergeCalls).toBe(1);
    expect(h.gateCalls).toBe(1);
    expect(h.pushCalls).toBe(1);
    expect(h.ghReadyCalls).toBe(1);
    expect(h.stderr).toBe("");
  });

  test("merge conflict aborts and blocks ready", () => {
    const h = makeHarness({ mergeThrows: true });
    expect(tryAutoIntegrateBase(integrateOpts(h))).toBe("blocked");
    expect(h.abortCalls).toBe(1);
    expect(h.gateCalls).toBe(0);
    expect(h.ghReadyCalls).toBe(0);
    expect(h.stderr).toContain("ready flip blocked");
    expect(h.stderr).toContain("PR stays draft");
  });

  test("post-merge gate failure resets local tree and blocks ready", () => {
    const h = makeHarness({ gateThrows: true });
    expect(tryAutoIntegrateBase(integrateOpts(h))).toBe("blocked");
    expect(h.resetCalls).toEqual(["abc123"]);
    expect(h.ghReadyCalls).toBe(0);
    expect(h.stderr).toContain("ready flip blocked");
  });

  test("pushes merge commit when gate is clean", () => {
    const h = makeHarness();
    expect(tryAutoIntegrateBase(integrateOpts(h))).toBe("integrated");
    expect(h.gateCalls).toBe(1);
    expect(h.pushCalls).toBe(1);
    expect(h.ghReadyCalls).toBe(1);
  });

  test("dirty pre-merge porcelain blocks without merge", () => {
    const h = makeHarness({ porcelain: " M dirty.txt" });
    expect(tryAutoIntegrateBase(integrateOpts(h))).toBe("blocked");
    expect(h.mergeCalls).toBe(0);
    expect(h.stderr).toContain("ready flip blocked");
  });

  test("gh pr ready failure after integrate warns without throwing", () => {
    const h = makeHarness({ ghReadyThrows: true });
    let result: ReturnType<typeof tryAutoIntegrateBase> | undefined;
    expect(() => {
      result = tryAutoIntegrateBase(integrateOpts(h));
    }).not.toThrow();
    expect(result).toBe("blocked");
    expect(h.pushCalls).toBe(1);
    expect(h.warnings.some((w) => w.includes("failed to mark PR ready"))).toBe(true);
  });

  test("maybeMarkReady and review-final share behind-base outcomes", async () => {
    const scenarios = [
      { mergeThrows: false, gateThrows: false, ghReadyThrows: false },
      { mergeThrows: true, gateThrows: false, ghReadyThrows: false },
      { mergeThrows: false, gateThrows: true, ghReadyThrows: false },
    ] as const;

    for (const scenario of scenarios) {
      const indexParent = mkdtempSync(join(tmpdir(), "jarvis-auto-integrate-index-"));
      const indexDir = join(indexParent, "repo");
      mkdirSync(indexDir);
      execSync("git init -q -b feature", { cwd: indexDir, stdio: "pipe" });
      execSync("git config user.email 'test@example.com'", { cwd: indexDir, stdio: "pipe" });
      execSync("git config user.name 'Test User'", { cwd: indexDir, stdio: "pipe" });
      const indexPath = join(indexDir, "index.md");
      writeFileSync(indexPath, "# Spec\n\n- [x] [00 - one](./00-one.md)\n");
      execSync("git add -A && git commit -q -m seed", { cwd: indexDir, stdio: "pipe" });

      const helperHarness = makeHarness(scenario);
      const helperResult = tryAutoIntegrateBase(integrateOpts(helperHarness));

      const maybeHarness = makeHarness(scenario);
      await maybeMarkReady({
        indexPath,
        cwd: indexDir,
        timeoutMs: 30_000,
        baseBranch: "main",
        checkPrExists: () => true,
        checkBaseCurrent: () => ({ status: "behind", baseRefName }),
        autoIntegrateBase: true,
        tryAutoIntegrateBase: (opts) => tryAutoIntegrateBase({ ...integrateOpts(maybeHarness), ...opts }),
      });
      rmSync(indexParent, { recursive: true, force: true });

      const parent = mkdtempSync(join(tmpdir(), "jarvis-auto-integrate-review-"));
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

      const reviewHarness = makeHarness(scenario);
      const code = await runPatchReviewPhase({
        config: makeReviewConfig(),
        cwd: dir,
        specPath,
        reviewPassesOverride: 1,
        fanout: () => {},
        writeTelemetry: () => {},
        agents: { claude: new ReviewOkAgent() },
        iterationTimeoutMs: 30_000,
        runBaselineGate: () => {},
        checkPrExists: () => true,
        checkBaseCurrent: () => ({ status: "behind", baseRefName }),
        tryAutoIntegrateBase: (opts) => tryAutoIntegrateBase({ ...integrateOpts(reviewHarness), ...opts }),
        baseBranch: "main",
      });
      rmSync(parent, { recursive: true, force: true });

      const expected = scenario.mergeThrows || scenario.gateThrows ? "blocked" : "integrated";
      expect(helperResult).toBe(expected);
      expect(code).toBe(0);
      expect(maybeHarness.mergeCalls).toBe(helperHarness.mergeCalls);
      expect(maybeHarness.gateCalls).toBe(helperHarness.gateCalls);
      expect(maybeHarness.ghReadyCalls).toBe(helperHarness.ghReadyCalls);
      expect(maybeHarness.abortCalls).toBe(helperHarness.abortCalls);
      expect(maybeHarness.resetCalls).toEqual(helperHarness.resetCalls);
      expect(reviewHarness.mergeCalls).toBe(helperHarness.mergeCalls);
      expect(reviewHarness.gateCalls).toBe(helperHarness.gateCalls);
      expect(reviewHarness.ghReadyCalls).toBe(helperHarness.ghReadyCalls);
    }
  });
});
