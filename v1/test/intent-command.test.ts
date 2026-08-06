import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
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
import { isAbsolute, join, resolve } from "node:path";
import type { SubprocessRunner } from "../../shared/subprocess.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { INTENT_USAGE, intentCommand, parseIntentArgs } from "../src/commands/intent.ts";
import { loadConfig, registerProject, writeConfig } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";
import { buildIntentSplitPrompt } from "../src/modes/plan/intent-split.ts";
import { HARNESS_MODEL_CONFIG_FALLBACK } from "../src/quota-harness-messages.ts";

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

function resolveHarnessRoot(): string | null {
  let current = import.meta.dir;
  for (let depth = 0; depth < 10; depth += 1) {
    const candidateBinary = join(current, "node_modules", "markdownlint-cli2", "markdownlint-cli2.js");
    const candidateConfig = join(current, ".markdownlint-cli2.jsonc");
    if (existsSync(candidateBinary) && existsSync(candidateConfig)) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function getHarnessMarkdownlintPaths(): { root: string; binary: string; config: string } | null {
  const root = resolveHarnessRoot();
  if (root === null) {
    return null;
  }
  return {
    root,
    binary: join(root, "node_modules", "markdownlint-cli2", "markdownlint-cli2.js"),
    config: join(root, ".markdownlint-cli2.jsonc"),
  };
}

function hasHarnessMarkdownlint(): boolean {
  return getHarnessMarkdownlintPaths() !== null;
}

function skipWithoutHarnessMarkdownlint(reason: string): boolean {
  if (hasHarnessMarkdownlint()) {
    return false;
  }
  process.stderr.write(`skip: ${reason}; pinned markdownlint binary not installed in this worktree\n`);
  return true;
}

function runHarnessMarkdownlint(path: string): number {
  const paths = getHarnessMarkdownlintPaths();
  if (paths === null) {
    throw new Error("missing pinned markdownlint binary");
  }
  const result = spawnSync("bun", [paths.binary, "--config", paths.config, path], {
    cwd: paths.root,
    env: process.env,
    stdio: "pipe",
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
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
    | "model_config"
    | "model_config-with-stderr"
    | "hard-error"
    | "checkout-pollution"
    | "stage-out-of-bounds"
    | "repair-mismatched-name"
    | "repair-no-frontmatter"
    | "repair-missing-name"
    | "repair-missing-prerequisites"
    | "repair-prerequisites-spacing"
    | "repair-unterminated-frontmatter"
    | "repair-near-miss-prerequisites"
    | "repair-empty-name"
    | "repair-md-violations"
    | "repair-autofix-heading-spacing"
    | "repair-duplicate-name-heading"
    | "repair-missing-heading"
    | "repair-heading-already-present"
    | "repair-name-prefixed-prose";

  constructor(
    name: AgentName,
    mode:
      | "ok-two"
      | "ok-one"
      | "invalid"
      | "invalid-prerequisites"
      | "quota"
      | "quota-dirty"
      | "model_config"
      | "model_config-with-stderr"
      | "hard-error"
      | "checkout-pollution"
      | "stage-out-of-bounds"
      | "repair-mismatched-name"
      | "repair-no-frontmatter"
      | "repair-missing-name"
      | "repair-missing-prerequisites"
      | "repair-prerequisites-spacing"
      | "repair-unterminated-frontmatter"
      | "repair-near-miss-prerequisites"
      | "repair-empty-name"
      | "repair-md-violations"
      | "repair-autofix-heading-spacing"
      | "repair-duplicate-name-heading"
      | "repair-missing-heading"
      | "repair-heading-already-present"
      | "repair-name-prefixed-prose",
  ) {
    this.name = name;
    this.#mode = mode;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    if (this.#mode === "quota") {
      return { kind: "quota", stderr: "synthetic quota" };
    }
    if (this.#mode === "model_config" || this.#mode === "model_config-with-stderr") {
      return {
        kind: "model_config",
        stderr: this.#mode === "model_config-with-stderr" ? "unknown model: fake-model" : "",
      };
    }
    if (this.#mode === "hard-error") {
      return { kind: "error", exitCode: 1, stderr: "synthetic hard error" };
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
    if (this.#mode === "repair-prerequisites-spacing") {
      writeFileSync(
        join(stageDir, "spacing.md"),
        `---
name: spacing
---

## Intent

Should normalize spacing around prerequisites.
## Prerequisites
- first dependency
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-unterminated-frontmatter") {
      writeFileSync(
        join(stageDir, "unterminated.md"),
        `---
title: Some title
incomplete frontmatter

## Intent

Body content.

## Prerequisites
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-near-miss-prerequisites") {
      writeFileSync(
        join(stageDir, "near-miss.md"),
        `---
name: near-miss
---

## Intent

Body content.

### Prerequisites

This is a near-miss heading.
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-empty-name") {
      writeFileSync(
        join(stageDir, "empty-name.md"),
        `---
name:
---

## Intent

Body content.

## Prerequisites
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-md-violations") {
      writeFileSync(
        join(stageDir, "md-violations.md"),
        `---
name: md-violations
---

# MD violations

## Intent

Some content with a reference.

#499

## Prerequisites


`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-autofix-heading-spacing") {
      writeFileSync(
        join(stageDir, "heading-spacing.md"),
        `---
name: heading-spacing
---
# Heading spacing

## Intent
Body text.

## Prerequisites
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-duplicate-name-heading") {
      writeFileSync(
        join(stageDir, "test-intent.md"),
        `---
name: test-intent
---

name: test-intent

## Prerequisites
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-missing-heading") {
      writeFileSync(
        join(stageDir, "missing-heading.md"),
        `---
name: missing-heading
---

Some content without a heading.

## Prerequisites
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-heading-already-present") {
      writeFileSync(
        join(stageDir, "has-heading.md"),
        `---
name: has-heading
---

# Custom Title

Some content.

## Prerequisites
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "repair-name-prefixed-prose") {
      writeFileSync(
        join(stageDir, "name-prefixed-prose.md"),
        `---
name: name-prefixed-prose
---

name: value pairs are validated before merging.

## Prerequisites
`,
        "utf8",
      );
      return { kind: "ok", stdout: "", stderr: "" };
    }
    if (this.#mode === "invalid") {
      writeFileSync(join(stageDir, "bad-name.md"), "---\nname: wrong-name\n\n---\n\n## Intent\n\nBroken.\n", "utf8");
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
      | "model_config"
      | "model_config-with-stderr"
      | "hard-error"
      | "checkout-pollution"
      | "stage-out-of-bounds"
      | "repair-mismatched-name"
      | "repair-no-frontmatter"
      | "repair-missing-name"
      | "repair-missing-prerequisites"
      | "repair-prerequisites-spacing"
      | "repair-unterminated-frontmatter"
      | "repair-near-miss-prerequisites"
      | "repair-empty-name"
      | "repair-md-violations"
      | "repair-autofix-heading-spacing"
      | "repair-duplicate-name-heading"
      | "repair-missing-heading"
      | "repair-heading-already-present"
      | "repair-name-prefixed-prose"
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

  test("--target-dir flag is accepted and stored", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-parse-"));
    try {
      const result = parseIntentArgs(["--target-dir", "v2/spec", "inline seed"], dir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.invocation.targetDir).toBe("v2/spec");
        expect(result.invocation.mode).toBe("inline");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--target-dir rejects absolute paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-parse-"));
    try {
      const result = parseIntentArgs(["--target-dir", "/absolute/path", "inline seed"], dir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("intent:");
        expect(result.message).toContain("relative path");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--target-dir rejects .. traversal", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-parse-"));
    try {
      const result = parseIntentArgs(["--target-dir", "../escape", "inline seed"], dir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("intent:");
        expect(result.message).toContain("..");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--target-dir rejects empty string", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-parse-"));
    try {
      const result = parseIntentArgs(["--target-dir", "", "inline seed"], dir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("intent:");
        expect(result.message).toContain("non-empty");
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

  test("--target-dir flag appears in usage output", () => {
    expect(INTENT_USAGE).toContain("--target-dir");
  });

  describe("no-commit path", () => {
    function setupNoCommitEnv(): { dir: string; cfgDir: string; projectRoot: string; cleanup: () => void } {
      const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-no-commit-"));
      const cfgDir = join(dir, "cfg");
      const projectRoot = join(dir, "project");
      mkdirSync(projectRoot);
      registerProject("project", projectRoot, { dir: cfgDir });
      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.plan.agentOrder = [
        { agent: "claude", model: "haiku" },
        { agent: "codex", model: "gpt-5.3-codex" },
      ];
      cfg.modes.plan.commit = false;
      writeConfig(cfg, { dir: cfgDir });
      return { dir, cfgDir, projectRoot, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
    }

    test("inline seed writes N intents to external ready-intents without git/PR", async () => {
      const env = setupNoCommitEnv();
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
        expect(cap.err()).toContain("2 intents written to");
        expect(cap.out()).toContain("jarvis1 plan --repo project");
        expect(cap.out()).toContain("ready-intents/slice-one.md");
        expect(cap.out()).toContain("ready-intents/slice-two.md");

        const externalRoot = join(env.cfgDir, "specs", "project");
        expect(readFileSync(join(externalRoot, "ready-intents", "slice-one.md"), "utf8")).toContain("## Prerequisites");
        expect(readFileSync(join(externalRoot, "ready-intents", "slice-two.md"), "utf8")).toContain("name: slice-two");
        expect(existsSync(join(externalRoot, ".jarvis-intent-stage"))).toBe(false);
      } finally {
        env.cleanup();
      }
    });

    test("works against a non-git project root", async () => {
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

    test("collision aborts without partial writes", async () => {
      const env = setupNoCommitEnv();
      try {
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

    test("cleanup removes stage directory on success", async () => {
      const env = setupNoCommitEnv();
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

        const externalRoot = join(env.cfgDir, "specs", "project");
        const stageDir = join(externalRoot, ".jarvis-intent-stage");
        expect(existsSync(stageDir)).toBe(false);
      } finally {
        env.cleanup();
      }
    });

    test("accepts file seed from external seeds home", async () => {
      const env = setupNoCommitEnv();
      try {
        const externalRoot = join(env.cfgDir, "specs", "project");
        const seedDir = join(externalRoot, "seeds");
        mkdirSync(seedDir, { recursive: true });
        const seedPath = join(seedDir, "raw-seed.md");
        writeFileSync(seedPath, "# Seed\n");

        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: ["--repo", "project", seedPath],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-two" }),
        });
        expect(code).toBe(0);
        expect(readFileSync(join(externalRoot, "ready-intents", "slice-one.md"), "utf8")).toContain("name: slice-one");
        expect(readFileSync(join(externalRoot, "ready-intents", "slice-two.md"), "utf8")).toContain("name: slice-two");
        expect(existsSync(seedPath)).toBe(false);
      } finally {
        env.cleanup();
      }
    });

    test("file seeds survive failed no-commit publication", async () => {
      const env = setupNoCommitEnv();
      try {
        const externalRoot = join(env.cfgDir, "specs", "project");
        const seedDir = join(externalRoot, "seeds");
        mkdirSync(seedDir, { recursive: true });
        const seedPath = join(seedDir, "raw-seed.md");
        writeFileSync(seedPath, "# Seed\n");
        mkdirSync(join(externalRoot, "ready-intents"), { recursive: true });
        writeFileSync(join(externalRoot, "ready-intents", "slice-one.md"), "keep\n");

        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [seedPath],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-two" }),
        });
        expect(code).toBe(1);
        expect(existsSync(seedPath)).toBe(true);
      } finally {
        env.cleanup();
      }
    });

    test("file seeds survive validation and splitter failures", async () => {
      const env = setupNoCommitEnv();
      try {
        const externalRoot = join(env.cfgDir, "specs", "project");
        const seedDir = join(externalRoot, "seeds");
        mkdirSync(seedDir, { recursive: true });
        const seedPath = join(seedDir, "raw-seed.md");
        writeFileSync(seedPath, "# Seed\n");
        for (const mode of ["invalid-prerequisites", "hard-error"] as const) {
          const cap = captureIo();
          expect(
            await intentCommand({
              io: cap.io,
              args: [seedPath],
              cwd: env.projectRoot,
              config: { dir: env.cfgDir },
              logClient: okLogClient,
              createAgent: createSplitAgentFactory({ claude: mode }),
            }),
          ).toBe(1);
          expect(existsSync(seedPath)).toBe(true);
        }
      } finally {
        env.cleanup();
      }
    });

    test("rejects file seed from in-repo seeds dir", async () => {
      const env = setupNoCommitEnv();
      try {
        const seedDir = join(env.projectRoot, "spec", "seeds");
        mkdirSync(seedDir, { recursive: true });
        const seedPath = join(seedDir, "raw-seed.md");
        writeFileSync(seedPath, "# Seed\n");

        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: ["--repo", "project", seedPath],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-one" }),
        });
        expect(code).toBe(1);
        expect(cap.err()).toContain("intent: raw seed files must live under");
        expect(cap.err()).toContain("seeds/");
        expect(cap.err()).not.toContain("spec/seeds");
        expect(cap.err()).toContain("specs/project/seeds");

        const externalRoot = join(env.cfgDir, "specs", "project");
        expect(existsSync(join(externalRoot, "ready-intents"))).toBe(false);
      } finally {
        env.cleanup();
      }
    });

    test("splitter turn carries additionalReadDirs in spawn options", async () => {
      const env = setupNoCommitEnv();
      try {
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

    test("checkout pollution aborts without partial writes", async () => {
      const env = setupNoCommitEnv();
      try {
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

    test("stage-dir structural scan rejects non-.md files while allowing legitimate siblings", async () => {
      const env = setupNoCommitEnv();
      try {
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

    test("does not create PR or call gh pr ready", async () => {
      const env = setupNoCommitEnv();
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
        expect(cap.err()).toContain("2 intents written to");
        expect(cap.err()).not.toContain("intent: split commit pushed");
        expect(cap.err()).not.toContain("intent: draft PR");
        expect(cap.err()).not.toContain("warning: could not mark PR ready for review");
        expect(cap.out()).not.toContain("https://example.com/pull/");
        expect(existsSync(join(env.projectRoot, ".worktree"))).toBe(false);
      } finally {
        env.cleanup();
      }
    });

    test("repair: missing markdownlint binary warns and continues with in-TS repairs", async () => {
      const env = setupNoCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-md-violations" }),
          markdownlintHarnessRoot: null,
        });
        expect(code).toBe(0);
        expect(cap.err()).toContain("warning: could not locate markdownlint binary; skipping autofix");

        const externalRoot = join(env.cfgDir, "specs", "project");
        const content = readFileSync(join(externalRoot, "ready-intents", "md-violations.md"), "utf8");
        expect(content).toContain("#499");
        expect(content).not.toContain("# 499");
        expect(content).toContain("## Prerequisites");
        expect(content).not.toContain("\n\n\n");
      } finally {
        env.cleanup();
      }
    });

    test("autofix stays on the harness config even when project root provides its own config", async () => {
      if (skipWithoutHarnessMarkdownlint("no-commit harness-config autofix coverage")) {
        return;
      }
      const env = setupNoCommitEnv();
      try {
        writeFileSync(
          join(env.projectRoot, ".markdownlint-cli2.jsonc"),
          JSON.stringify({ config: { default: false } }, null, 2),
          "utf8",
        );

        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-autofix-heading-spacing" }),
        });
        expect(code).toBe(0);

        const externalRoot = join(env.cfgDir, "specs", "project");
        const path = join(externalRoot, "ready-intents", "heading-spacing.md");
        const content = readFileSync(path, "utf8");
        expect(content).toContain("## Intent\n\nBody text.");
        expect(runHarnessMarkdownlint(path)).toBe(0);
      } finally {
        env.cleanup();
      }
    });

    test("accepts issue reference in no-commit path as preserved reference", async () => {
      const env = setupNoCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-md-violations" }),
        });
        expect(code).toBe(0);
        const externalRoot = join(env.cfgDir, "specs", "project");
        const content = readFileSync(join(externalRoot, "ready-intents", "md-violations.md"), "utf8");
        expect(content).toContain("#499");
        expect(content).not.toContain("# 499");
      } finally {
        env.cleanup();
      }
    });

    test("--target-dir in no-commit mode shifts seed-input check but keeps external ready-intents flat", async () => {
      const env = setupNoCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: ["--target-dir", "v1/spec", TWO_BEHAVIOR_SEED],
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

        const externalRoot = join(env.cfgDir, "specs", "project");
        expect(readFileSync(join(externalRoot, "ready-intents", "slice-one.md"), "utf8")).toContain("## Prerequisites");
        expect(readFileSync(join(externalRoot, "ready-intents", "slice-two.md"), "utf8")).toContain("name: slice-two");
        expect(existsSync(join(externalRoot, "v1/spec", "ready-intents"))).toBe(false);
      } finally {
        env.cleanup();
      }
    });

    test("--target-dir in no-commit mode does not affect seed-input directory validation", async () => {
      const env = setupNoCommitEnv();
      try {
        const seedDir = join(env.projectRoot, "spec", "seeds");
        mkdirSync(seedDir, { recursive: true });
        const seedPath = join(seedDir, "raw-seed.md");
        writeFileSync(seedPath, "# Seed\n");

        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: ["--target-dir", "v1/spec", seedPath],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-one" }),
        });
        expect(code).toBe(1);
        expect(cap.err()).toContain("intent: raw seed files must live under");
        expect(cap.err()).toContain("seeds/");
        expect(cap.err()).not.toContain("v1/spec/seeds");
        expect(cap.err()).toContain("specs/project/seeds");
        const externalRoot = join(env.cfgDir, "specs", "project");
        expect(existsSync(join(externalRoot, "ready-intents"))).toBe(false);
      } finally {
        env.cleanup();
      }
    });

    test("repair: mismatched name is repaired in no-commit path", async () => {
      const env = setupNoCommitEnv();
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
        const externalRoot = join(env.cfgDir, "specs", "project");
        const content = readFileSync(join(externalRoot, "ready-intents", "bad-name.md"), "utf8");
        expect(content).toContain("name: bad-name");
        expect(content).toContain("## Prerequisites");
      } finally {
        env.cleanup();
      }
    });

    test("repair: missing name key in no-commit path is inserted", async () => {
      const env = setupNoCommitEnv();
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
        const externalRoot = join(env.cfgDir, "specs", "project");
        const content = readFileSync(join(externalRoot, "ready-intents", "missing-name.md"), "utf8");
        expect(content).toContain("name: missing-name");
        expect(content).toContain("description: A test intent");
        expect(content).toContain("## Prerequisites");
      } finally {
        env.cleanup();
      }
    });
  });

  describe("commit path", () => {
    function fakeRunner(usages: Array<{ args: string[]; cwd: string }>): SubprocessRunner {
      const handlers: Array<(cmd: string, args: string[], cwd: string) => string | undefined> = [];
      handlers.push((cmd, args) => {
        if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") {
          return "main\n";
        }
        return undefined;
      });
      handlers.push((cmd, args) => {
        if (cmd === "git" && args[0] === "status" && args[1] === "--porcelain") {
          return "";
        }
        return undefined;
      });
      handlers.push((cmd, args) => {
        if (cmd === "git" && (args[0] === "add" || args[0] === "commit" || args[0] === "push")) {
          return "";
        }
        return undefined;
      });
      handlers.push((cmd, args) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view" && args.some((a) => a.includes(".url"))) {
          return "https://example.com/pull/1\n";
        }
        return undefined;
      });
      handlers.push((cmd, args) => {
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          // Actually remove the worktree for assertion accuracy
          const pathArg = args[3] !== undefined ? args[3] : (args[2] ?? "");
          try {
            rmSync(pathArg, { recursive: true, force: true });
          } catch {}
          return "";
        }
        return undefined;
      });
      handlers.push(() => "");
      return {
        run(cmd, args, cwd) {
          usages.push({ args: [cmd, ...args], cwd });
          for (const h of handlers) {
            const result = h(cmd, args, cwd);
            if (result !== undefined) return result;
          }
          return "";
        },
      };
    }

    function writeGhScript(binDir: string, stateDir: string): string {
      const ghPath = join(binDir, "gh");
      const script = `#!/usr/bin/env bash
set -euo pipefail
STATEDIR=${JSON.stringify(stateDir)}
PR_CREATED="$STATEDIR/pr-created"
PR_READY="$STATEDIR/pr-ready"
if [[ "$1 $2" == "auth status" ]]; then exit 0; fi
if [[ "$1 $2" == "repo view" ]]; then printf 'main\\n'; exit 0; fi
if [[ "$1 $2" == "pr create" ]]; then touch "$PR_CREATED"; exit 0; fi
if [[ "$1 $2" == "pr view" ]]; then
  if [[ "$*" == *"--json url"* ]]; then printf 'https://example.com/pull/1\\n'; exit 0; fi
  if [[ "$*" == *"number,state,isDraft"* ]]; then
    if [[ ! -f "$PR_CREATED" ]]; then exit 1; fi
    if [[ -f "$PR_READY" ]]; then
      printf '{"number":1,"state":"OPEN","isDraft":false}\\n'
    else
      printf '{"number":1,"state":"OPEN","isDraft":true}\\n'
    fi
    exit 0
  fi
  if [[ "$*" == *"select(.state=="OPEN") | {number: .number, isDraft: .isDraft}"* ]]; then
    if [[ ! -f "$PR_CREATED" ]]; then exit 1; fi
    if [[ -f "$PR_READY" ]]; then
      printf '{"number":1,"state":"OPEN","isDraft":false}\\n'
    else
      printf '{"number":1,"state":"OPEN","isDraft":true}\\n'
    fi
    exit 0
  fi
  if [[ "$*" == *"select(.state=="OPEN") | .number"* ]]; then
    if [[ ! -f "$PR_CREATED" ]]; then exit 1; fi
    printf '1\\n'
    exit 0
  fi
  if [[ "$*" == *"select(.isDraft)"* ]]; then
    if [[ ! -f "$PR_CREATED" ]]; then exit 1; fi
    if [[ -f "$PR_READY" ]]; then printf 'false\\n'; else printf 'true\\n'; fi
    exit 0
  fi
  if [[ "$*" == *".number"* ]]; then
    if [[ ! -f "$PR_CREATED" ]]; then exit 1; fi
    printf '1\\n'
    exit 0
  fi
  exit 0
fi
if [[ "$1 $2" == "pr edit" ]]; then exit 0; fi
if [[ "$1 $2" == "pr ready" ]]; then touch "$PR_READY"; exit 0; fi
exit 0
`;
      writeFileSync(ghPath, script, "utf8");
      chmodSync(ghPath, 0o755);
      return ghPath;
    }

    function setupCommitEnv(): {
      dir: string;
      cfgDir: string;
      projectRoot: string;
      prCreated: string;
      prReady: string;
      cleanup: () => void;
      runner: SubprocessRunner;
      runnerCalls: Array<{ args: string[]; cwd: string }>;
      createIntentWorktree: (opts: { projectRoot: string; name: string; baseBranch?: string }) => Promise<string>;
      renderAttribution: (opts: { cwd: string; base: string }) => string;
    } {
      const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-commit-"));
      const cfgDir = join(dir, "cfg");
      const projectRoot = join(dir, "project");
      const prCreated = join(dir, "pr-created");
      const prReady = join(dir, "pr-ready");
      const binDir = join(dir, "bin");

      mkdirSync(projectRoot);
      mkdirSync(binDir, { recursive: true });
      registerProject("project", projectRoot, { dir: cfgDir });

      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.plan.agentOrder = [
        { agent: "claude", model: "haiku" },
        { agent: "codex", model: "gpt-5.3-codex" },
      ];
      writeConfig(cfg, { dir: cfgDir });

      const origPath = process.env.PATH;
      writeGhScript(binDir, dir);
      process.env.PATH = `${binDir}:${origPath ?? ""}`;

      const runnerCalls: Array<{ args: string[]; cwd: string }> = [];
      const runnerInstance = fakeRunner(runnerCalls);

      return {
        dir,
        cfgDir,
        projectRoot,
        prCreated,
        prReady,
        runner: runnerInstance,
        runnerCalls,
        createIntentWorktree: async (opts) => {
          const worktreePath = join(opts.projectRoot, ".worktree", `intent-${opts.name}`);
          mkdirSync(worktreePath, { recursive: true });
          const srcReadyDir = join(opts.projectRoot, "spec", "ready-intents");
          if (existsSync(srcReadyDir)) {
            const dstReadyDir = join(worktreePath, "spec", "ready-intents");
            mkdirSync(dstReadyDir, { recursive: true });
            for (const entry of readdirSync(srcReadyDir)) {
              writeFileSync(join(dstReadyDir, entry), readFileSync(join(srcReadyDir, entry)));
            }
          }
          const srcSeedDir = join(opts.projectRoot, "spec", "seeds");
          if (existsSync(srcSeedDir)) {
            const dstSeedDir = join(worktreePath, "spec", "seeds");
            mkdirSync(dstSeedDir, { recursive: true });
            for (const entry of readdirSync(srcSeedDir)) {
              writeFileSync(join(dstSeedDir, entry), readFileSync(join(srcSeedDir, entry)));
            }
          }
          return worktreePath;
        },
        renderAttribution: () => "",
        cleanup: () => {
          process.env.PATH = origPath;
          rmSync(dir, { recursive: true, force: true });
        },
      };
    }

    test("inline seed writes N intents to ready-intents and opens a draft PR", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-two" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
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
        expect(existsSync(env.prCreated)).toBe(true);
      } finally {
        env.cleanup();
      }
    });

    test("file seed split commits its deletion while unrelated seeds remain", async () => {
      const env = setupCommitEnv();
      try {
        const seedDir = join(env.projectRoot, "spec", "seeds");
        mkdirSync(seedDir, { recursive: true });
        const seedPath = join(seedDir, "raw-seed.md");
        writeFileSync(seedPath, "# Seed\n");
        writeFileSync(join(seedDir, "unrelated.md"), "# Other\n");

        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [seedPath],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-one" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        const worktree = findIntentWorktree(env.projectRoot);
        expect(existsSync(seedPath)).toBe(true);
        expect(readFileSync(seedPath, "utf8")).toBe("# Seed\n");
        expect(existsSync(join(worktree, "spec", "seeds", "raw-seed.md"))).toBe(false);
        expect(readFileSync(join(worktree, "spec", "seeds", "unrelated.md"), "utf8")).toBe("# Other\n");
        expect(readFileSync(join(worktree, "spec", "ready-intents", "single-behavior.md"), "utf8")).toContain(
          "name: single-behavior",
        );
        const commit = env.runnerCalls.find((call) => call.args[0] === "git" && call.args[1] === "commit");
        expect(commit?.args.join("\n")).toContain("intent: split 1 intent");
      } finally {
        env.cleanup();
      }
    });

    test("name collisions abort without overwriting ready-intents or opening a PR", async () => {
      const env = setupCommitEnv();
      try {
        const existingDir = join(env.projectRoot, "spec", "ready-intents");
        mkdirSync(existingDir, { recursive: true });
        writeFileSync(join(existingDir, "slice-one.md"), "keep me\n");

        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-two" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(1);
        expect(cap.err()).toContain("spec/ready-intents/slice-one.md already exists");
        expect(readFileSync(join(existingDir, "slice-one.md"), "utf8")).toBe("keep me\n");
        expect(existsSync(env.prCreated)).toBe(false);
      } finally {
        env.cleanup();
      }
    });

    test("mismatched frontmatter name is repaired and succeeds", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-mismatched-name" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        expect(cap.err()).toContain("intent: split commit pushed");
        expect(existsSync(env.prCreated)).toBe(true);
        const worktree = findIntentWorktree(env.projectRoot);
        const content = readFileSync(join(worktree, "spec", "ready-intents", "bad-name.md"), "utf8");
        expect(content).toContain("name: bad-name");
        expect(content).toContain("## Prerequisites");
      } finally {
        env.cleanup();
      }
    });

    test("non-bullet prerequisites abort without partial ready-intents or a PR", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "invalid-prerequisites" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(1);
        expect(cap.err()).toContain("must list prerequisites as one bullet per line");
        expect(existsSync(env.prCreated)).toBe(false);
        expect(existsSync(join(env.projectRoot, ".worktree"))).toBe(true);
        expect(readdirSync(join(env.projectRoot, ".worktree"))).toHaveLength(0);
      } finally {
        env.cleanup();
      }
    });

    test("quota exhaustion falls through to the next configured agent", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "quota", codex: "ok-two" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        expect(cap.err()).toContain("intent: claude: quota exhausted; falling back");
        expect(cap.out()).toContain("jarvis1 plan spec/ready-intents/slice-two.md");
      } finally {
        env.cleanup();
      }
    });

    test("quota fallback retries with a clean stage directory", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "quota-dirty", codex: "ok-one" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
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

    test("model_config falls through to the next configured agent", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "model_config", codex: "ok-two" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        expect(cap.err()).toContain(`intent: claude: ${HARNESS_MODEL_CONFIG_FALLBACK}`);
        expect(cap.out()).toContain("jarvis1 plan spec/ready-intents/slice-two.md");
      } finally {
        env.cleanup();
      }
    });

    test("all agents model_config exits 3 with terminal message", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "model_config", codex: "model_config" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(3);
        expect(cap.err()).toContain("intent: model configuration error");
      } finally {
        env.cleanup();
      }
    });

    test("hard error falls through to the next configured agent", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "hard-error", codex: "ok-two" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        expect(cap.out()).toContain("jarvis1 plan spec/ready-intents/slice-two.md");
      } finally {
        env.cleanup();
      }
    });

    test("model_config rotation includes agent stderr when non-empty", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "model_config-with-stderr", codex: "ok-one" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        expect(cap.err()).toContain(`intent: claude: ${HARNESS_MODEL_CONFIG_FALLBACK}`);
        expect(cap.err()).toContain("unknown model: fake-model");
      } finally {
        env.cleanup();
      }
    });

    test("repair: missing frontmatter block is prepended", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-no-frontmatter" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
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
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-missing-name" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
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
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-missing-prerequisites" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        const worktree = findIntentWorktree(env.projectRoot);
        const content = readFileSync(join(worktree, "spec", "ready-intents", "missing-prereqs.md"), "utf8");
        expect(content).toContain("name: missing-prereqs");
        expect(content).toContain("## Prerequisites");
        const lines = content.split("\n");
        const lastContent = lines.filter((line) => line.trim()).pop();
        expect(lastContent).toBe("## Prerequisites");
      } finally {
        env.cleanup();
      }
    });

    test("repair: prerequisites heading spacing is normalized", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-prerequisites-spacing" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        const worktree = findIntentWorktree(env.projectRoot);
        const content = readFileSync(join(worktree, "spec", "ready-intents", "spacing.md"), "utf8");
        expect(content).toContain(
          "Should normalize spacing around prerequisites.\n\n## Prerequisites\n\n- first dependency",
        );
      } finally {
        env.cleanup();
      }
    });

    test("repair: compliant file is left unchanged", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-two" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        const worktree = findIntentWorktree(env.projectRoot);
        const content1 = readFileSync(join(worktree, "spec", "ready-intents", "slice-one.md"), "utf8");
        const content2 = readFileSync(join(worktree, "spec", "ready-intents", "slice-two.md"), "utf8");
        expect(content1).toContain("---\nname: slice-one\n---");
        expect(content2).toContain("---\nname: slice-two\n---");
        expect(content1).toContain("## Prerequisites");
        expect(content2).toContain("## Prerequisites");
      } finally {
        env.cleanup();
      }
    });

    test("repair: unterminated frontmatter is not repaired and fails validation", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-unterminated-frontmatter" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(1);
        expect(cap.err()).toContain("must declare name: unterminated");
        expect(existsSync(env.prCreated)).toBe(false);
        expect(existsSync(join(env.projectRoot, ".worktree"))).toBe(true);
        expect(readdirSync(join(env.projectRoot, ".worktree"))).toHaveLength(0);
      } finally {
        env.cleanup();
      }
    });

    test("repair: near-miss Prerequisites heading (### instead of ##) is left in place while empty section is appended", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-near-miss-prerequisites" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        expect(cap.err()).toContain("intent: split commit pushed");
        expect(existsSync(env.prCreated)).toBe(true);
        const worktree = findIntentWorktree(env.projectRoot);
        const content = readFileSync(join(worktree, "spec", "ready-intents", "near-miss.md"), "utf8");
        expect(content).toContain("### Prerequisites");
        expect(content).toContain("## Prerequisites");
        const lines = content.split("\n");
        const lastContent = lines.filter((line) => line.trim()).pop();
        expect(lastContent).toBe("## Prerequisites");
      } finally {
        env.cleanup();
      }
    });

    test("repair: empty name value is filled with slug", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-empty-name" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        const worktree = findIntentWorktree(env.projectRoot);
        const content = readFileSync(join(worktree, "spec", "ready-intents", "empty-name.md"), "utf8");
        expect(content).toContain("name: empty-name");
        expect(content).toContain("## Prerequisites");
      } finally {
        env.cleanup();
      }
    });

    test("auto-ready AC1: committed run flips ready immediately", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-two" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        expect(cap.err()).toContain("intent: split commit pushed");
        expect(cap.err()).toContain("intent: draft PR #1 opened");
        expect(cap.out()).toContain("https://example.com/pull/1");
        expect(existsSync(env.prReady)).toBe(true);
      } finally {
        env.cleanup();
      }
    });

    test("auto-ready AC2: gh ready failure exits 0", async () => {
      const env = setupCommitEnv();
      try {
        // Simulate gh ready failure by setting a flag in the environment
        // that tells the gh script to fail on pr ready
        const ghPath = join(env.dir, "bin", "gh");
        const readScript = readFileSync(ghPath, "utf8");
        const failScript = readScript.replace('touch "$PR_READY"', "exit 1");
        writeFileSync(ghPath, failScript, "utf8");
        chmodSync(ghPath, 0o755);

        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-two" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        expect(cap.err()).toContain("intent: split commit pushed");
        expect(cap.err()).toContain("intent: draft PR #1 opened");
        expect(cap.err()).toContain("warning: could not mark PR ready for review");
        expect(existsSync(env.prReady)).toBe(false);
      } finally {
        env.cleanup();
      }
    });

    test("--target-dir flag routes committed ready-intents to the overridden directory", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: ["--target-dir", "v1/spec", TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-two" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        expect(cap.err()).toContain("intent: split commit pushed");
        expect(cap.err()).toContain("intent: draft PR #1 opened");
        expect(cap.out()).toContain("https://example.com/pull/1");
        expect(cap.out()).toContain("jarvis1 plan v1/spec/ready-intents/slice-one.md");
        expect(cap.out()).toContain("jarvis1 plan v1/spec/ready-intents/slice-two.md");

        const worktree = findIntentWorktree(env.projectRoot);
        expect(readFileSync(join(worktree, "v1/spec", "ready-intents", "slice-one.md"), "utf8")).toContain(
          "## Prerequisites",
        );
        expect(readFileSync(join(worktree, "v1/spec", "ready-intents", "slice-two.md"), "utf8")).toContain(
          "name: slice-two",
        );
        expect(existsSync(join(worktree, "spec", "ready-intents"))).toBe(false);
      } finally {
        env.cleanup();
      }
    });

    test("--target-dir flag rejects file seed outside the overridden directory", async () => {
      const env = setupCommitEnv();
      try {
        const seedDir = join(env.projectRoot, "spec", "seeds");
        mkdirSync(seedDir, { recursive: true });
        const seedPath = join(seedDir, "raw-seed.md");
        writeFileSync(seedPath, "# Seed\n");

        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: ["--target-dir", "v1/spec", seedPath],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-one" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(1);
        expect(cap.err()).toContain("intent: raw seed files must live under v1/spec/seeds/");
        expect(existsSync(env.prCreated)).toBe(false);
      } finally {
        env.cleanup();
      }
    });

    test("--target-dir flag accepts file seed under the overridden directory", async () => {
      const env = setupCommitEnv();
      try {
        const seedDir = join(env.projectRoot, "v1/spec", "seeds");
        mkdirSync(seedDir, { recursive: true });
        const seedPath = join(seedDir, "raw-seed.md");
        writeFileSync(seedPath, "# Seed\n");

        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: ["--target-dir", "v1/spec", seedPath],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "ok-one" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        expect(cap.err()).toContain("intent: split commit pushed");
        const worktree = findIntentWorktree(env.projectRoot);
        expect(readFileSync(join(worktree, "v1/spec", "ready-intents", "single-behavior.md"), "utf8")).toContain(
          "name: single-behavior",
        );
      } finally {
        env.cleanup();
      }
    });

    test("repair: MD012/MD018 violations are fixed by trim + reference relocation + autofix", async () => {
      if (skipWithoutHarnessMarkdownlint("repair: MD012/MD018 integration coverage")) {
        return;
      }
      const env = setupCommitEnv();
      try {
        const seededPath = join(env.projectRoot, "seeded-md-violations.md");
        const seededContent = `---
name: md-violations
---

# MD violations

## Intent

Some content with a reference.

#499

## Prerequisites


`;
        writeFileSync(seededPath, seededContent, "utf8");
        expect(runHarnessMarkdownlint(seededPath)).toBe(1);

        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-md-violations" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        const worktree = findIntentWorktree(env.projectRoot);
        const content = readFileSync(join(worktree, "spec", "ready-intents", "md-violations.md"), "utf8");
        expect(content).not.toBe(seededContent);
        expect(content).toContain("#499");
        expect(content).not.toContain("# 499");
        const lines = content.split("\n");
        const refLine = lines.find((line) => line.includes("#499"));
        expect(refLine).toBeDefined();
        expect(refLine).not.toMatch(/^#\d+/);
        expect(content).toContain("## Prerequisites");
        expect(content).not.toContain("\n\n\n");
        expect(runHarnessMarkdownlint(join(worktree, "spec", "ready-intents", "md-violations.md"))).toBe(0);
      } finally {
        env.cleanup();
      }
    });

    test("repair: missing markdownlint binary warns and continues with in-TS repairs", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-md-violations" }),
          markdownlintHarnessRoot: null,
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        expect(cap.err()).toContain("warning: could not locate markdownlint binary; skipping autofix");

        const worktree = findIntentWorktree(env.projectRoot);
        const content = readFileSync(join(worktree, "spec", "ready-intents", "md-violations.md"), "utf8");
        expect(content).toContain("#499");
        expect(content).not.toContain("# 499");
        expect(content).toContain("## Prerequisites");
        expect(content).not.toContain("\n\n\n");
      } finally {
        env.cleanup();
      }
    });

    test("repair: duplicate name: line in body is replaced with # heading", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-duplicate-name-heading" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        const worktree = findIntentWorktree(env.projectRoot);
        const content = readFileSync(join(worktree, "spec", "ready-intents", "test-intent.md"), "utf8");
        expect(content).toContain("# Test Intent");
        expect(content).not.toContain("name: test-intent\n\nname: test-intent");
        expect(content).toContain("## Prerequisites");
      } finally {
        env.cleanup();
      }
    });

    test("repair: missing heading in body is prepended", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-missing-heading" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        const worktree = findIntentWorktree(env.projectRoot);
        const content = readFileSync(join(worktree, "spec", "ready-intents", "missing-heading.md"), "utf8");
        expect(content).toContain("# Missing Heading");
        const lines = content.split("\n");
        const headingIdx = lines.indexOf("# Missing Heading");
        const contentIdx = lines.findIndex((line) => line.includes("Some content without a heading"));
        expect(headingIdx).toBeGreaterThanOrEqual(0);
        expect(contentIdx).toBeGreaterThan(headingIdx);
        expect(content).toContain("## Prerequisites");
      } finally {
        env.cleanup();
      }
    });

    test("repair: existing heading in body is left untouched", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-heading-already-present" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        const worktree = findIntentWorktree(env.projectRoot);
        const content = readFileSync(join(worktree, "spec", "ready-intents", "has-heading.md"), "utf8");
        expect(content).toContain("# Custom Title");
        expect(content).not.toContain("# Has Heading");
        expect(content).toContain("Some content.");
        expect(content).toContain("## Prerequisites");
      } finally {
        env.cleanup();
      }
    });

    test("repair: name-prefixed prose that doesn't match the slug is preserved, heading prepended", async () => {
      const env = setupCommitEnv();
      try {
        const cap = captureIo();
        const code = await intentCommand({
          io: cap.io,
          args: [TWO_BEHAVIOR_SEED],
          cwd: env.projectRoot,
          config: { dir: env.cfgDir },
          logClient: okLogClient,
          createAgent: createSplitAgentFactory({ claude: "repair-name-prefixed-prose" }),
          runner: env.runner,
          createIntentWorktree: env.createIntentWorktree,
          renderAttribution: env.renderAttribution,
        });
        expect(code).toBe(0);
        const worktree = findIntentWorktree(env.projectRoot);
        const content = readFileSync(join(worktree, "spec", "ready-intents", "name-prefixed-prose.md"), "utf8");
        const lines = content.split("\n");
        const headingIdx = lines.indexOf("# Name Prefixed Prose");
        const proseIdx = lines.indexOf("name: value pairs are validated before merging.");
        expect(headingIdx).toBeGreaterThanOrEqual(0);
        expect(proseIdx).toBeGreaterThan(headingIdx);
        expect(content).toContain("## Prerequisites");
      } finally {
        env.cleanup();
      }
    });
  });
});
