import { describe, expect, test } from "bun:test";
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
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { intentCommand, parseIntentArgs } from "../src/commands/intent.ts";
import { loadConfig, registerProject, writeConfig } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";
import { buildIntentSplitPrompt } from "../src/modes/plan/intent-split.ts";

const okLogClient: LogClient = {
  assertReachable: async () => {},
  send: async () => {},
};

const TWO_BEHAVIOR_SEED = "Split this into two reviewable behaviors";

function captureIo() {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s: string) => {
        out += s;
      },
      stderr: (s: string) => {
        err += s;
      },
    },
    out: () => out,
    err: () => err,
  };
}

function intentFile(name: string, body: string, prerequisites: string[] = []): string {
  return `---
name: ${name}
---

## Intent

${body}

## Prerequisites
${prerequisites.length === 0 ? "" : `\n${prerequisites.map((line) => `- ${line}`).join("\n")}\n`}`;
}

class SplitAgent implements Agent {
  readonly name: AgentName;
  readonly #mode: "ok-two" | "ok-one" | "invalid" | "invalid-prerequisites" | "quota" | "quota-dirty";

  constructor(
    name: AgentName,
    mode: "ok-two" | "ok-one" | "invalid" | "invalid-prerequisites" | "quota" | "quota-dirty",
  ) {
    this.name = name;
    this.#mode = mode;
  }

