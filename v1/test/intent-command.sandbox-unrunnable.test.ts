// This test requires real git remote/branch state for intent command commit-mode behavior and cannot run in sandbox mode.
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
import { isAbsolute, join } from "node:path";
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
  readonly #mode:
    | "ok-two"
    | "ok-one"
    | "invalid"
    | "invalid-prerequisites"
    | "quota"
    | "quota-dirty"
    | "checkout-pollution"
    | "stage-out-of-bounds"
    | "repair-mismatched-name"
    | "repair-no-frontmatter"
    | "repair-missing-name"
    | "repair-missing-prerequisites";

  constructor(
    name: AgentName,
    mode:
      | "ok-two"
      | "ok-one"
      | "invalid"
      | "invalid-prerequisites"
      | "quota"
      | "quota-dirty"
      | "checkout-pollution"
      | "stage-out-of-bounds"
      | "repair-mismatched-name"
      | "repair-no-frontmatter"
      | "repair-missing-name"
      | "repair-missing-prerequisites",
  ) {
    this.name = name;
    this.#mode = mode;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    if (this.#mode === "quota") {
      return { kind: "quota", stderr: "synthetic quota" };
    }
    let stageDir: string;
    const match = prompt.match(/Write the authored intents as markdown files under `([^`]+)`/);
    if (match?.[1] && isAbsolute(match[1])) {
      stageDir = match[1];
    } else {
      stageDir = join(opts.cwd, ".jarvis-intent-stage");
    }
    mkdirSync(stageDir, { recursive: true });
    if (this.#mode === "quota-dirty") {
      writeFileSync(join(stageDir, "stale.md"), intentFile("stale", "Should be cleared."), "utf8");
      return { kind: "quota", stderr: "synthetic quota after writes" };
    }
    if (this.#mode === "checkout-pollution") {
      writeFileSync(join(opts.cwd, "rogue-file.txt"), "This should not be here\n", "utf8");
      writeFileSync(join(stageDir, "slice-one.md"), intentFile("slice-one", "First behavior."), "utf8");
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "stage-out-of-bounds") {
      writeFileSync(join(stageDir, "slice-one.md"), intentFile("slice-one", "First behavior."), "utf8");
      writeFileSync(join(stageDir, "notes.txt"), "This should not be here\n", "utf8");
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-mismatched-name") {
      writeFileSync(
        join(stageDir, "bad-name.md"),
        `---
name: wrong-name
---

## Intent

Should be repaired.

