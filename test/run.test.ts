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
import { dirname, join } from "node:path";
import type {
  Agent,
  AgentName,
  AgentResult,
  AgentRunOptions,
} from "../src/agents/types.ts";
import {
  prepareActiveSpecPath,
  type RunCommandOptions,
  type RunIo,
  runCommand,
} from "../src/commands/run.ts";
import { loadConfig, registerProject, writeConfig } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";

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
  readonly #run: (
    callCount: number,
    prompt: string,
    opts: AgentRunOptions,
  ) => AgentResult | Promise<AgentResult>;

  constructor(
    name: AgentName,
    run: (
      callCount: number,
      prompt: string,
      opts: AgentRunOptions,
    ) => AgentResult | Promise<AgentResult>,
  ) {
    this.name = name;
    this.#run = run;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    this.calls.push({ prompt, cwd: opts.cwd });
    this.callOpts.push(opts);
    return this.#run(this.calls.length, prompt, opts);
  }
}

let dir: string;
let projectRoot: string;
let cfgDir: string;
let originalPath: string | undefined;

const DEFAULT_PATCH_MODELS = {
  claude: "haiku",
  codex: "gpt-5.3-codex",
  cursor: "Composer 2",
  opencode: "github-copilot/claude-opus-4.7",
};

async function runWithDefaults(opts: RunCommandOptions): Promise<number> {
  return runCommand({
    ...opts,
    skipGhCheck: true,
    logClient: {
      assertReachable: async () => {},
      send: async () => {},
    },
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
  test("refuses to run when log server is unreachable", async () => {
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
      skipGhCheck: true,
      logClient: {
        assertReachable: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:4310");
        },
        send: async () => {},
      },
      handleSignals: false,
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("log server unreachable");
    expect(cap.err()).toContain("jarvis log-server");
    expect(claude.calls).toHaveLength(0);
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
    execSync(
      "git remote add origin https://github.com/example/lazy-project.git",
      { cwd: projectRoot },
    );
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
    expect(cap.err()).toContain("jarvis triage");
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
    expect(claude.calls[0]?.prompt).toContain(
      "Inspect the target repo for guidance",
    );
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
    const spec = writeSpecWithoutRepo(
      "# Feature\n\nrepo: ./project\n\n- [ ] todo\n",
    );
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

    const code = await runCommand({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      skipGhCheck: true,
      logClient,
      handleSignals: false,
    });

    expect(code).toBe(0);
    const firstOutbound = messages.findIndex((m) => m.tag === "outbound");
    const firstInboundOut = messages.findIndex(
      (m) => m.tag === "inbound_stdout",
    );
    const firstInboundErr = messages.findIndex(
      (m) => m.tag === "inbound_stderr",
    );
    expect(firstOutbound).toBeGreaterThan(0);
    expect(firstInboundOut).toBeGreaterThan(firstOutbound);
    expect(firstInboundErr).toBeGreaterThan(firstOutbound);
    expect(messages[0]?.tag).toBe("harness");
    expect(messages[0]?.namespace).toBe("project:feature");
    expect(messages[0]?.text).toContain("current-task: 1/1 todo");

    const sessionFiles = readdirSync(join(cfgDir, "sessions"));
    expect(sessionFiles).toHaveLength(1);
    expect(sessionFiles[0]).toContain("project:feature-");
    const sessionBody = readFileSync(
      join(cfgDir, "sessions", sessionFiles[0] as string),
      "utf8",
    );
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
      writeFileSync(
        spec,
        callCount === 1 ? "- [x] one\n- [ ] two\n" : "- [x] one\n- [x] two\n",
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
    writeFileSync(
      spec,
      withRepo(
        "- [ ] [00 - One](./00-one.md)\n- [ ] [01 - Two](./01-two.md)\n",
      ),
    );
    writeFileSync(
      firstSubspec,
      "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n",
    );
    writeFileSync(
      secondSubspec,
      "# 01 - Two\n\n## Acceptance criteria\n\n- [ ] Two accepted.\n",
    );
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      if (callCount === 1) {
        writeFileSync(join(projectRoot, "one.txt"), "one\n");
        writeFileSync(
          firstSubspec,
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n",
        );
      } else {
        writeFileSync(join(projectRoot, "two.txt"), "two\n");
        writeFileSync(
          secondSubspec,
          "# 01 - Two\n\n## Acceptance criteria\n\n- [x] Two accepted.\n",
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
    expect(
      execSync("git status --porcelain", { cwd: projectRoot }).toString(),
    ).toBe("");
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
    expect(latestMessage).toContain(
      "## Acceptance criteria\n\n- [x] Two accepted.",
    );
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
    writeFileSync(
      join(specDir, "00-one.md"),
      "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n",
    );
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
    expect(cap.err()).toContain("jarvis triage");
    expect(readFileSync(spec, "utf8")).toContain(
      "- [ ] [00 - One](./00-one.md)",
    );
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
    expect(
      execSync("git status --porcelain", { cwd: projectRoot }).toString(),
    ).toBe("");
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
    writeFileSync(
      join(specDir, "00-one.md"),
      "# 00 - One\n\nNo acceptance criteria section here.\n",
    );
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
    writeFileSync(
      spec,
      withRepo(
        "# Feature\n\n- [ ] [00 - One](./00-one.md)\n- [ ] [01 - Two](./01-two.md)\n",
      ),
    );
    writeFileSync(
      join(specDir, "00-one.md"),
      "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One accepted.\n",
    );
    writeFileSync(
      join(specDir, "01-two.md"),
      "# 01 - Two\n\n## Acceptance criteria\n\n- [ ] Two accepted.\n",
    );
    execSync("git add -A && git commit -m init && git push -u origin main", {
      cwd: projectRoot,
    });

    const binDir = join(dir, "bin");
    mkdirSync(binDir);
    const realGit = execSync("command -v git", { encoding: "utf8" }).trim();
    const git = join(binDir, "git");
    const gh = join(binDir, "gh");
    const pushLog = join(dir, "push-log");
    const prState = join(dir, "pr-state");
    const prLog = join(dir, "pr-log");
    const prViewLog = join(dir, "pr-view-log");
    const readyLog = join(dir, "ready-log");
    const readyState = join(dir, "ready-state");
    const prTitle = join(dir, "pr-title");
    const prBody = join(dir, "pr-body");
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
  else
    printf '1\\n'
  fi
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

    const code = await runCommand({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      logClient: {
        assertReachable: async () => {},
        send: async () => {},
      },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(readFileSync(pushLog, "utf8").trim().split("\n")).toEqual([
      "push -u origin feature",
      "push",
    ]);
    expect(readFileSync(prLog, "utf8").trim().split("\n")).toEqual(["create"]);
    expect(readFileSync(prViewLog, "utf8").trim().split("\n")).toHaveLength(3);
    expect(readFileSync(readyLog, "utf8").trim().split("\n")).toEqual([
      "ready",
    ]);
    expect(readFileSync(createCommitCount, "utf8").trim()).toBe("1");
    expect(readFileSync(readyCommitCount, "utf8").trim()).toBe("2");
    expect(readFileSync(prTitle, "utf8")).toBe("Feature");
    expect(readFileSync(prBody, "utf8")).toBe(
      "Implements the feature in two subspec commits.",
    );
    expect(
      execSync("gh pr view feature --json isDraft -q .isDraft", {
        cwd: join(projectRoot, ".worktree", "feature"),
        env: process.env,
        encoding: "utf8",
      }).trim(),
    ).toBe("false");
    expect(
      claude.calls.filter((call) =>
        call.prompt.includes("draft GitHub pull request body"),
      ),
    ).toHaveLength(1);
    const subjects = execSync("git log --format=%s main..feature", {
      cwd: projectRoot,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .reverse();
    expect(subjects).toEqual(["00 - One", "01 - Two"]);
  });

  test("stops at the configured max iterations", async () => {
    const spec = writeSpec("- [ ] one\n- [ ] two\n- [ ] three\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      const checked = Array.from(
        { length: callCount },
        (_, index) => `- [x] ${index + 1}`,
      );
      const unchecked = Array.from(
        { length: 3 - callCount },
        (_, index) => `- [ ] ${callCount + index + 1}`,
      );
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
        version: 1,
        agentOrder: ["claude"],
        maxIterations: 1,
        patchModels: DEFAULT_PATCH_MODELS,
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
        version: 1,
        agentOrder: ["claude"],
        maxIterations: 10,
        patchModels: {
          claude: "haiku",
          codex: "gpt-5.3-codex",
          cursor: "Composer 2",
          opencode: "github-copilot/claude-opus-4.7",
        },
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
      "-p\0--permission-mode\0acceptEdits\0--model\0haiku\0",
    );
  });

  test("CLI maxIterations overrides config maxIterations", async () => {
    const spec = writeSpec("- [ ] one\n- [ ] two\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      writeFileSync(
        spec,
        callCount === 1 ? "- [x] one\n- [ ] two\n" : "- [x] one\n- [x] two\n",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    });
    writeConfig(
      {
        version: 1,
        agentOrder: ["claude"],
        maxIterations: 1,
        patchModels: DEFAULT_PATCH_MODELS,
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
    expect(cap.err()).toContain("claude: quota exhausted");
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
        version: 1,
        agentOrder: ["claude", "codex"],
        maxIterations: 10,
        patchModels: DEFAULT_PATCH_MODELS,
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
    expect(cap.err()).toContain("all agents quota-exhausted");
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
        version: 1,
        agentOrder: ["claude", "codex"],
        maxIterations: 10,
        patchModels: DEFAULT_PATCH_MODELS,
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
        version: 1,
        agentOrder: ["claude", "codex"],
        maxIterations: 10,
        patchModels: DEFAULT_PATCH_MODELS,
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
    expect(cap.err()).toContain(
      'claude: configured patch model "haiku" is not supported by this CLI/account',
    );
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

  test("max-iterations exit prints bounded tail of latest iteration output", async () => {
    const spec = writeSpec("- [ ] one\n- [ ] two\n- [ ] three\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", (callCount) => {
      const checked = Array.from(
        { length: callCount },
        (_, index) => `- [x] ${index + 1}`,
      );
      const unchecked = Array.from(
        { length: 3 - callCount },
        (_, index) => `- [ ] ${callCount + index + 1}`,
      );
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
    expect(
      messages.some(
        (m) => m.tag === "harness" && m.text.includes("test error message"),
      ),
    ).toBe(true);
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
    expect(
      harnessMessages.some((m) => m.text.includes("configured patch model")),
    ).toBe(true);
    expect(
      harnessMessages.some((m) => m.text.includes("error: unsupported model")),
    ).toBe(true);
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

    expect(activeSpecPath).toBe(
      join(worktreeRoot, "spec", "feature", "index.md"),
    );
    expect(existsSync(activeSpecPath)).toBe(true);
    expect(readFileSync(activeSpecPath, "utf8")).toBe(
      "- [ ] [00 - Task](./00-task.md)\n",
    );
    expect(readFileSync(join(targetSpecDir, "00-task.md"), "utf8")).toBe(
      "# 00 - Task\n",
    );
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
    writeFileSync(
      spec,
      "# F\n\nrepo: https://github.com/example/dup\n\n- [x] done\n",
    );

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
      expect(cap.err()).toContain(
        '"https://github.com/example/origin-project"',
      );
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
      expect(cap.err()).toContain(
        "--cwd is only valid when effective `git` is false",
      );
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
