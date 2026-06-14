import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, registerProject, writeConfig } from "../../../src/config.ts";
import { promptCommand, type PromptRunOptions } from "../../../src/modes/prompt/run.ts";
import {
  HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED,
  HARNESS_QUOTA_FALLBACK_STRICT,
} from "../../../src/quota-harness-messages.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../../src/agents/types.ts";

function captureIo(): {
  io: PromptRunOptions["io"];
  out: () => string;
  err: () => string;
} {
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

let dir: string;
let projectRoot: string;
let cfgDir: string;
let origin: string;
let binDir: string;
let ghLogPath: string;
let originalPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-prompt-"));
  projectRoot = join(dir, "project");
  cfgDir = join(dir, "cfg");
  origin = join(dir, "origin.git");
  binDir = join(dir, "bin");
  ghLogPath = join(dir, "gh.log");
  originalPath = process.env.PATH;

  mkdirSync(projectRoot);
  mkdirSync(binDir);

  execSync(`git init --bare -b main ${origin}`);
  execSync("git init -b main", { cwd: projectRoot });
  execSync("git config user.email 'test@example.com'", { cwd: projectRoot });
  execSync("git config user.name 'Test User'", { cwd: projectRoot });
  writeFileSync(join(projectRoot, "README.md"), "seed\n");
  execSync("git add README.md", { cwd: projectRoot });
  execSync("git commit -m 'seed'", { cwd: projectRoot });
  execSync(`git remote add origin ${origin}`, { cwd: projectRoot });
  execSync("git push -u origin main", { cwd: projectRoot });

  registerProject("project", projectRoot, { dir: cfgDir, origin });
  const cfg = loadConfig({ dir: cfgDir });
  cfg.telemetryPath = null;
  cfg.modes.prompt.agentOrder = [
    { agent: "claude", model: "haiku" },
    { agent: "codex", model: "gpt-5.3-codex" },
  ];
  writeConfig(cfg, { dir: cfgDir });

  writeFileSync(
    join(binDir, "gh"),
    `#!/bin/sh
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  printf 'main\\n'
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  printf '%s\\n' "$@" > "$JARVIS_TEST_GH_LOG"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  exit 0
fi
exit 1
`,
  );
  chmodSync(join(binDir, "gh"), 0o755);
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  process.env.JARVIS_TEST_GH_LOG = ghLogPath;
  Bun.env.PATH = process.env.PATH;
  Bun.env.JARVIS_TEST_GH_LOG = ghLogPath;
});

afterEach(() => {
  if (originalPath === undefined) {
    delete process.env.PATH;
    delete Bun.env.PATH;
  } else {
    process.env.PATH = originalPath;
    Bun.env.PATH = originalPath;
  }
  delete process.env.JARVIS_TEST_GH_LOG;
  delete Bun.env.JARVIS_TEST_GH_LOG;
  rmSync(dir, { recursive: true, force: true });
});

function promptOpts(io: PromptRunOptions["io"], agents: PromptRunOptions["agents"]): PromptRunOptions {
  return {
    promptText: "Fix prompt mode\n\nAdd coverage.",
    io,
    projectPath: projectRoot,
    config: { dir: cfgDir },
    ...(agents === undefined ? {} : { agents }),
    skipGhCheck: true,
  };
}

function promptWorktreePath(): string {
  const entries = readdirSync(join(projectRoot, ".worktree"));
  expect(entries.length).toBe(1);
  return join(projectRoot, ".worktree", entries[0]!);
}

function ghArgs(): string[] {
  return readFileSync(ghLogPath, "utf8").trim().split("\n");
}