## Prerequisites
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-no-frontmatter") {
      writeFileSync(
        join(stageDir, "no-frontmatter.md"),
        `## Intent

Should be repaired with frontmatter.

## Prerequisites
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-missing-name") {
      writeFileSync(
        join(stageDir, "missing-name.md"),
        `---
description: A test intent
---

## Intent

Should have name added.

## Prerequisites
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-missing-prerequisites") {
      writeFileSync(
        join(stageDir, "missing-prereqs.md"),
        `---
name: missing-prereqs
---

## Intent

Should have Prerequisites added.
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
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
    Record<
      AgentName,
      | "ok-two"
      | "ok-one"
      | "invalid"
      | "invalid-prerequisites"
      | "quota"
      | "quota-dirty"
      | "checkout-pollution"
      | "stage-out-of-bounds"
      | "repair-mismatched-name"
      | "repair-no-frontmatter"
      | "repair-missing-name"
      | "repair-missing-prerequisites"
    >
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
    expect(prompt).toContain("one prerequisite behavior per physical line as `- ...`");
    expect(prompt).toContain("Leave the `## Prerequisites` body empty when there are no prerequisites.");
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

  test("mismatched frontmatter name is repaired and succeeds", async () => {
    const env = setupEnv();
    try {
      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "repair-mismatched-name" }),
      });
      expect(code).toBe(0);
      expect(cap.err()).toContain("intent: split commit pushed");
      expect(existsSync(env.prState)).toBe(true);
      const worktree = findIntentWorktree(env.projectRoot);
      const content = readFileSync(join(worktree, "spec", "ready-intents", "bad-name.md"), "utf8");
      expect(content).toContain("name: bad-name");
      expect(content).toContain("## Prerequisites");
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

  test("no-commit inline seed writes N intents to external ready-intents without git/PR", async () => {
    const env = setupEnv();
    try {
      const cap = captureIo();
      const cfg = loadConfig({ dir: env.cfgDir });
      cfg.modes.plan.commit = false;
      writeConfig(cfg, { dir: env.cfgDir });

      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "ok-two" }),
      });
      expect(code).toBe(0);
      expect(cap.err()).toContain("2 intents written to");
      expect(cap.out()).toContain("jarvis1 plan --repo project");
      expect(cap.out()).toContain("ready-intents/slice-one.md");
      expect(cap.out()).toContain("ready-intents/slice-two.md");
      expect(existsSync(env.prState)).toBe(false);

      const externalRoot = join(env.cfgDir, "specs", "project");
      expect(readFileSync(join(externalRoot, "ready-intents", "slice-one.md"), "utf8")).toContain("## Prerequisites");
      expect(readFileSync(join(externalRoot, "ready-intents", "slice-two.md"), "utf8")).toContain("name: slice-two");
      expect(existsSync(join(externalRoot, ".jarvis-intent-stage"))).toBe(false);
    } finally {
      env.cleanup();
    }
  });

  test("no-commit works against a non-git project root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-no-git-"));
    try {
      const cfgDir = join(dir, "cfg");
      const projectRoot = join(dir, "project");
      mkdirSync(projectRoot);
      registerProject("project", projectRoot, { dir: cfgDir });

      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.plan.agentOrder = [{ agent: "claude", model: "haiku" }];
      cfg.modes.plan.commit = false;
      writeConfig(cfg, { dir: cfgDir });

      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: projectRoot,
        config: { dir: cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "ok-one" }),
      });
      expect(code).toBe(0);
      expect(cap.err()).toContain("1 intent written to");

      const externalRoot = join(cfgDir, "specs", "project");
      expect(readFileSync(join(externalRoot, "ready-intents", "single-behavior.md"), "utf8")).toContain(
        "name: single-behavior",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no-commit collision aborts without partial writes", async () => {
    const env = setupEnv();
    try {
      const cfg = loadConfig({ dir: env.cfgDir });
      cfg.modes.plan.commit = false;
      writeConfig(cfg, { dir: env.cfgDir });

      const externalRoot = join(env.cfgDir, "specs", "project");
      const readyIntentsDir = join(externalRoot, "ready-intents");
      mkdirSync(readyIntentsDir, { recursive: true });
      writeFileSync(join(readyIntentsDir, "slice-one.md"), "keep me\n");

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
      expect(cap.err()).toContain("ready-intents/slice-one.md already exists");
      expect(readFileSync(join(readyIntentsDir, "slice-one.md"), "utf8")).toBe("keep me\n");
      expect(existsSync(join(readyIntentsDir, "slice-two.md"))).toBe(false);
    } finally {
      env.cleanup();
    }
  });

  test("no-commit cleanup removes stage directory on success", async () => {
    const env = setupEnv();
    try {
      const cfg = loadConfig({ dir: env.cfgDir });
      cfg.modes.plan.commit = false;
      writeConfig(cfg, { dir: env.cfgDir });

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

      const externalRoot = join(env.cfgDir, "specs", "project");
      const stageDir = join(externalRoot, ".jarvis-intent-stage");
      expect(existsSync(stageDir)).toBe(false);
    } finally {
      env.cleanup();
    }
  });

  test("committed-path behavior is preserved with no-commit configured", async () => {
    const env = setupEnv();
    try {
      const cfg = loadConfig({ dir: env.cfgDir });
      cfg.modes.plan.commit = false;
      writeConfig(cfg, { dir: env.cfgDir });

      const wipDir = join(env.projectRoot, "spec", "wip-intents");
      mkdirSync(wipDir, { recursive: true });
      const seedPath = join(wipDir, "raw-seed.md");
      writeFileSync(seedPath, "# Seed\n");
      execSync("git add spec/", { cwd: env.projectRoot });
      execSync("git commit -m 'add wip-intents'", { cwd: env.projectRoot });
      execSync("git push", { cwd: env.projectRoot });

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

      const externalRoot = join(env.cfgDir, "specs", "project");
      expect(readFileSync(join(externalRoot, "ready-intents", "single-behavior.md"), "utf8")).toContain(
        "name: single-behavior",
      );
    } finally {
      env.cleanup();
    }
  });

  test("no-commit splitter turn carries additionalReadDirs in spawn options", async () => {
    const env = setupEnv();
    try {
      const cfg = loadConfig({ dir: env.cfgDir });
      cfg.modes.plan.commit = false;
      writeConfig(cfg, { dir: env.cfgDir });

      let capturedAdditionalReadDirs: string[] | undefined;
      class SpyAgent extends SplitAgent {
        override async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
          capturedAdditionalReadDirs = opts.additionalReadDirs;
          return super.run(prompt, opts);
        }
      }

      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: () => new SpyAgent("claude", "ok-one"),
      });
      expect(code).toBe(0);
      expect(capturedAdditionalReadDirs).toBeDefined();
      expect(capturedAdditionalReadDirs?.length).toBeGreaterThan(0);
      expect(capturedAdditionalReadDirs?.[0]).toContain(".jarvis-intent-stage");
    } finally {
      env.cleanup();
    }
  });

  test("no-commit checkout pollution aborts without partial writes", async () => {
    const env = setupEnv();
    try {
      const cfg = loadConfig({ dir: env.cfgDir });
      cfg.modes.plan.commit = false;
      writeConfig(cfg, { dir: env.cfgDir });

      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "checkout-pollution" }),
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("splitter wrote into checkout");
      expect(cap.err()).toContain("rogue-file.txt");

      const externalRoot = join(env.cfgDir, "specs", "project");
      expect(existsSync(join(externalRoot, "ready-intents"))).toBe(false);
    } finally {
      env.cleanup();
    }
  });

  test("no-commit stage-dir structural scan rejects non-.md files while allowing legitimate siblings", async () => {
    const env = setupEnv();
    try {
      const cfg = loadConfig({ dir: env.cfgDir });
      cfg.modes.plan.commit = false;
      writeConfig(cfg, { dir: env.cfgDir });

      const externalRoot = join(env.cfgDir, "specs", "project");
      const readyIntentsDir = join(externalRoot, "ready-intents");
      mkdirSync(readyIntentsDir, { recursive: true });
      writeFileSync(join(readyIntentsDir, "prior-intent.md"), "keep me\n");
      const planDir = join(externalRoot, "2026-01-01T00-00-00Z-prior");
      mkdirSync(planDir, { recursive: true });

      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "stage-out-of-bounds" }),
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("invalid splitter output notes.txt");
      expect(cap.err()).toContain("expected only markdown files");
      expect(readFileSync(join(readyIntentsDir, "prior-intent.md"), "utf8")).toBe("keep me\n");
      expect(existsSync(planDir)).toBe(true);
    } finally {
      env.cleanup();
    }
  });

  test("repair: missing frontmatter block is prepended", async () => {
    const env = setupEnv();
    try {
      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "repair-no-frontmatter" }),
      });
      expect(code).toBe(0);
      const worktree = findIntentWorktree(env.projectRoot);
      const content = readFileSync(join(worktree, "spec", "ready-intents", "no-frontmatter.md"), "utf8");
      expect(content).toContain("---\nname: no-frontmatter\n---");
      expect(content).toContain("## Prerequisites");
    } finally {
      env.cleanup();
    }
  });

  test("repair: missing name key in frontmatter block is inserted", async () => {
    const env = setupEnv();
    try {
      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "repair-missing-name" }),
      });
      expect(code).toBe(0);
      const worktree = findIntentWorktree(env.projectRoot);
      const content = readFileSync(join(worktree, "spec", "ready-intents", "missing-name.md"), "utf8");
      expect(content).toContain("name: missing-name");
      expect(content).toContain("description: A test intent");
      expect(content).toContain("## Prerequisites");
    } finally {
      env.cleanup();
    }
  });

  test("repair: missing Prerequisites section is appended", async () => {
    const env = setupEnv();
    try {
      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "repair-missing-prerequisites" }),
      });
      expect(code).toBe(0);
      const worktree = findIntentWorktree(env.projectRoot);
      const content = readFileSync(join(worktree, "spec", "ready-intents", "missing-prereqs.md"), "utf8");
      expect(content).toContain("name: missing-prereqs");
      expect(content).toContain("## Prerequisites");
      // Verify Prerequisites is at the end (empty section)
      const lines = content.split("\n");
      const lastContent = lines.filter((line) => line.trim()).pop();
      expect(lastContent).toBe("## Prerequisites");
    } finally {
      env.cleanup();
    }
  });

  test("repair: mismatched name is repaired in no-commit path", async () => {
    const env = setupEnv();
    try {
      const cfg = loadConfig({ dir: env.cfgDir });
      cfg.modes.plan.commit = false;
      writeConfig(cfg, { dir: env.cfgDir });

      const cap = captureIo();
      const code = await intentCommand({
        io: cap.io,
        args: [TWO_BEHAVIOR_SEED],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createSplitAgentFactory({ claude: "repair-mismatched-name" }),
      });
      expect(code).toBe(0);
      const externalRoot = join(env.cfgDir, "specs", "project");
      const content = readFileSync(join(externalRoot, "ready-intents", "bad-name.md"), "utf8");
      expect(content).toContain("name: bad-name");
      expect(content).toContain("## Prerequisites");
    } finally {
      env.cleanup();
    }
  });

  test("repair: compliant file is left unchanged", async () => {
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
      const worktree = findIntentWorktree(env.projectRoot);
      // ok-two creates slice-one and slice-two with proper frontmatter
      const content1 = readFileSync(join(worktree, "spec", "ready-intents", "slice-one.md"), "utf8");
      const content2 = readFileSync(join(worktree, "spec", "ready-intents", "slice-two.md"), "utf8");
      // Verify they contain the full intentFile structure
      expect(content1).toContain("---\nname: slice-one\n---");
      expect(content2).toContain("---\nname: slice-two\n---");
      expect(content1).toContain("## Prerequisites");
      expect(content2).toContain("## Prerequisites");
    } finally {
      env.cleanup();
    }
  });
});
