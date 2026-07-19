import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { loadConfig, registerProject, writeConfig } from "../src/config.ts";
import { __testClearDeltaStateDir, __testSetDeltaStateDir } from "../src/modes/patch/no-commit-delta.ts";
import { type RunCommandOptions, type RunIo, runCommand } from "../src/modes/patch/run.ts";
import { NARRATIVE_END_MARKER } from "../src/pr.ts";
import { beginHangFixtureTracking, reapActiveHangFixtures } from "./idle-hang-fixtures.ts";

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
    runCompletionReadyGate: () => ({ kind: "green" }),
    ...disableReviewByDefault(opts),
    skipGhCheck: true,
  });
}

function setupGit(): void {
  execSync("git init -b jarvis-e2e", { cwd: projectRoot });
  execSync('git config user.email "jarvis-test@example.com"', {
    cwd: projectRoot,
  });
  execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
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

describe("runCommand linked-subspec and PR tests", () => {
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
        writeFileSync(join(projectRoot, "one.txt"), "one\n");
      } else {
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
    expect(claude.calls.length).toBe(2);
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
        writeFileSync(subspec, `${header}- [x] First.\n- [ ] Second.\n`);
      } else {
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
    expect(claude.calls).toHaveLength(2);
    expect(readFileSync(readyGateLog, "utf8").trim().split("\n")).toEqual(["full", "fast", "fast"]);
    const body = readFileSync(prBody, "utf8");
    expect(body).toContain("## Subspecs\n");
    expect(body).toContain("- 00 - One\n");
    expect(body).toContain("## Commits\n");
    expect(body).toContain("<!-- jarvis:narrative:generated-sha256:");
    expect(body).toContain(`${NARRATIVE_END_MARKER}\n\n---\n\nWritten by fake-claude through Jarvis.`);
  });
});
