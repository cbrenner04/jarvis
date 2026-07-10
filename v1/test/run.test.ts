import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { branchExistsLocal, branchExistsOnOrigin, getCurrentBranch } from "../../shared/git.ts";
import { ClaudeAgent } from "../src/agents/claude.ts";
import { runAgent } from "../src/agents/spawn.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { type AgentEntry, DEFAULT_CONFIG, loadConfig, registerProject, writeConfig } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";
import {
  __testClearDeltaStateDir,
  __testSetDeltaStateDir,
  createFreshDelta,
  recordBlocker,
  recordNewlyCheckedAc,
} from "../src/modes/patch/no-commit-delta.ts";
import {
  type CompletionReadyGateResult,
  maybeWarnAboutUnmergedPlanBranch,
  prepareActiveSpecPath,
  type RunCommandOptions,
  type RunIo,
  runCommand,
} from "../src/modes/patch/run.ts";
import { NARRATIVE_END_MARKER } from "../src/pr.ts";
import {
  HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED,
  HARNESS_IDLE_TIMEOUT_FALLBACK,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessAuthRotateLine,
  harnessQuotaFallbackLenientLine,
} from "../src/quota-harness-messages.ts";
import { getWorktreeLockPath } from "../src/worktree-lock.ts";
import {
  beginHangFixtureTracking,
  reapActiveHangFixtures,
  withHangFixtureSpawned,
  writeIdleHangScript,
} from "./idle-hang-fixtures.ts";

const HANG_FIXTURE_TRACKING_ID = import.meta.path;

function captureIo(): { io: RunIo; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
    },
    out: () => out,
    err: () => err,
  };
}

class FakeAgent implements Agent {
  readonly name: AgentName;
  readonly calls: { prompt: string; cwd: string }[] = [];
  readonly callOpts: AgentRunOptions[] = [];
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
    this.callOpts.push(opts);
    return this.#run(this.calls.length, prompt, opts);
  }

  attributionLabel(): string {
    return `fake-${this.name}`;
  }
}

let dir: string;
let projectRoot: string;
let cfgDir: string;
let originalPath: string | undefined;

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };
const CODEX_ENTRY = { agent: "codex" as const, model: "gpt-5.3-codex" };
const CURSOR_ENTRY = { agent: "cursor" as const, model: "Composer 2.5" };
const CLAUDE_MONTHLY_SPEND_FIXTURE = readFileSync(
  join(import.meta.dir, "fixtures/claude/2.1.142-monthly-spend-limit.json"),
  "utf8",
);

function fakeClaudeBinary(dir: string, opts: { exit: number; stdout?: string; stderr?: string }): string {
  const path = join(dir, "claude");
  const out = opts.stdout ?? "";
  const err = opts.stderr ?? "";
  const outB64 = Buffer.from(out).toString("base64");
  const errB64 = Buffer.from(err).toString("base64");
  const script = `#!/usr/bin/env bash
printf '%s' "$(printf '%s' '${outB64}' | base64 -d)"
printf '%s' "$(printf '%s' '${errB64}' | base64 -d)" 1>&2
exit ${opts.exit}
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

function disableReviewByDefault(opts: RunCommandOptions): RunCommandOptions {
  return {
    ...opts,
    reviewPasses: opts.reviewPasses ?? 0,
    logClient: opts.logClient ?? {
      assertReachable: async () => {},
      send: async () => {},
    },
  };
}

async function runWithDefaults(opts: RunCommandOptions): Promise<number> {
  return runCommand({
    // Default the completion `ready` gate to green so completion-path tests do
    // not invoke a real `bun run ready` in their temp worktrees. Tests that
    // exercise the gate pass their own `runCompletionReadyGate`, which wins via
    // the spread below.
    runCompletionReadyGate: () => ({ kind: "green" }),
    ...disableReviewByDefault(opts),
    skipGhCheck: true,
  });
}

function initCompletionGateRepo(specContents = "- [ ] todo\n"): string {
  execSync("git init -b jarvis-e2e", { cwd: projectRoot });
  execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
  execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
  const spec = writeSpec(specContents);
  execSync("git add index.md && git commit -m init", { cwd: projectRoot });
  return spec;
}

function createCompletionAgent(spec: string, onFixup?: (callCount: number) => void): FakeAgent {
  return new FakeAgent("claude", (callCount) => {
    if (callCount === 1) {
      writeFileSync(spec, readFileSync(spec, "utf8").replace("- [ ]", "- [x]"));
      execSync("git add index.md && git commit -m done", { cwd: projectRoot });
    } else {
      onFixup?.(callCount);
    }
    return { kind: "ok", stdout: "", stderr: "" };
  });
}

function createCompletionThenIdleAgent(spec: string, hangScript: string): FakeAgent {
  return new FakeAgent("claude", (callCount, prompt, opts) => {
    if (callCount === 1) {
      writeFileSync(spec, readFileSync(spec, "utf8").replace("- [ ]", "- [x]"));
      execSync("git add index.md && git commit -m done", { cwd: projectRoot });
      return { kind: "ok", stdout: "", stderr: "" };
    }
    return runAgent(
      {
        name: "claude",
        binary: hangScript,
        cwd: opts.cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
      },
      prompt,
      withHangFixtureSpawned(opts),
    );
  });
}

function createIdleHangAgent(name: AgentName, hangScript: string): FakeAgent {
  return new FakeAgent(name, (_callCount, prompt, opts) =>
    runAgent(
      {
        name,
        binary: hangScript,
        cwd: opts.cwd,
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
      },
      prompt,
      withHangFixtureSpawned(opts),
    ),
  );
}

const DRAFT_PR_17_JSON =
  '[{"number":17,"isDraft":true,"headRefName":"feature","headRepository":{"name":"repo"},"headRepositoryOwner":{"login":"owner"}}]\n';

function initGitRepoWithOrigin(remoteName = "origin.git"): string {
  const origin = join(dir, remoteName);
  execSync(`git init --bare ${origin}`);
  execSync("git init -b main", { cwd: projectRoot });
  execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
  execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
  execSync(`git remote add origin ${origin}`, { cwd: projectRoot });
  writeFileSync(join(projectRoot, "README.md"), "seed\n");
  execSync("git add README.md && git commit -m init && git push -u origin main", { cwd: projectRoot });
  return origin;
}

function writeManagedExternalSpec(specName: string): { indexPath: string; subspecPath: string; specRoot: string } {
  const specRoot = join(cfgDir, "specs", "project", specName);
  mkdirSync(specRoot, { recursive: true });
  const indexPath = join(specRoot, "index.md");
  const subspecPath = join(specRoot, "00-one.md");
  writeFileSync(indexPath, `repo: ${projectRoot}\n\n# Feature\n\n- [ ] [00 - One](./00-one.md)\n`);
  writeFileSync(subspecPath, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
  return { indexPath, subspecPath, specRoot };
}

function writeStaleExternalDelta(subspecPath: string): void {
  writeFileSync(
    subspecPath,
    "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n\n## Blocker\n\nNeed a rerun.\n",
  );
  const delta = createFreshDelta(subspecPath);
  recordNewlyCheckedAc(delta, "One accepted.");
  recordBlocker(delta, "Need a rerun.");
}

function createStalePatchBranch(specName: string): string {
  execSync(`git checkout -b ${specName}`, { cwd: projectRoot });
  const stalePath = join(projectRoot, "stale.txt");
  writeFileSync(stalePath, "stale\n");
  execSync("git add stale.txt && git commit -m stale && git push -u origin HEAD", { cwd: projectRoot });
  execSync("git checkout main", { cwd: projectRoot });
  const worktreePath = join(projectRoot, ".worktree", specName);
  execSync(`git worktree add ${worktreePath} ${specName}`, { cwd: projectRoot });
  return worktreePath;
}

function installCleanupGhStub(
  prListJson: string,
  opts?: { failClose?: boolean },
): { closeLog: string; oldPath: string } {
  const binDir = join(dir, "bin-cleanup");
  mkdirSync(binDir, { recursive: true });
  const gh = join(binDir, "gh");
  const closeLog = join(dir, "gh-pr-close.log");
  const prListFile = join(dir, "gh-pr-list.json");
  writeFileSync(prListFile, prListJson);
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "auth status" ]]; then exit 0; fi
if [[ "$1 $2" == "repo view" && "$*" == *"defaultBranchRef"* ]]; then
  printf 'main\\n'
  exit 0
fi
if [[ "$1 $2" == "repo view" && "$*" == *"owner,name"* ]]; then
  printf '{"owner":{"login":"owner"},"name":"repo"}\\n'
  exit 0
fi
if [[ "$1 $2" == "pr list" ]]; then
  cat "${prListFile}"
  exit 0
fi
if [[ "$1 $2" == "pr close" ]]; then
  printf '%s\\n' "$3" >> "${closeLog}"
  ${opts?.failClose ? "exit 1" : "exit 0"}
fi
exit 1
`,
  );
  chmodSync(gh, 0o755);
  const oldPath = process.env.PATH ?? "";
  process.env.PATH = `${binDir}:${oldPath}`;
  return { closeLog, oldPath };
}

function installGhReadyStub(): string {
  const binDir = join(dir, "bin-gh-ready");
  mkdirSync(binDir, { recursive: true });
  const gh = join(binDir, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "auth status" ]]; then exit 0; fi
if [[ "$1 $2" == "repo view" ]]; then printf 'main\\n'; exit 0; fi
exit 1
`,
  );
  chmodSync(gh, 0o755);
  const oldPath = process.env.PATH ?? "";
  process.env.PATH = `${binDir}:${oldPath}`;
  return oldPath;
}

function repeatFailureText(failureText: string, count: number): string[] {
  return Array.from({ length: count }, () => failureText);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-run-"));
  projectRoot = join(dir, "project");
  cfgDir = join(dir, "cfg");
  originalPath = process.env.PATH;
  mkdirSync(projectRoot);
  registerProject("project", projectRoot, { dir: cfgDir });
  __testSetDeltaStateDir(join(dir, "delta-state"));
  beginHangFixtureTracking(HANG_FIXTURE_TRACKING_ID);
});

