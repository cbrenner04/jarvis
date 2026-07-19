import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runAgent } from "../src/agents/spawn.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { type AgentEntry, DEFAULT_CONFIG, loadConfig, registerProject, writeConfig } from "../src/config.ts";
import {
  __testClearDeltaStateDir,
  __testSetDeltaStateDir,
  createFreshDelta,
  recordBlocker,
  recordNewlyCheckedAc,
} from "../src/modes/patch/no-commit-delta.ts";
import {
  type CompletionReadyGateResult,
  type RunCommandOptions,
  type RunIo,
  runCommand,
} from "../src/modes/patch/run.ts";
import { HARNESS_IDLE_TIMEOUT_FALLBACK } from "../src/quota-harness-messages.ts";
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
const _CURSOR_ENTRY = { agent: "cursor" as const, model: "Composer 2.5" };
const _CLAUDE_MONTHLY_SPEND_FIXTURE = readFileSync(
  join(import.meta.dir, "fixtures/claude/2.1.142-monthly-spend-limit.json"),
  "utf8",
);

function _fakeClaudeBinary(dir: string, opts: { exit: number; stdout?: string; stderr?: string }): string {
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

function _initGitRepoWithOrigin(remoteName = "origin.git"): string {
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

function _installGhReadyStub(): string {
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

describe("completion-gate tests", () => {
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

  test("completion ready gate: red verification is terminal", async () => {
    const spec = initCompletionGateRepo();
    const cap = captureIo();
    const claude = createCompletionAgent(spec);

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      runCompletionReadyGate: () => ({
        kind: "red",
        failureText: "bun run ready failed:\nboom",
        verificationRed: true,
      }),
    });

    expect(code).toBe(10);
    expect(claude.calls).toHaveLength(1);
    const records = readFileSync(join(cfgDir, "runs.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const terminal = records.find((record) => record.record_role === "run_terminal");
    expect(terminal?.exit_reason).toBe("ready-gate-failed");
    expect(cap.err()).toContain("bun run ready failed:");
  });

  test.skip("completion ready gate: red-then-green seam yields green completion, no fix-up iteration", async () => {
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

  test("completion ready gate: operational failure exits 6 without successful telemetry", async () => {
    const spec = initCompletionGateRepo();
    const cap = captureIo();
    const claude = createCompletionAgent(spec);
    const cfg = loadConfig({ dir: cfgDir });
    const project = cfg.projects.project;
    if (project === undefined) throw new Error("missing registered project");
    cfg.iterationTimeoutMs = 10;
    project.readyCommand = "/bin/sleep 1";
    writeConfig(cfg, { dir: cfgDir });

    const code = await runCommand({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
      reviewPasses: 0,
      skipGhCheck: true,
      logClient: { assertReachable: async () => {}, send: async () => {} },
    });

    expect(code).toBe(6);
    expect(cap.err()).toContain("/bin/sleep 1 exceeded 10ms budget (gate: completion-ready)");
    const records = readFileSync(join(cfgDir, "runs.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.some((record) => record.exit_reason === "criteria-complete")).toBeFalse();
    expect(records.some((record) => record.exit_reason === "completed-spec")).toBeFalse();
    expect(records.find((record) => record.record_role === "run_terminal")?.exit_reason).toBe("dirty-worktree");
  });

  test.skip("completion: fix-up iteration counts against maxIterations; exhausted budget stops with exit 5", async () => {
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

  test.skip("completion: blocker added during fix-up iteration stops with exit 7", async () => {
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

  test.skip("completion: all-red seam retries to the bound, then stops on unchanged failure", async () => {
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

  test.skip("completion: fix-up idle stall exits 8 terminally without agentOrder escalation", async () => {
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

  test.skip("completion: stuck-red stop (exit 10) when failure unchanged after fix-up iteration", async () => {
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

  test.skip("completion: changed failure loops back instead of stopping with exit 10", async () => {
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

  test.skip("completion: noise-only differences (timings/paths) are treated as unchanged", async () => {
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

  test.skip("completion: telemetry includes ready-stuck-red exit reason", async () => {
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

  test.skip("completion: changing-failure bound stops at N consecutive red fix-up iterations with no AC progress", async () => {
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

  test.skip("completion: changing-failure message is distinct from identical-failure message", async () => {
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

  test.skip("completion: stuck-red with real fix-up commits resets to baseline and messages name flaky-or-real", async () => {
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

  test.skip("completion: failed force-push still exits 10 with ready-stuck-red telemetry", async () => {
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

  test.skip("completion: no upstream / skipGhCheck exits 10 with no push attempted", async () => {
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

    test.skip("real path: red-then-green completion readyCommand leaves a clean HEAD-recordable tree", async () => {
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

  describe.skip("readyGateRetryBound configuration", () => {
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

  test("legacy readyGateRetryBound loads with warning, is omitted, and cannot retry", async () => {
    const spec = initCompletionGateRepo();
    const configPath = join(cfgDir, "config.json");
    const saved = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const projects = saved.projects as Record<string, Record<string, unknown>>;
    const project = projects.project;
    if (project === undefined) throw new Error("missing registered project");
    project.readyGateRetryBound = 2;
    writeFileSync(configPath, JSON.stringify(saved));

    let warning = "";
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => {
      warning += String(chunk);
      return true;
    }) as typeof process.stderr.write;
    let loaded: ReturnType<typeof loadConfig>;
    try {
      loaded = loadConfig({ dir: cfgDir });
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(warning).toContain('project "project" readyGateRetryBound is deprecated and ignored');
    expect(loaded.projects.project?.readyGateRetryBound).toBeUndefined();
    writeConfig(loaded, { dir: cfgDir });
    expect(readFileSync(configPath, "utf8")).not.toContain("readyGateRetryBound");

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
        return { kind: "red", failureText: "bun run ready failed", verificationRed: true };
      },
    });

    expect(code).toBe(10);
    expect(gateCalls).toBe(1);
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
});

// Type definitions and review helpers
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

function _writeNamedSpec(name: string, contents: string): string {
  const specDir = join(projectRoot, name);
  mkdirSync(specDir);
  const spec = join(specDir, "index.md");
  writeFileSync(spec, withRepo(contents));
  return spec;
}

function _writeDirectSpec(contents: string): string {
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

function _writeSpecWithoutRepo(contents: string): string {
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
