import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { planCommand } from "../src/commands/plan.ts";
import { loadConfig, registerProject, writeConfig } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";

const READY_INTENT = "---\nname: my-feature\n---\n\n## Prerequisites\n\nnone\n";

class DraftAgent implements Agent {
  readonly name: AgentName = "claude";

  async run(_prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    const specRoot = join(opts.cwd, "spec");
    const specDir = readdirSync(specRoot)
      .map((entry) => join(specRoot, entry))
      .find((entry) => existsSync(join(entry, "intent.md")));
    if (specDir && !existsSync(join(specDir, "index.md"))) {
      writeFileSync(join(specDir, "index.md"), "# Draft\n\n- [ ] [00](./00-one.md)\n");
      writeFileSync(join(specDir, "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] done\n");
    }
    return { kind: "ok", stdout: "", stderr: "" };
  }

  attributionLabel(): string {
    return "draft-agent";
  }
}

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

function writeGhStub(binDir: string, stateDir: string): void {
  const ghPath = join(binDir, "gh");
  writeFileSync(
    ghPath,
    `#!/usr/bin/env bash
set -euo pipefail
state_dir=${JSON.stringify(stateDir)}
pr_file="$state_dir/pr-created"
body_file="$state_dir/pr-body.txt"
if [[ "$#" -ge 3 && "$1" == "repo" && "$2" == "view" && "$3" == "--json" ]]; then
  printf 'main\\n'
  exit 0
fi
if [[ "$#" -ge 3 && "$1" == "pr" && "$2" == "view" ]]; then
  branch="$3"
  shift 3
  if [[ ! -f "$pr_file" ]]; then
    exit 0
  fi
  case "$*" in
    "--json number,state -q select(.state==\\"OPEN\\") | .number")
      printf '1\\n'
      ;;
    "--json number,state -q .number")
      printf '1\\n'
      ;;
    "--json url -q .url")
      printf 'https://example.test/%s\\n' "$branch"
      ;;
    "--json body -q .body")
      cat "$body_file"
      ;;
    "--json number,state,isDraft -q select(.state==\\"OPEN\\") | {number: .number, isDraft: .isDraft}")
      printf '{"number":1,"isDraft":false}\\n'
      ;;
    *)
      exit 1
      ;;
  esac
  exit 0
fi
if [[ "$#" -ge 3 && "$1" == "pr" && "$2" == "create" ]]; then
  : > "$pr_file"
  body=""
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == "--body" ]]; then
      body="$2"
      break
    fi
    shift
  done
  printf '%s' "$body" > "$body_file"
  exit 0
fi
if [[ "$#" -ge 4 && "$1" == "pr" && "$2" == "edit" && "$4" == "--body-file" ]]; then
  cat > "$body_file"
  exit 0
fi
if [[ "$#" -ge 3 && "$1" == "pr" && "$2" == "ready" ]]; then
  exit 0
fi
exit 1
`,
    "utf8",
  );
  execSync(`chmod +x ${JSON.stringify(ghPath)}`);
}

function initCommittedProject(opts?: { symlinkReadyIntents?: boolean }): {
  dir: string;
  cfgDir: string;
  projectRoot: string;
  remoteDir: string;
  externalDir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-delete-command-"));
  const cfgDir = join(dir, "cfg");
  const projectRoot = join(dir, "project");
  const remoteDir = join(dir, "remote.git");
  const externalDir = join(dir, "external");
  mkdirSync(projectRoot);
  mkdirSync(externalDir);
  registerProject("project", projectRoot, { dir: cfgDir });

  execSync("git init -b main", { cwd: projectRoot, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: projectRoot, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: projectRoot, stdio: "pipe" });
  writeFileSync(join(projectRoot, "README.md"), "seed\n");
  mkdirSync(join(projectRoot, "spec"), { recursive: true });
  writeFileSync(join(projectRoot, "spec", ".keep"), "");

  if (opts?.symlinkReadyIntents) {
    const externalReadyIntentsDir = join(externalDir, "ready-intents");
    mkdirSync(externalReadyIntentsDir, { recursive: true });
    const relativeTarget = relative(projectRoot, externalReadyIntentsDir);
    symlinkSync(relativeTarget, join(projectRoot, "ready-intents"));
  } else {
    mkdirSync(join(projectRoot, "ready-intents"), { recursive: true });
  }

  execSync("git add -A", { cwd: projectRoot, stdio: "pipe" });
  execSync("git commit -m initial", { cwd: projectRoot, stdio: "pipe" });
  execSync("git init --bare -b main remote.git", { cwd: dir, stdio: "pipe" });
  execSync(`git remote add origin ${JSON.stringify(remoteDir)}`, { cwd: projectRoot, stdio: "pipe" });
  execSync("git push -u origin main", { cwd: projectRoot, stdio: "pipe" });

  return {
    dir,
    cfgDir,
    projectRoot,
    remoteDir,
    externalDir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function configureCommitMode(cfgDir: string): void {
  const cfg = loadConfig({ dir: cfgDir });
  const projectCfg = cfg.projects.project;
  if (!projectCfg) {
    throw new Error("expected registered project");
  }
  projectCfg.plan = { commit: true };
  cfg.modes.plan.agentOrder = [{ agent: "claude", model: "haiku" }];
  cfg.modes.review.passes = 0;
  writeConfig(cfg, { dir: cfgDir });
}

function configureNoCommitMode(cfgDir: string): void {
  const cfg = loadConfig({ dir: cfgDir });
  const projectCfg = cfg.projects.project;
  if (!projectCfg) {
    throw new Error("expected registered project");
  }
  projectCfg.plan = { commit: false };
  cfg.modes.plan.agentOrder = [{ agent: "claude", model: "haiku" }];
  cfg.modes.review.passes = 0;
  writeConfig(cfg, { dir: cfgDir });
}

function readPlanBranchSubjects(projectRoot: string, branch: string): string[] {
  const output = execSync(`git log --format=%s main..${branch}`, { cwd: projectRoot, encoding: "utf8" });
  return output.trim() === "" ? [] : output.trim().split("\n");
}

function readPlanBranchChanges(projectRoot: string, branch: string): string {
  return execSync(`git diff --name-status main..${branch}`, { cwd: projectRoot, encoding: "utf8" });
}

function readSpecDirBasename(projectRoot: string, planName: string): string {
  const specRoot = join(projectRoot, ".worktree", `plan-${planName}`, "spec");
  const entries = readdirSync(specRoot).filter((entry) => entry !== ".keep");
  if (entries.length !== 1 || !entries[0]) {
    throw new Error(`expected one spec dir in ${specRoot}`);
  }
  return entries[0];
}

const logClient: LogClient = {
  assertReachable: async () => {},
  send: async () => {},
};

describe("plan ready-intent deletion command flow", () => {
  test("commit: true deletes only the consumed ready-intent in the plan: draft commit", async () => {
    const setup = initCommittedProject();
    const originalPath = process.env.PATH;
    try {
      configureCommitMode(setup.cfgDir);
      const readyIntentPath = join(setup.projectRoot, "ready-intents", "my-feature.md");
      writeFileSync(readyIntentPath, READY_INTENT);
      writeFileSync(join(setup.projectRoot, "ready-intents", "other-feature.md"), READY_INTENT);
      execSync("git add ready-intents", { cwd: setup.projectRoot, stdio: "pipe" });
      execSync("git commit -m 'add ready intents'", { cwd: setup.projectRoot, stdio: "pipe" });
      execSync("git push", { cwd: setup.projectRoot, stdio: "pipe" });

      const binDir = join(setup.dir, "bin");
      const stateDir = join(setup.dir, "gh-state");
      mkdirSync(binDir);
      mkdirSync(stateDir);
      writeGhStub(binDir, stateDir);
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: [readyIntentPath],
        cwd: setup.projectRoot,
        config: { dir: setup.cfgDir },
        logClient,
        createAgent: () => new DraftAgent(),
      });

      if (code !== 0) {
        throw new Error(cap.err() || cap.out());
      }
      expect(code).toBe(0);
      expect(readPlanBranchSubjects(setup.projectRoot, "plan/my-feature")).toEqual(["plan: draft"]);
      const changes = readPlanBranchChanges(setup.projectRoot, "plan/my-feature");
      expect(changes).toContain("ready-intents/my-feature.md");
      expect(changes).toContain("intent.md");
      expect(changes).not.toContain("D\tready-intents/other-feature.md");
      expect(cap.err()).not.toContain("plan: boundary violation detected before draft commit");
      expect(cap.err()).not.toContain("plan: blocker commit pushed");

      const specDirBasename = readSpecDirBasename(setup.projectRoot, "my-feature");
      const specIntentPath = join(
        setup.projectRoot,
        ".worktree",
        "plan-my-feature",
        "spec",
        specDirBasename,
        "intent.md",
      );
      expect(readFileSync(specIntentPath, "utf8")).toBe(READY_INTENT);
      expect(
        existsSync(join(setup.projectRoot, ".worktree", "plan-my-feature", "ready-intents", "my-feature.md")),
      ).toBe(false);
      expect(
        existsSync(join(setup.projectRoot, ".worktree", "plan-my-feature", "ready-intents", "other-feature.md")),
      ).toBe(true);
      expect(readFileSync(readyIntentPath, "utf8")).toBe(READY_INTENT);
    } finally {
      process.env.PATH = originalPath;
      setup.cleanup();
    }
  });

  test("commit: false consumes the source ready-intent after successful publication", async () => {
    const setup = initCommittedProject();
    try {
      configureNoCommitMode(setup.cfgDir);
      const readyIntentPath = join(setup.projectRoot, "ready-intents", "my-feature.md");
      writeFileSync(readyIntentPath, READY_INTENT);

      const cap = captureIo();
      const agent: Agent = {
        name: "claude",
        async run(_prompt: string, _opts: AgentRunOptions): Promise<AgentResult> {
          const match = cap.out().match(/^Intent: (.+)\/intent\.md$/m);
          if (!match?.[1]) {
            throw new Error("missing external intent path");
          }
          writeFileSync(join(match[1], "index.md"), "# Draft\n\n- [ ] [00](./00-one.md)\n");
          writeFileSync(join(match[1], "00-one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] done\n");
          return { kind: "ok", stdout: "", stderr: "" };
        },
        attributionLabel: () => "draft-agent",
      };

      const code = await planCommand({
        io: cap.io,
        args: [readyIntentPath],
        cwd: setup.projectRoot,
        config: { dir: setup.cfgDir },
        logClient,
        skipGhCheck: true,
        createAgent: () => agent,
      });

      expect(code).toBe(0);
      expect(existsSync(readyIntentPath)).toBe(false);
    } finally {
      setup.cleanup();
    }
  });

  test("authored-but-unmerged ready-intents are copied but not deleted", async () => {
    const setup = initCommittedProject();
    const originalPath = process.env.PATH;
    try {
      configureCommitMode(setup.cfgDir);
      const readyIntentPath = join(setup.projectRoot, "ready-intents", "my-feature.md");
      writeFileSync(readyIntentPath, READY_INTENT);

      const binDir = join(setup.dir, "bin");
      const stateDir = join(setup.dir, "gh-state");
      mkdirSync(binDir);
      mkdirSync(stateDir);
      writeGhStub(binDir, stateDir);
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: [readyIntentPath],
        cwd: setup.projectRoot,
        config: { dir: setup.cfgDir },
        logClient,
        createAgent: () => new DraftAgent(),
      });

      if (code !== 0) {
        throw new Error(cap.err() || cap.out());
      }
      expect(code).toBe(0);
      expect(readPlanBranchChanges(setup.projectRoot, "plan/my-feature")).not.toContain("ready-intents/my-feature.md");
      expect(readFileSync(readyIntentPath, "utf8")).toBe(READY_INTENT);
    } finally {
      process.env.PATH = originalPath;
      setup.cleanup();
    }
  });

  test("lexical escapes are copied but not deleted", async () => {
    const setup = initCommittedProject();
    const originalPath = process.env.PATH;
    try {
      configureCommitMode(setup.cfgDir);
      const externalReadyIntentsDir = join(setup.externalDir, "ready-intents");
      mkdirSync(externalReadyIntentsDir, { recursive: true });
      const readyIntentPath = join(externalReadyIntentsDir, "my-feature.md");
      writeFileSync(readyIntentPath, READY_INTENT);

      const binDir = join(setup.dir, "bin");
      const stateDir = join(setup.dir, "gh-state");
      mkdirSync(binDir);
      mkdirSync(stateDir);
      writeGhStub(binDir, stateDir);
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: ["--repo", "project", readyIntentPath],
        cwd: setup.projectRoot,
        config: { dir: setup.cfgDir },
        logClient,
        createAgent: () => new DraftAgent(),
      });

      if (code !== 0) {
        throw new Error(cap.err() || cap.out());
      }
      expect(code).toBe(0);
      expect(readPlanBranchChanges(setup.projectRoot, "plan/my-feature")).not.toContain("ready-intents/my-feature.md");
      expect(readFileSync(readyIntentPath, "utf8")).toBe(READY_INTENT);
    } finally {
      process.env.PATH = originalPath;
      setup.cleanup();
    }
  });

  test("symlink escapes are copied but not deleted", async () => {
    const setup = initCommittedProject({ symlinkReadyIntents: true });
    const originalPath = process.env.PATH;
    try {
      configureCommitMode(setup.cfgDir);
      const readyIntentPath = join(setup.projectRoot, "ready-intents", "my-feature.md");
      writeFileSync(join(setup.externalDir, "ready-intents", "my-feature.md"), READY_INTENT);
      expect(lstatSync(join(setup.projectRoot, "ready-intents")).isSymbolicLink()).toBe(true);

      const binDir = join(setup.dir, "bin");
      const stateDir = join(setup.dir, "gh-state");
      mkdirSync(binDir);
      mkdirSync(stateDir);
      writeGhStub(binDir, stateDir);
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      const cap = captureIo();
      const code = await planCommand({
        io: cap.io,
        args: [readyIntentPath],
        cwd: setup.projectRoot,
        config: { dir: setup.cfgDir },
        logClient,
        createAgent: () => new DraftAgent(),
      });

      if (code !== 0) {
        throw new Error(cap.err() || cap.out());
      }
      expect(code).toBe(0);
      expect(readPlanBranchChanges(setup.projectRoot, "plan/my-feature")).not.toContain("ready-intents/my-feature.md");
      expect(readFileSync(join(setup.externalDir, "ready-intents", "my-feature.md"), "utf8")).toBe(READY_INTENT);
    } finally {
      process.env.PATH = originalPath;
      setup.cleanup();
    }
  });
});