describe("promptCommand", () => {
  test("falls through quota to the next agent and prints the successful fallback stdout", async () => {
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "quota", stderr: "claude quota" }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "codex answer\n", stderr: "" }));

    const code = await promptCommand(promptOpts(cap.io, { claude, codex }));

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    expect(claude.calls[0]?.cwd).toBe(codex.calls[0]?.cwd);
    expect(cap.out()).toBe("codex answer\n");
    expect(cap.err()).toContain(`claude: ${HARNESS_QUOTA_FALLBACK_STRICT}`);
  });

  test("returns exit 2 only after the last configured agent also returns quota", async () => {
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "quota", stderr: "claude quota" }));
    const codex = new FakeAgent("codex", () => ({ kind: "quota", stderr: "codex quota" }));

    const code = await promptCommand(promptOpts(cap.io, { claude, codex }));

    expect(code).toBe(2);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    const stderr = cap.err();
    expect(stderr).toContain(`claude: ${HARNESS_QUOTA_FALLBACK_STRICT}`);
    expect(stderr).toContain(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
    expect(stderr.match(new RegExp(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED, "g"))).toHaveLength(1);
    expect(stderr.indexOf(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED)).toBeGreaterThan(stderr.indexOf("jarvis1: invoking codex"));
  });

  test("a successful first agent still drives the no-diff flow", async () => {
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "no diff\n", stderr: "" }));

    const code = await promptCommand(promptOpts(cap.io, { claude }));

    expect(code).toBe(0);
    expect(cap.out()).toBe("no diff\n");
    expect(claude.calls).toHaveLength(1);
    expect(readdirSync(join(projectRoot, ".worktree"))).toHaveLength(1);
    expect(() => ghArgs()).toThrow();
  });

  test("a successful first agent still drives the diff flow", async () => {
    const cap = captureIo();
    const claude = new FakeAgent("claude", (_count, _prompt, opts) => {
      writeFileSync(join(opts.cwd, "change.txt"), "first agent diff\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await promptCommand(promptOpts(cap.io, { claude }));

    expect(code).toBe(0);
    const worktree = promptWorktreePath();
    const branch = execSync("git branch --show-current", { cwd: worktree, encoding: "utf8" }).trim();
    expect(execSync("git log -1 --pretty=%B", { cwd: worktree, encoding: "utf8" })).toContain("Jarvis-Agent: fake-claude");
    expect(branch).toContain("prompt/");
    expect(execSync("git ls-remote --heads origin", { cwd: projectRoot, encoding: "utf8" })).toContain("refs/heads/prompt/");
    const args = ghArgs();
    expect(args.slice(0, 10)).toEqual([
      "pr",
      "create",
      "--draft",
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      "Fix prompt mode",
      "--body",
    ]);
    expect(args.slice(10).join("\n")).toBe(
      "Fix prompt mode\n\nAdd coverage.\n\n---\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    );
  });

  test("a successful fallback agent drives the diff flow identically", async () => {
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "quota", stderr: "claude quota" }));
    const codex = new FakeAgent("codex", (_count, _prompt, opts) => {
      writeFileSync(join(opts.cwd, "change.txt"), "fallback diff\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await promptCommand(promptOpts(cap.io, { claude, codex }));

    expect(code).toBe(0);
    const worktree = promptWorktreePath();
    const branch = execSync("git branch --show-current", { cwd: worktree, encoding: "utf8" }).trim();
    expect(execSync("git log -1 --pretty=%B", { cwd: worktree, encoding: "utf8" })).toContain("Jarvis-Agent: fake-codex");
    expect(execSync("git ls-remote --heads origin", { cwd: projectRoot, encoding: "utf8" })).toContain("refs/heads/prompt/");
    expect(ghArgs()).toContain(branch);
  });

  test("mixed model-config then quota exits 3 instead of 2", async () => {
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "model_config", stderr: "bad model" }));
    const codex = new FakeAgent("codex", () => ({ kind: "quota", stderr: "codex quota" }));

    const code = await promptCommand(promptOpts(cap.io, { claude, codex }));

    expect(code).toBe(3);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    expect(cap.err()).not.toContain(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
  });

  test("hard agent errors stop the chain without invoking later agents", async () => {
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "error", exitCode: 1, stderr: "boom" }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "unused", stderr: "" }));

    const code = await promptCommand(promptOpts(cap.io, { claude, codex }));

    expect(code).toBe(3);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(0);
    expect(cap.err()).toContain("agent failed: boom");
  });
});