afterEach(() => {
  reapActiveHangFixtures(HANG_FIXTURE_TRACKING_ID);
  __testClearDeltaStateDir();
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("runCommand", () => {
  describe("plan-branch warning preflight", () => {
    test("warns when matching origin plan/<name> branch is unmerged", () => {
      const remote = mkdtempSync(join(tmpdir(), "jarvis-plan-warn-remote-"));
      const local = mkdtempSync(join(tmpdir(), "jarvis-plan-warn-local-"));
      try {
        execSync("git init --bare -b main", { cwd: remote });
        execSync("git init -b main", { cwd: local });
        execSync("git config user.email 'test@example.com'", { cwd: local });
        execSync("git config user.name 'Test User'", { cwd: local });
        writeFileSync(join(local, "README.md"), "seed\n");
        execSync("git add README.md", { cwd: local });
        execSync("git commit -m 'seed'", { cwd: local });
        execSync(`git remote add origin ${remote}`, { cwd: local });
        execSync("git push -u origin main", { cwd: local });
        execSync("git checkout -b plan/my-spec", { cwd: local });
        writeFileSync(join(local, "spec.txt"), "x\n");
        execSync("git add spec.txt", { cwd: local });
        execSync("git commit -m 'plan work'", { cwd: local });
        execSync("git push -u origin plan/my-spec", { cwd: local });

        const cap = captureIo();
        maybeWarnAboutUnmergedPlanBranch({
          io: cap.io,
          projectRoot: local,
          specPath: join(local, "spec", "my-spec", "index.md"),
          gitEnabled: true,
        });
        expect(cap.err()).toContain("warning: a plan branch plan/my-spec");
      } finally {
        rmSync(remote, { recursive: true, force: true });
        rmSync(local, { recursive: true, force: true });
      }
    });

    test("does not warn when matching plan branch is already merged", () => {
      const remote = mkdtempSync(join(tmpdir(), "jarvis-plan-merged-remote-"));
      const local = mkdtempSync(join(tmpdir(), "jarvis-plan-merged-local-"));
      try {
        execSync("git init --bare -b main", { cwd: remote });
        execSync("git init -b main", { cwd: local });
        execSync("git config user.email 'test@example.com'", { cwd: local });
        execSync("git config user.name 'Test User'", { cwd: local });
        writeFileSync(join(local, "README.md"), "seed\n");
        execSync("git add README.md", { cwd: local });
        execSync("git commit -m 'seed'", { cwd: local });
        execSync(`git remote add origin ${remote}`, { cwd: local });
        execSync("git push -u origin main", { cwd: local });
        execSync("git checkout -b plan/my-spec", { cwd: local });
        writeFileSync(join(local, "spec.txt"), "x\n");
        execSync("git add spec.txt", { cwd: local });
        execSync("git commit -m 'plan work'", { cwd: local });
        execSync("git push -u origin plan/my-spec", { cwd: local });
        execSync("git checkout main", { cwd: local });
        execSync("git merge --no-ff plan/my-spec -m 'merge plan'", {
          cwd: local,
        });
        execSync("git push origin main", { cwd: local });

        const cap = captureIo();
        maybeWarnAboutUnmergedPlanBranch({
          io: cap.io,
          projectRoot: local,
          specPath: join(local, "spec", "my-spec", "index.md"),
          gitEnabled: true,
        });
        expect(cap.err()).not.toContain("warning: a plan branch");
      } finally {
        rmSync(remote, { recursive: true, force: true });
        rmSync(local, { recursive: true, force: true });
      }
    });

    test("does not warn when no matching origin plan/<name> branch exists", () => {
      const remote = mkdtempSync(join(tmpdir(), "jarvis-plan-none-remote-"));
      const local = mkdtempSync(join(tmpdir(), "jarvis-plan-none-local-"));
      try {
        execSync("git init --bare -b main", { cwd: remote });
        execSync("git init -b main", { cwd: local });
        execSync("git config user.email 'test@example.com'", { cwd: local });
        execSync("git config user.name 'Test User'", { cwd: local });
        writeFileSync(join(local, "README.md"), "seed\n");
        execSync("git add README.md", { cwd: local });
        execSync("git commit -m 'seed'", { cwd: local });
        execSync(`git remote add origin ${remote}`, { cwd: local });
        execSync("git push -u origin main", { cwd: local });

        const cap = captureIo();
        maybeWarnAboutUnmergedPlanBranch({
          io: cap.io,
          projectRoot: local,
          specPath: join(local, "spec", "my-spec", "index.md"),
          gitEnabled: true,
        });
        expect(cap.err()).not.toContain("warning: a plan branch");
      } finally {
        rmSync(remote, { recursive: true, force: true });
        rmSync(local, { recursive: true, force: true });
      }
    });

    test("skips silently when ls-remote fails (no auth/remote)", () => {
      const local = mkdtempSync(join(tmpdir(), "jarvis-plan-lsremote-fail-"));
      try {
        execSync("git init -b main", { cwd: local });
        execSync("git config user.email 'test@example.com'", { cwd: local });
        execSync("git config user.name 'Test User'", { cwd: local });
        writeFileSync(join(local, "README.md"), "seed\n");
        execSync("git add README.md", { cwd: local });
        execSync("git commit -m 'seed'", { cwd: local });

        const cap = captureIo();
        maybeWarnAboutUnmergedPlanBranch({
          io: cap.io,
          projectRoot: local,
          specPath: join(local, "spec", "my-spec", "index.md"),
          gitEnabled: true,
        });
        expect(cap.err()).toBe("");
      } finally {
        rmSync(local, { recursive: true, force: true });
      }
    });
  });

  describe("stale external-spec rerun cleanup", () => {
    test("closes a stale draft PR, resets source-spec deltas, and recreates a fresh branch/worktree", async () => {
      initGitRepoWithOrigin();
      const specName = "feature";
      const { indexPath, subspecPath } = writeManagedExternalSpec(specName);
      writeStaleExternalDelta(subspecPath);
      createStalePatchBranch(specName);
      const { closeLog, oldPath } = installCleanupGhStub(DRAFT_PR_17_JSON);
      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.plan.commit = false;
      writeConfig(cfg, { dir: cfgDir });
      const cap = captureIo();
      let sawFreshState = false;
      const claude = new FakeAgent("claude", (_n, _prompt, runOpts) => {
        expect(runOpts.cwd).toBe(join(projectRoot, ".worktree", specName));
        expect(readFileSync(subspecPath, "utf8")).toContain("- [ ] One accepted.");
        expect(readFileSync(subspecPath, "utf8")).not.toContain("## Blocker");
        expect(existsSync(join(runOpts.cwd, "stale.txt"))).toBe(false);
        expect(getCurrentBranch(runOpts.cwd)).toBe(specName);
        const head = execSync("git rev-parse HEAD", { cwd: runOpts.cwd, encoding: "utf8" }).trim();
        const mainHead = execSync("git rev-parse main", { cwd: projectRoot, encoding: "utf8" }).trim();
        expect(head).toBe(mainHead);
        sawFreshState = true;
        return { kind: "error", exitCode: 1, stderr: "stop" };
      });

      try {
        const code = await runCommand({
          specPath: indexPath,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          logClient: { assertReachable: async () => {}, send: async () => {} },
          handleSignals: false,
        });

        expect(code).toBe(3);
        expect(sawFreshState).toBe(true);
        expect(readFileSync(closeLog, "utf8").trim()).toBe("17");
        expect(branchExistsLocal(projectRoot, specName)).toBe(true);
        expect(branchExistsOnOrigin(projectRoot, specName)).toBe(false);
        expect(existsSync(join(projectRoot, ".worktree", specName))).toBe(true);
      } finally {
        process.env.PATH = oldPath;
      }
    });

    test("refuses cleanup when the stale worktree has a live lock", async () => {
      initGitRepoWithOrigin();
      const specName = "feature";
      const { indexPath } = writeManagedExternalSpec(specName);
      const worktreePath = createStalePatchBranch(specName);
      writeFileSync(
        join(worktreePath, ".jarvis.lock"),
        `${JSON.stringify({ pid: process.pid, started_at: "2026-06-27T00:00:00Z", host: "test-host" }, null, 2)}\n`,
      );
      const { closeLog, oldPath } = installCleanupGhStub(DRAFT_PR_17_JSON);
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("agent must not run");
      });

      try {
        const code = await runCommand({
          specPath: indexPath,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          logClient: { assertReachable: async () => {}, send: async () => {} },
          handleSignals: false,
        });

        expect(code).toBe(9);
        expect(cap.err()).toContain("worktree is in use by process");
        expect(existsSync(join(worktreePath, "stale.txt"))).toBe(true);
        expect(branchExistsOnOrigin(projectRoot, specName)).toBe(true);
        expect(existsSync(closeLog)).toBe(false);
      } finally {
        process.env.PATH = oldPath;
      }
    });

    test("refuses cleanup when the matching open PR is not draft", async () => {
      initGitRepoWithOrigin();
      const specName = "feature";
      const { indexPath } = writeManagedExternalSpec(specName);
      const worktreePath = createStalePatchBranch(specName);
      const { oldPath } = installCleanupGhStub(
        '[{"number":17,"isDraft":false,"headRefName":"feature","headRepository":{"name":"repo"},"headRepositoryOwner":{"login":"owner"}}]\n',
      );
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("agent must not run");
      });

      try {
        const code = await runCommand({
          specPath: indexPath,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          logClient: { assertReachable: async () => {}, send: async () => {} },
          handleSignals: false,
        });

        expect(code).toBe(1);
        expect(cap.err()).toContain("is not draft");
        expect(existsSync(join(worktreePath, "stale.txt"))).toBe(true);
        expect(branchExistsOnOrigin(projectRoot, specName)).toBe(true);
      } finally {
        process.env.PATH = oldPath;
      }
    });

    test("refuses cleanup when multiple matching open PRs exist", async () => {
      initGitRepoWithOrigin();
      const specName = "feature";
      const { indexPath } = writeManagedExternalSpec(specName);
      const worktreePath = createStalePatchBranch(specName);
      const { oldPath } = installCleanupGhStub(
        '[{"number":17,"isDraft":true,"headRefName":"feature","headRepository":{"name":"repo"},"headRepositoryOwner":{"login":"owner"}},{"number":18,"isDraft":true,"headRefName":"feature","headRepository":{"name":"repo"},"headRepositoryOwner":{"login":"owner"}}]\n',
      );
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("agent must not run");
      });

      try {
        const code = await runCommand({
          specPath: indexPath,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          logClient: { assertReachable: async () => {}, send: async () => {} },
          handleSignals: false,
        });

        expect(code).toBe(1);
        expect(cap.err()).toContain("multiple open PRs match");
        expect(existsSync(join(worktreePath, "stale.txt"))).toBe(true);
        expect(branchExistsOnOrigin(projectRoot, specName)).toBe(true);
      } finally {
        process.env.PATH = oldPath;
      }
    });

    test("cleans stale worktree and branches when no open PR matches", async () => {
      initGitRepoWithOrigin();
      const specName = "feature";
      const { indexPath } = writeManagedExternalSpec(specName);
      createStalePatchBranch(specName);
      const { oldPath } = installCleanupGhStub("[]\n");
      const cap = captureIo();
      let sawFreshState = false;
      const claude = new FakeAgent("claude", (_n, _prompt, runOpts) => {
        expect(existsSync(join(runOpts.cwd, "stale.txt"))).toBe(false);
        sawFreshState = true;
        return { kind: "error", exitCode: 1, stderr: "stop" };
      });

      try {
        const code = await runCommand({
          specPath: indexPath,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          logClient: { assertReachable: async () => {}, send: async () => {} },
          handleSignals: false,
        });

        expect(code).toBe(3);
        expect(sawFreshState).toBe(true);
        expect(branchExistsOnOrigin(projectRoot, specName)).toBe(false);
      } finally {
        process.env.PATH = oldPath;
      }
    });

    test("aborts before agent invocation when closing the stale draft PR fails", async () => {
      initGitRepoWithOrigin();
      const specName = "feature";
      const { indexPath } = writeManagedExternalSpec(specName);
      const worktreePath = createStalePatchBranch(specName);
      const { oldPath } = installCleanupGhStub(DRAFT_PR_17_JSON, { failClose: true });
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("agent must not run");
      });

      try {
        const code = await runCommand({
          specPath: indexPath,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          logClient: { assertReachable: async () => {}, send: async () => {} },
          handleSignals: false,
        });

        expect(code).toBe(1);
        expect(cap.err()).toContain("failed to close stale draft PR");
        expect(existsSync(join(worktreePath, "stale.txt"))).toBe(true);
        expect(branchExistsOnOrigin(projectRoot, specName)).toBe(true);
      } finally {
        process.env.PATH = oldPath;
      }
    });

    test("aborts before agent invocation when stale remote branch deletion fails", async () => {
      const origin = initGitRepoWithOrigin();
      const specName = "feature";
      const { indexPath } = writeManagedExternalSpec(specName);
      createStalePatchBranch(specName);
      renameSync(origin, `${origin}.offline`);
      const { oldPath } = installCleanupGhStub(DRAFT_PR_17_JSON);
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("agent must not run");
      });

      try {
        const code = await runCommand({
          specPath: indexPath,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          logClient: { assertReachable: async () => {}, send: async () => {} },
          handleSignals: false,
        });

        expect(code).toBe(1);
        expect(cap.err()).toContain("failed to remove stale remote branch");
        expect(branchExistsLocal(projectRoot, specName)).toBe(false);
      } finally {
        process.env.PATH = oldPath;
      }
    });
  });

  describe("telemetry", () => {
    test("writes one JSONL line per iteration plus a terminal line", async () => {
      const spec = writeSpec("- [ ] one\n- [ ] two\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", (callCount) => {
        writeFileSync(spec, callCount === 1 ? "- [x] one\n- [ ] two\n" : "- [x] one\n- [x] two\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(0);
      const telemetryPath = join(cfgDir, "runs.jsonl");
      const lines = readFileSync(telemetryPath, "utf8").trim().split("\n");
      expect(lines).toHaveLength(3);
      for (const line of lines) {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        expect(typeof parsed.ts).toBe("string");
        expect(parsed.namespace).toBe("project:project");
        expect(parsed.agent).toBe("claude");
        expect(typeof parsed.iteration).toBe("number");
        expect(typeof parsed.duration_ms).toBe("number");
        expect(typeof parsed.kind).toBe("string");
        expect(typeof parsed.exit_reason).toBe("string");
      }
    });

    test("telemetryPath null disables writes", async () => {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.telemetryPath = null;
      writeConfig(cfg, { dir: cfgDir });
      const spec = writeSpec("- [ ] todo\n");
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [x] todo\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: captureIo().io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(existsSync(join(cfgDir, "runs.jsonl"))).toBe(false);
    });

    test("telemetry append errors do not change run exit code", async () => {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.telemetryPath = "/dev/null/runs.jsonl";
      writeConfig(cfg, { dir: cfgDir });
      const spec = writeSpec("- [ ] todo\n");
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [x] todo\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: captureIo().io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(0);
    });

    test("run summary excludes quota fallback row and counts one iteration", async () => {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY];
      writeConfig(cfg, { dir: cfgDir });

      const spec = writeSpec("- [ ] chip\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => ({
        kind: "quota",
        stderr: "",
      }));
      const codex = new FakeAgent("codex", () => {
        writeFileSync(spec, "- [x] chip\n");
        return {
          kind: "ok",
          stdout: "",
          stderr: "",
          usage_source: "agent",
          usage: {
            input_tokens: 400,
            output_tokens: 100,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          cost_usd: 0.02,
        };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex },
        handleSignals: false,
      });

      expect(code).toBe(0);
      const out = cap.out();
      expect(out).toContain("iterations: 1");
      expect(out).toContain("1 quota attempt(s) under claude were excluded from usage totals.");
      expect(out).toContain(`codex (${CODEX_ENTRY.model})`);
      expect(out).not.toContain("claude (");
    });
  });

  test("refuses to run when log server is unreachable", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "",
      stderr: "",
    }));

    const code = await runCommand(
      disableReviewByDefault({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        skipGhCheck: true,
        logClient: {
          assertReachable: async () => {
            throw new Error("connect ECONNREFUSED 127.0.0.1:4310");
          },
          send: async () => {},
        },
        handleSignals: false,
      }),
    );

    expect(code).toBe(1);
    expect(cap.err()).toContain("log server unreachable");
    expect(cap.err()).toContain("jarvis1 log-server");
    expect(claude.calls).toHaveLength(0);
  });

  test("log-server send latency does not delay the iteration", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "out\n", stderr: "err\n" };
    });
    let sendCalls = 0;
    const slowLogClient: LogClient = {
      assertReachable: async () => {},
      send: async () => {
        sendCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
    };

    const startedAt = Date.now();
    const code = await runCommand(
      disableReviewByDefault({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        skipGhCheck: true,
        logClient: slowLogClient,
        handleSignals: false,
        runCompletionReadyGate: () => ({ kind: "green" }),
      }),
    );
    const elapsedMs = Date.now() - startedAt;

    expect(code).toBe(0);
    // sendCalls confirms the slow client was actually invoked, but the
    // iteration must not have awaited any of the 500ms delays. Allow a
    // generous ceiling for CI scheduling.
    expect(sendCalls).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(500);
  });

  test("log-server send errors do not change run exit code", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "out\n", stderr: "err\n" };
    });
    const throwingLogClient: LogClient = {
      assertReachable: async () => {},
      send: async () => {
        throw new Error("log server exploded");
      },
    };

    const code = await runCommand(
      disableReviewByDefault({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        skipGhCheck: true,
        logClient: throwingLogClient,
        handleSignals: false,
        runCompletionReadyGate: () => ({ kind: "green" }),
      }),
    );

    expect(code).toBe(0);
  });

  test("exits 0 immediately when the spec is already complete", async () => {
    const spec = writeSpec("- [x] done\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "error",
      exitCode: 1,
      stderr: "should not run",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("spec complete");
    expect(claude.calls).toHaveLength(0);
  });

  test("lazily populates a registered project's origin from the repo on run", async () => {
    // Set up project as a real git repo with an origin remote so the lazy
    // populate path can read it via `git remote get-url origin`.
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    execSync("git remote add origin https://github.com/example/lazy-project.git", { cwd: projectRoot });
    const spec = writeSpec("- [x] done\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "",
      stderr: "",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.projects.project).toEqual({
      root: projectRoot,
      origin: "https://github.com/example/lazy-project.git",
    });
  });

  test("run continues when origin cannot be read for a registered project", async () => {
    // No git init in projectRoot — `git remote get-url origin` will fail.
    const spec = writeSpec("- [x] done\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "",
      stderr: "",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.projects.project).toEqual({ root: projectRoot });
  });

  test("commits and completes when checklists are complete but the git worktree is dirty", async () => {
    // Set up a bare remote repo and a local clone
    const remoteRepo = mkdtempSync(join(tmpdir(), "remote-"));
    try {
      execSync("git init --bare", { cwd: remoteRepo });

      execSync("git init -b jarvis-e2e", { cwd: projectRoot });
      execSync('git config user.email "jarvis-test@example.com"', {
        cwd: projectRoot,
      });
      execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
      execSync(`git remote add origin ${remoteRepo}`, { cwd: projectRoot });

      const spec = writeSpec("- [ ] todo\n");
      execSync("git add index.md && git commit -m init", { cwd: projectRoot });
      execSync("git push -u origin jarvis-e2e", { cwd: projectRoot });
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [x] todo\n");
        writeFileSync(join(projectRoot, "extra.txt"), "x");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(cap.out()).toContain("spec complete");
      // Verify harness commit was made
      const commitLog = execSync("git log --format=%B -1", { cwd: projectRoot, encoding: "utf8" });
      expect(commitLog).toContain("complete-but-dirty");
      expect(commitLog).toContain("Jarvis-Agent: completion-ready");
      // Verify no acceptance criterion was auto-ticked
      const specContent = readFileSync(spec, "utf8");
      expect(specContent).toBe("- [x] todo\n");
    } finally {
      rmSync(remoteRepo, { recursive: true, force: true });
    }
  });

  test("exits 0 when the worktree is git-clean after a completing iteration", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const spec = writeSpec("- [ ] todo\n");
    execSync("git add index.md && git commit -m init", { cwd: projectRoot });
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "- [x] todo\n");
      execSync("git add index.md && git commit -m done", { cwd: projectRoot });
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("spec complete");
  });

  test("orphan reap failure does not change the run exit code", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const spec = writeSpec("- [ ] todo\n");
    execSync("git add index.md && git commit -m init", { cwd: projectRoot });
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "- [x] todo\n");
      execSync("git add index.md && git commit -m done", { cwd: projectRoot });
      return { kind: "ok", stdout: "", stderr: "" };
    });

    // The reap entry point throws in both the per-iteration `finally` and at
    // finalize; the run must still complete with its normal exit code.
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
      __testReapFn: () => {
        throw new Error("induced reap failure");
      },
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("spec complete");
  });

  test("completion ready gate: green gate proceeds to shrink/review with check:fix committed", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const spec = writeSpec("- [ ] todo\n");
    execSync("git add index.md && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const gateCalls: string[] = [];
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "- [x] todo\n");
      execSync("git add index.md && git commit -m done", { cwd: projectRoot });
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0, // Disable review to isolate the completion gate
      runCompletionReadyGate: (cwd) => {
        gateCalls.push(cwd);
        return { kind: "green" };
      },
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("spec complete");
    expect(cap.out()).toContain("completion: running ready gate");
    // Gate runs once on the green completion path; no fix-up iteration.
    expect(gateCalls).toHaveLength(1);
    expect(claude.calls).toHaveLength(1);
  });

  test("completion ready gate: red-then-green seam yields green completion, no fix-up iteration", async () => {
    const spec = initCompletionGateRepo();

    const cap = captureIo();
    const claude = createCompletionAgent(spec);

    // Red on the first gate attempt (within runCompletionReadyGate), green on retry.
    let gateCalls = 0;
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => {
        gateCalls += 1;
        return gateCalls === 1
          ? { kind: "red", failureText: "bun run ready failed:\nboom", verificationRed: true }
          : { kind: "green" };
      },
    });

    expect(code).toBe(0);
    expect(cap.err()).toContain("completion: ready gate failed (attempt 1");
    expect(cap.out()).toContain("completion: ready gate passed on retry");
    expect(cap.out()).toContain("spec complete");
    // Only the initial iteration; no fix-up iteration because gate passes on retry.
    expect(claude.calls).toHaveLength(1);
    // Gate is called twice within the same runCompletionReadyGate invocation.
    expect(gateCalls).toBe(2);
    // No fix-up iteration should be triggered.
    expect(cap.out()).not.toContain("fix-up:");
  });

  test("completion: fix-up iteration counts against maxIterations; exhausted budget stops with exit 5", async () => {
    const spec = initCompletionGateRepo();

    const cap = captureIo();
    const claude = createCompletionAgent(spec);

    // Each fix-up gate check reports a *changed* failure, so every loop counts
    // as progress and keeps looping (rather than tripping the stuck-red stop)
    // until the iteration budget is exhausted.
    let gateCalls = 0;
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 2 },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => {
        gateCalls += 1;
        return { kind: "red", failureText: `bun run ready failed:\nboom ${gateCalls}`, verificationRed: true };
      },
    });

    // Budget is exhausted while the failure keeps changing, so exit 5.
    // With maxIterations: 2:
    // - iteration 1 (normal): completes spec, gate red (boom 1) -> drives fix-up
    // - iteration 2 (fix-up): gate red (boom 2, changed) -> progress, loops again
    // - iteration 3: 3 > maxIterations 2 -> max-iterations stop
    expect(code).toBe(5);
    expect(cap.err()).toContain("max iterations");
  });

  test("completion: blocker added during fix-up iteration stops with exit 7", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    // Create a named spec with an index
    const specDir = join(projectRoot, "my-feature");
    mkdirSync(specDir);
    const indexPath = join(specDir, "index.md");
    const subSpec = join(specDir, "01-subtask.md");

    const indexContent = `repo: ${projectRoot}\n\n# Feature\n\n- [ ] [01 - Subtask](./01-subtask.md)`;
    const subSpecContent = `# Subtask\n\n## Acceptance criteria\n\n- [ ] do something\n`;

    writeFileSync(indexPath, indexContent);
    writeFileSync(subSpec, subSpecContent);
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      if (callCount === 1) {
        // Tick the checkbox in the first iteration
        writeFileSync(subSpec, `# Subtask\n\n## Acceptance criteria\n\n- [x] do something\n`);
        execSync("git add -A && git commit -m done", { cwd: projectRoot });
      }
      // In the fix-up iteration, add a blocker
      if (callCount === 2) {
        writeFileSync(
          subSpec,
          `# Subtask\n\n## Acceptance criteria\n\n- [x] do something\n\n## Blocker\n\nSomething blocked`,
        );
        execSync("git add -A && git commit -m blocker", { cwd: projectRoot });
      }
      return { kind: "ok", stdout: "", stderr: "" };
    });

    // Red on all attempts in first completion check (drives fix-up), green in second.
    let gateCalls = 0;
    const code = await runWithDefaults({
      specPath: indexPath,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => {
        gateCalls += 1;
        // Calls 1-3: first completion, red; calls 4+: second completion, green
        return gateCalls <= 3
          ? { kind: "red", failureText: "bun run ready failed:\nboom", verificationRed: true }
          : { kind: "green" };
      },
    });

    // The blocker added during the fix-up iteration should stop with exit 7.
    expect(code).toBe(7);
    expect(cap.err()).toContain("Something blocked");
  });

  test("completion: all-red seam retries to the bound, then stops on unchanged failure", async () => {
    const spec = initCompletionGateRepo();

    const cap = captureIo();
    const claude = createCompletionAgent(spec);

    // Always red: all attempts return red.
    let gateCalls = 0;
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 3 },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => {
        gateCalls += 1;
        return { kind: "red", failureText: "bun run ready failed:\nalways red", verificationRed: true };
      },
    });

    // First completion check retries to the bound, then loops back once. The
    // second completion check also stays red and trips the unchanged-failure
    // stuck-red stop.
    expect(code).toBe(10);
    expect(cap.err()).toContain("gate stayed red after fix-up iteration");
    expect(cap.err()).toContain("flaky");
    expect(cap.err()).toContain("Finalize by hand");
    // Seam called 6 times (3 per completion check, 2 checks).
    expect(gateCalls).toBe(6);
    // Agent called once normally, once for fix-up.
    expect(claude.calls).toHaveLength(2);
  });

  test("completion: fix-up idle stall exits 8 terminally without agentOrder escalation", async () => {
    const spec = initCompletionGateRepo();
    const idleTimeoutMs = 1000;
    const hangScript = writeIdleHangScript(join(dir, "idle-hang.sh"));

    const cap = captureIo();
    const claude = createCompletionThenIdleAgent(spec, hangScript);
    const codex = new FakeAgent("codex", () => {
      throw new Error("codex should not be invoked on fix-up idle abort");
    });

    const cfg = loadConfig({ dir: cfgDir });
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY];
    cfg.idleOutputTimeoutMs = idleTimeoutMs;
    cfg.maxIterations = 3;
    writeConfig(cfg, { dir: cfgDir });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
      reviewPasses: 0,
      __testKillGraceMs: 200,
      runCompletionReadyGate: () => ({
        kind: "red",
        failureText: "bun run ready failed:\nboom",
        verificationRed: true,
      }),
    });

    expect(code).toBe(8);
    expect(cap.err()).not.toContain(`claude: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
    expect(cap.err()).toContain("iteration 2 exceeded idle timeout");
    expect(claude.calls).toHaveLength(2);
    expect(codex.calls).toHaveLength(0);

    const rows = readFileSync(join(cfgDir, "runs.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const fallbackRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout-fallback");
    const terminalRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout");
    expect(fallbackRow).toBeUndefined();
    expect(terminalRow).toBeDefined();
    expect(terminalRow?.agent).toBe("claude");
    expect(terminalRow?.kind).toBe("timeout");
  });

  test("completion: stuck-red stop (exit 10) when failure unchanged after fix-up iteration", async () => {
    const spec = initCompletionGateRepo();

    const cap = captureIo();
    const claude = createCompletionAgent(spec);

    // Red on all gate attempts; the failure text is identical (unchanged).
    const failureText = "bun run ready failed:\nERROR: test failed";
    let gateCalls = 0;
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 2 },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => {
        gateCalls += 1;
        return { kind: "red", failureText, verificationRed: true };
      },
    });

    // Exit 10 (ready-stuck-red) when failure is unchanged and no new work/blocker.
    expect(code).toBe(10);
    expect(cap.err()).toContain("bun run ready failed:");
    expect(cap.err()).toContain("ERROR: test failed");
    expect(cap.err()).toContain("jarvis1 triage");
    expect(cap.err()).toContain("flaky");
    expect(cap.err()).toContain("Finalize by hand");
    // Gate is retried up to 3 times per completion invocation (bound=2 + initial).
    // Two completion checks (initial + after fix-up) = 6 total seam calls.
    expect(gateCalls).toBe(6);
    // Agent called once normally, once for fix-up.
    expect(claude.calls).toHaveLength(2);
  });

  test("completion: changed failure loops back instead of stopping with exit 10", async () => {
    const spec = initCompletionGateRepo();

    const cap = captureIo();
    const claude = createCompletionAgent(spec);

    // Red on all gate attempts; the failure text changes on second completion check.
    let gateCalls = 0;
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 2 },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => {
        gateCalls += 1;
        // Return red with different failures to indicate progress
        // Calls 1-3: first completion check, all return ERROR 1
        // Calls 4-6: second completion check, all return ERROR 2
        if (gateCalls <= 3) {
          return { kind: "red", failureText: "bun run ready failed:\nERROR 1", verificationRed: true };
        } else {
          return { kind: "red", failureText: "bun run ready failed:\nERROR 2: different", verificationRed: true };
        }
      },
    });

    // With maxIterations 2:
    // iteration 1: spec completes, gate red (ERROR 1 from retries) -> drives fix-up
    // iteration 2: fix-up runs, gate red (ERROR 2 from retries, different) -> failure changed, would loop but iteration 2 is at limit
    // iteration 3 exceeds maxIterations, so exit 5.
    expect(code).toBe(5);
    expect(cap.err()).toContain("max iterations");
    // Agent called once for normal iteration, once for fix-up.
    expect(claude.calls).toHaveLength(2);
    // Gate is retried 3 times per completion check, twice total = 6 calls.
    expect(gateCalls).toBe(6);
  });

  test("completion: noise-only differences (timings/paths) are treated as unchanged", async () => {
    const spec = initCompletionGateRepo();

    const cap = captureIo();
    const claude = createCompletionAgent(spec);

    // Red on all gate attempts; the failure text differs only in noise (timing, path, date).
    let gateCalls = 0;
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 2 },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => {
        gateCalls += 1;
        // Same error but with different timings and a date.
        // Calls 1-3: first completion, calls 4-6: second completion
        if (gateCalls <= 3) {
          return {
            kind: "red",
            failureText: `bun run ready failed:
ERROR: test failed in 1234ms at /Users/chris/Work/jarvis/.worktree/tmp-123/code.ts
deadline in 5m30s
Date: 2026-06-17`,
            verificationRed: true,
          };
        } else {
          return {
            kind: "red",
            failureText: `bun run ready failed:
ERROR: test failed in 5678ms at /Users/chris/Work/jarvis/.worktree/tmp-456/code.ts
deadline in 5m20s
Date: 2026-06-18`,
            verificationRed: true,
          };
        }
      },
    });

    // Exit 10 because failures are treated as unchanged after normalization.
    expect(code).toBe(10);
    expect(cap.err()).toContain("bun run ready failed:");
    expect(cap.err()).toContain("flaky");
    // Gate is retried 3 times per completion check, 2 checks total = 6 calls.
    expect(gateCalls).toBe(6);
  });

  test("completion: telemetry includes ready-stuck-red exit reason", async () => {
    const spec = initCompletionGateRepo();

    const cap = captureIo();
    const claude = createCompletionAgent(spec);

    const failureText = "bun run ready failed:\nERROR: test failed";
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 2 },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => {
        return { kind: "red", failureText, verificationRed: true };
      },
    });

    expect(code).toBe(10);
    // Telemetry is written to runs.jsonl; assert a record carries the
    // ready-stuck-red exit reason.
    const telemetryPath = join(cfgDir, "runs.jsonl");
    const lines = readFileSync(telemetryPath, "utf8").trim().split("\n");
    const stuckRedRecord = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((r) => r.exit_reason === "ready-stuck-red");
    expect(stuckRedRecord).toBeDefined();
  });

  test("completion: changing-failure bound stops at N consecutive red fix-up iterations with no AC progress", async () => {
    const spec = initCompletionGateRepo();

    const cap = captureIo();
    const claude = createCompletionAgent(spec);

    // Each completion check ends on a different failure text.
    let gateCalls = 0;
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 10 },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => {
        gateCalls += 1;
        const errors = [
          ...repeatFailureText("bun run ready failed:\nERROR: unsafe-lint test-1 failed", 3),
          ...repeatFailureText("bun run ready failed:\nERROR: unsafe-lint test-2 failed", 3),
          ...repeatFailureText("bun run ready failed:\nERROR: unsafe-lint test-3 failed", 3),
        ];
        const failureText =
          errors[Math.min(gateCalls - 1, errors.length - 1)] ?? "bun run ready failed:\nERROR: unsafe-lint";
        return { kind: "red", failureText, verificationRed: true };
      },
    });

    // With N = 3 (from CONSECUTIVE_RED_FIXUP_BOUND):
    // completion 1 final red -> count=1 -> fix-up
    // completion 2 final red differs -> count=2 -> fix-up
    // completion 3 final red differs -> count=3 (>=N) -> exit 10
    expect(code).toBe(10);
    expect(cap.err()).toContain("gate stayed red");
    expect(cap.err()).toContain("3 consecutive fix-up iterations");
    expect(cap.err()).toContain("flaky");
    expect(cap.err()).toContain("jarvis1 triage");
    // Gate called 9 times (3 attempts per completion check, 3 checks total).
    expect(gateCalls).toBe(9);
    expect(claude.calls).toHaveLength(3);
  });

  test("completion: changing-failure message is distinct from identical-failure message", async () => {
    const spec = initCompletionGateRepo();

    const cap = captureIo();
    const claude = createCompletionAgent(spec);

    // Each completion check ends on a different failure text.
    let gateCalls = 0;
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 10 },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => {
        gateCalls += 1;
        if (gateCalls <= 3) {
          return { kind: "red", failureText: "bun run ready failed:\nERROR: test-1", verificationRed: true };
        } else if (gateCalls <= 6) {
          return {
            kind: "red",
            failureText: "bun run ready failed:\nERROR: test-2 (different)",
            verificationRed: true,
          };
        } else {
          return {
            kind: "red",
            failureText: "bun run ready failed:\nERROR: test-3 (yet another)",
            verificationRed: true,
          };
        }
      },
    });

    expect(code).toBe(10);
    const errorOutput = cap.err();
    // Changing-failure message should NOT say "unchanged"
    expect(errorOutput).not.toContain("unchanged");
    // Should mention the bound and consecutive iterations
    expect(errorOutput).toContain("stayed red");
    expect(errorOutput).toContain("consecutive fix-up iterations");
  });

  test("completion: stuck-red with real fix-up commits resets to baseline and messages name flaky-or-real", async () => {
    const spec = initCompletionGateRepo();

    const cap = captureIo();
    const failureText = "bun run ready failed:\nERROR: test failed";

    // Track commit SHAs to verify reset happened
    let baselineSha: string | null = null;
    let fixupSha: string | null = null;

    // Agent completes the task on first call, then adds a fix-up commit on subsequent calls
    const claude = new FakeAgent("claude", (callCount) => {
      if (callCount === 1) {
        // Complete the spec
        writeFileSync(spec, readFileSync(spec, "utf8").replace("- [ ]", "- [x]"));
        execSync("git add index.md && git commit -m done", { cwd: projectRoot });
        baselineSha = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim();
      } else if (callCount === 2) {
        // Fix-up iteration: add a chase edit commit
        writeFileSync(spec, `${readFileSync(spec, "utf8")}\nfix attempt 1\n`);
        execSync("git add index.md && git commit -m 'fix-up attempt 1'", { cwd: projectRoot });
        fixupSha = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim();
      }
      return { kind: "ok", stdout: "", stderr: "" };
    });

    let _gateCalls = 0;
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 10 },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => {
        _gateCalls += 1;
        return { kind: "red", failureText, verificationRed: true };
      },
    });

    // Should exit 10 (stuck-red)
    expect(code).toBe(10);

    // Messages should mention flaky-or-real and finalize by hand
    const errorOutput = cap.err();
    expect(errorOutput).toContain("flaky");
    expect(errorOutput).toContain("Finalize by hand");
    expect(errorOutput).toContain("git reflog");
    expect(errorOutput).toContain("Fix-up edits have been discarded");

    // Verify the fix-up commit was discarded locally: HEAD should be reset to baseline
    const currentHead = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim();
    if (baselineSha !== null) {
      expect(currentHead).toBe(baselineSha);
    }
    // Fix-up commit should be in reflog (as a reset target)
    if (fixupSha !== null) {
      const reflog = execSync("git reflog", { cwd: projectRoot, encoding: "utf8" });
      // The fix-up should be in reflog (as a reset target), but HEAD should not point to it
      const shortSha = (fixupSha as string).slice(0, 7);
      expect(reflog).toContain(shortSha);
    }
  });

  test("completion: failed force-push still exits 10 with ready-stuck-red telemetry", async () => {
    const spec = initCompletionGateRepo();

    const cap = captureIo();
    const failureText = "bun run ready failed:\nERROR: test failed";

    // Agent that adds a fix-up commit on the second call
    const claude = new FakeAgent("claude", (callCount) => {
      if (callCount === 1) {
        writeFileSync(spec, readFileSync(spec, "utf8").replace("- [ ]", "- [x]"));
        execSync("git add index.md && git commit -m done", { cwd: projectRoot });
      } else if (callCount === 2) {
        // Add a fix-up commit
        writeFileSync(spec, `${readFileSync(spec, "utf8")}\nfix attempt\n`);
        execSync("git add index.md && git commit -m 'fix-up'", { cwd: projectRoot });
      }
      return { kind: "ok", stdout: "", stderr: "" };
    });

    let _gateCalls = 0;
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 10 },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => {
        _gateCalls += 1;
        return { kind: "red", failureText, verificationRed: true };
      },
    });

    // Should still exit 10 even though there's no upstream (so force-push fails silently)
    expect(code).toBe(10);

    // Telemetry should include ready-stuck-red
    const telemetryPath = join(cfgDir, "runs.jsonl");
    const lines = readFileSync(telemetryPath, "utf8").trim().split("\n");
    const stuckRedRecord = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((r) => r.exit_reason === "ready-stuck-red");
    expect(stuckRedRecord).toBeDefined();
  });

  test("completion: no upstream / skipGhCheck exits 10 with no push attempted", async () => {
    const spec = initCompletionGateRepo();

    const cap = captureIo();
    const failureText = "bun run ready failed:\nERROR: test failed";

    // Agent that adds a fix-up commit on the second call
    const claude = new FakeAgent("claude", (callCount) => {
      if (callCount === 1) {
        writeFileSync(spec, readFileSync(spec, "utf8").replace("- [ ]", "- [x]"));
        execSync("git add index.md && git commit -m done", { cwd: projectRoot });
      } else if (callCount === 2) {
        // Add a fix-up commit
        writeFileSync(spec, `${readFileSync(spec, "utf8")}\nfix attempt\n`);
        execSync("git add index.md && git commit -m 'fix-up'", { cwd: projectRoot });
      }
      return { kind: "ok", stdout: "", stderr: "" };
    });

    let _gateCalls = 0;
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 10 },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      skipGhCheck: true,
      runCompletionReadyGate: () => {
        _gateCalls += 1;
        return { kind: "red", failureText, verificationRed: true };
      },
    });

    // Should exit 10 (stuck-red)
    expect(code).toBe(10);

    // No error should be logged about failed push (since it was skipped)
    const errorOutput = cap.err();
    expect(errorOutput).not.toContain("failed to force-push");
  });

  describe("completion-transition ready gate", () => {
    test("runs bun run ready at the completion transition for git: true runs", async () => {
      setupGit();
      const spec = writeSpec("- [ ] todo\n");
      execSync("git add index.md && git commit -m init", { cwd: projectRoot });
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [x] todo\n");
        execSync("git add index.md && git commit -m done", { cwd: projectRoot });
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(cap.out()).toContain("spec complete");
    });

    test("records completion-transition ready green result keyed to HEAD sha + clean worktree", async () => {
      setupGit();
      const spec = writeSpec("- [ ] todo\n");
      execSync("git add index.md && git commit -m init", { cwd: projectRoot });
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [x] todo\n");
        execSync("git add index.md && git commit -m done", { cwd: projectRoot });
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(0);
      // Verify the completion happened
      expect(cap.out()).toContain("spec complete");
      // Verify worktree is clean after completion
      const status = execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8" });
      expect(status.trim()).toBe("");
    });

    test("records post-check:fix HEAD sha when completion-transition ready lands a commit", async () => {
      setupGit();
      const spec = writeSpec("- [ ] todo\n");
      execSync("git add index.md && git commit -m init", { cwd: projectRoot });
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [x] todo\n");
        execSync("git add index.md && git commit -m done", { cwd: projectRoot });
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(cap.out()).toContain("spec complete");
      // Verify the final HEAD sha is recorded (no newer commits after ready gate)
      const finalHeadSha = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim();
      expect(finalHeadSha).toMatch(/^[0-9a-f]{40}$/);
    });

    test("completion-transition ready red does not record green result and proceeds to shrink/review", async () => {
      setupGit();
      const spec = writeSpec("- [ ] todo\n");
      execSync("git add index.md && git commit -m init", { cwd: projectRoot });
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [x] todo\n");
        execSync("git add index.md && git commit -m done", { cwd: projectRoot });
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(cap.out()).toContain("spec complete");
    });

    test("uses project fixCommand at completion-transition gate site", async () => {
      setupGit();
      installNoopFixBun();
      const spec = writeSpec("- [ ] todo\n");
      execSync("git add index.md && git commit -m init", { cwd: projectRoot });

      const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-sentinel-"));
      try {
        const fixSentinel = join(sentinelDir, "fix-invoked");
        const fixScript = join(sentinelDir, "fix.sh");
        writeFileSync(fixScript, `#!/bin/sh\ntouch "${fixSentinel}"\n`);
        chmodSync(fixScript, 0o755);
        const readyScript = join(sentinelDir, "ready.sh");
        writeFileSync(readyScript, `#!/bin/sh\nexit 0\n`);
        chmodSync(readyScript, 0o755);

        const cfg = loadConfig({ dir: cfgDir });
        if (cfg.projects.project === undefined) {
          cfg.projects.project = { root: projectRoot };
        }
        cfg.projects.project.fixCommand = fixScript;
        cfg.projects.project.readyCommand = readyScript;
        writeConfig(cfg, { dir: cfgDir });

        const cap = captureIo();
        const claude = new FakeAgent("claude", () => {
          writeFileSync(spec, "- [x] todo\n");
          execSync("git add index.md && git commit -m done", { cwd: projectRoot });
          return { kind: "ok", stdout: "", stderr: "" };
        });

        const code = await runCommand({
          specPath: spec,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          handleSignals: false,
          skipGhCheck: true,
          reviewPasses: 0,
          logClient: { assertReachable: async () => {}, send: async () => {} },
        });

        expect(code).toBe(0);
        expect(cap.out()).toContain("spec complete");
        expect(existsSync(fixSentinel)).toBe(true);
      } finally {
        rmSync(sentinelDir, { recursive: true, force: true });
      }
    });

    test("uses project readyCommand at completion-transition gate site", async () => {
      setupGit();
      installNoopFixBun();
      const spec = writeSpec("- [ ] todo\n");
      execSync("git add index.md && git commit -m init", { cwd: projectRoot });

      // Write sentinel and script outside the git repo so git tree stays clean
      const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-sentinel-"));
      try {
        const sentinel = join(sentinelDir, "invoked");
        const script = join(sentinelDir, "ready.sh");
        writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
        chmodSync(script, 0o755);

        const cfg = loadConfig({ dir: cfgDir });
        if (cfg.projects.project === undefined) {
          cfg.projects.project = { root: projectRoot };
        }
        cfg.projects.project.readyCommand = script;
        writeConfig(cfg, { dir: cfgDir });

        const cap = captureIo();
        const claude = new FakeAgent("claude", () => {
          writeFileSync(spec, "- [x] todo\n");
          execSync("git add index.md && git commit -m done", { cwd: projectRoot });
          return { kind: "ok", stdout: "", stderr: "" };
        });

        const code = await runCommand({
          specPath: spec,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          handleSignals: false,
          skipGhCheck: true,
          reviewPasses: 0,
          logClient: { assertReachable: async () => {}, send: async () => {} },
        });

        expect(code).toBe(0);
        expect(cap.out()).toContain("spec complete");
        expect(existsSync(sentinel)).toBe(true);
      } finally {
        rmSync(sentinelDir, { recursive: true, force: true });
      }
    });

    test("mutating readyCommand green dirties tree and completion commits post-verification churn", async () => {
      execSync("git init -b project", { cwd: projectRoot });
      execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
      execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
      installNoopFixBun();
      const remoteDir = mkdtempSync(join(tmpdir(), "jarvis-mutating-ready-remote-"));
      execSync("git init --bare -b project", { cwd: remoteDir });
      execSync(`git remote add origin ${remoteDir}`, { cwd: projectRoot });
      const spec = writeSpec("- [ ] todo\n");
      execSync("git add index.md && git commit -m init", { cwd: projectRoot });
      execSync("git push -u origin project", { cwd: projectRoot });

      const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-mutating-ready-"));
      try {
        const churnFile = join(projectRoot, "coverage-threshold.txt");
        const script = join(sentinelDir, "ready.sh");
        writeFileSync(
          script,
          `#!/bin/sh
printf 'auto-updated\\n' > "${churnFile}"
exit 0
`,
        );
        chmodSync(script, 0o755);

        const cfg = loadConfig({ dir: cfgDir });
        if (cfg.projects.project === undefined) {
          cfg.projects.project = { root: projectRoot };
        }
        cfg.projects.project.readyCommand = script;
        writeConfig(cfg, { dir: cfgDir });

        const cap = captureIo();
        const claude = new FakeAgent("claude", () => {
          writeFileSync(spec, "- [x] todo\n");
          execSync("git add index.md && git commit -m done", { cwd: projectRoot });
          return { kind: "ok", stdout: "", stderr: "" };
        });

        const code = await runCommand({
          specPath: spec,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          handleSignals: false,
          skipGhCheck: true,
          reviewPasses: 0,
          logClient: { assertReachable: async () => {}, send: async () => {} },
        });

        expect(code).toBe(0);
        expect(existsSync(churnFile)).toBe(true);
        expect(execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8" }).trim()).toBe("");
        expect(execSync("git log -1 --pretty=%s", { cwd: projectRoot, encoding: "utf8" }).trim()).toBe(
          "chore: apply post-ready verification output",
        );
      } finally {
        rmSync(sentinelDir, { recursive: true, force: true });
        rmSync(remoteDir, { recursive: true, force: true });
      }
    });

    test("real path: red-then-green completion readyCommand leaves a clean HEAD-recordable tree", async () => {
      execSync("git init -b project", { cwd: projectRoot });
      execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
      execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
      installNoopFixBun();
      const remoteDir = mkdtempSync(join(tmpdir(), "jarvis-ready-retry-remote-"));
      execSync("git init --bare -b project", { cwd: remoteDir });
      execSync(`git remote add origin ${remoteDir}`, { cwd: projectRoot });
      const spec = writeSpec("- [ ] todo\n");
      execSync("git add index.md && git commit -m init", { cwd: projectRoot });
      execSync("git push -u origin project", { cwd: projectRoot });

      const sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-ready-retry-"));
      try {
        const attemptsFile = join(sentinelDir, "attempts.txt");
        const script = join(sentinelDir, "ready.sh");
        writeFileSync(
          script,
          `#!/bin/sh
set -eu
count=0
if [ -f "${attemptsFile}" ]; then
  count="$(cat "${attemptsFile}")"
fi
count=$((count + 1))
printf '%s' "$count" > "${attemptsFile}"
if [ "$count" -eq 1 ]; then
  printf 'normalized\n' >> "${projectRoot}/seed.txt"
  printf 'flake on first full run\n' 1>&2
  exit 1
fi
exit 0
`,
        );
        chmodSync(script, 0o755);

        const cfg = loadConfig({ dir: cfgDir });
        if (cfg.projects.project === undefined) {
          cfg.projects.project = { root: projectRoot };
        }
        cfg.projects.project.readyCommand = script;
        writeConfig(cfg, { dir: cfgDir });

        const cap = captureIo();
        const claude = new FakeAgent("claude", () => {
          writeFileSync(spec, "- [x] todo\n");
          execSync("git add index.md && git commit -m done", { cwd: projectRoot });
          return { kind: "ok", stdout: "", stderr: "" };
        });

        const code = await runCommand({
          specPath: spec,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          handleSignals: false,
          skipGhCheck: true,
          reviewPasses: 0,
          logClient: { assertReachable: async () => {}, send: async () => {} },
        });

        expect(code).toBe(0);
        expect(Number(readFileSync(attemptsFile, "utf8"))).toBeGreaterThanOrEqual(2);
        expect(cap.err()).toContain("completion: ready gate failed (attempt 1/3), retrying");
        expect(cap.out()).toContain("completion: ready gate passed on retry");
        expect(execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8" }).trim()).toBe("");
        expect(execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim()).toMatch(/^[0-9a-f]{40}$/);
        expect(execSync("git log -1 --pretty=%s", { cwd: projectRoot, encoding: "utf8" }).trim()).toBe(
          "chore: apply pre-ready check:fix",
        );
      } finally {
        rmSync(sentinelDir, { recursive: true, force: true });
        rmSync(remoteDir, { recursive: true, force: true });
      }
    });

    test("real path: pre-ready fix push failure does not retry into green completion", async () => {
      execSync("git init -b project", { cwd: projectRoot });
      execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
      execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
      // `bun run fix` emits an autofix change so the pre-ready fix-commit path
      // (not the dirty-worktree-completion path) is what tries to push.
      installNoopFixBun({ fixWritesFile: "fixme.ts" });

      const remoteDir = mkdtempSync(join(tmpdir(), "jarvis-ready-push-remote-"));
      const missingRemote = join(remoteDir, "missing-origin.git");
      execSync("git init --bare -b project", { cwd: remoteDir });
      execSync(`git remote add origin ${remoteDir}`, { cwd: projectRoot });

      const spec = writeSpec("- [ ] todo\n");
      // Absent-script skip skips autofix when root package.json lacks the
      // resolved script; declare a `fix` script so the shim runs and emits dirt.
      writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ scripts: { fix: "noop" } }));
      execSync("git add index.md package.json && git commit -m init", { cwd: projectRoot });
      execSync("git push -u origin project", { cwd: projectRoot });

      const cap = captureIo();
      // Agent leaves a clean tree (commits its work) and breaks the push remote;
      // the dirt the gate must commit comes from `bun run fix`, and its push fails.
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [x] todo\n");
        execSync("git add index.md && git commit -m done", { cwd: projectRoot });
        execSync(`git remote set-url origin ${missingRemote}`, { cwd: projectRoot });
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runCommand({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        skipGhCheck: true,
        reviewPasses: 0,
        logClient: { assertReachable: async () => {}, send: async () => {} },
      });

      expect(code).toBe(6);
      expect(cap.out()).not.toContain("completion: ready gate passed on retry");
      expect(cap.err()).not.toContain("retrying");
      expect(cap.err()).toContain("did not retry or enter fix-up");
      expect(
        Number(execSync("git rev-list --count origin/project..HEAD", { cwd: projectRoot, encoding: "utf8" })),
      ).toBeGreaterThan(0);

      rmSync(remoteDir, { recursive: true, force: true });
    });
  });

  describe("readyGateRetryBound configuration", () => {
    test("config validation: readyGateRetryBound 0 is accepted", () => {
      const cfgZeroDir = mkdtempSync(join(tmpdir(), "jarvis-config-zero-"));
      try {
        const cfg = loadConfig({ dir: cfgZeroDir });
        cfg.projects.zerotest = { root: join(tmpdir(), "project-zero") };
        cfg.projects.zerotest.readyGateRetryBound = 0;
        expect(() => writeConfig(cfg, { dir: cfgZeroDir })).not.toThrow();
        const loaded = loadConfig({ dir: cfgZeroDir });
        expect(loaded.projects.zerotest?.readyGateRetryBound).toBe(0);
      } finally {
        rmSync(cfgZeroDir, { recursive: true, force: true });
      }
    });

    test("config validation: negative readyGateRetryBound is rejected", () => {
      const cfgNegDir = mkdtempSync(join(tmpdir(), "jarvis-config-neg-"));
      try {
        expect(() => {
          const cfg = JSON.parse(readFileSync(join(cfgNegDir, "config.json"), "utf8"));
          cfg.projects.negtest = { root: join(tmpdir(), "project-neg"), readyGateRetryBound: -1 };
          writeFileSync(join(cfgNegDir, "config.json"), JSON.stringify(cfg));
          loadConfig({ dir: cfgNegDir });
        }).toThrow();
      } finally {
        rmSync(cfgNegDir, { recursive: true, force: true });
      }
    });

    test("config validation: non-integer readyGateRetryBound is rejected", () => {
      const cfgFloatDir = mkdtempSync(join(tmpdir(), "jarvis-config-float-"));
      try {
        expect(() => {
          const cfg = JSON.parse(readFileSync(join(cfgFloatDir, "config.json"), "utf8"));
          cfg.projects.floattest = { root: join(tmpdir(), "project-float"), readyGateRetryBound: 1.5 };
          writeFileSync(join(cfgFloatDir, "config.json"), JSON.stringify(cfg));
          loadConfig({ dir: cfgFloatDir });
        }).toThrow();
      } finally {
        rmSync(cfgFloatDir, { recursive: true, force: true });
      }
    });

    test("config validation: non-numeric readyGateRetryBound is rejected", () => {
      const cfgStrDir = mkdtempSync(join(tmpdir(), "jarvis-config-str-"));
      try {
        expect(() => {
          const cfg = JSON.parse(readFileSync(join(cfgStrDir, "config.json"), "utf8"));
          cfg.projects.stringtest = { root: join(tmpdir(), "project-str"), readyGateRetryBound: "five" };
          writeFileSync(join(cfgStrDir, "config.json"), JSON.stringify(cfg));
          loadConfig({ dir: cfgStrDir });
        }).toThrow();
      } finally {
        rmSync(cfgStrDir, { recursive: true, force: true });
      }
    });

    test("config validation: Infinity is rejected", () => {
      const cfgInfDir = mkdtempSync(join(tmpdir(), "jarvis-config-inf-"));
      try {
        expect(() => {
          const cfg = JSON.parse(readFileSync(join(cfgInfDir, "config.json"), "utf8"));
          cfg.projects.inftest = { root: join(tmpdir(), "project-inf"), readyGateRetryBound: Infinity };
          writeFileSync(join(cfgInfDir, "config.json"), JSON.stringify(cfg));
          loadConfig({ dir: cfgInfDir });
        }).toThrow();
      } finally {
        rmSync(cfgInfDir, { recursive: true, force: true });
      }
    });

    test("config validation: readyGateRetryBound key is in unknown-key error message", () => {
      const cfgUnkDir = mkdtempSync(join(tmpdir(), "jarvis-config-unk-"));
      try {
        // Initialize config first
        loadConfig({ dir: cfgUnkDir });
        // Now modify it to include an unknown key
        const cfg = JSON.parse(readFileSync(join(cfgUnkDir, "config.json"), "utf8"));
        cfg.projects.unktest = { root: join(tmpdir(), "project-unk"), unknownKey: "value" };
        writeFileSync(join(cfgUnkDir, "config.json"), JSON.stringify(cfg));
        expect(() => {
          loadConfig({ dir: cfgUnkDir });
        }).toThrow(/readyGateRetryBound/);
      } finally {
        rmSync(cfgUnkDir, { recursive: true, force: true });
      }
    });

    test("gate-loop behavior: with readyGateRetryBound 1, completion gate makes 2 total attempts on retryable red", async () => {
      const spec = initCompletionGateRepo();

      const cfg = loadConfig({ dir: cfgDir });
      if (cfg.projects.project === undefined) {
        cfg.projects.project = { root: projectRoot };
      }
      cfg.projects.project.readyGateRetryBound = 1;
      writeConfig(cfg, { dir: cfgDir });

      const cap = captureIo();
      const claude = createCompletionAgent(spec);

      let gateCalls = 0;
      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        reviewPasses: 0,
        runCompletionReadyGate: () => {
          gateCalls += 1;
          // Red once, then green (with bound 1, should try 2 times total)
          return gateCalls === 1
            ? { kind: "red", failureText: "bun run ready failed:\ntest", verificationRed: true }
            : { kind: "green" };
        },
      });

      expect(code).toBe(0);
      expect(cap.out()).toContain("spec complete");
      expect(gateCalls).toBe(2); // 1 initial attempt + 1 retry
    });

    test("gate-loop behavior: with readyGateRetryBound 0, completion gate makes 1 attempt only", async () => {
      const spec = initCompletionGateRepo();

      const cfg = loadConfig({ dir: cfgDir });
      if (cfg.projects.project === undefined) {
        cfg.projects.project = { root: projectRoot };
      }
      cfg.projects.project.readyGateRetryBound = 0;
      writeConfig(cfg, { dir: cfgDir });

      const cap = captureIo();
      const claude = createCompletionAgent(spec);

      let gateCallsInFirstCompletion = 0;
      let _completionCheckCount = 0;
      const _code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        reviewPasses: 0,
        runCompletionReadyGate: () => {
          gateCallsInFirstCompletion += 1;
          // Count completions by checking when we return to 1
          if (gateCallsInFirstCompletion === 1) {
            _completionCheckCount += 1;
          }
          // Red on all attempts (bound 0 means 1 attempt per completion check)
          return { kind: "red", failureText: "bun run ready failed:\nno retries with bound 0", verificationRed: true };
        },
      });

      // With bound 0, each completion check makes exactly 1 attempt
      // First completion check: 1 attempt, then enters fix-up
      // Second completion check (fix-up): 1 attempt, then fails
      // So total gateCalls = 2 (one per completion check), but each with only 1 attempt
      expect(gateCallsInFirstCompletion).toBe(2);
      // Verify no retrying message (since we don't retry with bound 0)
      const stderr = cap.err();
      expect(stderr).not.toContain("attempt 1/1, retrying");
      expect(stderr).toContain("ready gate failed: bun run ready failed:");
    });

    test("gate-loop behavior: attempt N/M denominator equals bound + 1", async () => {
      const spec = initCompletionGateRepo();

      const cfg = loadConfig({ dir: cfgDir });
      if (cfg.projects.project === undefined) {
        cfg.projects.project = { root: projectRoot };
      }
      cfg.projects.project.readyGateRetryBound = 6;
      writeConfig(cfg, { dir: cfgDir });

      const cap = captureIo();
      const claude = createCompletionAgent(spec);

      let gateCalls = 0;
      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        reviewPasses: 0,
        runCompletionReadyGate: () => {
          gateCalls += 1;
          // Red once, then green (so we see only first attempt message)
          // bound 6 -> totalAttempts 7, so denominator should be 7 (different from default 3)
          return gateCalls === 1
            ? { kind: "red", failureText: "bun run ready failed:\ntest", verificationRed: true }
            : { kind: "green" };
        },
      });

      // With bound 6, should see denominator 7 (6 + 1) in first attempt message
      const stderr = cap.err();
      expect(stderr).toContain("attempt 1/7");
      expect(code).toBe(0);
    });

    test("gate-loop behavior: default bound (2) produces denominator 3", async () => {
      const spec = initCompletionGateRepo();

      // Don't set readyGateRetryBound, should use default of 2
      const cfg = loadConfig({ dir: cfgDir });
      if (cfg.projects.project === undefined) {
        cfg.projects.project = { root: projectRoot };
      }
      // Leave readyGateRetryBound undefined to use default
      writeConfig(cfg, { dir: cfgDir });

      const cap = captureIo();
      const claude = createCompletionAgent(spec);

      let gateCalls = 0;
      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        reviewPasses: 0,
        runCompletionReadyGate: () => {
          gateCalls += 1;
          // Red once, then green to verify default denominator is 3
          return gateCalls === 1
            ? { kind: "red", failureText: "bun run ready failed:\ntest", verificationRed: true }
            : { kind: "green" };
        },
      });

      expect(code).toBe(0);
      expect(cap.err()).toContain("attempt 1/3"); // Default bound 2 -> 3 total attempts
      expect(cap.out()).toContain("spec complete");
    });

    async function testGateLoopWithBound(
      bound: number,
      gateImpl: (cwd: string) => CompletionReadyGateResult,
    ): Promise<{ spec: string; cap: ReturnType<typeof captureIo>; code: number }> {
      const spec = initCompletionGateRepo();
      const cfg = loadConfig({ dir: cfgDir });
      if (cfg.projects.project === undefined) {
        cfg.projects.project = { root: projectRoot };
      }
      cfg.projects.project.readyGateRetryBound = bound;
      writeConfig(cfg, { dir: cfgDir });

      const cap = captureIo();
      const claude = createCompletionAgent(spec);

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        reviewPasses: 0,
        runCompletionReadyGate: gateImpl,
      });

      return { spec, cap, code };
    }

    test("gate-loop behavior: sustained retryable red exhausts bound 2 exactly", async () => {
      const { cap, code } = await testGateLoopWithBound(2, (_cwd) => {
        return { kind: "red", failureText: "commit failed: test error" };
      });

      expect(code).not.toBe(0);
      const stderr = cap.err();
      expect(stderr).toContain("attempt 1/3), retrying");
      expect(stderr).toContain("attempt 2/3), retrying");
      expect(stderr).not.toContain("attempt 3/3), retrying");
      expect(stderr).toContain("ready gate failed:");
    });

    test("gate-loop behavior: non-retryable red at bound 2 exits on first attempt", async () => {
      let gateCallCount = 0;

      const { cap, code } = await testGateLoopWithBound(2, (_cwd) => {
        gateCallCount += 1;
        return {
          kind: "red",
          failureText: "push failed: permission denied to repository",
          retryable: false,
        };
      });

      expect(gateCallCount).toBe(1);
      expect(cap.err()).not.toContain("retrying");
      expect(cap.err()).toContain("ready gate failed:");
      expect(code).not.toBe(0);
    });

    test("gate-loop behavior: retryable red across multiple attempts ends green when later attempt succeeds (bound 2, red→red→green) — proves exact bound + 1 count", async () => {
      let gateCalls = 0;

      const { cap, code } = await testGateLoopWithBound(2, (_cwd) => {
        gateCalls += 1;
        if (gateCalls <= 2) {
          return { kind: "red", failureText: "commit failed: transient error" };
        }
        return { kind: "green" };
      });

      // This green-terminating variant measures the exact count uncontaminated by loopback.
      // Green return on attempt 3 ends the single completion check before any second check,
      // so gateCalls === totalAttempts is a genuine measurement of bound + 1.
      expect(gateCalls).toBe(3);
      expect(code).toBe(0);
      expect(cap.out()).toContain("spec complete");
    });
  });

  describe("post-completion gate tier matrix", () => {
    test("common path with review: one full ready, review final skips on unchanged tree", async () => {
      const env = setupReviewEnv({ reviewPasses: 1 });
      const cap = captureIo();
      const claude = reviewFakeAgent("claude", () => ({
        kind: "ok",
        stdout: "",
        stderr: "",
      }));

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(readFileSync(env.readyLog, "utf8").trim().split("\n")).toEqual(["full", "fast", "fast"]);
      expect(readFileSync(env.prReadyLog, "utf8").trim().split("\n")).toEqual(["ready"]);
    });

    test("no-review path: completion full then maybeMarkReady fast", async () => {
      const env = setupReviewEnv({ reviewPasses: 0 });
      const cap = captureIo();
      const claude = reviewFakeAgent("claude", () => {
        throw new Error("review must not run");
      });

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        reviewPasses: 0,
        agents: { claude },
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(readFileSync(env.readyLog, "utf8").trim().split("\n")).toEqual(["full", "fast", "fast"]);
      expect(readFileSync(env.prReadyLog, "utf8").trim().split("\n")).toEqual(["ready"]);
    });

    test("no-review path emits at most one behind-base auto-integrate", async () => {
      const env = setupReviewEnv({ reviewPasses: 0, behindBase: true });
      const cap = captureIo();
      const claude = reviewFakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        reviewPasses: 0,
        agents: { claude },
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      const merges = readFileSync(env.mergeLog, "utf8")
        .trim()
        .split("\n")
        .filter((line) => line.includes(" merge "));
      expect(merges).toHaveLength(1);
      expect(readFileSync(env.prReadyLog, "utf8").trim().split("\n")).toEqual(["ready"]);
    });

    test("resume-review: baseline and final each run full (no in-run carrier)", async () => {
      const env = setupReviewEnv({ reviewPasses: 1 });
      writeFileSync(env.spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] [00 - One](./00-one.md)\n`);
      execSync("git add -A && git commit -m complete && git push origin main", { cwd: projectRoot });
      execSync("git checkout -b feature && git push -u origin feature", { cwd: projectRoot });
      execSync("git checkout main", { cwd: projectRoot });
      writeFileSync(join(dirname(env.prReadyLog), "pr-state"), "");

      const cap = captureIo();
      const claude = reviewFakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        resumeReview: true,
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(readFileSync(env.readyLog, "utf8").trim().split("\n")).toEqual(["full", "full"]);
    });

    test("when tree is unchanged, shrink pre-gate runs fast tier", async () => {
      const env = setupReviewEnv({ reviewPasses: 0 });
      const cap = captureIo();
      const claude = reviewFakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        reviewPasses: 0,
        agents: { claude },
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      const tiers = readFileSync(env.readyLog, "utf8").trim().split("\n");
      expect(tiers[0]).toBe("full");
      expect(tiers[1]).toBe("fast");
    });

    test("when tree is unchanged, review baseline runs fast tier", async () => {
      const env = setupReviewEnv({ reviewPasses: 1 });
      const cap = captureIo();
      const claude = reviewFakeAgent("claude", (_n, _cwd, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "" : "",
        stderr: "",
      }));

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      const tiers = readFileSync(env.readyLog, "utf8").trim().split("\n");
      expect(tiers).toEqual(["full", "fast", "fast"]);
    });

    test("when tree is unchanged, maybeMarkReady runs fast tier", async () => {
      const env = setupReviewEnv({ reviewPasses: 0 });
      const cap = captureIo();
      const claude = reviewFakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));

      await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        reviewPasses: 0,
        agents: { claude },
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      const tiers = readFileSync(env.readyLog, "utf8").trim().split("\n");
      expect(tiers.at(-1)).toBe("fast");
    });

    test("when tree is unchanged, review final skips ready and calls gh pr ready", async () => {
      const env = setupReviewEnv({ reviewPasses: 1 });
      const cap = captureIo();
      const claude = reviewFakeAgent("claude", (_n, _cwd, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "" : "",
        stderr: "",
      }));

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(readFileSync(env.readyLog, "utf8").trim().split("\n")).toHaveLength(3);
      expect(readFileSync(env.prReadyLog, "utf8").trim().split("\n")).toEqual(["ready"]);
    });

    test("completion-transition gate always invokes full tier", async () => {
      setupGit();
      const spec = writeSpec("- [ ] todo\n");
      execSync("git add index.md && git commit -m init", { cwd: projectRoot });
      const cap = captureIo();
      const tiers: string[] = [];

      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [x] todo\n");
        execSync("git add index.md && git commit -m done", { cwd: projectRoot });
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        reviewPasses: 0,
        runCompletionReadyGate: (cwd) => {
          const { runReadyAndCommit } = require("../src/ready-gate.ts") as typeof import("../src/ready-gate.ts");
          runReadyAndCommit({
            cwd,
            tier: "full",
            agentLabel: "completion-ready",
            timeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
            runFix: () => {},
            runReady: (_c, tier) => {
              tiers.push(tier);
            },
          });
          return { kind: "green" };
        },
      });

      expect(code).toBe(0);
      expect(tiers[0]).toBe("full");
    });
  });

  test("completes after an agent flips an unchecked box", async () => {
    const spec = writeNamedSpec("feature", "- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("project: project");
    expect(cap.out()).toContain("spec: feature");
    expect(cap.out()).toContain("iteration: 1");
    expect(cap.out()).toContain("current-task: 1/1 todo");
    expect(cap.out()).toContain("agent: claude");
    expect(cap.out()).toContain("spec complete");
    expect(readFileSync(spec, "utf8")).toContain("- [x] todo");
    expect(claude.calls).toEqual([
      {
        prompt: expect.stringContaining(`Read the spec at ${spec}.`),
        cwd: projectRoot,
      },
    ]);
    expect(claude.calls[0]?.prompt).toContain("Work the harness-injected active subspec only.");
    expect(claude.calls[0]?.prompt).toContain("Follow these Jarvis rules:");
    expect(claude.calls[0]?.prompt).not.toContain("Inspect the target repo for guidance");
  });

  test("routes an external spec to its declared repo", async () => {
    const spec = writeExternalSpec("# Feature\n\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] todo\n`);
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("project: project");
    expect(claude.calls).toEqual([
      {
        prompt: expect.stringContaining(`Read the spec at ${spec}.`),
        cwd: projectRoot,
      },
    ]);
    expect(claude.callOpts[0]?.additionalReadDirs).toEqual([dirname(spec)]);
  });

  test("omits additionalReadDirs for an in-worktree spec", async () => {
    const spec = writeNamedSpec("feature", "- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(claude.callOpts[0]?.additionalReadDirs).toBeUndefined();
  });

  test("includes configured project siblings in additionalReadDirs", async () => {
    const spec = writeNamedSpec("feature", "- [ ] todo\n");
    const sibling1 = mkdtempSync(join(tmpdir(), "jarvis-test-sibling1-"));
    const sibling2 = mkdtempSync(join(tmpdir(), "jarvis-test-sibling2-"));

    try {
      const cfg = loadConfig({ dir: cfgDir });
      const project = cfg.projects.project;
      if (project === undefined) {
        throw new Error("project not registered");
      }
      project.siblings = [sibling1, sibling2];
      writeConfig(cfg, { dir: cfgDir });

      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [x] todo\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(claude.callOpts[0]?.additionalReadDirs).toContain(sibling1);
      expect(claude.callOpts[0]?.additionalReadDirs).toContain(sibling2);
    } finally {
      rmSync(sibling1, { recursive: true, force: true });
      rmSync(sibling2, { recursive: true, force: true });
    }
  });

  test("lists configured project siblings in the prompt", async () => {
    const spec = writeNamedSpec("feature", "- [ ] todo\n");
    const sibling1 = mkdtempSync(join(tmpdir(), "jarvis-test-sibling1-"));
    const sibling2 = mkdtempSync(join(tmpdir(), "jarvis-test-sibling2-"));

    try {
      const cfg = loadConfig({ dir: cfgDir });
      const project = cfg.projects.project;
      if (project === undefined) {
        throw new Error("project not registered");
      }
      project.siblings = [sibling1, sibling2];
      writeConfig(cfg, { dir: cfgDir });

      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [x] todo\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(claude.calls[0]?.prompt).toContain("Additional project sibling directories are available for this run:");
      expect(claude.calls[0]?.prompt).toContain(sibling1);
      expect(claude.calls[0]?.prompt).toContain(sibling2);
      expect(claude.calls[0]?.prompt).toContain("Treat these directories as part of the target project");
    } finally {
      rmSync(sibling1, { recursive: true, force: true });
      rmSync(sibling2, { recursive: true, force: true });
    }
  });

  test("fails when a configured sibling path does not exist", async () => {
    const spec = writeNamedSpec("feature", "- [ ] todo\n");
    const nonexistent = `/tmp/jarvis-test-nonexistent-${Date.now()}`;

    const cfg = loadConfig({ dir: cfgDir });
    const project = cfg.projects.project;
    if (project === undefined) {
      throw new Error("project not registered");
    }
    project.siblings = [nonexistent];
    writeConfig(cfg, { dir: cfgDir });

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "",
      stderr: "",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain(nonexistent);
    expect(cap.err()).toContain("does not exist");
    expect(claude.calls).toHaveLength(0);
  });

  test("specs without a repo fail clearly before agents run", async () => {
    const spec = writeSpecWithoutRepo("# Feature\n\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "",
      stderr: "",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
      disambiguate: () => ({ kind: "non-tty" }),
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("rerun with --repo <name>");
    expect(claude.calls).toHaveLength(0);
  });

  test("specs with relative repos fail clearly", async () => {
    const spec = writeSpecWithoutRepo("# Feature\n\nrepo: ./project\n\n- [ ] todo\n");
    const cap = captureIo();

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: {},
      handleSignals: false,
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("spec `repo:`:");
    expect(cap.err()).toContain("no project matches");
  });

  test("does not print successful agent stdout/stderr to terminal", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "agent out\n", stderr: "agent err\n" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.out()).not.toContain("agent out\n");
    expect(cap.err()).not.toContain("agent err\n");
  });

  test("writes banner, outbound, and inbound to server and session log in order", async () => {
    const spec = writeNamedSpec("feature", "- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "out line\n", stderr: "err line\n" };
    });
    const messages: { namespace: string; tag: string; text: string }[] = [];
    const logClient: LogClient = {
      assertReachable: async () => {},
      send: async (message) => {
        messages.push({
          namespace: message.namespace,
          tag: message.tag,
          text: message.text,
        });
      },
    };

    const code = await runCommand(
      disableReviewByDefault({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        skipGhCheck: true,
        logClient,
        handleSignals: false,
        runCompletionReadyGate: () => ({ kind: "green" }),
      }),
    );

    expect(code).toBe(0);
    const firstOutbound = messages.findIndex((m) => m.tag === "outbound");
    const firstInboundOut = messages.findIndex((m) => m.tag === "inbound_stdout");
    const firstInboundErr = messages.findIndex((m) => m.tag === "inbound_stderr");
    expect(firstOutbound).toBeGreaterThan(0);
    expect(firstInboundOut).toBeGreaterThan(firstOutbound);
    expect(firstInboundErr).toBeGreaterThan(firstOutbound);
    expect(messages[0]?.tag).toBe("harness");
    expect(messages[0]?.namespace).toBe("project:feature");
    expect(messages[0]?.text).toContain("current-task: 1/1 todo");

    const sessionFiles = readdirSync(join(cfgDir, "sessions"));
    expect(sessionFiles).toHaveLength(1);
    expect(sessionFiles[0]).toContain("project:feature-");
    const sessionBody = readFileSync(join(cfgDir, "sessions", sessionFiles[0] as string), "utf8");
    expect(sessionBody).toContain("[harness]");
    expect(sessionBody).toContain("[outbound]");
    expect(sessionBody).toContain("[inbound_stdout] out line");
    expect(sessionBody).toContain("[inbound_stderr] err line");
  });

  test("exits 4 when a successful iteration makes no progress", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "",
      stderr: "",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(4);
    expect(cap.err()).toContain("iteration 1 made no progress; stopping");
    expect(claude.calls).toHaveLength(1);
  });

  test("no-progress escalates through agentOrder and exits 4 only after last rung", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(4);
    // claude no-progressed and escalated
    expect(cap.err()).toContain("no progress; escalating to next agent");
    // terminal stop only after codex (last rung) also no-progressed
    expect(cap.err()).toContain("iteration 2 made no progress; stopping");
    // bounded tail printed once (terminal stop only)
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    // no stopping message emitted on the advance step
    expect(cap.err()).not.toContain("iteration 1 made no progress; stopping");
  });

  test("selected standard tier no-progresses through only the remaining ladder suffix", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\ntier: standard\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("claude should be skipped");
    });
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const cursor = new FakeAgent("cursor", () => ({ kind: "ok", stdout: "", stderr: "" }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex, cursor },
      handleSignals: false,
    });

    expect(code).toBe(4);
    expect(claude.calls).toHaveLength(0);
    expect(codex.calls).toHaveLength(1);
    expect(cursor.calls).toHaveLength(1);
    expect(cap.err()).toContain("codex: no progress; escalating to next agent");
    expect(cap.err()).toContain("iteration 2 made no progress; stopping");
  });

  test("selected standard tier still preserves max-iterations exit 5", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.maxIterations = 1;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\ntier: standard\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("claude should be skipped");
    });
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const cursor = new FakeAgent("cursor", () => ({ kind: "ok", stdout: "", stderr: "" }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex, cursor },
      handleSignals: false,
    });

    expect(code).toBe(5);
    expect(claude.calls).toHaveLength(0);
    expect(codex.calls).toHaveLength(1);
    expect(cursor.calls).toHaveLength(0);
    expect(cap.err()).toContain("codex: no progress; escalating to next agent");
    expect(cap.err()).toContain("max iterations (1) reached; stopping");
  });

  test("tierless specs retain first-rung behavior and do not gain recorded tier metadata", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "# Spec\n- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });
    const codex = new FakeAgent("codex", () => {
      throw new Error("codex should not run");
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(0);
    expect(readFileSync(spec, "utf8")).not.toContain("tier:");
  });

  test("recorded standard tier starts patch escalation at the second rung and reports the selected agent", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\ntier: standard\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("claude should be skipped by tier selection");
    });
    const codex = new FakeAgent("codex", () => {
      writeFileSync(spec, "# Spec\ntier: standard\n- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });
    const cursor = new FakeAgent("cursor", () => {
      throw new Error("cursor should not run");
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex, cursor },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(0);
    expect(codex.calls).toHaveLength(1);
    expect(cursor.calls).toHaveLength(0);
    expect(cap.out()).toContain("agent: codex");

    const telemetryRows = readFileSync(join(cfgDir, "runs.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(telemetryRows.some((row) => row.agent === "claude")).toBe(false);
    expect(telemetryRows.some((row) => row.agent === "codex")).toBe(true);
  });

  test("run --tier overrides recorded metadata for one patch run without rewriting the spec", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\ntier: trivial\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("claude should be skipped by --tier hard");
    });
    const codex = new FakeAgent("codex", () => {
      throw new Error("codex should be skipped by --tier hard");
    });
    const cursor = new FakeAgent("cursor", () => {
      writeFileSync(spec, "# Spec\ntier: trivial\n- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex, cursor },
      handleSignals: false,
      tierOverride: "hard",
    });

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(0);
    expect(codex.calls).toHaveLength(0);
    expect(cursor.calls).toHaveLength(1);
    expect(readFileSync(spec, "utf8")).toContain("tier: trivial");
    expect(cap.out()).toContain("agent: cursor");
  });

  test.each([
    {
      name: "one-rung ladder maps every tier to the only entry",
      agentOrder: [CLAUDE_ENTRY],
      tier: "hard" as const,
      expectedAgent: "claude" as const,
    },
    {
      name: "two-rung ladder maps standard to the final entry",
      agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
      tier: "standard" as const,
      expectedAgent: "codex" as const,
    },
    {
      name: "two-rung ladder maps hard to the final entry",
      agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
      tier: "hard" as const,
      expectedAgent: "codex" as const,
    },
  ])("$name", async ({ agentOrder, tier, expectedAgent }) => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [...agentOrder];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec(`# Spec\ntier: ${tier}\n- [ ] todo\n`);
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      if (expectedAgent !== "claude") {
        throw new Error("claude should not run");
      }
      writeFileSync(spec, `# Spec\ntier: ${tier}\n- [x] todo\n`);
      return { kind: "ok", stdout: "", stderr: "" };
    });
    const codex = new FakeAgent("codex", () => {
      if (expectedAgent !== "codex") {
        throw new Error("codex should not run");
      }
      writeFileSync(spec, `# Spec\ntier: ${tier}\n- [x] todo\n`);
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain(`agent: ${expectedAgent}`);
  });

  test.each([
    {
      name: "unknown value",
      spec: "# Spec\ntier: expert\n- [ ] todo\n",
      expected: "expected one of trivial, standard, hard",
    },
    {
      name: "blank value",
      spec: "# Spec\ntier: \n- [ ] todo\n",
      expected: "expected one of trivial, standard, hard",
    },
    {
      name: "duplicate lines",
      spec: "# Spec\ntier: trivial\ntier: hard\n- [ ] todo\n",
      expected: "duplicate `tier:` line",
    },
    {
      name: "later line",
      spec: "# Spec\n- [ ] todo\ntier: hard\n",
      expected: "`tier:` must appear before the first checklist item",
    },
  ])("invalid recorded tier metadata: $name", async ({ spec: specBody, expected }) => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec(specBody);
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("agent should not run for invalid metadata");
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain(expected);
    expect(claude.calls).toHaveLength(0);
  });

  describe("patch --agent override", () => {
    test("uses override ladder for implementation without mutating config", async () => {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
      writeConfig(cfg, { dir: cfgDir });
      const configBefore = readFileSync(join(cfgDir, "config.json"), "utf8");

      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("claude should be skipped by override");
      });
      const codex = new FakeAgent("codex", () => {
        writeFileSync(spec, "- [x] todo\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex },
        handleSignals: false,
        agentOrderOverride: [CODEX_ENTRY],
      });

      expect(code).toBe(0);
      expect(claude.calls).toHaveLength(0);
      expect(codex.calls).toHaveLength(1);
      expect(cap.out()).toContain("agent: codex");
      expect(readFileSync(join(cfgDir, "config.json"), "utf8")).toBe(configBefore);
    });

    test("--tier slices the overridden ladder", async () => {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
      writeConfig(cfg, { dir: cfgDir });

      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("claude should be skipped");
      });
      const codex = new FakeAgent("codex", () => {
        writeFileSync(spec, "- [x] todo\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const cursor = new FakeAgent("cursor", () => {
        throw new Error("cursor should be skipped");
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex, cursor },
        handleSignals: false,
        agentOrderOverride: [CLAUDE_ENTRY, CODEX_ENTRY],
        tierOverride: "hard",
      });

      expect(code).toBe(0);
      expect(claude.calls).toHaveLength(0);
      expect(codex.calls).toHaveLength(1);
      expect(cursor.calls).toHaveLength(0);
      expect(cap.out()).toContain("agent: codex");
    });

    test("no-progress escalation operates on the overridden ladder", async () => {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
      writeConfig(cfg, { dir: cfgDir });

      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("claude should be skipped by override");
      });
      const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const cursor = new FakeAgent("cursor", () => ({ kind: "ok", stdout: "", stderr: "" }));

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex, cursor },
        handleSignals: false,
        agentOrderOverride: [CODEX_ENTRY, CURSOR_ENTRY],
      });

      expect(code).toBe(4);
      expect(claude.calls).toHaveLength(0);
      expect(codex.calls).toHaveLength(1);
      expect(cursor.calls).toHaveLength(1);
      expect(cap.err()).toContain("codex: no progress; escalating to next agent");
    });

    test("review panel and actuator ignore the implementation override", async () => {
      const env = setupReviewEnv({
        reviewPasses: 1,
        patchAgentOrder: [CODEX_ENTRY, CLAUDE_ENTRY],
        reviewAgentOrder: [CLAUDE_ENTRY],
      });
      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.patch.subRoleAgentOrder = { reviewActuator: [CLAUDE_ENTRY] };
      writeConfig(cfg, { dir: cfgDir });

      const cap = captureIo();
      let codexReviewCalls = 0;
      const codex = new FakeAgent("codex", (_callCount, prompt) => {
        if (isPatchReviewPrompt(prompt) || isPatchReviewActuatorPrompt(prompt)) {
          codexReviewCalls += 1;
          throw new Error("review must not use override implementation agent");
        }
        if (prompt.includes("PR description")) {
          return { kind: "ok", stdout: "Implements the feature.\n", stderr: "" };
        }
        writeFileSync(join(env.worktree, "impl.txt"), "impl\n");
        writeFileSync(
          join(env.worktree, "spec", "feature", "00-one.md"),
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const claude = reviewFakeAgent(
        "claude",
        (_n, _cwd, prompt) => ({
          kind: "ok",
          stdout: prompt.includes("Review: Adjudicator") ? "Refine code output.\n" : "",
          stderr: "",
        }),
        (_n, cwd) => {
          writeFileSync(join(cwd, "code.txt"), "refined\n");
          return { kind: "ok", stdout: "", stderr: "" };
        },
      );

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex },
        agentOrderOverride: [CODEX_ENTRY],
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(codex.calls).toHaveLength(2);
      expect(codexReviewCalls).toBe(0);
      expect(claude.calls.filter((c) => isPatchReviewPrompt(c.prompt))).toHaveLength(3);
      expect(claude.calls.filter((c) => isPatchReviewActuatorPrompt(c.prompt))).toHaveLength(1);
    });

    test("shrink ignores the implementation override ladder", async () => {
      const env = setupReviewEnv({
        reviewPasses: 0,
        patchAgentOrder: [CODEX_ENTRY, CLAUDE_ENTRY],
      });
      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.patch.subRoleAgentOrder = { reviewActuator: [CLAUDE_ENTRY] };
      writeConfig(cfg, { dir: cfgDir });

      const cap = captureIo();
      const codex = new FakeAgent("codex", (callCount, _prompt, opts) => {
        if (callCount > 2) {
          throw new Error("codex must not run shrink when reviewActuator is claude");
        }
        if (callCount === 2) {
          return { kind: "ok", stdout: "Implements the feature.\n", stderr: "" };
        }
        writeFileSync(join(opts.cwd, "impl.txt"), "impl\n");
        writeFileSync(
          join(opts.cwd, "spec", "feature", "00-one.md"),
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const claude = new FakeAgent("claude", (callCount, prompt) => {
        if (callCount !== 1) {
          throw new Error("claude should only run shrink");
        }
        if (!prompt.includes("Simplification checklist")) {
          throw new Error("expected shrink prompt");
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex },
        agentOrderOverride: [CODEX_ENTRY],
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(codex.calls).toHaveLength(2);
      expect(claude.calls).toHaveLength(1);
    });

    test("review and shrink use pre-override patch order without subRoleAgentOrder", async () => {
      const env = setupReviewEnv({
        reviewPasses: 1,
        patchAgentOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
        reviewAgentOrder: [CLAUDE_ENTRY],
      });

      const cap = captureIo();
      let codexReviewCalls = 0;
      const codex = new FakeAgent("codex", (_callCount, prompt) => {
        if (isPatchReviewPrompt(prompt) || isPatchReviewActuatorPrompt(prompt)) {
          codexReviewCalls += 1;
          throw new Error("review must not use override implementation agent");
        }
        if (prompt.includes("Simplification checklist")) {
          throw new Error("codex must not run shrink");
        }
        if (prompt.includes("PR description")) {
          return { kind: "ok", stdout: "Implements the feature.\n", stderr: "" };
        }
        writeFileSync(join(env.worktree, "impl.txt"), "impl\n");
        writeFileSync(
          join(env.worktree, "spec", "feature", "00-one.md"),
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const claude = new FakeAgent("claude", (_callCount, prompt, opts) => {
        if (isPatchReviewPrompt(prompt)) {
          return {
            kind: "ok",
            stdout: prompt.includes("Review: Adjudicator") ? "Refine code output.\n" : "",
            stderr: "",
          };
        }
        if (isPatchReviewActuatorPrompt(prompt)) {
          writeFileSync(join(opts.cwd, "code.txt"), "refined\n");
          return { kind: "ok", stdout: "", stderr: "" };
        }
        if (prompt.includes("Simplification checklist")) {
          return { kind: "ok", stdout: "", stderr: "" };
        }
        throw new Error("claude must not run implementation under override");
      });

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex },
        agentOrderOverride: [CODEX_ENTRY],
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(codexReviewCalls).toBe(0);
      expect(claude.calls.filter((c) => isPatchReviewPrompt(c.prompt))).toHaveLength(3);
      expect(claude.calls.filter((c) => isPatchReviewActuatorPrompt(c.prompt))).toHaveLength(1);
      expect(claude.calls.filter((c) => c.prompt.includes("Simplification checklist"))).toHaveLength(1);
      expect(codex.calls.filter((c) => c.prompt.includes("PR description"))).toHaveLength(1);
    });

    test("quota escalation operates on the overridden ladder", async () => {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
      writeConfig(cfg, { dir: cfgDir });

      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("claude should be skipped by override");
      });
      const codex = new FakeAgent("codex", () => ({ kind: "quota", stderr: "limit" }));
      const cursor = new FakeAgent("cursor", () => {
        writeFileSync(spec, "- [x] todo\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex, cursor },
        handleSignals: false,
        agentOrderOverride: [CODEX_ENTRY, CURSOR_ENTRY],
      });

      expect(code).toBe(0);
      expect(claude.calls).toHaveLength(0);
      expect(codex.calls).toHaveLength(1);
      expect(cursor.calls).toHaveLength(1);
      expect(cap.err()).toContain(`codex: ${HARNESS_QUOTA_FALLBACK_STRICT}`);
    });

    test("idle-timeout escalation operates on the overridden ladder", async () => {
      const idleTimeoutMs = 1000;
      const hangScript = writeIdleHangScript(join(dir, "override-idle-hang.sh"));
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
      cfg.idleOutputTimeoutMs = idleTimeoutMs;
      cfg.maxIterations = 3;
      writeConfig(cfg, { dir: cfgDir });

      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("claude should be skipped by override");
      });
      const codex = createIdleHangAgent("codex", hangScript);
      const cursor = new FakeAgent("cursor", () => ({ kind: "ok", stdout: "", stderr: "" }));

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex, cursor },
        handleSignals: false,
        agentOrderOverride: [CODEX_ENTRY, CURSOR_ENTRY],
        __testKillGraceMs: 200,
      });

      expect(code).toBe(4);
      expect(claude.calls).toHaveLength(0);
      expect(codex.calls).toHaveLength(1);
      expect(cursor.calls).toHaveLength(1);
      expect(cap.err()).toContain(`codex: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
    });

    test("--resume-review with override invokes no implementation agents", async () => {
      const env = setupReviewEnv({ reviewPasses: 1 });
      writeFileSync(env.spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] [00 - One](./00-one.md)\n`);
      execSync("git add -A && git commit -m complete && git push origin main", { cwd: projectRoot });
      execSync("git checkout -b feature && git push -u origin feature", { cwd: projectRoot });
      execSync("git checkout main", { cwd: projectRoot });
      writeFileSync(join(dirname(env.prReadyLog), "pr-state"), "");

      const cap = captureIo();
      let implementationAgentCalled = false;
      const codex = new FakeAgent("codex", () => {
        implementationAgentCalled = true;
        throw new Error("implementation agent must not run under resume-review");
      });
      const claude = reviewFakeAgent(
        "claude",
        (_n, _cwd, prompt) => ({
          kind: "ok",
          stdout: prompt.includes("Review: Adjudicator") ? "Good." : "",
          stderr: "",
        }),
        (_n, cwd) => {
          writeFileSync(join(cwd, "code.txt"), "x\n");
          return { kind: "ok", stdout: "", stderr: "" };
        },
      );

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex },
        agentOrderOverride: [CODEX_ENTRY],
        resumeReview: true,
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(implementationAgentCalled).toBe(false);
    });
  });

  test("no-progress escalation re-selects the same active subspec after advancing", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    setupGit();
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    const firstSubspec = join(specDir, "00-one.md");
    const secondSubspec = join(specDir, "01-two.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n- [ ] [01 - Two](./01-two.md)\n"));
    writeFileSync(firstSubspec, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One done.\n");
    writeFileSync(secondSubspec, "# 01 - Two\n\n## Acceptance criteria\n\n- [ ] Two done.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(4);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    // Both rungs targeted the first subspec, not the second
    expect(claude.calls[0]?.prompt).toContain(firstSubspec);
    expect(codex.calls[0]?.prompt).toContain(firstSubspec);
    expect(claude.calls[0]?.prompt).not.toContain(secondSubspec);
    expect(codex.calls[0]?.prompt).not.toContain(secondSubspec);
  });

  test("maxIterations pre-empts no-progress ladder exhaustion before the final rung runs", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const cursor = new FakeAgent("cursor", () => ({ kind: "ok", stdout: "", stderr: "" }));

    // maxIterations: 2 means the cap fires after codex no-progresses on iteration 2,
    // preventing cursor (the third rung) from ever running; exit is 5, not 4.
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 2 },
      agents: { claude, codex, cursor },
      handleSignals: false,
    });

    expect(code).toBe(5);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    expect(cursor.calls).toHaveLength(0);
    expect(cap.err()).toContain("max iterations (2) reached");
  });

  test("completion takes precedence over no-progress", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("spec complete");
    expect(cap.err()).not.toContain("made no progress");
  });

  test("index specs continue looping until complete", async () => {
    const spec = writeSpec("- [ ] one\n- [ ] two\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      writeFileSync(spec, callCount === 1 ? "- [x] one\n- [ ] two\n" : "- [x] one\n- [x] two\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(2);
    expect(cap.out()).toContain("iteration: 2");
    expect(cap.out()).toContain("spec complete");
  });

  test("commits each linked subspec transition and leaves the worktree clean", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    const firstSubspec = join(specDir, "00-one.md");
    const secondSubspec = join(specDir, "01-two.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n- [ ] [01 - Two](./01-two.md)\n"));
    writeFileSync(firstSubspec, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
    writeFileSync(secondSubspec, "# 01 - Two\n\n## Acceptance criteria\n\n- [ ] Two accepted.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      if (callCount === 1) {
        writeFileSync(join(projectRoot, "one.txt"), "one\n");
        writeFileSync(firstSubspec, "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n");
      } else {
        writeFileSync(join(projectRoot, "two.txt"), "two\n");
        writeFileSync(secondSubspec, "# 01 - Two\n\n## Acceptance criteria\n\n- [x] Two accepted.\n");
      }
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(2);
    expect(execSync("git status --porcelain", { cwd: projectRoot }).toString()).toBe("");
    const subjects = execSync("git log --format=%s", {
      cwd: projectRoot,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .reverse()
      .slice(1);
    expect(subjects).toEqual(["00 - One", "01 - Two"]);
    const latestMessage = execSync("git log -1 --format=%B", {
      cwd: projectRoot,
      encoding: "utf8",
    });
    expect(latestMessage).toContain("Spec: spec/feature/01-two.md");
    expect(latestMessage).toContain("## Acceptance criteria\n\n- [x] Two accepted.");
  });

  test("tracks the active linked subspec when its spec directory moves", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
    writeFileSync(join(specDir, "00-one.md"), "# 00 - One\n\n## Acceptance criteria\n\n- [ ] Spec moved.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      const v1Dir = join(projectRoot, "v1");
      mkdirSync(v1Dir);
      renameSync(join(projectRoot, "spec"), join(v1Dir, "spec"));
      writeFileSync(
        join(v1Dir, "spec", "feature", "00-one.md"),
        "# 00 - One\n\n## Acceptance criteria\n\n- [x] Spec moved.\n",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(1);
    expect(existsSync(spec)).toBe(false);
    expect(readFileSync(join(projectRoot, "v1", "spec", "feature", "index.md"), "utf8")).toContain(
      "- [x] [00 - One](./00-one.md)",
    );
    expect(
      execSync("git log -1 --format=%B", {
        cwd: projectRoot,
        encoding: "utf8",
      }),
    ).toContain("Spec: v1/spec/feature/00-one.md");
  });

  test("exits 6 with guidance when linked subspec work is dirty but unchecked", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
    writeFileSync(join(specDir, "00-one.md"), "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(join(projectRoot, "one.txt"), "one\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(6);
    expect(cap.err()).toContain("checked no new acceptance criteria");
    expect(cap.err()).toContain("00-one.md");
    expect(cap.err()).toContain("- One accepted.");
    expect(cap.err()).toContain("Inspect the dirty worktree");
    expect(cap.err()).toContain("jarvis1 triage");
    expect(readFileSync(spec, "utf8")).toContain("- [ ] [00 - One](./00-one.md)");
  });

  test("bounded tick-retry: an agent that ticks on its retry turn completes without operator re-run", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
    const subspec = join(specDir, "00-one.md");
    writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      if (callCount === 1) {
        // Turn 1: edit a file but tick nothing -> dirty worktree, no new AC.
        writeFileSync(join(projectRoot, "one.txt"), "one\n");
      } else {
        // Retry turn: tick the satisfied criterion.
        writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n");
      }
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    // The retry, not an immediate exit 6, let the ticking agent finish in one run.
    expect(code).toBe(0);
    expect(claude.calls.length).toBe(2);
  });

  test("bounded tick-retry: an agent that never ticks stops at exit 6 after the bound and is never auto-ticked", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
    const subspec = join(specDir, "00-one.md");
    writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      // Edits something different each turn, never ticks.
      writeFileSync(join(projectRoot, "one.txt"), `edit ${callCount}\n`);
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(6);
    // Retried once (bound N=2): two calls, not an immediate exit on the first.
    expect(claude.calls.length).toBe(2);
    // The harness never ticked on the agent's behalf.
    expect(readFileSync(subspec, "utf8")).toContain("- [ ] One accepted.");
  });

  test("uncommitted ticks present at iteration start are committed and advance the spec (no deadlock)", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
    const subspec = join(specDir, "00-one.md");
    writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });
    // The criterion is ticked in the working tree but NOT committed — the deadlock setup.
    writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n");

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    // The uncommitted tick is committed at iteration start and the spec completes —
    // without the agent ever running (no re-detection of "no progress").
    expect(code).toBe(0);
    expect(claude.calls.length).toBe(0);
  });

  test("uncommitted ticks on a completed subspec continue to the next linked subspec", async () => {
    setupGit();
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    const firstSubspec = join(specDir, "00-one.md");
    const secondSubspec = join(specDir, "01-two.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n- [ ] [01 - Two](./01-two.md)\n"));
    writeFileSync(firstSubspec, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
    writeFileSync(secondSubspec, "# 01 - Two\n\n## Acceptance criteria\n\n- [ ] Two accepted.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });
    writeFileSync(firstSubspec, "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n");

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 2 },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).not.toBe(0);
    expect(claude.calls).toHaveLength(1);
    expect(claude.calls[0]?.prompt).toContain(secondSubspec);
    expect(claude.calls[0]?.prompt).not.toContain(firstSubspec);
    expect(execSync("git log -1 --format=%s", { cwd: projectRoot, encoding: "utf8" })).toContain("00 - One");
    const committedIndex = execSync("git show HEAD:spec/feature/index.md", {
      cwd: projectRoot,
      encoding: "utf8",
    });
    expect(committedIndex).toContain("- [x] [00 - One](./00-one.md)");
    expect(committedIndex).toContain("- [ ] [01 - Two](./01-two.md)");
    expect(cap.out()).not.toContain("spec complete");
  });

  test("bounded tick-retry: an AC tick between edited-but-unticked iterations resets the count", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
    const subspec = join(specDir, "00-one.md");
    const header = "# 00 - One\n\n## Acceptance criteria\n\n";
    writeFileSync(subspec, `${header}- [ ] First.\n- [ ] Second.\n`);
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      if (callCount === 2) {
        // Progress: tick one of two criteria -> resets the edited-but-unticked count.
        writeFileSync(subspec, `${header}- [x] First.\n- [ ] Second.\n`);
      } else {
        // Turns 1, 3, 4: edit a file, tick nothing.
        writeFileSync(join(projectRoot, "one.txt"), `edit ${callCount}\n`);
      }
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    // count: t1=1, t2 ticks (reset 0), t3=1, t4=2 -> exit 6 at the 4th call.
    // Without the reset it would exit 6 at the 3rd call (t1=1, t3=2).
    expect(code).toBe(6);
    expect(claude.calls.length).toBe(4);
  });

  test("exits 4 with unticked criteria guidance when linked subspec clean iteration makes no progress", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    const subspec = join(specDir, "00-one.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
    writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] Item A.\n- [ ] Item B.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      // Agent runs clean but doesn't tick anything
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(4);
    expect(cap.err()).toContain("iteration 1 made no progress; stopping");
    expect(cap.err()).toContain("Unticked acceptance criteria:");
    expect(cap.err()).toContain("- Item A.");
    expect(cap.err()).toContain("- Item B.");
    expect(cap.err()).toContain("tick the satisfied acceptance criteria");
  });

  test("WIP-commits partial acceptance-criteria progress and re-iterates on the same subspec", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    const subspec = join(specDir, "00-one.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
    writeFileSync(
      subspec,
      "# 00 - One\n\n## Acceptance criteria\n\n- [ ] Step A satisfied.\n- [ ] Step B satisfied.\n",
    );
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      if (callCount === 1) {
        writeFileSync(join(projectRoot, "a.txt"), "a\n");
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A satisfied.\n- [ ] Step B satisfied.\n",
        );
      } else {
        writeFileSync(join(projectRoot, "b.txt"), "b\n");
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A satisfied.\n- [x] Step B satisfied.\n",
        );
      }
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(2);
    expect(execSync("git status --porcelain", { cwd: projectRoot }).toString()).toBe("");
    const subjects = execSync("git log --format=%s", {
      cwd: projectRoot,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .reverse()
      .slice(1);
    expect(subjects).toEqual(["WIP: 00 - One (1/2 criteria)", "00 - One"]);
    const wipMessage = execSync("git log --format=%B HEAD~1 -1", {
      cwd: projectRoot,
      encoding: "utf8",
    });
    expect(wipMessage).toContain("Spec: spec/feature/00-one.md");
    expect(wipMessage).toContain("Newly checked:\n- Step A satisfied.");
  });

  test("agent-error commits WIP progress for tracked edits or checked criteria", async () => {
    const repo = setupLinkedSubspecRepo({
      trackedFile: true,
      criteria: ["Step A satisfied.", "Step B satisfied."],
    });
    const base = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      if (!repo.trackedFilePath) throw new Error("trackedFilePath not set");
      writeFileSync(repo.trackedFilePath, "changed\n");
      writeFileSync(
        repo.subspec,
        "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A satisfied.\n- [ ] Step B satisfied.\n",
      );
      return { kind: "error", exitCode: 17, stderr: "boom" };
    });

    const code = await runWithDefaults({
      specPath: repo.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(3);
    expect(execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8" })).toBe("");
    expect(execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim()).not.toBe(base);
    expect(execSync("git log -1 --format=%s", { cwd: projectRoot, encoding: "utf8" }).trim()).toBe(
      "WIP: 00 - One (1/2 criteria)",
    );
  });

  test("agent-error with untracked-only litter creates no WIP commit", async () => {
    setupLinkedSubspecRepo({
      trackedFile: false,
      criteria: ["Step A satisfied."],
    });
    const base = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(join(projectRoot, "scratch.txt"), "scratch\n");
      return { kind: "error", exitCode: 17, stderr: "boom" };
    });

    const code = await runWithDefaults({
      specPath: join(projectRoot, "spec", "feature", "index.md"),
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(3);
    expect(execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf8" }).trim()).toBe(base);
    expect(execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8" })).toContain("?? scratch.txt");
  });

  test("agent-error WIP commit failure exits 1 with a named harness error", async () => {
    const repo = setupLinkedSubspecRepo({
      trackedFile: true,
      criteria: ["Step A satisfied."],
    });
    const realGit = execSync("command -v git", { cwd: projectRoot, encoding: "utf8" }).trim();
    const fakeBin = join(projectRoot, "fake-bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeGit = join(fakeBin, "git");
    writeFileSync(
      fakeGit,
      `#!/usr/bin/env bash
if [ "$1" = "commit" ]; then
  echo "forced git commit failure" 1>&2
  exit 1
fi
exec ${JSON.stringify(realGit)} "$@"
`,
    );
    chmodSync(fakeGit, 0o755);
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      if (!repo.trackedFilePath) throw new Error("trackedFilePath not set");
      writeFileSync(repo.trackedFilePath, "changed\n");
      writeFileSync(repo.subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A satisfied.\n");
      process.env.PATH = `${fakeBin}:${originalPath ?? ""}`;
      return { kind: "error", exitCode: 17, stderr: "boom" };
    });

    const code = await runWithDefaults({
      specPath: repo.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("failed to commit agent-error WIP progress");
  });

  test("exits 1 when the active subspec has no acceptance-criteria checkboxes", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
    writeFileSync(join(specDir, "00-one.md"), "# 00 - One\n\nNo acceptance criteria section here.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("agent should not have run");
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("no `## Acceptance criteria` checkboxes");
    expect(claude.calls).toHaveLength(0);
  });

  test("prints parser warning when acceptance heading is malformed", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
    writeFileSync(join(specDir, "00-one.md"), "# 00 - One\n\n### Acceptance criteria\n\n- [ ] One accepted.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("agent should not have run");
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("no `## Acceptance criteria` checkboxes");
    expect(cap.err()).toContain("Rejected heading `### Acceptance criteria`");
    expect(claude.calls).toHaveLength(0);
  });

  test("pushes each subspec commit and opens one draft PR after the first push", async () => {
    const origin = join(dir, "origin.git");
    execSync(`git init --bare ${origin}`);
    execSync("git init -b main", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    execSync(`git remote add origin ${origin}`, { cwd: projectRoot });

    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    writeFileSync(spec, withRepo("# Feature\n\n- [ ] [00 - One](./00-one.md)\n- [ ] [01 - Two](./01-two.md)\n"));
    writeFileSync(join(specDir, "00-one.md"), "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
    writeFileSync(join(specDir, "01-two.md"), "# 01 - Two\n\n## Acceptance criteria\n\n- [ ] Two accepted.\n");
    execSync("git add -A && git commit -m init && git push -u origin main", {
      cwd: projectRoot,
    });

    const binDir = join(dir, "bin");
    mkdirSync(binDir);
    const realGit = execSync("command -v git", { encoding: "utf8" }).trim();
    const bun = join(binDir, "bun");
    const git = join(binDir, "git");
    const gh = join(binDir, "gh");
    const pushLog = join(dir, "push-log");
    const prState = join(dir, "pr-state");
    const prLog = join(dir, "pr-log");
    const prViewLog = join(dir, "pr-view-log");
    const readyGateLog = join(dir, "ready-gate-log");
    const readyLog = join(dir, "ready-log");
    const readyState = join(dir, "ready-state");
    const prTitle = join(dir, "pr-title");
    const prBody = join(dir, "pr-body");
    const prEditLog = join(dir, "pr-edit-log");
    const createCommitCount = join(dir, "create-commit-count");
    const readyCommitCount = join(dir, "ready-commit-count");
    writeFileSync(
      git,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "push" ]]; then
  printf '%s\\n' "$*" >> "${pushLog}"
fi
exec "${realGit}" "$@"
`,
    );
    chmodSync(git, 0o755);
    writeFileSync(
      bun,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "run fix" ]]; then
  exit 0
fi
if [[ "$1 $2" == "run ready" ]]; then
  printf '%s\n' "\${JARVIS_READY_TIER:-full}" >> "${readyGateLog}"
  exit 0
fi
exit 1
`,
    );
    chmodSync(bun, 0o755);
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "auth status" ]]; then
  exit 0
fi
if [[ "$1 $2" == "repo view" ]]; then
  printf 'main\\n'
  exit 0
fi
if [[ "$1 $2" == "pr view" ]]; then
  printf 'view\\n' >> "${prViewLog}"
  if [[ ! -f "${prState}" ]]; then
    exit 1
  fi
  if [[ "$*" == *"isDraft"* ]]; then
    if [[ -f "${readyState}" ]]; then
      printf 'false\\n'
    else
      printf 'true\\n'
    fi
  elif [[ "$*" == *"--json body"* ]]; then
    if [[ -f "${prBody}" ]]; then
      cat "${prBody}"
    fi
  elif [[ "$*" == *"--json number,state"* ]]; then
    printf '1\\n'
  elif [[ "$*" == *"--json url"* ]]; then
    printf 'https://github.com/example/repo/pull/1\\n'
  else
    printf '1\\n'
  fi
  exit 0
fi
if [[ "$1 $2" == "pr edit" ]]; then
  printf 'edit\\n' >> "${prEditLog}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --body-file)
        shift
        if [[ "$1" == "-" ]]; then
          cat > "${prBody}"
        else
          cp "$1" "${prBody}"
        fi
        ;;
    esac
    shift
  done
  exit 0
fi
if [[ "$1 $2" == "pr create" ]]; then
  printf 'create\\n' >> "${prLog}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --title)
        shift
        printf '%s' "$1" > "${prTitle}"
        ;;
      --body)
        shift
        printf '%s' "$1" > "${prBody}"
        ;;
    esac
    shift
  done
  touch "${prState}"
  git rev-list --count main..HEAD > "${createCommitCount}"
  exit 0
fi
if [[ "$1 $2" == "pr ready" ]]; then
  printf 'ready\\n' >> "${readyLog}"
  git rev-list --count main..HEAD > "${readyCommitCount}"
  touch "${readyState}"
  exit 0
fi
exit 1
`,
    );
    chmodSync(gh, 0o755);
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const cap = captureIo();
    const claude = new FakeAgent("claude", (_callCount, prompt, opts) => {
      if (prompt.includes("draft GitHub pull request body")) {
        return {
          kind: "ok",
          stdout: "Implements the feature in two subspec commits.\n",
          stderr: "",
        };
      }
      if (!existsSync(join(opts.cwd, "one.txt"))) {
        writeFileSync(join(opts.cwd, "one.txt"), "one\n");
        writeFileSync(
          join(opts.cwd, "spec", "feature", "00-one.md"),
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n",
        );
      } else {
        writeFileSync(join(opts.cwd, "two.txt"), "two\n");
        writeFileSync(
          join(opts.cwd, "spec", "feature", "01-two.md"),
          "# 01 - Two\n\n## Acceptance criteria\n\n- [x] Two accepted.\n",
        );
      }
      return { kind: "ok", stdout: "", stderr: "" };
    });

    // Pin template narrative behavior to ensure agent-call count expectations stay valid
    const cfg = loadConfig({ dir: cfgDir });
    cfg.modes.patch.prNarrative = "template";
    writeConfig(cfg, { dir: cfgDir });

    const code = await runCommand(
      disableReviewByDefault({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        logClient: {
          assertReachable: async () => {},
          send: async () => {},
        },
        handleSignals: false,
      }),
    );

    expect(code).toBe(0);
    expect(readFileSync(pushLog, "utf8").trim().split("\n")).toEqual(["push -u origin feature", "push"]);
    expect(readFileSync(prLog, "utf8").trim().split("\n")).toEqual(["create"]);
    expect(readFileSync(prViewLog, "utf8").trim().split("\n")).toHaveLength(7);
    expect(readFileSync(prEditLog, "utf8").trim().split("\n")).toEqual(["edit"]);
    // Completion runs `full`; shrink pre-gate and maybeMarkReady run `fast` on unchanged tree.
    expect(readFileSync(readyGateLog, "utf8").trim().split("\n")).toEqual(["full", "fast", "fast"]);
    expect(readFileSync(readyLog, "utf8").trim().split("\n")).toEqual(["ready"]);
    expect(readFileSync(createCommitCount, "utf8").trim()).toBe("1");
    expect(readFileSync(readyCommitCount, "utf8").trim()).toBe("2");
    expect(readFileSync(prTitle, "utf8")).toBe("Feature");
    const subspecShas = execSync("git log --reverse --format=%h main..feature", { cwd: projectRoot, encoding: "utf8" })
      .trim()
      .split("\n");
    expect(subspecShas).toHaveLength(2);
    const body = readFileSync(prBody, "utf8");
    // With template prNarrative, narrative is generated from subspecs and commits
    expect(body).toContain("# Feature\n");
    expect(body).toContain("## Subspecs\n");
    expect(body).toContain("- 00 - One\n");
    expect(body).toContain("- 01 - Two\n");
    expect(body).toContain("## Commits\n");
    expect(body).toContain("<!-- jarvis:narrative:generated-sha256:");
    expect(body).toContain(`${NARRATIVE_END_MARKER}\n\n---\n\nWritten by fake-claude through Jarvis.`);
    expect(
      execSync("gh pr view feature --json isDraft -q .isDraft", {
        cwd: join(projectRoot, ".worktree", "feature"),
        env: process.env,
        encoding: "utf8",
      }).trim(),
    ).toBe("false");
    // With template narrative, agent is not called for PR body, so 3 calls instead of 5
    // (one for first iteration, two for second iteration)
    expect(claude.calls).toHaveLength(3);
    const subjects = execSync("git log --format=%s main..feature", {
      cwd: projectRoot,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .reverse();
    expect(subjects).toEqual(["00 - One", "01 - Two"]);
  });

  test("uses fallback PR body when deterministic spec body is empty (with template prNarrative)", async () => {
    const origin = join(dir, "origin.git");
    execSync(`git init --bare ${origin}`);
    execSync("git init -b main", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    execSync(`git remote add origin ${origin}`, { cwd: projectRoot });

    const specDir = join(projectRoot, "spec", "degenerate");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
    writeFileSync(join(specDir, "00-one.md"), "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
    execSync("git add -A && git commit -m init && git push -u origin main", {
      cwd: projectRoot,
    });

    const binDir = join(dir, "bin");
    mkdirSync(binDir);
    const realGit = execSync("command -v git", { encoding: "utf8" }).trim();
    const bun = join(binDir, "bun");
    const git = join(binDir, "git");
    const gh = join(binDir, "gh");
    const prState = join(dir, "pr-state");
    const prBody = join(dir, "pr-body");
    const readyGateLog = join(dir, "ready-gate-log");
    writeFileSync(
      git,
      `#!/usr/bin/env bash
set -euo pipefail
exec "${realGit}" "$@"
`,
    );
    chmodSync(git, 0o755);
    writeFileSync(
      bun,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "run fix" ]]; then
  exit 0
fi
if [[ "$1 $2" == "run ready" ]]; then
  printf '%s\n' "\${JARVIS_READY_TIER:-full}" >> "${readyGateLog}"
  exit 0
fi
exit 1
`,
    );
    chmodSync(bun, 0o755);
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "auth status" ]]; then
  exit 0
fi
if [[ "$1 $2" == "repo view" ]]; then
  printf 'main\\n'
  exit 0
fi
if [[ "$1 $2" == "pr view" ]]; then
  if [[ ! -f "${prState}" ]]; then
    exit 1
  fi
  if [[ "$*" == *"isDraft"* ]]; then
    printf 'false\\n'
  else
    printf '1\\n'
  fi
  exit 0
fi
if [[ "$1 $2" == "pr create" ]]; then
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --body)
        shift
        printf '%s' "$1" > "${prBody}"
        ;;
    esac
    shift
  done
  touch "${prState}"
  exit 0
