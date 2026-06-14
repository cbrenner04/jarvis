import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { planCommand } from "../src/commands/plan.ts";
import { computeNoCommitSpecRoot, stripPlanSpecTimestampPrefix } from "../src/modes/plan/spec-paths.ts";
import { loadConfig, registerProject, writeConfig } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };

const okLogClient: LogClient = {
  assertReachable: async () => {},
  send: async () => {},
};

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

type PlanPhaseAgentOptions = {
  proposedName?: string;
  invalidName?: boolean;
  failIntentDraft?: boolean;
  cfgDir?: string;
};

function writeDraftedIntent(intentPath: string, proposedName: string): void {
  const current = readFileSync(intentPath, "utf8");
  const rawBegin = current.indexOf("<<<RAW_SEED_BEGIN>>>");
  const rawEnd = current.indexOf("<<<RAW_SEED_END>>>");
  if (rawBegin === -1 || rawEnd === -1) {
    throw new Error("expected raw seed block in seeded intent");
  }
  const rawBlock = current.slice(rawBegin, rawEnd + "<<<RAW_SEED_END>>>".length);
  const next = `---
name: ${proposedName}
---

## Raw seed

${rawBlock}

## Intent

Drafted intent body.
`;
  writeFileSync(intentPath, next, "utf8");
}

function extractPromptPath(prompt: string, label: string): string | null {
  const match = new RegExp(`\\*\\*${label}:\\*\\* \`([^\`]+)\``).exec(prompt);
  return match?.[1] ?? null;
}

function writeDraftSpecTree(specDir: string, _flatLayout: boolean): void {
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "index.md"), "# Draft spec\n\n- [ ] [00 - One](./00-one.md)\n");
  writeFileSync(join(specDir, "00-one.md"), "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One.\n");
}

class PlanPhaseAgent implements Agent {
  readonly name: AgentName = "claude";
  readonly #opts: PlanPhaseAgentOptions;

  constructor(opts: PlanPhaseAgentOptions = {}) {
    this.#opts = opts;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    if (this.#opts.failIntentDraft && prompt.includes("Intent Draft Phase")) {
      return { kind: "error", exitCode: 1, stderr: "synthetic intent-draft failure" };
    }

    if (prompt.includes("Intent Draft Phase")) {
      const intentPath = join(opts.cwd, "intent.md");
      const proposed = this.#opts.invalidName ? "Bad Name!" : (this.#opts.proposedName ?? "some-cool-prompt");
      writeDraftedIntent(intentPath, proposed);
      return { kind: "ok", stdout: "", stderr: "" };
    }

    if (prompt.includes("Intent Refinement Phase")) {
      const intentPath = findIntentPath(opts.cwd, this.#opts.cfgDir);
      if (intentPath !== null) {
        const body = readFileSync(intentPath, "utf8");
        writeFileSync(intentPath, `${body.trimEnd()}\n\n## Refine skip\n`, "utf8");
      }
      return { kind: "ok", stdout: "", stderr: "" };
    }

    if (prompt.includes("Draft Phase")) {
      const flat = prompt.includes("Only write files in the working directory");
      if (flat) {
        const specDir = extractPromptPath(prompt, "Working directory") ?? opts.cwd;
        writeDraftSpecTree(specDir, true);
      } else {
        const specDir = findWorktreeSpecDir(opts.cwd);
        if (specDir === null) {
          throw new Error(`expected spec dir under ${opts.cwd}`);
        }
        writeDraftSpecTree(specDir, false);
      }
      return { kind: "ok", stdout: "", stderr: "" };
    }

    return { kind: "ok", stdout: "", stderr: "" };
  }

  attributionLabel(): string {
    return "fake-claude";
  }
}

function findIntentPath(cwd: string, cfgDir?: string): string | null {
  const roots = [cwd];
  if (cfgDir !== undefined) {
    roots.push(join(cfgDir, "specs"));
  }
  for (const root of roots) {
    const found = walkForIntent(root, 0);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function walkForIntent(dir: string, depth: number): string | null {
  if (!existsSync(dir) || depth > 5) {
    return null;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name === "intent.md") {
      return full;
    }
    if (entry.isDirectory()) {
      const nested = walkForIntent(full, depth + 1);
      if (nested !== null) {
        return nested;
      }
    }
  }
  return null;
}

function findWorktreeSpecDir(worktreeRoot: string): string | null {
  const specRoot = join(worktreeRoot, "spec");
  if (!existsSync(specRoot)) {
    return null;
  }
  for (const name of readdirSync(specRoot)) {
    const candidate = join(specRoot, name);
    if (existsSync(join(candidate, "intent.md"))) {
      return candidate;
    }
  }
  return null;
}

type FreshSeedEnv = {
  projectRoot: string;
  cfgDir: string;
  cleanup: () => void;
};

function setupFreshSeedEnv(): FreshSeedEnv {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-fresh-seed-"));
  const cfgDir = join(dir, "cfg");
  const projectRoot = join(dir, "project");
  const origin = join(dir, "origin.git");

  mkdirSync(projectRoot);
  mkdirSync(origin);
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

  const binDir = join(dir, "bin");
  mkdirSync(binDir);
  const realGh = execSync("command -v gh", { encoding: "utf8" }).trim();
  const gh = join(binDir, "gh");
  const prState = join(dir, "pr-state");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "auth status" ]]; then exit 0; fi