  async run(_prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    if (this.#mode === "quota") {
      return { kind: "quota", stderr: "synthetic quota" };
    }
    const stageDir = join(opts.cwd, ".jarvis-intent-stage");
    mkdirSync(stageDir, { recursive: true });
    if (this.#mode === "quota-dirty") {
      writeFileSync(join(stageDir, "stale.md"), intentFile("stale", "Should be cleared."), "utf8");
      return { kind: "quota", stderr: "synthetic quota after writes" };
    }
    if (this.#mode === "invalid") {
      writeFileSync(join(stageDir, "bad-name.md"), "---\nname: wrong-name\n---\n\n## Intent\n\nBroken.\n", "utf8");
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "invalid-prerequisites") {
      writeFileSync(
        join(stageDir, "bad-prereqs.md"),
        `---
name: bad-prereqs
---

## Intent

Broken.

## Prerequisites

Needs another behavior first.
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "ok-one") {
      writeFileSync(join(stageDir, "single-behavior.md"), intentFile("single-behavior", "One behavior."), "utf8");
      return { kind: "ok", stdout: "", stderr: "" };
    }
    writeFileSync(join(stageDir, "slice-one.md"), intentFile("slice-one", "First behavior."), "utf8");
    writeFileSync(
      join(stageDir, "slice-two.md"),
      intentFile("slice-two", "Second behavior.", ["First behavior."]),
      "utf8",
    );
    return { kind: "ok", stdout: "", stderr: "" };
  }

  attributionLabel(): string {
    return `${this.name}-agent`;
  }
}

function setupEnv(): {
  dir: string;
  cfgDir: string;
  projectRoot: string;
  prState: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-"));
  const cfgDir = join(dir, "cfg");
  const projectRoot = join(dir, "project");
  const origin = join(dir, "origin.git");
  const binDir = join(dir, "bin");
  const prState = join(dir, "pr-state");

  mkdirSync(projectRoot);
  mkdirSync(origin);
  mkdirSync(binDir);
  registerProject("project", projectRoot, { dir: cfgDir });

  execSync("git init --bare -b main", { cwd: origin });
  execSync("git init -b main", { cwd: projectRoot });
  execSync("git config user.email 'test@example.com'", { cwd: projectRoot });
  execSync("git config user.name 'Test User'", { cwd: projectRoot });
  writeFileSync(join(projectRoot, "README.md"), "test\n");
  execSync("git add README.md", { cwd: projectRoot });
  execSync("git commit -m 'initial'", { cwd: projectRoot });
  execSync(`git remote add origin ${origin}`, { cwd: projectRoot });
  execSync("git push -u origin main", { cwd: projectRoot });

  const gh = join(binDir, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "auth status" ]]; then exit 0; fi
if [[ "$1 $2" == "repo view" ]]; then printf 'main\\n'; exit 0; fi
if [[ "$1 $2" == "pr create" ]]; then touch "${prState}"; exit 0; fi
if [[ "$1 $2" == "pr view" ]]; then
  if [[ "$*" == *"--json url"* ]]; then printf 'https://example.com/pull/1\\n'; exit 0; fi
  if [[ "$*" == *"--json number,state"* ]]; then
    if [[ -f "${prState}" ]]; then printf '1\\n'; else exit 1; fi
  fi
  exit 0
fi
if [[ "$1 $2" == "pr edit" ]]; then exit 0; fi
if [[ "$1 $2" == "pr ready" ]]; then exit 0; fi
exit 0
`,
    "utf8",
  );
  chmodSync(gh, 0o755);
  process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;

  const cfg = loadConfig({ dir: cfgDir });
  cfg.modes.plan.agentOrder = [
    { agent: "claude", model: "haiku" },
    { agent: "codex", model: "gpt-5.3-codex" },
  ];
  writeConfig(cfg, { dir: cfgDir });

  return {
    dir,
    cfgDir,
    projectRoot,
    prState,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function createSplitAgentFactory(
  modes: Partial<
    Record<AgentName, "ok-two" | "ok-one" | "invalid" | "invalid-prerequisites" | "quota" | "quota-dirty">
  >,
) {
  return (name: AgentName): Agent => new SplitAgent(name, modes[name] ?? "ok-two");
}

function findIntentWorktree(projectRoot: string): string {
  const root = join(projectRoot, ".worktree");
  const name = readdirSync(root).find((entry) => entry.startsWith("intent-"));
  if (!name) {
    throw new Error("missing intent worktree");
  }
  return join(root, name);
}

describe("parseIntentArgs", () => {
  test("existing file parses as file seed", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-parse-"));
    try {
      const file = join(dir, "seed.md");
      writeFileSync(file, "seed\n");
      const result = parseIntentArgs([file], dir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.invocation.mode).toBe("file");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing file-like arg stays inline", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-parse-"));
    try {
      const result = parseIntentArgs(["./missing.md"], dir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.invocation.mode).toBe("inline");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("intentCommand", () => {
  test("intent-split prompt uses governed layering and honors global removal", () => {
    const prompt = buildIntentSplitPrompt({
      workdir: "/tmp/worktree",
      seedLabel: "inline",
      seedContent: "Split reporting",
      stagingDir: ".jarvis-intent-stage",
    });
    expect(prompt).toContain("Before editing code, read the relevant durable docs/specs");
    expect(prompt).toContain("Be terse in communication artifacts");
    expect(prompt).not.toContain("No planning labels in code.");
  });

  test("inline seed writes N intents to ready-intents and opens a draft PR", async () => {
    const env = setupEnv();
    try {
      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "ok-two" }),
      });
      expect(code).toBe(0);
      expect(cap.err()).toContain("intent: split commit pushed");
      expect(cap.err()).toContain("intent: draft PR #1 opened");
      expect(cap.out()).toContain("https://example.com/pull/1");
      expect(cap.out()).toContain("jarvis1 plan spec/ready-intents/slice-one.md");
      expect(cap.out()).toContain("jarvis1 plan spec/ready-intents/slice-two.md");

      const worktree = findIntentWorktree(env.projectRoot);
      expect(readFileSync(join(worktree, "spec", "ready-intents", "slice-one.md"), "utf8")).toContain(
        "## Prerequisites",
      );
      expect(readFileSync(join(worktree, "spec", "ready-intents", "slice-two.md"), "utf8")).toContain(
        "name: slice-two",
      );
      expect(existsSync(join(worktree, "spec", "ready-intents", "index.md"))).toBe(false);
      expect(existsSync(env.prState)).toBe(true);
    } finally {
      env.cleanup();
    }
  });

  test("file seed from wip-intents writes one intent and leaves the raw seed in place", async () => {
    const env = setupEnv();
    try {
      const wipDir = join(env.projectRoot, "spec", "wip-intents");
      mkdirSync(wipDir, { recursive: true });
      const seedPath = join(wipDir, "raw-seed.md");
      writeFileSync(seedPath, "# Seed\n");

      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [seedPath],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "ok-one" }),
      });
      expect(code).toBe(0);
      const worktree = findIntentWorktree(env.projectRoot);
      expect(existsSync(seedPath)).toBe(true);
      expect(readFileSync(seedPath, "utf8")).toBe("# Seed\n");
      expect(readFileSync(join(worktree, "spec", "ready-intents", "single-behavior.md"), "utf8")).toContain(
        "name: single-behavior",
      );
    } finally {
      env.cleanup();
    }
  });