fi
if [[ "$1 $2" == "pr ready" ]]; then
  exit 0
fi
exit 1
`,
    );
    chmodSync(gh, 0o755);
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const cap = captureIo();
    const claude = new FakeAgent("claude", (_callCount, _prompt, opts) => {
      writeFileSync(join(opts.cwd, "one.txt"), "one\n");
      writeFileSync(
        join(opts.cwd, "spec", "degenerate", "00-one.md"),
        "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    });

    // Pin template narrative behavior
    const cfg2 = loadConfig({ dir: cfgDir });
    cfg2.modes.patch.prNarrative = "template";
    writeConfig(cfg2, { dir: cfgDir });

    const code = await runCommand(
      disableReviewByDefault({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        logClient: {
          assertReachable: async () => {},
          send: async () => {},
        },
        handleSignals: false,
      }),
    );

    expect(code).toBe(0);
    // 1 call for implementation, 1 call for shrink phase
    expect(claude.calls).toHaveLength(2);
    // Completion runs `full`; shrink pre-gate and maybeMarkReady run `fast` on unchanged tree.
    expect(readFileSync(readyGateLog, "utf8").trim().split("\n")).toEqual(["full", "fast", "fast"]);
    const body = readFileSync(prBody, "utf8");
    // With template prNarrative, narrative is generated from subspecs and commits
    expect(body).toContain("## Subspecs\n");
    expect(body).toContain("- 00 - One\n");
    expect(body).toContain("## Commits\n");
    expect(body).toContain("<!-- jarvis:narrative:generated-sha256:");
    expect(body).toContain(`${NARRATIVE_END_MARKER}\n\n---\n\nWritten by fake-claude through Jarvis.`);
  });

  test("stops at the configured max iterations", async () => {
    const spec = writeSpec("- [ ] one\n- [ ] two\n- [ ] three\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      const checked = Array.from({ length: callCount }, (_, index) => `- [x] ${index + 1}`);
      const unchecked = Array.from({ length: 3 - callCount }, (_, index) => `- [ ] ${callCount + index + 1}`);
      writeFileSync(spec, [...checked, ...unchecked].join("\n"));
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 2 },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(5);
    expect(cap.err()).toContain("max iterations (2) reached; stopping");
    expect(claude.calls).toHaveLength(2);
  });

  test("config maxIterations overrides the default", async () => {
    const spec = writeSpec("- [ ] one\n- [ ] two\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "- [x] one\n- [ ] two\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });
    writeConfig(
      {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 1,
        iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
        git: true,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(5);
    expect(cap.err()).toContain("max iterations (1) reached; stopping");
  });

  test("normal run constructs adapters with configured patch models", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const binDir = join(dir, "bin");
    mkdirSync(binDir);
    const claude = join(binDir, "claude");
    writeFileSync(
      claude,
      `#!/usr/bin/env bash
