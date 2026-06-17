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
import { runAgent } from "../src/agents/spawn.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { type AgentEntry, loadConfig, registerProject, writeConfig } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";
import {
  maybeWarnAboutUnmergedPlanBranch,
  prepareActiveSpecPath,
  type RunCommandOptions,
  type RunIo,
  runCommand,
} from "../src/modes/patch/run.ts";
import { NARRATIVE_END_MARKER } from "../src/pr.ts";
import {
  HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessQuotaFallbackLenientLine,
} from "../src/quota-harness-messages.ts";

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
    ...disableReviewByDefault(opts),
    skipGhCheck: true,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-run-"));
  projectRoot = join(dir, "project");
  cfgDir = join(dir, "cfg");
  originalPath = process.env.PATH;
  mkdirSync(projectRoot);
  registerProject("project", projectRoot, { dir: cfgDir });
});

afterEach(() => {
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

  test("exits 6 when checklists are complete but the git worktree is dirty", async () => {
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

    expect(code).toBe(6);
    expect(cap.err()).toContain("not clean");
    expect(cap.err()).toContain("jarvis1 triage");
    expect(cap.out()).not.toContain("spec complete");
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
    expect(claude.calls[0]?.prompt).toContain("Inspect the target repo for guidance");
    expect(claude.calls[0]?.prompt).toContain("Follow these Jarvis rules:");
    expect(claude.calls[0]?.prompt).not.toContain("Read README.md.");
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
    expect(cap.err()).toContain("spec repo must be an absolute path");
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

  test("exits 4 with unticked criteria guidance when linked subspec clean iteration makes no progress", async () => {
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
if [[ "$1 $2" == "run ready" ]]; then
  printf 'ready-gate\\n' >> "${readyGateLog}"
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
    expect(readFileSync(prViewLog, "utf8").trim().split("\n")).toHaveLength(6);
    expect(readFileSync(prEditLog, "utf8").trim().split("\n")).toEqual(["edit"]);
    expect(readFileSync(readyGateLog, "utf8").trim().split("\n")).toEqual(["ready-gate", "ready-gate"]);
    expect(readFileSync(readyLog, "utf8").trim().split("\n")).toEqual(["ready"]);
    expect(readFileSync(createCommitCount, "utf8").trim()).toBe("1");
    expect(readFileSync(readyCommitCount, "utf8").trim()).toBe("2");
    expect(readFileSync(prTitle, "utf8")).toBe("Feature");
    const expectedBody = [
      "# Feature",
      "",
      "<!-- jarvis:narrative:start -->",
      "Auto-generated by jarvis",
      "<!-- jarvis:narrative:end -->",
    ].join("\n");
    const subspecShas = execSync("git log --reverse --format=%h main..feature", { cwd: projectRoot, encoding: "utf8" })
      .trim()
      .split("\n");
    expect(subspecShas).toHaveLength(2);
    const body = readFileSync(prBody, "utf8");
    expect(body).toContain(expectedBody.replace(NARRATIVE_END_MARKER, ""));
    expect(body).toContain("<!-- jarvis:narrative:generated-sha256:");
    expect(body).toContain(`${NARRATIVE_END_MARKER}\n\n---\n\nWritten by fake-claude through Jarvis.`);
    expect(
      execSync("gh pr view feature --json isDraft -q .isDraft", {
        cwd: join(projectRoot, ".worktree", "feature"),
        env: process.env,
        encoding: "utf8",
      }).trim(),
    ).toBe("false");
    expect(claude.calls).toHaveLength(5);
    const subjects = execSync("git log --format=%s main..feature", {
      cwd: projectRoot,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .reverse();
    expect(subjects).toEqual(["00 - One", "01 - Two"]);
  });

  test("uses fallback PR body when deterministic spec body is empty", async () => {
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
if [[ "$1 $2" == "run ready" ]]; then
  printf 'ready-gate\\n' >> "${readyGateLog}"
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
    expect(claude.calls).toHaveLength(3);
    expect(readFileSync(readyGateLog, "utf8").trim().split("\n")).toEqual(["ready-gate", "ready-gate"]);
    const expectedDegenerateBody = [
      "<!-- jarvis:narrative:start -->",
      "Auto-generated by jarvis",
      "<!-- jarvis:narrative:end -->",
    ].join("\n");
    const body = readFileSync(prBody, "utf8");
    expect(body).toContain(expectedDegenerateBody.replace(NARRATIVE_END_MARKER, ""));
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
        iterationTimeoutMs: 30 * 60_000,
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
        iterationTimeoutMs: 30 * 60_000,
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

  test("patch mode constructs an AiderAgent for aider entries", async () => {
    const spec = writeSpec("- [ ] todo\n");
    const binDir = join(dir, "bin");
    mkdirSync(binDir);
    const aider = join(binDir, "aider");
    writeFileSync(
      aider,
      `#!/usr/bin/env bash
: > "${dir}/aider-argv"
for a in "$@"; do printf '%s\\0' "$a" >> "${dir}/aider-argv"; done
exit 0
`,
    );
    chmodSync(aider, 0o755);
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    writeConfig(
      {
        version: 2,
        modes: {
          patch: {
            agentOrder: [{ agent: "aider", model: "ollama/llama3.1:8b" }],
          },
          plan: { agentOrder: [CLAUDE_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: 30 * 60_000,
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
    expect(readFileSync(join(dir, "aider-argv"), "utf8")).toContain("--model\0ollama/llama3.1:8b\0");
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
        iterationTimeoutMs: 30 * 60_000,
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
        iterationTimeoutMs: 30 * 60_000,
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
        iterationTimeoutMs: 30 * 60_000,
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
        iterationTimeoutMs: 30 * 60_000,
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
        iterationTimeoutMs: 30 * 60_000,
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
        iterationTimeoutMs: 30 * 60_000,
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
        iterationTimeoutMs: 30 * 60_000,
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
        iterationTimeoutMs: 30 * 60_000,
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
        iterationTimeoutMs: 30 * 60_000,
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
          iterationTimeoutMs: 30 * 60_000,
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
      const spec = writeSpec("- [ ] todo\n");
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
    });

    test("watchdog timeout kills SIGTERM-ignoring grandchildren and records pgid telemetry", async () => {
      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const ignoreTermScript = join(projectRoot, "ignore-term.sh");
      writeFileSync(
        ignoreTermScript,
        `#!/usr/bin/env bash
trap '' TERM
while true; do :; done
`,
      );
      chmodSync(ignoreTermScript, 0o755);
      const hangScript = join(projectRoot, "hang-agent.sh");
      writeFileSync(
        hangScript,
        `#!/usr/bin/env bash
set -euo pipefail
"$PWD/ignore-term.sh" &
echo "$!" > "$PWD/hanging-child.pid"
wait
`,
      );
      chmodSync(hangScript, 0o755);

      class HangingAgent implements Agent {
        readonly name = "claude" as const;
        async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
          return runAgent(
            {
              name: this.name,
              binary: hangScript,
              cwd: opts.cwd,
              buildArgv: () => [],
              stdio: ["ignore", "pipe", "pipe"],
              streamErrorPrefix: "test:",
            },
            prompt,
            opts,
          );
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

      const started = Date.now();
      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude: new HangingAgent() },
        handleSignals: false,
        __testKillGraceMs: 200,
      });
      const elapsedMs = Date.now() - started;

      expect(code).toBe(8);
      expect(elapsedMs).toBeLessThanOrEqual(7200);
      expect(cap.err()).toContain("[watchdog] iteration timeout fired after 1500ms;");

      const childPid = Number.parseInt(readFileSync(join(projectRoot, "hanging-child.pid"), "utf8").trim(), 10);
      expect(Number.isFinite(childPid)).toBe(true);
      let childAlive = true;
      try {
        process.kill(childPid, 0);
      } catch {
        childAlive = false;
      }
      expect(childAlive).toBe(false);

      const telemetryPath = join(cfgDir, "runs.jsonl");
      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const timeoutRow = rows.find(
        (row) => row.record_role !== "run_terminal" && row.exit_reason === "watchdog-iteration-timeout",
      );
      expect(timeoutRow).toBeDefined();
      expect(typeof timeoutRow?.watchdog_pgid).toBe("number");

      const sessionsDir = join(cfgDir, "sessions");
      const sessionFile = readdirSync(sessionsDir)[0];
      if (sessionFile === undefined) {
        throw new Error("expected a session log file");
      }
      const sessionLog = readFileSync(join(sessionsDir, sessionFile), "utf8");
      expect(sessionLog).toContain("[watchdog] iteration timeout fired after 1500ms;");
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
          iterationTimeoutMs: 30 * 60_000,
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

  writeFileSync(
    git,
    `#!/usr/bin/env bash
set -euo pipefail
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
if [[ "$1 $2" == "run ready" ]]; then
  printf 'ready\\n' >> "${readyLog}"
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
        patch: { agentOrder: opts.patchAgentOrder ?? [CLAUDE_ENTRY] },
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
      iterationTimeoutMs: 30 * 60_000,
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
    expect(reviewPrompt).toContain("diff --git");
    expect(reviewPrompt).not.toContain("failed to generate diff");
    expect(cap.out()).toContain("iterations: 1");
    expect(cap.out()).toContain("review attempts: 4"); // 3 roles + actuator
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

  test("review commit push failure leaves PR draft and exits 1", async () => {
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

    expect(code).toBe(1);
    expect(cap.err()).toContain("review: actuator commit failed");
    expect(existsSync(env.prReadyLog)).toBe(false);
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

  test("review-agent quota exhaustion exits 2 and leaves the PR draft", async () => {
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

    expect(code).toBe(2);
    expect(existsSync(env.prReadyLog)).toBe(false);
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
