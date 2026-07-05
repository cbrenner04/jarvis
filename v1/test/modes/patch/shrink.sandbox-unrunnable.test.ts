// Real git subprocess stalls: exercises the GIT_SUBPROCESS_OPTS kill/timeout path itself, so a
// fake ShrinkGitOps (which never spawns) can't stand in — these are the genuine stall-path cases.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../../src/agents/types.ts";
import type { Config } from "../../../src/config.ts";
import { runPatchShrinkPhase } from "../../../src/modes/patch/shrink.ts";
import {
  beginHangFixtureTracking,
  IDLE_HANG_BODY,
  reapActiveHangFixtures,
  trackHangFixtureScript,
  writeIdleHangScript,
} from "../../idle-hang-fixtures.ts";

const HANG_FIXTURE_TRACKING_ID = import.meta.path;

beforeEach(() => {
  beginHangFixtureTracking(HANG_FIXTURE_TRACKING_ID);
}, 20_000);

afterEach(() => {
  reapActiveHangFixtures(HANG_FIXTURE_TRACKING_ID);
}, 20_000);

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
      patch: { agentOrder: [CLAUDE_ENTRY], shrink: "agent" },
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

/** Real git repo with a real remote, needed by the push-stall test below. */
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

describe("runPatchShrinkPhase real git subprocess stalls", () => {
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
  }, 35_000);

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
  }, 35_000);

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
  }, 35_000);
});