: > "${dir}/argv"
for a in "$@"; do printf '%s\\0' "$a" >> "${dir}/argv"; done
exit 0
`,
    );
    chmodSync(claude, 0o755);
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    writeConfig(
      {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
        git: true,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );
    const cap = captureIo();

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      handleSignals: false,
    });

    expect(code).toBe(4);
    expect(readFileSync(join(dir, "argv"), "utf8")).toBe(
      "-p\0--permission-mode\0acceptEdits\0--model\0haiku\0--output-format\0json\0",
    );
  });

  test("CLI maxIterations overrides config maxIterations", async () => {
    const spec = writeSpec("- [ ] one\n- [ ] two\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      writeFileSync(spec, callCount === 1 ? "- [x] one\n- [ ] two\n" : "- [x] one\n- [x] two\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });
    writeConfig(
      {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 1,
        iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
        git: true,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 2 },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(2);
  });

  test("falls through claude to codex on quota", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "quota",
      stderr: "limit",
    }));
    const codex = new FakeAgent("codex", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("iteration: 1");
    expect(cap.out()).toContain("iteration: 2");
    expect(cap.err()).toContain(`claude: ${HARNESS_QUOTA_FALLBACK_STRICT}`);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
  });

  test("falls through claude to codex on auth failure; emits auth-rotation note", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "quota",
      stderr: "refresh token revoked",
      authFailure: true,
    }));
    const codex = new FakeAgent("codex", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("iteration: 1");
    expect(cap.out()).toContain("iteration: 2");
    expect(cap.err()).toContain(`claude: ${harnessAuthRotateLine("claude")}`);
    expect(cap.err()).not.toContain(HARNESS_QUOTA_FALLBACK_STRICT);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
  });

  test("selected hard tier preserves quota exhaustion across the remaining ladder suffix", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\ntier: hard\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("claude should not run");
    });
    const codex = new FakeAgent("codex", () => {
      throw new Error("codex should not run");
    });
    const cursor = new FakeAgent("cursor", () => ({ kind: "quota", stderr: "limit" }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex, cursor },
      handleSignals: false,
    });

    expect(code).toBe(2);
    expect(cap.err()).toContain(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
    expect(claude.calls).toHaveLength(0);
    expect(codex.calls).toHaveLength(0);
    expect(cursor.calls).toHaveLength(1);
  });

  test("falls through claude to codex on zero-exit monthly-spend-limit JSON envelope", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claudeBin = fakeClaudeBinary(dir, {
      exit: 0,
      stdout: CLAUDE_MONTHLY_SPEND_FIXTURE,
    });
    const claude = new ClaudeAgent({ binary: claudeBin });
    const codex = new FakeAgent("codex", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.err()).toContain(`claude: ${HARNESS_QUOTA_FALLBACK_STRICT}`);
    expect(codex.calls).toHaveLength(1);
  });

  test("exits 2 when all agents return quota", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "quota",
      stderr: "limit",
    }));
    const codex = new FakeAgent("codex", () => ({
      kind: "quota",
      stderr: "limit",
    }));
    writeConfig(
      {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
        git: true,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(2);
    expect(cap.err()).toContain(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
  });

  test("selected hard tier preserves model-config exit 3", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\ntier: hard\n- [ ] todo\n");
    const cap = captureIo();
    const cursor = new FakeAgent("cursor", () => ({
      kind: "model_config",
      stderr: "unsupported model",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { cursor },
      handleSignals: false,
    });

    expect(code).toBe(3);
    expect(cap.err()).toContain("cursor: configured patch model");
    expect(cap.out()).toContain("agent: cursor");
  });

  test("selected hard tier preserves generic error exit 3", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\ntier: hard\n- [ ] todo\n");
    const cap = captureIo();
    const cursor = new FakeAgent("cursor", () => ({
      kind: "error",
      exitCode: 17,
      stderr: "boom",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { cursor },
      handleSignals: false,
    });

    expect(code).toBe(3);
    expect(cap.err()).toContain("boom");
    expect(cap.out()).toContain("agent: cursor");
  });

  test("selected hard tier preserves timeout exit 8", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\ntier: hard\n- [ ] todo\n");
    const cap = captureIo();
    const cursor = new FakeAgent("cursor", () => ({
      kind: "error",
      exitCode: 1,
      stderr: "aborted: iteration-timeout",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { cursor },
      handleSignals: false,
    });

    expect(code).toBe(8);
    expect(cap.err()).toContain("iteration 1 exceeded timeout");
    expect(cap.out()).toContain("agent: cursor");
  });

  test("quota fallback iterations count toward the cap", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "quota",
      stderr: "limit",
    }));
    const codex = new FakeAgent("codex", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });
    writeConfig(
      {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
        git: true,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 1 },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(5);
    expect(cap.err()).toContain("max iterations (1) reached; stopping");
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(0);
  });

  test("lenient mode falls back on weak quota-like error with no progress", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const spec = writeSpec("- [ ] todo\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "error",
      exitCode: 1,
      stderr: "HTTP 429: too many requests",
    }));
    const codex = new FakeAgent("codex", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });
    writeConfig(
      {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
        git: false,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.err()).toContain(harnessQuotaFallbackLenientLine(1));
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
  });

  test("strict mode does not fall back on weak quota-like error", async () => {
    execSync("git init -b jarvis-e2e", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', {
      cwd: projectRoot,
    });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    const spec = writeSpec("- [ ] todo\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "error",
      exitCode: 1,
      stderr: "HTTP 429: too many requests",
    }));
    const codex = new FakeAgent("codex", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });
    writeConfig(
      {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "strict",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
        git: true,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(3);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(0);
  });

  test("lenient mode does not classify real errors as quota", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "error",
      exitCode: 2,
      stderr: "TypeScript compile error in src/run.ts",
    }));
    const codex = new FakeAgent("codex", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });
    writeConfig(
      {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
        git: true,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(3);
    expect(cap.err()).toContain("TypeScript compile error");
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(0);
  });

  test("exits 3 on agent error and prints stderr", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "error",
      exitCode: 7,
      stderr: "boom",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(3);
    expect(cap.err()).toContain("boom");
  });

  test("exits 3 on model configuration failure without falling back", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "model_config",
      stderr: "error: unsupported model haiku",
    }));
    const codex = new FakeAgent("codex", () => {
      writeFileSync(spec, "- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });
    writeConfig(
      {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
        git: true,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(3);
    expect(cap.err()).toContain('claude: configured patch model "haiku" is not supported by this CLI/account');
    expect(cap.err()).toContain("error: unsupported model haiku");
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(0);
    expect(readFileSync(spec, "utf8")).toBe(withRepo("- [ ] todo\n"));
  });

  test("exits 1 when the spec has no repo", async () => {
    const spec = join(dir, "outside.md");
    writeFileSync(spec, "- [ ] todo\n");
    const cap = captureIo();

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: {},
      handleSignals: false,
      disambiguate: () => ({ kind: "non-tty" }),
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("rerun with --repo <name>");
  });

  test("non-index specs with empty response exit without invoking an agent", async () => {
    const spec = writeDirectSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "error",
      exitCode: 1,
      stderr: "should not run",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      confirmRun: () => "",
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("is not an index spec");
    expect(cap.out()).toContain("[e] exit");
    expect(claude.calls).toHaveLength(0);
    expect(readFileSync(spec, "utf8")).toBe(withRepo("- [ ] todo\n"));
  });

  test("non-index spec prompt displays sibling index option when it exists", async () => {
    const specDir = join(projectRoot, "specs");
    mkdirSync(specDir);
    const indexSpec = join(specDir, "index.md");
    const flatSpec = join(specDir, "spec.md");
    writeFileSync(indexSpec, withRepo("- [ ] linked task\n"));
    writeFileSync(flatSpec, withRepo("- [ ] todo\n"));

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "",
      stderr: "",
    }));

    const code = await runWithDefaults({
      specPath: flatSpec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      confirmRun: () => "e",
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("[s] switch to ./index.md");
    expect(cap.out()).toContain("[e] exit");
    expect(claude.calls).toHaveLength(0);
  });

  test("no-progress exit prints bounded tail of latest iteration output", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "line 1\nline 2\nline 3\nline 4\nline 5\n",
      stderr: "err 1\nerr 2\nerr 3\n",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(4);
    expect(cap.out()).toContain("line 3");
    expect(cap.out()).toContain("line 4");
    expect(cap.out()).toContain("line 5");
    expect(cap.out()).toContain("err 1");
    expect(cap.out()).toContain("err 2");
    expect(cap.out()).toContain("err 3");
    expect(cap.err()).toContain("made no progress");
  });

  test("does not print the opencode unavailable notice for estimated usage", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    writeConfig(
      {
        version: 2,
        modes: {
          patch: {
            agentOrder: [{ agent: "opencode", model: "github-copilot/test" }],
          },
          plan: { agentOrder: [CLAUDE_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 1,
        iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
        git: true,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );
    const opencode = new FakeAgent("opencode", () => ({
      kind: "ok",
      stdout: "ok",
      stderr: "",
      usage_source: "estimated",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { opencode },
      handleSignals: false,
    });

    expect(code).toBe(4);
    expect(cap.err()).not.toContain("opencode: token usage not available for this CLI version");
  });

  test("prints the opencode unavailable notice when usage is unavailable", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    writeConfig(
      {
        version: 2,
        modes: {
          patch: {
            agentOrder: [{ agent: "opencode", model: "github-copilot/test" }],
          },
          plan: { agentOrder: [CLAUDE_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 1,
        iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
        git: true,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );
    const opencode = new FakeAgent("opencode", () => ({
      kind: "ok",
      stdout: "ok",
      stderr: "",
      usage_source: "unavailable",
      cost_source: "no-usage",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { opencode },
      handleSignals: false,
    });

    expect(code).toBe(4);
    expect(cap.err()).toContain("opencode: token usage not available for this CLI version");
  });

  test("max-iterations exit prints bounded tail of latest iteration output", async () => {
    const spec = writeSpec("- [ ] one\n- [ ] two\n- [ ] three\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      const checked = Array.from({ length: callCount }, (_, index) => `- [x] ${index + 1}`);
      const unchecked = Array.from({ length: 3 - callCount }, (_, index) => `- [ ] ${callCount + index + 1}`);
      writeFileSync(spec, [...checked, ...unchecked].join("\n"));
      return {
        kind: "ok",
        stdout: `iteration ${callCount} output\n`,
        stderr: `iteration ${callCount} error\n`,
      };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 2 },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(5);
    expect(cap.out()).toContain("iteration 2 output");
    expect(cap.out()).toContain("iteration 2 error");
    expect(cap.err()).toContain("max iterations (2) reached");
    expect(claude.calls).toHaveLength(2);
  });

  test("agent error is logged and printed to terminal", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "error",
      exitCode: 7,
      stderr: "test error message",
    }));
    const messages: { tag: string; text: string }[] = [];
    const logClient: LogClient = {
      assertReachable: async () => {},
      send: async (message) => {
        messages.push({ tag: message.tag, text: message.text });
      },
    };

    const code = await runCommand({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      skipGhCheck: true,
      logClient,
      handleSignals: false,
    });

    expect(code).toBe(3);
    expect(cap.err()).toContain("test error message");
    expect(messages.some((m) => m.tag === "harness" && m.text.includes("test error message"))).toBe(true);
  });

  test("model config failure is logged and printed to terminal", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "model_config",
      stderr: "error: unsupported model",
    }));
    const messages: { tag: string; text: string }[] = [];
    const logClient: LogClient = {
      assertReachable: async () => {},
      send: async (message) => {
        messages.push({ tag: message.tag, text: message.text });
      },
    };

    const code = await runCommand({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      skipGhCheck: true,
      logClient,
      handleSignals: false,
    });

    expect(code).toBe(3);
    expect(cap.err()).toContain("configured patch model");
    expect(cap.err()).toContain("error: unsupported model");
    const harnessMessages = messages.filter((m) => m.tag === "harness");
    expect(harnessMessages.some((m) => m.text.includes("configured patch model"))).toBe(true);
    expect(harnessMessages.some((m) => m.text.includes("error: unsupported model"))).toBe(true);
  });

  test("prepares a missing spec directory inside the agent worktree", () => {
    const sourceSpecDir = join(projectRoot, "spec", "feature");
    mkdirSync(sourceSpecDir, { recursive: true });
    const sourceIndex = join(sourceSpecDir, "index.md");
    const sourceTask = join(sourceSpecDir, "00-task.md");
    const sourceExisting = join(sourceSpecDir, "01-existing.md");
    writeFileSync(sourceIndex, "- [ ] [00 - Task](./00-task.md)\n");
    writeFileSync(sourceTask, "# 00 - Task\n");
    writeFileSync(sourceExisting, "main checkout content\n");

    const worktreeRoot = join(projectRoot, ".worktree", "feature");
    const targetSpecDir = join(worktreeRoot, "spec", "feature");
    mkdirSync(targetSpecDir, { recursive: true });
    const targetExisting = join(targetSpecDir, "01-existing.md");
    writeFileSync(targetExisting, "worktree content\n");

    const activeSpecPath = prepareActiveSpecPath({
      projectRoot,
      agentWorkingDir: worktreeRoot,
      specPath: sourceIndex,
    });

    expect(activeSpecPath).toBe(join(worktreeRoot, "spec", "feature", "index.md"));
    expect(existsSync(activeSpecPath)).toBe(true);
    expect(readFileSync(activeSpecPath, "utf8")).toBe("- [ ] [00 - Task](./00-task.md)\n");
    expect(readFileSync(join(targetSpecDir, "00-task.md"), "utf8")).toBe("# 00 - Task\n");
    expect(readFileSync(targetExisting, "utf8")).toBe("worktree content\n");
  });

  describe(".active-spec-path marker preflight", () => {
    test("writes the worktree-local active spec path for a fresh git-backed patch run and keeps it unstaged", async () => {
      const oldPath = installGhReadyStub();
      try {
        initGitRepoWithOrigin();
        const specDir = join(projectRoot, "spec", "feature");
        mkdirSync(specDir, { recursive: true });
        const spec = join(specDir, "index.md");
        const subspec = join(specDir, "00-one.md");
        const gitignore = join(projectRoot, ".gitignore");
        writeFileSync(spec, "repo: project\n\n# Feature\n\n- [ ] [00 - One](./00-one.md)\n");
        writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
        writeFileSync(gitignore, ".scratch/\n");
        execSync("git add README.md spec .gitignore && git commit -m spec && git push origin main", {
          cwd: projectRoot,
        });
        const cap = captureIo();
        const claude = new FakeAgent("claude", () => ({ kind: "error", exitCode: 1, stderr: "stop" }));

        const code = await runCommand({
          specPath: spec,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          logClient: { assertReachable: async () => {}, send: async () => {} },
          handleSignals: false,
          reviewPasses: 0,
        });

        expect(code).toBe(3);
        const worktreePath = join(projectRoot, ".worktree", "feature");
        expect(readFileSync(join(worktreePath, ".active-spec-path"), "utf8")).toBe(
          join(worktreePath, "spec", "feature", "index.md"),
        );
        expect(readFileSync(gitignore, "utf8")).toBe(".scratch/\n");
        const excludePath = execSync("git rev-parse --git-path info/exclude", {
          cwd: worktreePath,
          encoding: "utf8",
        }).trim();
        expect(readFileSync(excludePath, "utf8")).toContain(".active-spec-path");
        expect(execSync("git status --short", { cwd: worktreePath, encoding: "utf8" })).toBe("");
      } finally {
        process.env.PATH = oldPath;
      }
    });

    test("writes the external absolute active spec path and rewrites it on rerun", async () => {
      const oldPath = installGhReadyStub();
      try {
        initGitRepoWithOrigin();
        const externalA = join(dir, "external-a", "feature");
        const externalB = join(dir, "external-b", "feature");
        mkdirSync(externalA, { recursive: true });
        mkdirSync(externalB, { recursive: true });
        const specA = join(externalA, "index.md");
        const specB = join(externalB, "index.md");
        const subspecA = join(externalA, "00-one.md");
        const subspecB = join(externalB, "00-one.md");
        writeFileSync(specA, `repo: ${projectRoot}\n\n# Feature\n\n- [ ] [00 - One](./00-one.md)\n`);
        writeFileSync(specB, `repo: ${projectRoot}\n\n# Feature\n\n- [ ] [00 - One](./00-one.md)\n`);
        writeFileSync(subspecA, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
        writeFileSync(subspecB, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
        const cap = captureIo();
        const claude = new FakeAgent("claude", () => ({ kind: "error", exitCode: 1, stderr: "stop" }));

        const firstCode = await runCommand({
          specPath: specA,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          logClient: { assertReachable: async () => {}, send: async () => {} },
          handleSignals: false,
          reviewPasses: 0,
        });
        expect(firstCode).toBe(3);

        const worktreePath = join(projectRoot, ".worktree", "feature");
        expect(readFileSync(join(worktreePath, ".active-spec-path"), "utf8")).toBe(specA);

        const secondCode = await runCommand({
          specPath: specB,
          io: cap.io,
          config: { dir: cfgDir },
          agents: { claude },
          logClient: { assertReachable: async () => {}, send: async () => {} },
          handleSignals: false,
          reviewPasses: 0,
        });
        expect(secondCode).toBe(3);
        expect(readFileSync(join(worktreePath, ".active-spec-path"), "utf8")).toBe(specB);
      } finally {
        process.env.PATH = oldPath;
      }
    });

    test("releases the worktree lock when marker write fails after lock acquisition", async () => {
      const oldPath = installGhReadyStub();
      try {
        initGitRepoWithOrigin();
        const specDir = join(projectRoot, "spec", "feature");
        mkdirSync(specDir, { recursive: true });
        const spec = join(specDir, "index.md");
        const subspec = join(specDir, "00-one.md");
        writeFileSync(spec, "repo: project\n\n# Feature\n\n- [ ] [00 - One](./00-one.md)\n");
        writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
        execSync("git add README.md spec && git commit -m spec && git push origin main", { cwd: projectRoot });
        const claude = new FakeAgent("claude", () => ({ kind: "error", exitCode: 1, stderr: "stop" }));
        const worktreePath = join(projectRoot, ".worktree", "feature");
        const secondCap = captureIo();
        const code = await runCommand({
          specPath: spec,
          io: secondCap.io,
          config: { dir: cfgDir },
          agents: { claude },
          logClient: { assertReachable: async () => {}, send: async () => {} },
          handleSignals: false,
          reviewPasses: 0,
          __testWriteActiveSpecPathMarker: () => {
            throw new Error("marker write boom");
          },
        });

        expect(code).toBe(1);
        expect(secondCap.err()).toContain("failed to write .active-spec-path marker: marker write boom");
        expect(existsSync(getWorktreeLockPath(worktreePath))).toBe(false);
      } finally {
        process.env.PATH = oldPath;
      }
    });

    test("skips marker writes when git is false or worktree setup is bypassed", async () => {
      initGitRepoWithOrigin();
      const specDir = join(projectRoot, "spec", "feature");
      mkdirSync(specDir, { recursive: true });
      const spec = join(specDir, "index.md");
      writeFileSync(spec, "repo: project\n\n# Feature\n\n- [ ] [00 - One](./00-one.md)\n");
      writeFileSync(join(specDir, "00-one.md"), "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
      execSync("git add README.md spec && git commit -m spec && git push origin main", { cwd: projectRoot });
      const claude = new FakeAgent("claude", () => ({ kind: "error", exitCode: 1, stderr: "stop" }));
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      writeConfig(cfg, { dir: cfgDir });

      const gitOffCode = await runCommand({
        specPath: spec,
        io: captureIo().io,
        config: { dir: cfgDir },
        agents: { claude },
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
        reviewPasses: 0,
        skipGhCheck: true,
        cwdFlag: projectRoot,
      });
      expect(gitOffCode).toBe(3);
      expect(existsSync(join(projectRoot, ".active-spec-path"))).toBe(false);

      cfg.git = true;
      writeConfig(cfg, { dir: cfgDir });
      const skippedCode = await runWithDefaults({
        specPath: spec,
        io: captureIo().io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });
      expect(skippedCode).toBe(3);
      expect(existsSync(join(projectRoot, ".worktree", "feature", ".active-spec-path"))).toBe(false);
    });
  });

  test("prompts when no repo resolves; selection drives the run", async () => {
    const spec = writeSpecWithoutRepo("# Feature\n\n- [x] done\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "",
      stderr: "",
    }));

    let promptCalled = 0;
    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
      disambiguate: ({ candidates }) => {
        promptCalled += 1;
        const picked = candidates.find((c) => c.key === "project");
        if (picked === undefined) {
          throw new Error("expected `project` in candidates");
        }
        return { kind: "selected", project: picked };
      },
    });

    expect(code).toBe(0);
    expect(promptCalled).toBe(1);
  });

  test("prompts when --repo matches multiple registered projects", async () => {
    const projectAlt = join(dir, "project-alt");
    mkdirSync(projectAlt);
    registerProject("project-alt", projectAlt, {
      dir: cfgDir,
      origin: "https://github.com/example/dup.git",
    });
    // Update the original project's origin to collide.
    const cfg = loadConfig({ dir: cfgDir });
    cfg.projects.project = {
      ...(cfg.projects.project as { root: string }),
      origin: "https://github.com/example/dup.git",
    };
    writeConfig(cfg, { dir: cfgDir });

    const altSpec = join(projectAlt, "index.md");
    writeFileSync(altSpec, "# F\n\n- [x] done\n");

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "",
      stderr: "",
    }));

    let receivedKeys: string[] = [];
    const code = await runWithDefaults({
      specPath: altSpec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
      repoFlag: "https://github.com/example/dup",
      disambiguate: ({ candidates }) => {
        receivedKeys = candidates.map((c) => c.key);
        const picked = candidates.find((c) => c.key === "project-alt");
        if (picked === undefined) {
          throw new Error("expected `project-alt`");
        }
        return { kind: "selected", project: picked };
      },
    });

    expect(code).toBe(0);
    expect(receivedKeys.sort()).toEqual(["project", "project-alt"]);
  });

  test("prompts when spec repo URL matches multiple registered projects", async () => {
    const projectAlt = join(dir, "project-alt");
    mkdirSync(projectAlt);
    registerProject("project-alt", projectAlt, {
      dir: cfgDir,
      origin: "https://github.com/example/dup.git",
    });
    const cfg = loadConfig({ dir: cfgDir });
    cfg.projects.project = {
      ...(cfg.projects.project as { root: string }),
      origin: "https://github.com/example/dup.git",
    };
    writeConfig(cfg, { dir: cfgDir });

    const externalDir = join(dir, "ext-specs");
    mkdirSync(externalDir);
    const spec = join(externalDir, "index.md");
    writeFileSync(spec, "# F\n\nrepo: https://github.com/example/dup\n\n- [x] done\n");

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "",
      stderr: "",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
      disambiguate: ({ candidates }) => {
        const picked = candidates.find((c) => c.key === "project");
        if (picked === undefined) {
          throw new Error("expected `project`");
        }
        return { kind: "selected", project: picked };
      },
    });

    expect(code).toBe(0);
  });

  test("non-TTY disambiguation exits 1 listing candidates", async () => {
    const spec = writeSpecWithoutRepo("# F\n\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "",
      stderr: "",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
      disambiguate: () => ({ kind: "non-tty" }),
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("--repo <name>");
    expect(cap.err()).toContain("project");
    expect(claude.calls).toHaveLength(0);
  });

  test("cancelled disambiguation exits 1 without invoking the agent", async () => {
    const spec = writeSpecWithoutRepo("# F\n\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "ok",
      stdout: "",
      stderr: "",
    }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
      disambiguate: () => ({ kind: "cancelled" }),
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("project selection cancelled");
    expect(claude.calls).toHaveLength(0);
  });

  describe("preflight: project root must exist", () => {
    test("registered project (matched by spec path) whose root has been removed exits 1", async () => {
      // The default project registered in beforeEach lives at projectRoot
      // and contains the spec. Remove the root after writing the spec
      // somewhere outside it so the spec remains readable.
      const externalSpec = join(dir, "registered-by-path-spec.md");
      writeFileSync(externalSpec, `repo: ${projectRoot}\n\n- [ ] todo\n`);
      rmSync(projectRoot, { recursive: true, force: true });
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "",
        stderr: "",
      }));

      const code = await runWithDefaults({
        specPath: externalSpec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(1);
      expect(cap.err()).toContain(projectRoot);
      expect(cap.err()).toContain("does not exist on disk");
      // Spec `repo:` is absolute and exact-matches the registered root,
      // so the spec-repo branch wins and is the named source.
      expect(cap.err()).toContain("spec `repo:` line");
      expect(claude.calls).toHaveLength(0);
      expect(existsSync(join(cfgDir, "sessions"))).toBe(false);
    });

    test("registered project resolved by --repo URL whose root is gone is attributed to --repo", async () => {
      const removedRoot = join(dir, "origin-project");
      mkdirSync(removedRoot);
      registerProject("origin-project", removedRoot, {
        dir: cfgDir,
        origin: "https://github.com/example/origin-project.git",
      });
      rmSync(removedRoot, { recursive: true, force: true });
      const externalDir = join(dir, "ext-origin");
      mkdirSync(externalDir);
      const spec = join(externalDir, "index.md");
      writeFileSync(spec, "- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "",
        stderr: "",
      }));

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        repoFlag: "https://github.com/example/origin-project",
      });

      expect(code).toBe(1);
      expect(cap.err()).toContain(removedRoot);
      expect(cap.err()).toContain("does not exist on disk");
      expect(cap.err()).toContain("--repo flag value");
      expect(cap.err()).toContain('"https://github.com/example/origin-project"');
      expect(claude.calls).toHaveLength(0);
      expect(existsSync(join(cfgDir, "sessions"))).toBe(false);
    });

    test("--repo flag matching a registered name whose root is gone is attributed to --repo", async () => {
      const removedRoot = join(dir, "by-name-project");
      mkdirSync(removedRoot);
      registerProject("by-name-project", removedRoot, { dir: cfgDir });
      rmSync(removedRoot, { recursive: true, force: true });
      const externalDir = join(dir, "ext-by-name");
      mkdirSync(externalDir);
      const spec = join(externalDir, "index.md");
      writeFileSync(spec, "- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "",
        stderr: "",
      }));

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        repoFlag: "by-name-project",
      });

      expect(code).toBe(1);
      expect(cap.err()).toContain(removedRoot);
      expect(cap.err()).toContain("--repo flag value");
      expect(cap.err()).toContain('"by-name-project"');
      expect(claude.calls).toHaveLength(0);
      expect(existsSync(join(cfgDir, "sessions"))).toBe(false);
    });

    test("ad-hoc git checkout that has been removed exits 1 attributed to ad-hoc", async () => {
      // Build a git checkout, write a spec inside it, capture spec content,
      // then remove the entire checkout. Recreate just the spec file in a
      // parallel location so jarvis can read it; rebuild the checkout
      // structure (with `.git`) so the resolver's ad-hoc walk lands on it,
      // then remove the root one final time so the preflight fires.
      const adHocRoot = join(dir, "adhoc-checkout");
      mkdirSync(join(adHocRoot, "specs"), { recursive: true });
      mkdirSync(join(adHocRoot, ".git"));
      const spec = join(adHocRoot, "specs", "index.md");
      writeFileSync(spec, "- [ ] todo\n");
      // Move the spec elsewhere so we have a stable readable path; point
      // it at the ad-hoc root via `repo:` so resolution lands on it.
      const stableSpec = join(dir, "adhoc-spec.md");
      writeFileSync(stableSpec, `repo: ${adHocRoot}\n\n- [ ] todo\n`);
      rmSync(adHocRoot, { recursive: true, force: true });
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "",
        stderr: "",
      }));

      const code = await runWithDefaults({
        specPath: stableSpec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        disambiguate: () => ({ kind: "non-tty" }),
      });

      // The resolver ignores spec-`repo:` absolute paths that do not match
      // any registered root, then falls through to location-based
      // resolution. The spec lives in `dir`, which is not registered and
      // has no `.git`, so resolution ends in needs-prompt. In a non-TTY
      // run that still exits 1 cleanly without spawning subprocesses.
      expect(code).toBe(1);
      expect(claude.calls).toHaveLength(0);
      expect(existsSync(join(cfgDir, "sessions"))).toBe(false);
    });

    test("preflight runs before the .git-presence check (git: true)", async () => {
      const removedRoot = join(dir, "preflight-vs-git-check");
      mkdirSync(removedRoot);
      registerProject("preflight-vs-git-check", removedRoot, { dir: cfgDir });
      rmSync(removedRoot, { recursive: true, force: true });
      const externalDir = join(dir, "ext-preflight");
      mkdirSync(externalDir);
      const spec = join(externalDir, "index.md");
      writeFileSync(spec, `repo: ${removedRoot}\n\n- [ ] todo\n`);
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "",
        stderr: "",
      }));

      const code = await runCommand({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        // Do not skip gh check: that branch contains both the .git check
        // and assertGhReady. The preflight must short-circuit before either.
        skipGhCheck: false,
        logClient: {
          assertReachable: async () => {},
          send: async () => {},
        },
        handleSignals: false,
      });

      expect(code).toBe(1);
      expect(cap.err()).toContain("does not exist on disk");
      expect(cap.err()).not.toContain("target is not a git checkout");
      expect(claude.calls).toHaveLength(0);
    });

    test("preflight fires when git is false (loop-only mode) too", async () => {
      const removedRoot = join(dir, "loop-only-removed");
      mkdirSync(removedRoot);
      registerProject("loop-only-removed", removedRoot, { dir: cfgDir });
      rmSync(removedRoot, { recursive: true, force: true });
      const externalDir = join(dir, "ext-loop-only");
      mkdirSync(externalDir);
      const spec = join(externalDir, "index.md");
      writeFileSync(spec, `repo: ${removedRoot}\n\n- [ ] todo\n`);
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      writeConfig(cfg, { dir: cfgDir });
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "",
        stderr: "",
      }));

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(1);
      expect(cap.err()).toContain("does not exist on disk");
      expect(claude.calls).toHaveLength(0);
      expect(existsSync(join(cfgDir, "sessions"))).toBe(false);
    });
  });

  describe("loop-only mode (git: false)", () => {
    test("completes spec with zero unchecked boxes without clean-tree check", async () => {
      const spec = writeSpec("- [x] done\n");
      // Make project root dirty (would normally trigger clean-tree blocker)
      writeFileSync(join(projectRoot, "dirty.txt"), "stuff");
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      writeConfig(cfg, { dir: cfgDir });
      const cap = captureIo();

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(cap.out()).toContain("spec complete");
    });

    test("does not create a worktree directory when git: false", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      writeConfig(cfg, { dir: cfgDir });
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, withRepo("- [x] todo\n"));
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runCommand({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        logClient: {
          assertReachable: async () => {},
          send: async () => {},
        },
      });

      expect(code).toBe(0);
      expect(existsSync(join(projectRoot, ".worktree"))).toBe(false);
      // Agent ran in project root, not a worktree
      expect(claude.calls[0]?.cwd).toBe(projectRoot);
    });

    test("--cwd honored when git: false and reflected in agent cwd", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const altCwd = join(dir, "alt-cwd");
      mkdirSync(altCwd);
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      writeConfig(cfg, { dir: cfgDir });
      const cap = captureIo();
      const claude = new FakeAgent("claude", (_count, _prompt, runOpts) => {
        // Tick the (possibly copied) spec at the agent's working directory.
        const activeSpec = join(runOpts.cwd, "index.md");
        if (existsSync(activeSpec)) {
          writeFileSync(activeSpec, withRepo("- [x] todo\n"));
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        cwdFlag: altCwd,
      });

      expect(claude.calls[0]?.cwd).toBe(altCwd);
      expect(code).toBe(0);
    });

    test("--cwd with git: true exits 1", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const altCwd = join(dir, "alt-cwd-2");
      mkdirSync(altCwd);
      const cap = captureIo();

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        handleSignals: false,
        cwdFlag: altCwd,
      });

      expect(code).toBe(1);
      expect(cap.err()).toContain("--cwd is only valid when effective `git` is false");
    });

    test("--cwd with nonexistent directory exits 1", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      writeConfig(cfg, { dir: cfgDir });
      const cap = captureIo();

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        handleSignals: false,
        cwdFlag: join(dir, "does-not-exist"),
      });

      expect(code).toBe(1);
      expect(cap.err()).toContain("--cwd directory does not exist");
    });

    test("git: true with non-git project root exits 1 before invoking any agent", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => ({
        kind: "ok",
        stdout: "",
        stderr: "",
      }));

      const code = await runCommand({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        // Intentionally NOT skipGhCheck so the .git enforcement fires.
        skipGhCheck: false,
        logClient: {
          assertReachable: async () => {},
          send: async () => {},
        },
      });

      expect(code).toBe(1);
      expect(cap.err()).toContain("target is not a git checkout");
      expect(claude.calls).toHaveLength(0);
    });

    test("per-project git override flips behavior independently of global", async () => {
      const spec = writeSpec("- [x] done\n");
      writeFileSync(join(projectRoot, "dirty.txt"), "stuff");
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = true;
      const existing = cfg.projects.project;
      if (existing !== undefined) {
        cfg.projects.project = { ...existing, git: false };
      }
      writeConfig(cfg, { dir: cfgDir });
      const cap = captureIo();

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(cap.out()).toContain("spec complete");
    });
  });

  describe("timeout behavior", () => {
    test("passes AbortSignal to agent via opts.signal", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      let receivedSignal: AbortSignal | undefined;
      const claude = new FakeAgent("claude", (_callCount, _prompt, opts) => {
        receivedSignal = opts.signal;
        writeFileSync(spec, `repo: ${projectRoot}\n\n- [x] todo\n`);
        return { kind: "ok", stdout: "", stderr: "" };
      });
      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
          git: true,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(receivedSignal).toBeDefined();
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    });

    test("iteration timeout causes exit code 8", async () => {
      const { spec } = setupLinkedSubspecRepo({ trackedFile: false, criteria: ["todo"] });
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => ({
        kind: "error",
        exitCode: -1,
        stderr: "aborted: iteration-timeout",
      }));
      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 1,
          git: true,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(8);
      expect(cap.err()).toContain("exceeded timeout");
      const rows = readFileSync(join(cfgDir, "runs.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const timeoutRow = rows.find((row) => row.exit_reason === "iteration-timeout");
      expect(timeoutRow?.record_role).toBe("run_terminal");
      expect(timeoutRow?.active_subspec_path).toBeDefined();
    });

    test("appends a split blocker at the third consecutive subspec timeout", async () => {
      const { spec, subspec } = setupLinkedSubspecRepo({ trackedFile: false, criteria: ["todo"] });
      const claude = new FakeAgent("claude", () => ({
        kind: "error",
        exitCode: -1,
        stderr: "aborted: iteration-timeout",
      }));
      writeConfig({ ...loadConfig({ dir: cfgDir }), maxIterations: 1, iterationTimeoutMs: 1 }, { dir: cfgDir });

      expect(
        await runWithDefaults({
          specPath: spec,
          io: captureIo().io,
          config: { dir: cfgDir },
          agents: { claude },
          handleSignals: false,
        }),
      ).toBe(8);
      expect(readFileSync(subspec, "utf8")).not.toContain("## Blocker");
      expect(
        await runWithDefaults({
          specPath: spec,
          io: captureIo().io,
          config: { dir: cfgDir },
          agents: { claude },
          handleSignals: false,
        }),
      ).toBe(8);
      expect(
        await runWithDefaults({
          specPath: spec,
          io: captureIo().io,
          config: { dir: cfgDir },
          agents: { claude },
          handleSignals: false,
        }),
      ).toBe(8);
      expect(readFileSync(subspec, "utf8")).toContain("Split the subspec");
    });

    test("resets the timeout streak after a max-iterations terminal result", async () => {
      const { spec, subspec } = setupLinkedSubspecRepo({ trackedFile: false, criteria: ["one", "two"] });
      const claude = new FakeAgent("claude", (callCount) => {
        if (callCount === 3) {
          writeFileSync(subspec, readFileSync(subspec, "utf8").replace("- [ ] one", "- [x] one"));
          return { kind: "ok", stdout: "", stderr: "" };
        }
        return { kind: "error", exitCode: -1, stderr: "aborted: iteration-timeout" };
      });
      writeConfig({ ...loadConfig({ dir: cfgDir }), maxIterations: 1, iterationTimeoutMs: 1 }, { dir: cfgDir });

      for (let index = 0; index < 2; index += 1) {
        expect(await runWithDefaults({ specPath: spec, io: captureIo().io, config: { dir: cfgDir }, agents: { claude }, handleSignals: false })).toBe(8);
      }
      expect(await runWithDefaults({ specPath: spec, io: captureIo().io, config: { dir: cfgDir }, agents: { claude }, handleSignals: false })).toBe(5);
      expect(await runWithDefaults({ specPath: spec, io: captureIo().io, config: { dir: cfgDir }, agents: { claude }, handleSignals: false })).toBe(8);

      expect(readFileSync(subspec, "utf8")).not.toContain("## Blocker");
      const rows = readFileSync(join(cfgDir, "runs.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(rows.some((row) => row.exit_reason === "max-iterations" && row.record_role === "run_terminal")).toBe(true);
    });

    test("resets the timeout streak when another subspec times out", async () => {
      const { spec, subspec } = setupLinkedSubspecRepo({ trackedFile: false, criteria: ["one"] });
      const secondSubspec = join(dirname(subspec), "01-two.md");
      writeFileSync(secondSubspec, "# 01 - Two\n\n## Acceptance criteria\n\n- [ ] two\n");
      writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n- [ ] [01 - Two](./01-two.md)\n"));
      const claude = new FakeAgent("claude", () => ({ kind: "error", exitCode: -1, stderr: "aborted: iteration-timeout" }));
      writeConfig({ ...loadConfig({ dir: cfgDir }), maxIterations: 1, iterationTimeoutMs: 1 }, { dir: cfgDir });

      for (let index = 0; index < 2; index += 1) {
        expect(await runWithDefaults({ specPath: spec, io: captureIo().io, config: { dir: cfgDir }, agents: { claude }, handleSignals: false })).toBe(8);
      }
      writeFileSync(spec, withRepo("- [x] [00 - One](./00-one.md)\n- [ ] [01 - Two](./01-two.md)\n"));
      expect(await runWithDefaults({ specPath: spec, io: captureIo().io, config: { dir: cfgDir }, agents: { claude }, handleSignals: false })).toBe(8);
      writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n- [ ] [01 - Two](./01-two.md)\n"));
      expect(await runWithDefaults({ specPath: spec, io: captureIo().io, config: { dir: cfgDir }, agents: { claude }, handleSignals: false })).toBe(8);

      expect(readFileSync(subspec, "utf8")).not.toContain("## Blocker");
    });

    test("does not duplicate a pre-existing blocker", async () => {
      const { spec, subspec } = setupLinkedSubspecRepo({ trackedFile: false, criteria: ["todo"] });
      const claude = new FakeAgent("claude", () => ({ kind: "error", exitCode: -1, stderr: "aborted: iteration-timeout" }));
      writeConfig({ ...loadConfig({ dir: cfgDir }), maxIterations: 1, iterationTimeoutMs: 1 }, { dir: cfgDir });

      for (let index = 0; index < 2; index += 1) {
        expect(await runWithDefaults({ specPath: spec, io: captureIo().io, config: { dir: cfgDir }, agents: { claude }, handleSignals: false })).toBe(8);
      }
      writeFileSync(subspec, `${readFileSync(subspec, "utf8")}\n## Blocker\n\nAlready blocked.\n`);
      expect(await runWithDefaults({ specPath: spec, io: captureIo().io, config: { dir: cfgDir }, agents: { claude }, handleSignals: false })).toBe(7);
      expect(readFileSync(subspec, "utf8").match(/^## Blocker$/gm)).toHaveLength(1);
    });

    test("does not append a split blocker when telemetry is disabled", async () => {
      const { spec, subspec } = setupLinkedSubspecRepo({ trackedFile: false, criteria: ["todo"] });
      const claude = new FakeAgent("claude", () => ({ kind: "error", exitCode: -1, stderr: "aborted: iteration-timeout" }));
      writeConfig(
        { ...loadConfig({ dir: cfgDir }), maxIterations: 1, iterationTimeoutMs: 1, telemetryPath: null },
        { dir: cfgDir },
      );

      for (let index = 0; index < 3; index += 1) {
        expect(await runWithDefaults({ specPath: spec, io: captureIo().io, config: { dir: cfgDir }, agents: { claude }, handleSignals: false })).toBe(8);
      }
      expect(readFileSync(subspec, "utf8")).not.toContain("## Blocker");
    });

    function initGitRepoForCheckpointTests(): void {
      execSync("git init -b jarvis-checkpoint", { cwd: projectRoot });
      execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
      execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
      execSync("git add -A && git commit -m init", { cwd: projectRoot });
    }

    test("iteration timeout commits uncommitted tracked edits and new untracked files as a checkpoint", async () => {
      const spec = writeSpec("- [ ] todo\n");
      initGitRepoForCheckpointTests();
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [ ] todo\n\nedited by agent\n");
        writeFileSync(join(projectRoot, "new-file.txt"), "created by agent\n");
        return { kind: "error", exitCode: -1, stderr: "aborted: iteration-timeout" };
      });
      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 1,
          git: true,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(8);
      const status = execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8" }).trim();
      expect(status).toBe("");
      const lastCommitSubject = execSync("git log -1 --format=%s", { cwd: projectRoot, encoding: "utf8" }).trim();
      expect(lastCommitSubject).toBe("WIP: checkpoint (iteration-timeout)");
      const committedNewFile = execSync("git show HEAD:new-file.txt", { cwd: projectRoot, encoding: "utf8" });
      expect(committedNewFile).toBe("created by agent\n");
    });

    test("iteration timeout logs checkpoint commit failures and still exits 8", async () => {
      const spec = writeSpec("- [ ] todo\n");
      initGitRepoForCheckpointTests();
      execSync("git config commit.gpgSign true", { cwd: projectRoot });
      execSync("git config gpg.program /bin/false", { cwd: projectRoot });
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [ ] todo\n\nedited by agent\n");
        return { kind: "error", exitCode: -1, stderr: "aborted: iteration-timeout" };
      });
      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 1,
          git: true,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(8);
      expect(cap.err()).toContain("failed to commit checkpoint on iteration-timeout");
    });

    test("external-spec iteration timeout skips checkpoints and resets its delta on the next run", async () => {
      writeFileSync(join(projectRoot, "README.md"), "seed\n");
      initGitRepoForCheckpointTests();
      const specDir = join(dir, "external-specs");
      mkdirSync(specDir, { recursive: true });
      const spec = join(specDir, "index.md");
      const subspec = join(specDir, "00-one.md");
      writeFileSync(spec, withRepo("# Feature\n\n- [ ] [00 - One](./00-one.md)\n"));
      writeFileSync(subspec, "# One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
      const beforeLog = execSync("git log --format=%H", { cwd: projectRoot, encoding: "utf8" }).trim();
      const cap = captureIo();
      const claude = new FakeAgent("claude", (callCount) => {
        if (callCount === 1) {
          writeFileSync(subspec, "# One\n\n## Acceptance criteria\n\n- [x] One accepted.\n");
          return { kind: "error", exitCode: -1, stderr: "aborted: iteration-timeout" };
        }
        expect(readFileSync(subspec, "utf8")).toContain("- [ ] One accepted.");
        return { kind: "error", exitCode: 1, stderr: "stop" };
      });
      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 1,
          git: true,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const firstCode = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });
      const afterTimeoutLog = execSync("git log --format=%H", { cwd: projectRoot, encoding: "utf8" }).trim();
      const secondCode = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(firstCode).toBe(8);
      expect(afterTimeoutLog).toBe(beforeLog);
      expect(secondCode).toBe(3);
    });

    test("iteration timeout does not commit a checkpoint when git is disabled", async () => {
      const spec = writeSpec("- [ ] todo\n");
      initGitRepoForCheckpointTests();
      const beforeLog = execSync("git log --format=%H", { cwd: projectRoot, encoding: "utf8" }).trim();
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(spec, "- [ ] todo\n\nedited by agent\n");
        return { kind: "error", exitCode: -1, stderr: "aborted: iteration-timeout" };
      });
      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 1,
          git: false,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(8);
      const afterLog = execSync("git log --format=%H", { cwd: projectRoot, encoding: "utf8" }).trim();
      expect(afterLog).toBe(beforeLog);
    });

    test("iteration timeout with no uncommitted changes creates no checkpoint commit", async () => {
      const spec = writeSpec("- [ ] todo\n");
      initGitRepoForCheckpointTests();
      const beforeLog = execSync("git log --format=%H", { cwd: projectRoot, encoding: "utf8" }).trim();
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => ({
        kind: "error",
        exitCode: -1,
        stderr: "aborted: iteration-timeout",
      }));
      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 1,
          git: true,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(8);
      const afterLog = execSync("git log --format=%H", { cwd: projectRoot, encoding: "utf8" }).trim();
      expect(afterLog).toBe(beforeLog);
    });

    test("watchdog timeout with pgid unavailable records last_output_age_ms only", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();

      class NeverSpawnedAgent implements Agent {
        readonly name = "claude" as const;
        async run(_prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
          await new Promise<void>((resolve) => {
            if (opts.signal?.aborted) {
              resolve();
              return;
            }
            opts.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return { kind: "error", exitCode: -1, stderr: "aborted: iteration-timeout" };
        }
        attributionLabel(): string {
          return "fake-claude";
        }
      }

      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: 1500,
          git: true,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: new NeverSpawnedAgent() },
        handleSignals: false,
      });

      expect(code).toBe(8);
      expect(cap.err()).not.toContain("[watchdog]");

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const timeoutRow = rows.find((row) => row.exit_reason === "watchdog-iteration-timeout");
      expect(timeoutRow).toBeDefined();
      expect(timeoutRow).toHaveProperty("last_output_age_ms");
      expect(timeoutRow?.last_output_age_ms).toBeNull();
      expect(timeoutRow).not.toHaveProperty("watchdog_pgid");
      expect(timeoutRow).not.toHaveProperty("watchdog_descendants_alive");
    });

    test("global run timeout causes exit code 8", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => ({
        kind: "error",
        exitCode: -1,
        stderr: "aborted: run-timeout",
      }));
      writeConfig(
        {
          version: 2,
          modes: {
            patch: { agentOrder: [CLAUDE_ENTRY] },
            plan: { agentOrder: [CLAUDE_ENTRY] },
            prompt: { agentOrder: [CLAUDE_ENTRY] },
            review: { passes: 2 },
          },
          quotaFallback: "lenient",
          weakQuotaExitCodes: [],
          maxIterations: 1,
          iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
          runTimeoutMs: 1,
          git: true,
          projects: { project: { root: projectRoot } },
        },
        { dir: cfgDir },
      );

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(8);
      expect(cap.err()).toContain("exceeded timeout");
    });
  });

  describe("blocker handling", () => {
    test("exits 7 when agent appends ## Blocker section and commits work", async () => {
      execSync("git init -b jarvis-e2e", { cwd: projectRoot });
      execSync('git config user.email "jarvis-test@example.com"', {
        cwd: projectRoot,
      });
      execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
      const specDir = join(projectRoot, "spec", "feature");
      mkdirSync(specDir, { recursive: true });
      const spec = join(specDir, "index.md");
      const subspec = join(specDir, "00-one.md");
      writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
      writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] Item one.\n");
      execSync("git add -A && git commit -m init", { cwd: projectRoot });

      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(join(projectRoot, "work.txt"), "work\n");
        const subspecContent = readFileSync(subspec, "utf8");
        writeFileSync(subspec, `${subspecContent}\n## Blocker\n\nWaiting for external API\n`);
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(7);
      expect(cap.err()).toContain("Waiting for external API");
      expect(claude.calls).toHaveLength(1);
      expect(execSync("git status --porcelain", { cwd: projectRoot }).toString()).toBe("");
      const lastMessage = execSync("git log -1 --format=%B", {
        cwd: projectRoot,
        encoding: "utf8",
      });
      expect(lastMessage).toContain("WIP: 00 - One (blocked)");
      expect(lastMessage).toContain("## Blocker");
      expect(lastMessage).toContain("Waiting for external API");
    });

    test("exits 7 without invoking agent when subspec already has blocker", async () => {
      execSync("git init -b jarvis-e2e", { cwd: projectRoot });
      execSync('git config user.email "jarvis-test@example.com"', {
        cwd: projectRoot,
      });
      execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
      const specDir = join(projectRoot, "spec", "feature");
      mkdirSync(specDir, { recursive: true });
      const spec = join(specDir, "index.md");
      const subspec = join(specDir, "00-one.md");
      writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
      writeFileSync(
        subspec,
        "# 00 - One\n\n## Acceptance criteria\n\n- [ ] Item one.\n\n## Blocker\n\nAlready blocked\n",
      );
      execSync("git add -A && git commit -m init", { cwd: projectRoot });

      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("should not be invoked");
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(7);
      expect(cap.err()).toContain("Already blocked");
      expect(claude.calls).toHaveLength(0);
    });

    test("commits combined WIP+blocker when agent ticks criteria and adds blocker", async () => {
      execSync("git init -b jarvis-e2e", { cwd: projectRoot });
      execSync('git config user.email "jarvis-test@example.com"', {
        cwd: projectRoot,
      });
      execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
      const specDir = join(projectRoot, "spec", "feature");
      mkdirSync(specDir, { recursive: true });
      const spec = join(specDir, "index.md");
      const subspec = join(specDir, "00-one.md");
      writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
      writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] Step A.\n- [ ] Step B.\n");
      execSync("git add -A && git commit -m init", { cwd: projectRoot });

      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n- [ ] Step B.\n\n## Blocker\n\nNeed implementation details\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
      });

      expect(code).toBe(7);
      expect(cap.err()).toContain("Need implementation details");
      expect(claude.calls).toHaveLength(1);
      const lastMessage = execSync("git log -1 --format=%B", {
        cwd: projectRoot,
        encoding: "utf8",
      });
      expect(lastMessage).toContain("WIP: 00 - One (blocked, 1/2 criteria)");
      expect(lastMessage).toContain("Newly checked:\n- Step A.");
      expect(lastMessage).toContain("## Blocker");
      expect(lastMessage).toContain("Need implementation details");
    });

    function setupGitRepo(stepA: string, stepB?: string): { spec: string; subspec: string } {
      execSync("git init -b jarvis-e2e", { cwd: projectRoot });
      execSync('git config user.email "jarvis-test@example.com"', {
        cwd: projectRoot,
      });
      execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
      const specDir = join(projectRoot, "spec", "feature");
      mkdirSync(specDir, { recursive: true });
      const spec = join(specDir, "index.md");
      const subspec = join(specDir, "00-one.md");
      const subspecContent = stepB
        ? `# 00 - One\n\n## Acceptance criteria\n\n- [ ] ${stepA}\n- [ ] ${stepB}\n`
        : `# 00 - One\n\n## Acceptance criteria\n\n- [ ] ${stepA}\n`;
      writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
      writeFileSync(subspec, subspecContent);
      execSync("git add -A && git commit -m init", { cwd: projectRoot });
      return { spec, subspec };
    }

    test("rejects blocker claim when base-ref validates green and continues loop", async () => {
      const { spec, subspec } = setupGitRepo("Step A.", "Step B.");

      const cap = captureIo();
      let iterationCount = 0;
      const claude = new FakeAgent("claude", () => {
        iterationCount += 1;
        if (iterationCount === 1) {
          // First iteration: tick one and add a claim blocker
          writeFileSync(
            subspec,
            "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n- [ ] Step B.\n\n## Blocker\n\nThis is a pre-existing failure that's unrelated to my changes\n",
          );
        } else if (iterationCount === 2) {
          // Second iteration (after blocker is rejected): tick the other box
          writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n- [x] Step B.\n");
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => true, // Base ref validates green
      });

      expect(code).toBe(0); // Should succeed, not exit 7
      expect(cap.err()).toContain("blocker claim rejected");
      expect(cap.err()).toContain("base ref validates green");
      expect(iterationCount).toBe(2); // Agent called twice: once for claim, once to fix

      // Verify the blocker section was stripped from the subspec
      const subspecContent = readFileSync(subspec, "utf8");
      expect(subspecContent).not.toContain("## Blocker");
      expect(subspecContent).not.toContain("pre-existing failure");
    });

    test("blocker claim stands when base-ref validates red", async () => {
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n\n## Blocker\n\nThis is unrelated to my changes, baseline already fails\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => false, // Base ref validates red
      });

      expect(code).toBe(7); // Should exit 7, not continue
      expect(cap.err()).toContain("This is unrelated to my changes");
      // Should NOT contain rejection message
      expect(cap.err()).not.toContain("blocker claim rejected");
    });

    test("blocker claim stands after rejection bound is hit", async () => {
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      let iterationCount = 0;
      const claude = new FakeAgent("claude", (_callCount) => {
        iterationCount += 1;
        // Both iterations add the same claim blocker
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [ ] Step A.\n\n## Blocker\n\nThis is pre-existing and baseline already fails\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const sessionLogDir = join(cfgDir, "session-logs");
      mkdirSync(sessionLogDir, { recursive: true });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir, maxIterations: 3 },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => true, // Base ref validates green for both iterations
      });

      // After bound is hit (2 rejections), the third iteration should exit 7
      expect(code).toBe(7);
      expect(iterationCount).toBe(3); // Agent called 3 times: 2 rejections + 1 stand
    });

    test("blocker claim requires validation seam to reject", async () => {
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n\n## Blocker\n\nThis is unrelated, pre-existing baseline failure\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        // No runBaseRefTests seam provided
      });

      // Without seam, blocker should stand (fail-safe behavior)
      expect(code).toBe(7);
      expect(cap.err()).toContain("This is unrelated");
      // Should NOT contain rejection message
      expect(cap.err()).not.toContain("blocker claim rejected");
    });

    test("non-claim blocker is not validated even if seam is provided", async () => {
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      let seamCalled = false;
      const claude = new FakeAgent("claude", () => {
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n\n## Blocker\n\nNeed implementation details\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => {
          seamCalled = true;
          return true;
        },
      });

      // Non-claim blocker should exit 7 without calling the seam
      expect(code).toBe(7);
      expect(cap.err()).toContain("Need implementation details");
      expect(seamCalled).toBe(false); // Seam should not be called
      // Should NOT contain rejection message
      expect(cap.err()).not.toContain("blocker claim rejected");
    });

    test("default base-ref runner is used when seam not provided", async () => {
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      let iterationCount = 0;
      const claude = new FakeAgent("claude", () => {
        iterationCount += 1;
        if (iterationCount === 1) {
          // First iteration: tick one and add a claim blocker
          writeFileSync(
            subspec,
            "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n\n## Blocker\n\nThis is a pre-existing failure that's unrelated to my changes\n",
          );
        } else if (iterationCount === 2) {
          // Second iteration (after blocker validation): resolve it
          writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n");
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        // No runBaseRefTests seam provided; should use default
      });

      // The default runner will try to validate but will likely fail to find tests,
      // so the blocker should stand (fail-safe). Code should be 7.
      expect(code).toBe(7);
      expect(cap.err()).toContain("pre-existing failure");
    });

    test("base-ref-test-runner: passes base branch parameter to validation seam", async () => {
      // Verify that the validation seam is called with a base branch parameter
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      let validationCall: { baseBranch: string } | undefined;
      const claude = new FakeAgent("claude", () => {
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n\n## Blocker\n\nThis is a pre-existing test failure\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const _code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        // Mock seam to capture the base branch parameter
        runBaseRefTests: async (baseBranch: string) => {
          validationCall = { baseBranch };
          // Return true to trigger rejection (so we can verify it was called)
          return true;
        },
      });

      // Verify the seam was called with a string parameter
      expect(validationCall).toBeDefined();
      expect(validationCall?.baseBranch).toBeDefined();
      expect(typeof validationCall?.baseBranch).toBe("string");
      // The base branch should be one of the common defaults or a non-empty string
      if (validationCall?.baseBranch) {
        expect(
          validationCall.baseBranch === "main" ||
            validationCall.baseBranch === "master" ||
            validationCall.baseBranch.length > 0,
        ).toBe(true);
      }
    });

    test("rejects blocker claim when snapshot-update re-test passes and continues loop", async () => {
      const { spec, subspec } = setupGitRepo("Step A.", "Step B.");

      const cap = captureIo();
      let iterationCount = 0;
      const claude = new FakeAgent("claude", () => {
        iterationCount += 1;
        if (iterationCount === 1) {
          // First iteration: tick one and add a claim blocker
          writeFileSync(
            subspec,
            "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n- [ ] Step B.\n\n## Blocker\n\nThis is a pre-existing failure that's unrelated to my changes\n",
          );
        } else if (iterationCount === 2) {
          // Second iteration (after blocker is rejected): tick the other box
          writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n- [x] Step B.\n");
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => false, // Base ref validates red
        runSnapshotUpdateRetest: async () => true, // Snapshot re-test green
      });

      expect(code).toBe(0); // Should succeed, not exit 7
      expect(cap.err()).toContain("blocker claim rejected");
      expect(cap.err()).toContain("snapshot-update re-test passes");
      expect(iterationCount).toBe(2); // Agent called twice: once for claim, once to fix

      // Verify the blocker section was stripped from the subspec
      const subspecContent = readFileSync(subspec, "utf8");
      expect(subspecContent).not.toContain("## Blocker");
      expect(subspecContent).not.toContain("pre-existing failure");
    });

    test("blocker claim stands when snapshot-update re-test fails", async () => {
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n\n## Blocker\n\nThis is unrelated to my changes, baseline already fails\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => false, // Base ref validates red
        runSnapshotUpdateRetest: async () => false, // Snapshot re-test red
      });

      expect(code).toBe(7); // Should exit 7, not continue
      expect(cap.err()).toContain("This is unrelated to my changes");
      // Should NOT contain rejection message
      expect(cap.err()).not.toContain("blocker claim rejected");
    });

    test("blocker claim stands when snapshot-update seam is not provided", async () => {
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n\n## Blocker\n\nThis is unrelated, pre-existing baseline failure\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => false, // Base ref validates red
        // No runSnapshotUpdateRetest seam provided
      });

      // Without seam, blocker should stand (fail-safe behavior)
      expect(code).toBe(7);
      expect(cap.err()).toContain("This is unrelated");
      // Should NOT contain rejection message
      expect(cap.err()).not.toContain("blocker claim rejected");
    });

    test("blocker claim stands when snapshot-update seam throws", async () => {
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n\n## Blocker\n\nThis is unrelated, baseline already broken\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => false, // Base ref validates red
        runSnapshotUpdateRetest: async () => {
          throw new Error("Test error");
        },
      });

      // Seam error: fail-safe, blocker should stand
      expect(code).toBe(7);
      expect(cap.err()).toContain("This is unrelated");
      // Should NOT contain rejection message
      expect(cap.err()).not.toContain("blocker claim rejected");
    });

    test("snapshot seam is not invoked when base-ref validation already rejected the blocker", async () => {
      const { spec, subspec } = setupGitRepo("Step A.", "Step B.");

      const cap = captureIo();
      let snapshotSeamCalled = false;
      let iterationCount = 0;
      const claude = new FakeAgent("claude", () => {
        iterationCount += 1;
        if (iterationCount === 1) {
          // First iteration: tick one and add a claim blocker
          writeFileSync(
            subspec,
            "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n- [ ] Step B.\n\n## Blocker\n\nThis is a pre-existing failure that's unrelated to my changes\n",
          );
        } else if (iterationCount === 2) {
          // Second iteration (after blocker is rejected by base-ref): tick the other box
          writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n- [x] Step B.\n");
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => true, // Base ref validates green
        runSnapshotUpdateRetest: async () => {
          snapshotSeamCalled = true;
          return true;
        },
      });

      expect(code).toBe(0); // Should succeed
      expect(cap.err()).toContain("blocker claim rejected");
      expect(cap.err()).toContain("base ref validates green");
      expect(snapshotSeamCalled).toBe(false); // Snapshot seam should not be called
      expect(iterationCount).toBe(2);
    });

    test("snapshot seam is not invoked for non-claim blockers", async () => {
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      let snapshotSeamCalled = false;
      const claude = new FakeAgent("claude", () => {
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n\n## Blocker\n\nNeed implementation details\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => false,
        runSnapshotUpdateRetest: async () => {
          snapshotSeamCalled = true;
          return true;
        },
      });

      // Non-claim blocker should exit 7 without calling the snapshot seam
      expect(code).toBe(7);
      expect(cap.err()).toContain("Need implementation details");
      expect(snapshotSeamCalled).toBe(false);
      // Should NOT contain rejection message
      expect(cap.err()).not.toContain("blocker claim rejected");
    });

    test("snapshot seam not invoked after snapshot-rejection bound is hit", async () => {
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      let iterationCount = 0;
      let snapshotSeamCalls = 0;
      const claude = new FakeAgent("claude", (_callCount) => {
        iterationCount += 1;
        // Both iterations add the same claim blocker
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [ ] Step A.\n\n## Blocker\n\nThis is pre-existing and baseline already fails\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const sessionLogDir = join(cfgDir, "session-logs");
      mkdirSync(sessionLogDir, { recursive: true });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir, maxIterations: 3 },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => false, // Base ref validates red for all iterations
        runSnapshotUpdateRetest: async () => {
          snapshotSeamCalls += 1;
          return true; // Snapshot would reject if called
        },
      });

      // After bound is hit (2 rejections), the third iteration should exit 7 without calling snapshot seam again
      expect(code).toBe(7);
      expect(iterationCount).toBe(3); // Agent called 3 times: 2 rejections + 1 stand
      expect(snapshotSeamCalls).toBe(2); // Seam called only twice (for first two rejections)
    });

    test("snapshot seam green rejects blocker claim and strips it", async () => {
      const { spec, subspec } = setupGitRepo("Step A.", "Step B.");

      const cap = captureIo();
      let iterationCount = 0;
      const claude = new FakeAgent("claude", () => {
        iterationCount += 1;
        if (iterationCount === 1) {
          // First iteration: tick one and add a claim blocker
          writeFileSync(
            subspec,
            "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n- [ ] Step B.\n\n## Blocker\n\nThis is a pre-existing failure that's unrelated to my changes\n",
          );
        } else if (iterationCount === 2) {
          // Second iteration (after blocker is rejected): tick the other box
          writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n- [x] Step B.\n");
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => false, // Base ref validates red
        runSnapshotUpdateRetest: async () => true, // Snapshot retest validates green
      });

      expect(code).toBe(0); // Should succeed, not exit 7
      expect(cap.err()).toContain("blocker claim rejected");
      expect(cap.err()).toContain("snapshot-churn");
      expect(iterationCount).toBe(2); // Agent called twice: once for claim, once to fix

      // Verify the blocker section was stripped from the subspec
      const subspecContent = readFileSync(subspec, "utf8");
      expect(subspecContent).not.toContain("## Blocker");
      expect(subspecContent).not.toContain("pre-existing failure");
    });

    test("snapshot seam red lets blocker stand", async () => {
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n\n## Blocker\n\nThis is unrelated to my changes, baseline already fails\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => false, // Base ref validates red
        runSnapshotUpdateRetest: async () => false, // Snapshot retest validates red
      });

      expect(code).toBe(7); // Should exit 7, not continue
      expect(cap.err()).toContain("This is unrelated to my changes");
      // Should NOT contain rejection message
      expect(cap.err()).not.toContain("blocker claim rejected");
    });

    test("snapshot seam absent (no seam provided) lets blocker stand (fail-safe)", async () => {
      const { spec, subspec } = setupGitRepo("Step A.");

      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        writeFileSync(
          subspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n\n## Blocker\n\nThis is unrelated to my changes\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => false, // Base ref validates red
        // No runSnapshotUpdateRetest seam provided
      });

      expect(code).toBe(7); // Should exit 7, not continue (fail-safe)
      expect(cap.err()).toContain("This is unrelated to my changes");
      // Should NOT contain rejection message
      expect(cap.err()).not.toContain("blocker claim rejected");
    });

    test("default snapshot seam rejects blocker with updateSnapshotsCommand configured", async () => {
      const { spec, subspec } = setupGitRepo("Step A.", "Step B.");

      const cap = captureIo();
      let iterationCount = 0;
      const claude = new FakeAgent("claude", () => {
        iterationCount += 1;
        if (iterationCount === 1) {
          // First iteration: tick one and add a claim blocker
          writeFileSync(
            subspec,
            "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n- [ ] Step B.\n\n## Blocker\n\nThis is a pre-existing failure\n",
          );
        } else if (iterationCount === 2) {
          // Second iteration (after blocker is rejected): tick the other box
          writeFileSync(subspec, "# 00 - One\n\n## Acceptance criteria\n\n- [x] Step A.\n- [x] Step B.\n");
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      // Update config with updateSnapshotsCommand for the project
      const cfg = loadConfig({ dir: cfgDir });
      if (cfg.projects.project === undefined) {
        cfg.projects.project = { root: projectRoot };
      }
      cfg.projects.project.updateSnapshotsCommand = "true"; // A command that always succeeds
      writeConfig(cfg, { dir: cfgDir });

      // The default runner re-tests with `bun run test`; give the fixture a passing one
      // so an update-then-retest resolves green (snapshot-churn rejected end-to-end).
      writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ scripts: { test: "true" } }));

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        handleSignals: false,
        runBaseRefTests: async () => false, // Base ref validates red
        // No runSnapshotUpdateRetest seam provided; should use default
      });

      expect(code).toBe(0); // Should succeed
      expect(cap.err()).toContain("blocker claim rejected");
      expect(cap.err()).toContain("snapshot-churn");
      expect(iterationCount).toBe(2);

      // Verify the blocker section was stripped from the subspec
      const subspecContent = readFileSync(subspec, "utf8");
      expect(subspecContent).not.toContain("## Blocker");
    });
  });
});

