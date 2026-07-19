import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAgent } from "../src/agents/claude.ts";
import { runAgent } from "../src/agents/spawn.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { DEFAULT_CONFIG, loadConfig, registerProject, writeConfig } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";
import {
  __testClearDeltaStateDir,
  __testSetDeltaStateDir,
  createFreshDelta,
  recordBlocker,
  recordNewlyCheckedAc,
} from "../src/modes/patch/no-commit-delta.ts";
import { prepareActiveSpecPath, type RunCommandOptions, type RunIo, runCommand } from "../src/modes/patch/run.ts";
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
  trackHangFixtureScript,
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

function _initCompletionGateRepo(specContents = "- [ ] todo\n"): string {
  execSync("git init -b jarvis-e2e", { cwd: projectRoot });
  execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
  execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
  const spec = writeSpec(specContents);
  execSync("git add index.md && git commit -m init", { cwd: projectRoot });
  return spec;
}

function _createCompletionAgent(spec: string, onFixup?: (callCount: number) => void): FakeAgent {
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

function _createCompletionThenIdleAgent(spec: string, hangScript: string): FakeAgent {
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

function _createIdleHangAgent(name: AgentName, hangScript: string): FakeAgent {
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

const _DRAFT_PR_17_JSON =
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

function _writeManagedExternalSpec(specName: string): { indexPath: string; subspecPath: string; specRoot: string } {
  const specRoot = join(cfgDir, "specs", "project", specName);
  mkdirSync(specRoot, { recursive: true });
  const indexPath = join(specRoot, "index.md");
  const subspecPath = join(specRoot, "00-one.md");
  writeFileSync(indexPath, `repo: ${projectRoot}\n\n# Feature\n\n- [ ] [00 - One](./00-one.md)\n`);
  writeFileSync(subspecPath, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n");
  return { indexPath, subspecPath, specRoot };
}

function _writeStaleExternalDelta(subspecPath: string): void {
  writeFileSync(
    subspecPath,
    "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n\n## Blocker\n\nNeed a rerun.\n",
  );
  const delta = createFreshDelta(subspecPath);
  recordNewlyCheckedAc(delta, "One accepted.");
  recordBlocker(delta, "Need a rerun.");
}

function _createStalePatchBranch(specName: string): string {
  execSync(`git checkout -b ${specName}`, { cwd: projectRoot });
  const stalePath = join(projectRoot, "stale.txt");
  writeFileSync(stalePath, "stale\n");
  execSync("git add stale.txt && git commit -m stale && git push -u origin HEAD", { cwd: projectRoot });
  execSync("git checkout main", { cwd: projectRoot });
  const worktreePath = join(projectRoot, ".worktree", specName);
  execSync(`git worktree add ${worktreePath} ${specName}`, { cwd: projectRoot });
  return worktreePath;
}

function _installCleanupGhStub(
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

function _repeatFailureText(failureText: string, count: number): string[] {
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
      "-p\0--permission-mode\0acceptEdits\0--model\0haiku\0--output-format\0stream-json\0--verbose\0",
    );
  });

  test("ClaudeAgent stream-json output records non-null last_output_age_ms on iteration timeout", async () => {
    const iterationTimeoutMs = 2000;
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const streamThenHang = join(dir, "claude-stream-then-hang.sh");
    writeFileSync(
      streamThenHang,
      `#!/usr/bin/env bash
set -euo pipefail
echo '{"type":"system","subtype":"init"}'
sleep 0.2
echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}'
sleep 0.2
echo '{"type":"result","result":"hello","total_cost_usd":0,"usage":{"input_tokens":1,"output_tokens":1,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}'
exec tail -f /dev/null
`,
    );
    chmodSync(streamThenHang, 0o755);
    trackHangFixtureScript(streamThenHang);
    const claude = new ClaudeAgent({ binary: streamThenHang });
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
        iterationTimeoutMs,
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
      __testKillGraceMs: 200,
    });

    expect(code).toBe(8);
    const rows = readFileSync(join(cfgDir, "runs.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const timeoutRow = rows.find((row) => row.exit_reason === "watchdog-iteration-timeout");
    expect(timeoutRow).toBeDefined();
    expect(typeof timeoutRow?.last_output_age_ms).toBe("number");
  });

  test("silent ClaudeAgent idle-escalates through agentOrder", async () => {
    const idleTimeoutMs = 1000;
    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const hangScript = writeIdleHangScript(join(dir, "claude-agent-idle.sh"));
    const claude = new ClaudeAgent({ binary: hangScript });
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
    writeConfig(
      {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 3,
        iterationTimeoutMs: 30 * 60_000,
        idleOutputTimeoutMs: idleTimeoutMs,
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
      __testKillGraceMs: 200,
    });

    expect(code).toBe(4);
    expect(cap.err()).toContain(`claude: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
    expect(codex.calls).toHaveLength(1);
    const rows = readFileSync(join(cfgDir, "runs.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const fallbackRow = rows.find((row) => row.exit_reason === "watchdog-idle-timeout-fallback");
    expect(fallbackRow).toBeDefined();
    expect(fallbackRow?.agent).toBe("claude");
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
function _installNoopFixBun(opts: { fixWritesFile?: string } = {}): void {
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

function _writeNamedSpec(name: string, contents: string): string {
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

function _writeExternalSpec(contents: string): string {
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

function _setupLinkedSubspecRepo(opts: { trackedFile: boolean; criteria: string[] }): {
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