  test("name collisions abort without overwriting ready-intents or opening a PR", async () => {
    const env = setupEnv();
    try {
      const existingDir = join(env.projectRoot, "spec", "ready-intents");
      mkdirSync(existingDir, { recursive: true });
      writeFileSync(join(existingDir, "slice-one.md"), "keep me\n");
      execSync("git add -A", { cwd: env.projectRoot });
      execSync("git commit -m 'add existing ready intent'", { cwd: env.projectRoot });
      execSync("git push", { cwd: env.projectRoot });

      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "ok-two" }),
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("spec/ready-intents/slice-one.md already exists");
      expect(readFileSync(join(existingDir, "slice-one.md"), "utf8")).toBe("keep me\n");
      expect(existsSync(env.prState)).toBe(false);
    } finally {
      env.cleanup();
    }
  });

  test("invalid splitter output aborts without partial ready-intents or a PR", async () => {
    const env = setupEnv();
    try {
      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "invalid" }),
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("must declare name: bad-name");
      expect(existsSync(env.prState)).toBe(false);
      expect(existsSync(join(env.projectRoot, ".worktree"))).toBe(true);
      expect(readdirSync(join(env.projectRoot, ".worktree"))).toHaveLength(0);
    } finally {
      env.cleanup();
    }
  });

  test("non-bullet prerequisites abort without partial ready-intents or a PR", async () => {
    const env = setupEnv();
    try {
      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "invalid-prerequisites" }),
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("must list prerequisites as one bullet per line");
      expect(existsSync(env.prState)).toBe(false);
      expect(existsSync(join(env.projectRoot, ".worktree"))).toBe(true);
      expect(readdirSync(join(env.projectRoot, ".worktree"))).toHaveLength(0);
    } finally {
      env.cleanup();
    }
  });

  test("quota exhaustion falls through to the next configured agent", async () => {
    const env = setupEnv();
    try {
      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "quota", codex: "ok-two" }),
      });
      expect(code).toBe(0);
      expect(cap.err()).toContain("intent: claude: quota exhausted; falling back");
      expect(cap.out()).toContain("jarvis1 plan spec/ready-intents/slice-two.md");
    } finally {
      env.cleanup();
    }
  });

  test("quota fallback retries with a clean stage directory", async () => {
    const env = setupEnv();
    try {
      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "quota-dirty", codex: "ok-one" }),
      });
      expect(code).toBe(0);
      expect(cap.err()).toContain("intent: claude: quota exhausted; falling back");
      const worktree = findIntentWorktree(env.projectRoot);
      expect(existsSync(join(worktree, "spec", "ready-intents", "stale.md"))).toBe(false);
      expect(existsSync(join(worktree, "spec", "ready-intents", "single-behavior.md"))).toBe(true);
    } finally {
      env.cleanup();
    }
  });
});