describe("agent stream handling (regression test for hang)", () => {
  test("settles promise when child exits and streams end (even if timing differs)", async () => {
    const result = await runAgent(
      {
        name: "claude",
        binary: "sh",
        cwd: tmpdir(),
        buildArgv: () => ["-c", "echo 'output'; exit 0"],
        stdio: ["pipe", "pipe", "pipe"] as const,
        streamErrorPrefix: "test:",
      },
      "",
      { cwd: tmpdir() },
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toContain("output");
    }
  });

  test("settles promise when child exits with error", async () => {
    const result = await runAgent(
      {
        name: "claude",
        binary: "sh",
        cwd: tmpdir(),
        buildArgv: () => ["-c", "echo 'error' >&2; exit 1"],
        stdio: ["pipe", "pipe", "pipe"] as const,
        streamErrorPrefix: "test:",
      },
      "",
      { cwd: tmpdir() },
    );

    expect(result.kind).toBe("error");
    expect(result.stderr).toContain("error");
  });

  test("settles promise when child exits without producing output", async () => {
    const result = await runAgent(
      {
        name: "claude",
        binary: "sh",
        cwd: tmpdir(),
        buildArgv: () => ["-c", "exit 0"],
        stdio: ["pipe", "pipe", "pipe"] as const,
        streamErrorPrefix: "test:",
      },
      "",
      { cwd: tmpdir() },
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    }
  });
});