if [[ "$1 $2" == "repo view" ]]; then printf 'main\\n'; exit 0; fi
if [[ "$1 $2" == "pr view" ]]; then
  if [[ "$*" == *"--json url"* ]]; then printf 'https://example.com/pull/1\\n'
  elif [[ "$*" == *"--json number"* ]]; then printf '1\\n'
  elif [[ "$*" == *"isDraft"* ]]; then printf 'true\\n'
  else printf '1\\n'; fi
  exit 0
fi
if [[ "$1 $2" == "pr create" ]]; then touch "${prState}"; exit 0; fi
if [[ "$1 $2" == "pr ready" ]]; then exit 0; fi
if [[ "$1 $2" == "pr edit" ]]; then exit 0; fi
exec "${realGh}" "$@"
`,
  );
  execSync(`chmod +x ${gh}`);
  process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;

  const cfg = loadConfig({ dir: cfgDir });
  cfg.modes.plan.agentOrder = [CLAUDE_ENTRY];
  cfg.modes.review = { passes: 1 };
  writeConfig(cfg, { dir: cfgDir });

  return {
    projectRoot,
    cfgDir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function createAgentFactory(opts: PlanPhaseAgentOptions = {}) {
  const agent = new PlanPhaseAgent(opts);
  return (_name: AgentName, _model: string | undefined) => agent;
}

function listWorktreeSpecDirs(projectRoot: string): string[] {
  const worktreeRoot = join(projectRoot, ".worktree");
  if (!existsSync(worktreeRoot)) {
    return [];
  }
  const names: string[] = [];
  for (const worktree of readdirSync(worktreeRoot)) {
    const specRoot = join(worktreeRoot, worktree, "spec");
    if (!existsSync(specRoot)) {
      continue;
    }
    for (const specDir of readdirSync(specRoot)) {
      if (existsSync(join(specRoot, specDir, "intent.md"))) {
        names.push(specDir);
      }
    }
  }
  return names;
}

describe("plan fresh seed flow", () => {
  test("inline seed creates committed worktree intent.md instead of wip-intents", async () => {
    const env = setupFreshSeedEnv();
    try {
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--refine-turns", "0", "--review-passes", "0", "some cool prompt"],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createAgentFactory({ cfgDir: env.cfgDir }),
      });

      expect(code).toBe(1);
      expect(cap.err()).toContain("plan: refine: skipped");
      expect(cap.err()).toContain("plan: blocked");
      expect(cap.err()).not.toContain("no-argument");
      expect(cap.err()).not.toContain("wip-intents");

      const worktrees = readdirSync(join(env.projectRoot, ".worktree"));
      const finalWorktree = worktrees.find((name) => name === "plan-some-cool-prompt");
      expect(finalWorktree).toBe("plan-some-cool-prompt");

      const specDirs = listWorktreeSpecDirs(env.projectRoot);
      expect(specDirs.length).toBe(1);
      const specDirBasename = specDirs[0] as string;
      expect(stripPlanSpecTimestampPrefix(specDirBasename)).toBe("some-cool-prompt");
      const intentPath = join(env.projectRoot, ".worktree", "plan-some-cool-prompt", "spec", specDirBasename, "intent.md");
      expect(existsSync(intentPath)).toBe(true);
      expect(readFileSync(intentPath, "utf8")).toContain("some cool prompt");
      expect(existsSync(join(env.projectRoot, "v1", "spec", "wip-intents"))).toBe(false);
    } finally {
      env.cleanup();
    }
  });

  test("file seed follows the same fresh-run path as inline text", async () => {
    const env = setupFreshSeedEnv();
    try {
      const seedPath = join(env.projectRoot, "seed-intent.md");
      writeFileSync(seedPath, "# File seed\n\nShip csv export.\n");

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--refine-turns", "0", "--review-passes", "0", seedPath],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createAgentFactory({ proposedName: "ship-csv-export", cfgDir: env.cfgDir }),
      });

      expect(code).toBe(1);
      expect(cap.err()).toContain("plan: refine: skipped");

      const worktrees = readdirSync(join(env.projectRoot, ".worktree"));
      expect(worktrees.some((name) => name === "plan-ship-csv-export")).toBe(true);

      const specDirs = listWorktreeSpecDirs(env.projectRoot);
      expect(specDirs.length).toBe(1);
      const intentPath = join(
        env.projectRoot,
        ".worktree",
        "plan-ship-csv-export",
        "spec",
        specDirs[0] as string,
        "intent.md",
      );
      expect(readFileSync(intentPath, "utf8")).toContain("Ship csv export.");
    } finally {
      env.cleanup();
    }
  });

  test("--refine-turns 0 on a seeded fresh run skips refine without no-arg rejection", async () => {
    const env = setupFreshSeedEnv();
    try {
      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--refine-turns", "0", "--review-passes", "0", "skip refine test"],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createAgentFactory({ proposedName: "skip-refine-test", cfgDir: env.cfgDir }),
      });

      expect(code).toBe(1);
      const err = cap.err();
      expect(err).toContain("plan: refine: skipped");
      expect(err).not.toMatch(/no-argument|no argument/i);
    } finally {
      env.cleanup();
    }
  });

  test("commit: false runs intent, refine, draft, and review in one invocation", async () => {
    const env = setupFreshSeedEnv();
    try {
      const cfg = loadConfig({ dir: env.cfgDir });
      const projectCfg = cfg.projects.project;
      if (!projectCfg) {
        throw new Error("expected project config");
      }
      projectCfg.plan = { commit: false, specTimestamp: false };
      writeConfig(cfg, { dir: env.cfgDir });

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--refine-turns", "1", "--review-passes", "1", "no commit flow"],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createAgentFactory({ proposedName: "no-commit-flow", cfgDir: env.cfgDir }),
      });

      expect(code).toBe(0);
      expect(cap.err()).toContain("plan: draft phase completed");
      expect(cap.out()).toContain("jarvis1 run");

      const project = loadConfig({ dir: env.cfgDir }).projects.project;
      if (!project) {
        throw new Error("expected project");
      }
      const externalRoot = computeNoCommitSpecRoot(env.cfgDir, { key: "project", root: env.projectRoot }, "no-commit-flow");
      expect(existsSync(join(externalRoot, "index.md"))).toBe(true);
      expect(existsSync(join(externalRoot, "intent.md"))).toBe(true);
      if (existsSync(join(env.projectRoot, ".worktree"))) {
        expect(readdirSync(join(env.projectRoot, ".worktree")).length).toBe(0);
      }
    } finally {
      env.cleanup();
    }
  });

  test("invalid proposed name falls back to deterministic derivation", async () => {
    const env = setupFreshSeedEnv();
    try {
      const cap = captureIo();
      await planCommand({
        io: cap.io,
        args: ["--refine-turns", "0", "--review-passes", "0", "fallback naming test"],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createAgentFactory({ invalidName: true, cfgDir: env.cfgDir }),
      });

      expect(cap.err()).toContain("falling back to deterministic derivation");
      const worktrees = readdirSync(join(env.projectRoot, ".worktree"));
      expect(worktrees.some((name) => name.startsWith("plan-fallback-naming-test"))).toBe(true);
    } finally {
      env.cleanup();
    }
  });

  test("collision suffixing picks the next free plan name", async () => {
    const env = setupFreshSeedEnv();
    try {
      mkdirSync(join(env.projectRoot, "spec", "some-cool-prompt"), { recursive: true });
      writeFileSync(join(env.projectRoot, "spec", "some-cool-prompt", "intent.md"), "existing\n");

      const cap = captureIo();
      await planCommand({
        io: cap.io,
        args: ["--refine-turns", "0", "--review-passes", "0", "some cool prompt"],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createAgentFactory({ cfgDir: env.cfgDir }),
      });

      const worktreeRoot = join(env.projectRoot, ".worktree");
      if (!existsSync(worktreeRoot)) {
        throw new Error(`expected worktree root after collision run: ${cap.err()}`);
      }
      const worktrees = readdirSync(worktreeRoot);
      expect(worktrees.some((name) => name === "plan-some-cool-prompt-2")).toBe(true);
    } finally {
      env.cleanup();
    }
  });

  test("commit: false cleans temp spec dir after intent-draft failure", async () => {
    const env = setupFreshSeedEnv();
    try {
      const cfg = loadConfig({ dir: env.cfgDir });
      const projectCfg = cfg.projects.project;
      if (!projectCfg) {
        throw new Error("expected project config");
      }
      projectCfg.plan = { commit: false, specTimestamp: false };
      writeConfig(cfg, { dir: env.cfgDir });

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["cleanup on failure"],
        cwd: env.projectRoot,
        config: { dir: env.cfgDir },
        logClient: okLogClient,
        createAgent: createAgentFactory({ failIntentDraft: true, cfgDir: env.cfgDir }),
      });

      expect(code).toBe(1);
      const specsRoot = join(env.cfgDir, "specs", "project");
      if (existsSync(specsRoot)) {
        expect(readdirSync(specsRoot).some((name) => name.startsWith("tmp-"))).toBe(false);
      }
    } finally {
      env.cleanup();
    }
  });
});