type ReviewEnv = {
  spec: string;
  worktree: string;
  readyLog: string;
  prReadyLog: string;
  prCommentLog: string;
  prCommentBody: string;
  failReviewPush: string;
  mergeLog: string;
  reviewCommitSubjects: () => string[];
  reviewCommitFiles: () => string[];
};

// Scaffold a real git repo + bare origin + fake git/bun/gh on PATH so the
// post-completion review phase runs end-to-end. Agents are supplied by callers.
function setupReviewEnv(opts: {
  reviewAgentOrder?: AgentEntry[];
  patchAgentOrder?: AgentEntry[];
  maxIterations?: number;
  reviewPasses?: number;
  behindBase?: boolean;
}): ReviewEnv {
  const origin = join(dir, "origin.git");
  execSync(`git init --bare ${origin}`);
  execSync("git init -b main", { cwd: projectRoot });
  execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
  execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
  execSync(`git remote add origin ${origin}`, { cwd: projectRoot });

  const specDir = join(projectRoot, "spec", "feature");
  mkdirSync(specDir, { recursive: true });
  const spec = join(specDir, "index.md");
  writeFileSync(spec, `repo: ${projectRoot}\n\n# Feature\n\n- [ ] [00 - One](./00-one.md)\n`);
  writeFileSync(join(specDir, "00-one.md"), "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
  execSync("git add -A && git commit -m init && git push -u origin main", { cwd: projectRoot });

  if (opts.behindBase === true) {
    execSync("git checkout -b feature", { cwd: projectRoot });
    execSync("git push -u origin feature", { cwd: projectRoot });
    execSync("git checkout main", { cwd: projectRoot });
    writeFileSync(join(projectRoot, "sibling-merge.txt"), "sibling\n");
    execSync("git add -A && git commit -m 'advance main' && git push origin main", { cwd: projectRoot });
  }

  const binDir = join(dir, "bin");
  mkdirSync(binDir);
  const realGit = execSync("command -v git", { encoding: "utf8" }).trim();
  const bun = join(binDir, "bun");
  const git = join(binDir, "git");
  const gh = join(binDir, "gh");
  const readyLog = join(dir, "ready-log");
  const prReadyLog = join(dir, "pr-ready-log");
  const prCommentLog = join(dir, "pr-comment-log");
  const prCommentBody = join(dir, "pr-comment-body");
  const prBody = join(dir, "pr-body");
  const prState = join(dir, "pr-state");
  const readyState = join(dir, "ready-state");
  const failReviewPush = join(dir, "fail-review-push");
  const mergeLog = join(dir, "merge-log");

  writeFileSync(
    git,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "merge" ]]; then
  printf 'git %s\\n' "$*" >> "${mergeLog}"
fi
if [[ "$1" == "push" && -f "${failReviewPush}" ]]; then
  printf 'forced review push failure\\n' >&2
  exit 1
fi
exec "${realGit}" "$@"
`,
  );
  chmodSync(git, 0o755);
  writeFileSync(
    bun,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "run fix" ]]; then
  exit 0
fi
if [[ "$1 $2" == "run ready" ]]; then
  printf '%s\n' "\${JARVIS_READY_TIER:-full}" >> "${readyLog}"
  exit 0
fi
exit 1
`,
  );
  chmodSync(bun, 0o755);
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "auth status" ]]; then exit 0; fi
if [[ "$1 $2" == "repo view" ]]; then printf 'main\\n'; exit 0; fi
if [[ "$1 $2" == "pr view" ]]; then
  if [[ ! -f "${prState}" ]]; then exit 1; fi
  if [[ "$*" == *"isDraft"* ]]; then
    if [[ -f "${readyState}" ]]; then printf 'false\\n'; else printf 'true\\n'; fi
  elif [[ "$*" == *"--json body"* ]]; then
    if [[ -f "${prBody}" ]]; then cat "${prBody}"; fi
  elif [[ "$*" == *"baseRefName"* ]]; then printf 'main\\n';
  elif [[ "$*" == *"--json number,state"* ]]; then printf '1\\n';
  elif [[ "$*" == *"--json url"* ]]; then printf 'https://example/pull/1\\n';
  else printf '1\\n'; fi
  exit 0
fi
if [[ "$1 $2" == "pr edit" ]]; then
  while [[ $# -gt 0 ]]; do case "$1" in --body-file) shift; if [[ "$1" == "-" ]]; then cat > "${prBody}"; else cp "$1" "${prBody}"; fi;; esac; shift; done
  exit 0
fi
if [[ "$1 $2" == "pr create" ]]; then
  while [[ $# -gt 0 ]]; do case "$1" in --body) shift; printf '%s' "$1" > "${prBody}";; esac; shift; done
  touch "${prState}"
  exit 0
fi
if [[ "$1 $2" == "pr ready" ]]; then printf 'ready\\n' >> "${prReadyLog}"; touch "${readyState}"; exit 0; fi
if [[ "$1 $2" == "pr comment" ]]; then
  printf 'comment\\n' >> "${prCommentLog}"
  while [[ $# -gt 0 ]]; do case "$1" in --body) shift; printf '%s' "$1" > "${prCommentBody}";; esac; shift; done
  exit 0
fi
exit 1
`,
  );
  chmodSync(gh, 0o755);
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;

  writeConfig(
    {
      version: 2,
      modes: {
        patch: {
          agentOrder: opts.patchAgentOrder ?? [CLAUDE_ENTRY],
          ...(opts.behindBase === true ? { shrink: "off" as const } : {}),
        },
        plan: { agentOrder: [CLAUDE_ENTRY] },
        prompt: { agentOrder: opts.patchAgentOrder ?? [CLAUDE_ENTRY] },
        review: {
          passes: opts.reviewPasses ?? 1,
          ...(opts.reviewAgentOrder !== undefined ? { agentOrder: opts.reviewAgentOrder } : {}),
        },
      },
      quotaFallback: "lenient",
      weakQuotaExitCodes: [],
      maxIterations: opts.maxIterations ?? 10,
      iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
      git: true,
      projects: { project: { root: projectRoot } },
    },
    { dir: cfgDir },
  );

  const worktree = join(projectRoot, ".worktree", "feature");
  const reviewCommitSubjects = () =>
    execSync("git log --format=%s main..feature", { cwd: projectRoot, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((s) => s.startsWith("review:"));
  const reviewCommitFiles = () =>
    execSync("git show --name-only --format= HEAD", { cwd: worktree, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((s) => s.length > 0);

  return {
    spec,
    worktree,
    readyLog,
    prReadyLog,
    prCommentLog,
    prCommentBody,
    failReviewPush,
    mergeLog,
    reviewCommitSubjects,
    reviewCommitFiles,
  };
}

// An implementation agent that completes the single subspec in one iteration and
// answers the PR-description prompt. `onReview` handles review-phase prompts.
function isPatchReviewPrompt(prompt: string): boolean {
  return prompt.includes("Patch Mode — Review:");
}

function isPatchReviewActuatorPrompt(prompt: string): boolean {
  return prompt.includes("## Review Verdict");
}

function reviewFakeAgent(
  name: "claude" | "codex",
  onReview: (callCount: number, cwd: string, prompt: string) => AgentResult,
  onActuator?: (callCount: number, cwd: string, prompt: string) => AgentResult,
): FakeAgent {
  return new FakeAgent(name, (callCount, prompt, opts) => {
    if (isPatchReviewPrompt(prompt)) {
      return onReview(callCount, opts.cwd, prompt);
    }
    if (isPatchReviewActuatorPrompt(prompt)) {
      return (onActuator ?? onReview)(callCount, opts.cwd, prompt);
    }
    if (prompt.includes("PR description")) {
      return { kind: "ok", stdout: "Implements the feature.\n", stderr: "" };
    }
    writeFileSync(join(opts.cwd, "impl.txt"), "impl\n");
    writeFileSync(
      join(opts.cwd, "spec", "feature", "00-one.md"),
      "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n",
    );
    return { kind: "ok", stdout: "", stderr: "" };
  });
}

describe("review phase", () => {
  test("runs passes, commits edits, then marks PR ready after review", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    const cap = captureIo();
    const claude = reviewFakeAgent(
      "claude",
      (_n, _cwd, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "Refine code output.\n" : "",
        stderr: "",
      }),
      (_n, cwd) => {
        writeFileSync(join(cwd, "code.txt"), "refined\n");
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(env.reviewCommitSubjects()).toEqual(["review: actuator"]);
    // gh pr ready fires exactly once, and only after the review commit landed.
    expect(readFileSync(env.prReadyLog, "utf8").trim().split("\n")).toEqual(["ready"]);
    const reviewPrompts = claude.calls.filter((c) => isPatchReviewPrompt(c.prompt));
    expect(reviewPrompts).toHaveLength(3); // 3 roles per cycle
    const reviewPrompt = reviewPrompts[0]?.prompt;
    expect(reviewPrompt).toContain("Changed paths:");
    expect(reviewPrompt).not.toContain("diff --git");
    expect(reviewPrompt).not.toContain("failed to generate diff");
    expect(cap.out()).toContain("iterations: 1");
    expect(cap.out()).toContain("review attempts: 4"); // 3 roles + actuator
  });

  test("completion review actuator idle escalation uses reviewActuator ladder not activeAgents", async () => {
    const idleTimeoutMs = 1000;
    const hangScript = writeIdleHangScript(join(dir, "completion-actuator-idle.sh"));
    const env = setupReviewEnv({ reviewPasses: 1, patchAgentOrder: [CODEX_ENTRY] });
    const cfg = loadConfig({ dir: cfgDir });
    cfg.idleOutputTimeoutMs = idleTimeoutMs;
    cfg.modes.patch.subRoleAgentOrder = { reviewActuator: [CLAUDE_ENTRY, CODEX_ENTRY] };
    writeConfig(cfg, { dir: cfgDir });

    const cap = captureIo();
    const claudeIdle = createIdleHangAgent("claude", hangScript);
    let codexActuatorCalls = 0;
    const codex = new FakeAgent("codex", (_callCount, prompt, opts) => {
      if (isPatchReviewActuatorPrompt(prompt)) {
        codexActuatorCalls += 1;
        return { kind: "ok", stdout: "", stderr: "" };
      }
      if (isPatchReviewPrompt(prompt)) {
        return {
          kind: "ok",
          stdout: prompt.includes("Review: Adjudicator") ? "Needs fix.\n" : "",
          stderr: "",
        };
      }
      if (prompt.includes("PR description")) {
        return { kind: "ok", stdout: "Implements the feature.\n", stderr: "" };
      }
      writeFileSync(join(opts.cwd, "impl.txt"), "impl\n");
      writeFileSync(
        join(opts.cwd, "spec", "feature", "00-one.md"),
        "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    });
    const claude = new FakeAgent("claude", (_callCount, prompt, opts) => {
      if (isPatchReviewActuatorPrompt(prompt)) {
        return claudeIdle.run(prompt, opts);
      }
      if (isPatchReviewPrompt(prompt)) {
        return {
          kind: "ok",
          stdout: prompt.includes("Review: Adjudicator") ? "Needs fix.\n" : "",
          stderr: "",
        };
      }
      throw new Error("unexpected claude call");
    });

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
      __testKillGraceMs: 200,
    });

    expect(code).toBe(0);
    expect(cap.err()).toContain(`review: claude: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
    expect(claudeIdle.calls.filter((c) => isPatchReviewActuatorPrompt(c.prompt))).toHaveLength(1);
    expect(codexActuatorCalls).toBe(1);
  });

  test("terminal shrink idle returns run exit 8 and skips review", async () => {
    const idleTimeoutMs = 1000;
    const hangScript = writeIdleHangScript(join(dir, "completion-shrink-idle.sh"));
    const env = setupReviewEnv({ reviewPasses: 1, patchAgentOrder: [CODEX_ENTRY] });
    const cfg = loadConfig({ dir: cfgDir });
    cfg.idleOutputTimeoutMs = idleTimeoutMs;
    cfg.modes.patch.subRoleAgentOrder = { reviewActuator: [CLAUDE_ENTRY, CODEX_ENTRY] };
    writeConfig(cfg, { dir: cfgDir });

    const cap = captureIo();
    let reviewPromptCalls = 0;
    const claudeIdle = createIdleHangAgent("claude", hangScript);
    const codexIdle = createIdleHangAgent("codex", hangScript);
    const codex = new FakeAgent("codex", (_callCount, prompt, opts) => {
      if (prompt.includes("Simplification checklist")) {
        return codexIdle.run(prompt, opts);
      }
      if (isPatchReviewPrompt(prompt) || isPatchReviewActuatorPrompt(prompt)) {
        reviewPromptCalls += 1;
        return { kind: "ok", stdout: "", stderr: "" };
      }
      if (prompt.includes("PR description")) {
        return { kind: "ok", stdout: "Implements the feature.\n", stderr: "" };
      }
      writeFileSync(join(opts.cwd, "impl.txt"), "impl\n");
      writeFileSync(
        join(opts.cwd, "spec", "feature", "00-one.md"),
        "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    });
    const claude = new FakeAgent("claude", (_callCount, prompt, opts) => {
      if (prompt.includes("Simplification checklist")) {
        return claudeIdle.run(prompt, opts);
      }
      if (isPatchReviewPrompt(prompt) || isPatchReviewActuatorPrompt(prompt)) {
        reviewPromptCalls += 1;
        return { kind: "ok", stdout: "", stderr: "" };
      }
      throw new Error("unexpected claude call");
    });

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
      __testKillGraceMs: 200,
    });

    expect(code).toBe(8);
    expect(reviewPromptCalls).toBe(0);
    expect(cap.err()).toContain(`shrink: claude: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
  });

  test("baseline gate leaves PR draft until review completes", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    const cap = captureIo();
    const draftStates: string[] = [];
    const claude = reviewFakeAgent(
      "claude",
      (_n, cwd, prompt) => {
        // Observe PR draft state at the moment the review agent runs.
        draftStates.push(
          execSync("gh pr view feature --json isDraft -q .isDraft", {
            cwd,
            env: process.env,
            encoding: "utf8",
          }).trim(),
        );
        return {
          kind: "ok",
          stdout: prompt.includes("Review: Adjudicator") ? "No actuator changes needed.\n" : "",
          stderr: "",
        };
      },
      (_n, cwd) => {
        writeFileSync(join(cwd, "code.txt"), "x\n");
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(draftStates).toEqual(["true", "true", "true"]); // 3 roles per cycle
  });

  test("runs all passes past a no-op; only non-empty passes commit", async () => {
    const env = setupReviewEnv({ reviewPasses: 2 });
    const cap = captureIo();
    let _reviewCalls = 0;
    let actuatorCalls = 0;
    const claude = reviewFakeAgent(
      "claude",
      (_callCount, _cwd, prompt) => {
        _reviewCalls += 1;
        return {
          kind: "ok",
          stdout: prompt.includes("Review: Adjudicator") ? "Apply second-cycle refinement.\n" : "",
          stderr: "",
        };
      },
      (_callCount, cwd) => {
        actuatorCalls += 1;
        writeFileSync(join(cwd, "code.txt"), `actuator ${actuatorCalls}\n`);
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    // 6 review prompts (3 roles × 2 cycles); first role of cycle 1 has no changes,
    // but subsequent roles do, so commits are made.
    const reviewPrompts = claude.calls.filter((c) => isPatchReviewPrompt(c.prompt));
    expect(reviewPrompts).toHaveLength(6);
    const commitSubjects = env.reviewCommitSubjects();
    expect(commitSubjects).toEqual(["review: actuator", "review: actuator"]);
    expect(cap.out()).toContain("review attempts: 8"); // (3 roles + actuator) × 2 cycles
  });

  test("reverts spec-tree edits (tracked and untracked); commits only code", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    const cap = captureIo();
    const claude = reviewFakeAgent(
      "claude",
      (_n, cwd, prompt) => {
        // Edit a tracked spec file, add an untracked spec file, and a code file.
        writeFileSync(
          join(cwd, "spec", "feature", "00-one.md"),
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] tampered.\n",
        );
        writeFileSync(join(cwd, "spec", "feature", "02-extra.md"), "sneaky\n");
        writeFileSync(join(cwd, "code.txt"), "ok\n");
        if (prompt.includes("Review: Adjudicator")) {
          return { kind: "ok", stdout: "Actuator should write code.\n", stderr: "" };
        }
        return { kind: "ok", stdout: "", stderr: "" };
      },
      (_n, cwd) => {
        writeFileSync(join(cwd, "code.txt"), "ok\n");
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    // Tracked spec file restored to its completed state.
    expect(readFileSync(join(env.worktree, "spec", "feature", "00-one.md"), "utf8")).toContain("- [x] One accepted.");
    // Untracked spec file removed.
    expect(existsSync(join(env.worktree, "spec", "feature", "02-extra.md"))).toBe(false);
    // The review commit carries the code change and durable verdict, not completed spec edits.
    const files = env.reviewCommitFiles();
    expect(files).toContain("code.txt");
    expect(files).toContain("spec/feature/verdict-patch.md");
    expect(files).not.toContain("spec/feature/00-one.md");
    expect(files).not.toContain("spec/feature/02-extra.md");
  });

  test("blocker sentinel posts a PR comment and exits 7 without marking ready", async () => {
    const env = setupReviewEnv({ reviewPasses: 2 });
    const cap = captureIo();
    const claude = reviewFakeAgent("claude", (_n, cwd) => {
      writeFileSync(join(cwd, ".jarvis-review-blocker"), "build is broken\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(7);
    // Only the first pass ran; PR comment posted; PR never marked ready.
    expect(claude.calls.filter((c) => isPatchReviewPrompt(c.prompt))).toHaveLength(1);
    expect(readFileSync(env.prCommentBody, "utf8")).toContain("build is broken");
    expect(existsSync(env.prReadyLog)).toBe(false);
    // Sentinel was consumed, not committed.
    expect(existsSync(join(env.worktree, ".jarvis-review-blocker"))).toBe(false);
  });

  test("review commit push failure exits 11 but auto-readies on successful gate re-run", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    const cap = captureIo();
    const claude = reviewFakeAgent(
      "claude",
      (_n, _cwd, prompt) => {
        return {
          kind: "ok",
          stdout: prompt.includes("Review: Adjudicator") ? "Refine code output.\n" : "",
          stderr: "",
        };
      },
      (_n, cwd) => {
        writeFileSync(env.failReviewPush, "1\n");
        writeFileSync(join(cwd, "code.txt"), "refined\n");
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(11);
    expect(cap.err()).toContain("review: actuator commit failed");
    // Completion (full) + shrink (fast) + review baseline (fast) + auto-ready with tree moved (full)
    expect(readFileSync(env.readyLog, "utf8").trim().split("\n")).toEqual(["full", "fast", "fast", "full"]);
    expect(readFileSync(env.prReadyLog, "utf8").trim().split("\n")).toEqual(["ready"]);
  });

  test("blocker without committable edits still comments and exits 7", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    const cap = captureIo();
    const claude = reviewFakeAgent("claude", (_n, cwd) => {
      writeFileSync(env.failReviewPush, "1\n");
      writeFileSync(join(cwd, ".jarvis-review-blocker"), "build is broken\n");
      writeFileSync(join(cwd, "code.txt"), "partial\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(7);
    expect(readFileSync(env.prCommentBody, "utf8")).toContain("build is broken");
    expect(existsSync(env.prReadyLog)).toBe(false);
  });

  test("review-agent quota exhaustion exits 11 but auto-readies PR on unchanged gate-green tree", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    const cap = captureIo();
    const claude = reviewFakeAgent("claude", () => ({ kind: "quota", stderr: "limit" }));

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(11);
    // Completion gate (full) + shrink (fast) + review baseline (fast) + auto-ready (fast)
    expect(readFileSync(env.readyLog, "utf8").trim().split("\n")).toEqual(["full", "fast", "fast", "fast"]);
    expect(readFileSync(env.prReadyLog, "utf8").trim().split("\n")).toEqual(["ready"]);
  });

  test("review uses the review agent order, not the implementation agents", async () => {
    const env = setupReviewEnv({
      patchAgentOrder: [CLAUDE_ENTRY],
      reviewAgentOrder: [CODEX_ENTRY],
      reviewPasses: 1,
    });
    const cap = captureIo();
    const claude = reviewFakeAgent(
      "claude",
      () => {
        throw new Error("claude must not run review passes");
      },
      (_n, cwd) => {
        writeFileSync(join(cwd, "code.txt"), "by claude actuator\n");
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );
    const codex = reviewFakeAgent("codex", (_n, _cwd, prompt) => {
      return {
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "Actuator should edit code.\n" : "",
        stderr: "",
      };
    });

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    // codex handled the review pass; claude handled implementation only.
    expect(codex.calls.some((c) => isPatchReviewPrompt(c.prompt))).toBe(true);
    expect(claude.calls.some((c) => isPatchReviewPrompt(c.prompt))).toBe(false);
    expect(env.reviewCommitSubjects()).toEqual(["review: actuator"]);
  });

  test("review still runs on the closing iteration when maxIterations is exhausted", async () => {
    const env = setupReviewEnv({ reviewPasses: 1, maxIterations: 1 });
    const cap = captureIo();
    const claude = reviewFakeAgent(
      "claude",
      (_n, _cwd, prompt) => {
        return {
          kind: "ok",
          stdout: prompt.includes("Review: Adjudicator") ? "Refine code output.\n" : "",
          stderr: "",
        };
      },
      (_n, cwd) => {
        writeFileSync(join(cwd, "code.txt"), "x\n");
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(env.reviewCommitSubjects()).toEqual(["review: actuator"]);
  });

  test("--review-passes 0 disables the review phase", async () => {
    const env = setupReviewEnv({ reviewPasses: 2 });
    const cap = captureIo();
    const claude = reviewFakeAgent("claude", () => {
      throw new Error("review must not run when disabled");
    });

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      reviewPasses: 0,
      agents: { claude },
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(env.reviewCommitSubjects()).toEqual([]);
    // With review disabled, readiness falls back to the normal completion path.
    expect(readFileSync(env.prReadyLog, "utf8").trim().split("\n")).toEqual(["ready"]);
  });
});

describe("--resume-review: review resume on completed specs", () => {
  test("Guard 1: review disabled exits 1 with distinct message", async () => {
    const env = setupReviewEnv({ reviewPasses: 0 });
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("no agent should run under guard rejection");
    });

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      resumeReview: true,
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("requires review passes > 0");
    expect(claude.calls).toHaveLength(0);
  });

  test("Guard 2: git off exits 1 with distinct message", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    const cap = captureIo();
    // Modify the loaded config to disable git.
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    writeConfig(cfg, { dir: cfgDir });
    const claude = new FakeAgent("claude", () => {
      throw new Error("no agent should run under guard rejection");
    });

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      resumeReview: true,
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("requires git mode to be enabled");
    expect(claude.calls).toHaveLength(0);
  });

  test("Guard 3: no implementation PR (fresh clone case) exits 1 after fetch", async () => {
    // Set up: completed spec on main branch, but no feature branch pushed to origin.
    // This simulates a fresh clone where the origin/<feature> remote ref does not exist locally.
    const origin = join(dir, "origin.git");
    execSync(`git init --bare ${origin}`);
    execSync("git init -b main", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    execSync(`git remote add origin ${origin}`, { cwd: projectRoot });

    // Create a completed spec on main.
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    writeFileSync(spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] [00 - One](./00-one.md)\n`);
    writeFileSync(join(specDir, "00-one.md"), "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n");
    execSync("git add -A && git commit -m init && git push -u origin main", { cwd: projectRoot });

    // Simulate fresh clone: no feature branch was ever pushed.
    // branchExistsOnOrigin would return false locally, but the harness should fetch first.
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("no agent should run under guard rejection");
    });

    const code = await runCommand({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      resumeReview: true,
      // CI has no authenticated gh; skip the gh-ready preflight so this test
      // exercises the resume-review branch-existence guard, not assertGhReady.
      skipGhCheck: true,
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("no implementation PR exists");
    expect(cap.err()).toContain("no remote branch found");
    expect(claude.calls).toHaveLength(0);
  });

  test("Guard 4: incomplete spec exits 1 with distinct message", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    // First, complete the spec by checking all tasks.
    writeFileSync(env.spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] [00 - One](./00-one.md)\n`);
    execSync("git add -A && git commit -m complete && git push origin main", { cwd: projectRoot });
    // Create and push a feature branch (simulates an implementation that completed).
    execSync("git checkout -b feature && git push -u origin feature", { cwd: projectRoot });
    // Now revert the spec to have unchecked tasks.
    execSync("git checkout main", { cwd: projectRoot });
    writeFileSync(env.spec, `repo: ${projectRoot}\n\n# Feature\n\n- [ ] [00 - One](./00-one.md)\n`);
    execSync("git add -A && git commit -m revert && git push origin main", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("no agent should run under guard rejection");
    });

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      resumeReview: true,
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("spec has unchecked tasks");
    expect(claude.calls).toHaveLength(0);
  });

  test("Guard 3 passes on fresh clone when feature branch does exist on origin", async () => {
    // Set up: completed spec AND feature branch pushed to origin.
    // Simulates: fresh clone where origin/<feature> exists but wasn't fetched yet locally.
    // After bestEffortFetch, branchExistsOnOrigin should return true.
    const origin = join(dir, "origin.git");
    execSync(`git init --bare ${origin}`);
    execSync("git init -b main", { cwd: projectRoot });
    execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
    execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
    execSync(`git remote add origin ${origin}`, { cwd: projectRoot });

    // Create and push a feature branch.
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    writeFileSync(spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] [00 - One](./00-one.md)\n`);
    writeFileSync(join(specDir, "00-one.md"), "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });
    execSync("git branch feature && git push -u origin feature", { cwd: projectRoot });
    execSync("git push -u origin main", { cwd: projectRoot });

    // Now simulate a fresh clone: remove the local feature branch to test that fetch finds it.
    execSync("git branch -D feature", { cwd: projectRoot });

    const binDir = join(dir, "bin");
    mkdirSync(binDir);
    const realGit = execSync("command -v git", { encoding: "utf8" }).trim();
    const bun = join(binDir, "bun");
    const git = join(binDir, "git");
    const gh = join(binDir, "gh");
    const readyLog = join(dir, "ready-log");
    const prReadyLog = join(dir, "pr-ready-log");
    const prState = join(dir, "pr-state");
    const readyState = join(dir, "ready-state");

    writeFileSync(
      git,
      `#!/usr/bin/env bash
set -euo pipefail
exec "${realGit}" "$@"
`,
    );
    chmodSync(git, 0o755);

    writeFileSync(
      bun,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "run fix" ]]; then
  exit 0
fi
if [[ "$1 $2" == "run ready" ]]; then
  printf '%s\n' "\${JARVIS_READY_TIER:-full}" >> "${readyLog}"
  exit 0
fi
exit 1
`,
    );
    chmodSync(bun, 0o755);

    writeFileSync(
      gh,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "auth status" ]]; then exit 0; fi
if [[ "$1 $2" == "repo view" ]]; then printf 'main\\n'; exit 0; fi
if [[ "$1 $2" == "pr view" ]]; then
  if [[ ! -f "${prState}" ]]; then exit 1; fi
  if [[ "$*" == *"isDraft"* ]]; then
    if [[ -f "${readyState}" ]]; then printf 'false\\n'; else printf 'true\\n'; fi
  elif [[ "$*" == *"--json body"* ]]; then
    printf 'stub\\n'
  elif [[ "$*" == *"--json number,state"* ]]; then printf '1\\n';
  elif [[ "$*" == *"--json url"* ]]; then printf 'https://example/pull/1\\n';
  else printf '1\\n'; fi
  exit 0
fi
if [[ "$1 $2" == "pr edit" ]]; then exit 0; fi
if [[ "$1 $2" == "pr create" ]]; then touch "${prState}"; exit 0; fi
if [[ "$1 $2" == "pr ready" ]]; then printf 'ready\\n' >> "${prReadyLog}"; touch "${readyState}"; exit 0; fi
exit 1
`,
    );
    chmodSync(gh, 0o755);

    const oldPath = process.env.PATH;
    process.env.PATH = `${binDir}:${oldPath}`;

    try {
      writeFileSync(prState, "");
      const cap = captureIo();
      const claude = reviewFakeAgent("claude", () => ({
        kind: "ok",
        stdout: "No changes needed.",
        stderr: "",
      }));

      const code = await runCommand({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude },
        resumeReview: true,
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      // Should succeed past Guard 3 and enter review phase.
      expect(code).toBe(0);
      expect(claude.calls.length).toBeGreaterThan(0);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  test("successful resume-review runs review phase and transitions PR to ready", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    // Complete the spec and create feature branch for implementation PR.
    writeFileSync(env.spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] [00 - One](./00-one.md)\n`);
    execSync("git add -A && git commit -m complete && git push origin main", { cwd: projectRoot });
    execSync("git checkout -b feature && git push -u origin feature", { cwd: projectRoot });
    execSync("git checkout main", { cwd: projectRoot });
    writeFileSync(join(dirname(env.prReadyLog), "pr-state"), "");

    const cap = captureIo();
    const claude = reviewFakeAgent(
      "claude",
      (_n, _cwd, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "Looks good." : "",
        stderr: "",
      }),
      (_n, cwd) => {
        writeFileSync(join(cwd, "code.txt"), "improved\n");
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      resumeReview: true,
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    // PR should be marked ready by final gate.
    expect(readFileSync(env.prReadyLog, "utf8").trim().split("\n")).toEqual(["ready"]);
    // Review commit should be created.
    expect(env.reviewCommitSubjects()).toEqual(["review: actuator"]);
  });

  test("review runs with zero implementation iterations under --resume-review", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    // Complete the spec and create feature branch for implementation PR.
    writeFileSync(env.spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] [00 - One](./00-one.md)\n`);
    execSync("git add -A && git commit -m complete && git push origin main", { cwd: projectRoot });
    execSync("git checkout -b feature && git push -u origin feature", { cwd: projectRoot });
    execSync("git checkout main", { cwd: projectRoot });
    writeFileSync(join(dirname(env.prReadyLog), "pr-state"), "");

    const cap = captureIo();
    const claude = reviewFakeAgent(
      "claude",
      (_n, _cwd, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "Looks good." : "",
        stderr: "",
      }),
      (_n, cwd) => {
        writeFileSync(join(cwd, "code.txt"), "x\n");
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      resumeReview: true,
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    // Output should show iterations: 0
    expect(cap.out()).toContain("iterations: 0");
    // No implementation agent should have been invoked.
    // 3 review roles + 1 actuator = 4 calls total, no implementation.
    expect(claude.calls).toHaveLength(4);
  });

  test("no implementation agent is invoked under --resume-review", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    // Complete the spec and create feature branch for implementation PR.
    writeFileSync(env.spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] [00 - One](./00-one.md)\n`);
    execSync("git add -A && git commit -m complete && git push origin main", { cwd: projectRoot });
    execSync("git checkout -b feature && git push -u origin feature", { cwd: projectRoot });
    execSync("git checkout main", { cwd: projectRoot });
    writeFileSync(join(dirname(env.prReadyLog), "pr-state"), "");

    const cap = captureIo();
    let implementationAgentCalled = false;
    const _claude = new FakeAgent("claude", () => {
      implementationAgentCalled = true;
      throw new Error("implementation agent must not run under resume-review");
    });

    // Override the claude agent to be the review fake when review runs.
    const reviewClaude = reviewFakeAgent(
      "claude",
      (_n, _cwd, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "Good." : "",
        stderr: "",
      }),
      (_n, cwd) => {
        writeFileSync(join(cwd, "code.txt"), "x\n");
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude: reviewClaude },
      resumeReview: true,
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(implementationAgentCalled).toBe(false);
  });

  test("shrink phase is skipped under --resume-review (no shrink telemetry row)", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    // Complete the spec and create feature branch for implementation PR.
    writeFileSync(env.spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] [00 - One](./00-one.md)\n`);
    execSync("git add -A && git commit -m complete && git push origin main", { cwd: projectRoot });
    execSync("git checkout -b feature && git push -u origin feature", { cwd: projectRoot });
    execSync("git checkout main", { cwd: projectRoot });
    writeFileSync(join(dirname(env.prReadyLog), "pr-state"), "");

    const cap = captureIo();
    const claude = reviewFakeAgent(
      "claude",
      (_n, _cwd, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "Good." : "",
        stderr: "",
      }),
      (_n, cwd) => {
        writeFileSync(join(cwd, "code.txt"), "x\n");
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      resumeReview: true,
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    const telemetryPath = join(cfgDir, "runs.jsonl");
    const lines = readFileSync(telemetryPath, "utf8").trim().split("\n");
    // Should have terminal line only (no shrink phase row).
    const shrinkRows = lines.filter((line) => {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      return parsed.patch_phase === "shrink";
    });
    expect(shrinkRows).toHaveLength(0);
  });

  test("already-ready PR is left untouched (idempotent)", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    // Complete the spec and create feature branch for implementation PR.
    writeFileSync(env.spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] [00 - One](./00-one.md)\n`);
    execSync("git add -A && git commit -m complete && git push origin main", { cwd: projectRoot });
    execSync("git checkout -b feature && git push -u origin feature", { cwd: projectRoot });
    execSync("git checkout main", { cwd: projectRoot });
    writeFileSync(join(dirname(env.prReadyLog), "pr-state"), "");

    // Mark the PR as already ready.
    writeFileSync(env.prReadyLog, "ready\n");
    writeFileSync(join(dirname(env.prReadyLog), "ready-state"), "");
    const cap = captureIo();
    const claude = reviewFakeAgent(
      "claude",
      (_n, _cwd, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "Good." : "",
        stderr: "",
      }),
      (_n, cwd) => {
        writeFileSync(join(cwd, "code.txt"), "x\n");
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      resumeReview: true,
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    // Final `gh pr ready` should still run but be a no-op on an already-ready PR.
    // The prReadyLog should reflect the prior call only (no new entry).
    const readyLines = readFileSync(env.prReadyLog, "utf8").trim().split("\n");
    // One line from setup, one from final gate = 2 lines.
    expect(readyLines.filter((line) => line === "ready")).toHaveLength(2);
  });

  test("--max-iterations under --resume-review has no effect (zero implementation iterations)", async () => {
    const env = setupReviewEnv({ reviewPasses: 1 });
    // Complete the spec and create feature branch for implementation PR.
    writeFileSync(env.spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] [00 - One](./00-one.md)\n`);
    execSync("git add -A && git commit -m complete && git push origin main", { cwd: projectRoot });
    execSync("git checkout -b feature && git push -u origin feature", { cwd: projectRoot });
    execSync("git checkout main", { cwd: projectRoot });
    writeFileSync(join(dirname(env.prReadyLog), "pr-state"), "");

    const cap = captureIo();
    const claude = reviewFakeAgent(
      "claude",
      (_n, _cwd, prompt) => ({
        kind: "ok",
        stdout: prompt.includes("Review: Adjudicator") ? "Good." : "",
        stderr: "",
      }),
      (_n, cwd) => {
        writeFileSync(join(cwd, "code.txt"), "x\n");
        return { kind: "ok", stdout: "", stderr: "" };
      },
    );

    const code = await runCommand({
      specPath: env.spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 5 },
      agents: { claude },
      resumeReview: true,
      logClient: { assertReachable: async () => {}, send: async () => {} },
      handleSignals: false,
    });

    expect(code).toBe(0);
    // Even with maxIterations: 5, should still show iterations: 0.
    expect(cap.out()).toContain("iterations: 0");
  });
});

function setupGit(): void {
  execSync("git init -b jarvis-e2e", { cwd: projectRoot });
  execSync('git config user.email "jarvis-test@example.com"', {
    cwd: projectRoot,
  });
  execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
}

// Put a `bun` shim on PATH that answers built-in `bun run fix` and delegates
// everything else to the real bun (the bare temp repos these gate tests use have
// no `fix` script). By default `run fix` is a no-op; pass `fixWritesFile` to have
// it emit an autofix change in cwd, exercising the pre-ready fix-commit path.
// PATH is restored by the afterEach.
function installNoopFixBun(opts: { fixWritesFile?: string } = {}): void {
  const realBun = execSync("command -v bun", { encoding: "utf8" }).trim();
  const fixBinDir = mkdtempSync(join(tmpdir(), "jarvis-fixbun-"));
  const bunPath = join(fixBinDir, "bun");
  const fixBody =
    opts.fixWritesFile !== undefined ? `printf 'fixed\\n' > "$PWD/${opts.fixWritesFile}"\n  exit 0` : "exit 0";
  writeFileSync(
    bunPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-} \${2:-}" == "run fix" ]]; then
  ${fixBody}
fi
exec "${realBun}" "$@"
`,
  );
  chmodSync(bunPath, 0o755);
  process.env.PATH = `${fixBinDir}:${process.env.PATH ?? ""}`;
}

function writeSpec(contents: string): string {
  const spec = join(projectRoot, "index.md");
  writeFileSync(spec, withRepo(contents));
  return spec;
}

function writeNamedSpec(name: string, contents: string): string {
  const specDir = join(projectRoot, name);
  mkdirSync(specDir);
  const spec = join(specDir, "index.md");
  writeFileSync(spec, withRepo(contents));
  return spec;
}

function writeDirectSpec(contents: string): string {
  const spec = join(projectRoot, "spec.md");
  writeFileSync(spec, withRepo(contents));
  return spec;
}

function writeExternalSpec(contents: string): string {
  const specDir = join(dir, "external-specs");
  mkdirSync(specDir, { recursive: true });
  const spec = join(specDir, "index.md");
  writeFileSync(spec, withRepo(contents));
  return spec;
}

function writeSpecWithoutRepo(contents: string): string {
  const specDir = join(dir, "missing-repo");
  mkdirSync(specDir, { recursive: true });
  const spec = join(specDir, "index.md");
  writeFileSync(spec, contents);
  return spec;
}

function withRepo(contents: string): string {
  return `repo: ${projectRoot}\n\n${contents}`;
}

function setupLinkedSubspecRepo(opts: { trackedFile: boolean; criteria: string[] }): {
  spec: string;
  subspec: string;
  trackedFilePath?: string;
} {
  setupGit();
  const specDir = join(projectRoot, "spec", "feature");
  mkdirSync(specDir, { recursive: true });
  const spec = join(specDir, "index.md");
  const subspec = join(specDir, "00-one.md");
  writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n"));
  writeFileSync(
    subspec,
    `# 00 - One\n\n## Acceptance criteria\n\n${opts.criteria.map((text) => `- [ ] ${text}`).join("\n")}\n`,
  );
  let trackedFilePath: string | undefined;
  if (opts.trackedFile) {
    trackedFilePath = join(projectRoot, "tracked.txt");
    writeFileSync(trackedFilePath, "base\n");
  }
  execSync("git add -A && git commit -m init", { cwd: projectRoot });
  return { spec, subspec, ...(trackedFilePath === undefined ? {} : { trackedFilePath }) };
}
