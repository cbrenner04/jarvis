import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runAgent } from "../src/agents/spawn.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../src/agents/types.ts";
import { type AgentEntry, DEFAULT_CONFIG, loadConfig, registerProject, writeConfig } from "../src/config.ts";
import { __testClearDeltaStateDir, __testSetDeltaStateDir } from "../src/modes/patch/no-commit-delta.ts";
import { type RunCommandOptions, type RunIo, runCommand } from "../src/modes/patch/run.ts";
import { HARNESS_IDLE_TIMEOUT_FALLBACK, HARNESS_QUOTA_FALLBACK_STRICT } from "../src/quota-harness-messages.ts";
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
const CURSOR_ENTRY = { agent: "cursor" as const, model: "Composer 2.5" };

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

function createIdleHangAgent(name: AgentName, hangScript: string): FakeAgent {
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

function _repeatFailureText(failureText: string, count: number): string[] {
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

function setupGit(): void {
  execSync("git init -b jarvis-e2e", { cwd: projectRoot });
  execSync('git config user.email "jarvis-test@example.com"', {
    cwd: projectRoot,
  });
  execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
}

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

function _writeDirectSpec(contents: string): string {
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

function _setupLinkedSubspecRepo(opts: { trackedFile: boolean; criteria: string[] }): LinkedSubspecRepo {
  setupGit();
  const specDir = join(projectRoot, "spec", "myfeature");
  mkdirSync(specDir, { recursive: true });
  const spec = join(specDir, "index.md");
  const subspec = join(specDir, "00-one.md");
  writeFileSync(spec, withRepo(`# My Feature\n\n- [ ] [00 - One](./00-one.md)\n`));
  const subspecContent = `# 00 - One\n\n## Acceptance criteria\n\n${opts.criteria.map((c) => `- [ ] ${c}`).join("\n")}\n`;
  writeFileSync(subspec, subspecContent);
  execSync("git add -A && git commit -m init", { cwd: projectRoot });

  if (opts.trackedFile) {
    const trackedFilePath = join(projectRoot, "tracked-file.txt");
    writeFileSync(trackedFilePath, "tracked\n");
    execSync("git add tracked-file.txt && git commit -m 'add tracked file'", { cwd: projectRoot });
    return { spec, subspec, trackedFilePath };
  }

  return { spec, subspec };
}

interface ReviewEnv {
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
}

interface LinkedSubspecRepo {
  spec: string;
  subspec: string;
  trackedFilePath?: string;
}

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

describe("runCommand routing tests", () => {
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
    expect(cap.err()).toContain("spec `repo:`:");
    expect(cap.err()).toContain("no project matches");
  });

  test("no-progress escalates through agentOrder and exits 4 only after last rung", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(4);
    expect(cap.err()).toContain("no progress; escalating to next agent");
    expect(cap.err()).toContain("iteration 2 made no progress; stopping");
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    expect(cap.err()).not.toContain("iteration 1 made no progress; stopping");
  });

  test("selected standard tier no-progresses through only the remaining ladder suffix", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\ntier: standard\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("claude should be skipped");
    });
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const cursor = new FakeAgent("cursor", () => ({ kind: "ok", stdout: "", stderr: "" }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex, cursor },
      handleSignals: false,
    });

    expect(code).toBe(4);
    expect(claude.calls).toHaveLength(0);
    expect(codex.calls).toHaveLength(1);
    expect(cursor.calls).toHaveLength(1);
    expect(cap.err()).toContain("codex: no progress; escalating to next agent");
    expect(cap.err()).toContain("iteration 2 made no progress; stopping");
  });

  test("selected standard tier still preserves max-iterations exit 5", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.maxIterations = 1;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\ntier: standard\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("claude should be skipped");
    });
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const cursor = new FakeAgent("cursor", () => ({ kind: "ok", stdout: "", stderr: "" }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex, cursor },
      handleSignals: false,
    });

    expect(code).toBe(5);
    expect(claude.calls).toHaveLength(0);
    expect(codex.calls).toHaveLength(1);
    expect(cursor.calls).toHaveLength(0);
    expect(cap.err()).toContain("codex: no progress; escalating to next agent");
    expect(cap.err()).toContain("max iterations (1) reached; stopping");
  });

  test("tierless specs retain first-rung behavior and do not gain recorded tier metadata", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      writeFileSync(spec, "# Spec\n- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });
    const codex = new FakeAgent("codex", () => {
      throw new Error("codex should not run");
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(0);
    expect(readFileSync(spec, "utf8")).not.toContain("tier:");
  });

  test("recorded standard tier starts patch escalation at the second rung and reports the selected agent", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\ntier: standard\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("claude should be skipped by tier selection");
    });
    const codex = new FakeAgent("codex", () => {
      writeFileSync(spec, "# Spec\ntier: standard\n- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });
    const cursor = new FakeAgent("cursor", () => {
      throw new Error("cursor should not run");
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex, cursor },
      handleSignals: false,
    });

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(0);
    expect(codex.calls).toHaveLength(1);
    expect(cursor.calls).toHaveLength(0);
    expect(cap.out()).toContain("agent: codex");

    const telemetryRows = readFileSync(join(cfgDir, "runs.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(telemetryRows.some((row) => row.agent === "claude")).toBe(false);
    expect(telemetryRows.some((row) => row.agent === "codex")).toBe(true);
  });

  test("run --tier overrides recorded metadata for one patch run without rewriting the spec", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("# Spec\ntier: trivial\n- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("claude should be skipped by --tier hard");
    });
    const codex = new FakeAgent("codex", () => {
      throw new Error("codex should be skipped by --tier hard");
    });
    const cursor = new FakeAgent("cursor", () => {
      writeFileSync(spec, "# Spec\ntier: trivial\n- [x] todo\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex, cursor },
      handleSignals: false,
      tierOverride: "hard",
    });

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(0);
    expect(codex.calls).toHaveLength(0);
    expect(cursor.calls).toHaveLength(1);
    expect(readFileSync(spec, "utf8")).toContain("tier: trivial");
    expect(cap.out()).toContain("agent: cursor");
  });

  test.each([
    {
      name: "one-rung ladder maps every tier to the only entry",
      agentOrder: [CLAUDE_ENTRY],
      tier: "hard" as const,
      expectedAgent: "claude" as const,
    },
    {
      name: "two-rung ladder maps standard to the final entry",
      agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
      tier: "standard" as const,
      expectedAgent: "codex" as const,
    },
    {
      name: "two-rung ladder maps hard to the final entry",
      agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
      tier: "hard" as const,
      expectedAgent: "codex" as const,
    },
  ])("$name", async ({ agentOrder, tier, expectedAgent }) => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [...agentOrder];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec(`# Spec\ntier: ${tier}\n- [ ] todo\n`);
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      if (expectedAgent !== "claude") {
        throw new Error("claude should not run");
      }
      writeFileSync(spec, `# Spec\ntier: ${tier}\n- [x] todo\n`);
      return { kind: "ok", stdout: "", stderr: "" };
    });
    const codex = new FakeAgent("codex", () => {
      if (expectedAgent !== "codex") {
        throw new Error("codex should not run");
      }
      writeFileSync(spec, `# Spec\ntier: ${tier}\n- [x] todo\n`);
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
    expect(cap.out()).toContain(`agent: ${expectedAgent}`);
  });

  test.each([
    {
      name: "unknown value",
      spec: "# Spec\ntier: expert\n- [ ] todo\n",
      expected: "expected one of trivial, standard, hard",
    },
    {
      name: "blank value",
      spec: "# Spec\ntier: \n- [ ] todo\n",
      expected: "expected one of trivial, standard, hard",
    },
    {
      name: "duplicate lines",
      spec: "# Spec\ntier: trivial\ntier: hard\n- [ ] todo\n",
      expected: "duplicate `tier:` line",
    },
    {
      name: "later line",
      spec: "# Spec\n- [ ] todo\ntier: hard\n",
      expected: "`tier:` must appear before the first checklist item",
    },
  ])("invalid recorded tier metadata: $name", async ({ spec: specBody, expected }) => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.git = false;
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec(specBody);
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => {
      throw new Error("agent should not run for invalid metadata");
    });

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude },
      handleSignals: false,
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain(expected);
    expect(claude.calls).toHaveLength(0);
  });

  describe("patch --agent override", () => {
    test("uses override ladder for implementation without mutating config", async () => {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
      writeConfig(cfg, { dir: cfgDir });
      const configBefore = readFileSync(join(cfgDir, "config.json"), "utf8");

      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("claude should be skipped by override");
      });
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
        agentOrderOverride: [CODEX_ENTRY],
      });

      expect(code).toBe(0);
      expect(claude.calls).toHaveLength(0);
      expect(codex.calls).toHaveLength(1);
      expect(cap.out()).toContain("agent: codex");
      expect(readFileSync(join(cfgDir, "config.json"), "utf8")).toBe(configBefore);
    });

    test("--tier slices the overridden ladder", async () => {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
      writeConfig(cfg, { dir: cfgDir });

      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("claude should be skipped");
      });
      const codex = new FakeAgent("codex", () => {
        writeFileSync(spec, "- [x] todo\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const cursor = new FakeAgent("cursor", () => {
        throw new Error("cursor should be skipped");
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex, cursor },
        handleSignals: false,
        agentOrderOverride: [CLAUDE_ENTRY, CODEX_ENTRY],
        tierOverride: "hard",
      });

      expect(code).toBe(0);
      expect(claude.calls).toHaveLength(0);
      expect(codex.calls).toHaveLength(1);
      expect(cursor.calls).toHaveLength(0);
      expect(cap.out()).toContain("agent: codex");
    });

    test("no-progress escalation operates on the overridden ladder", async () => {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
      writeConfig(cfg, { dir: cfgDir });

      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("claude should be skipped by override");
      });
      const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
      const cursor = new FakeAgent("cursor", () => ({ kind: "ok", stdout: "", stderr: "" }));

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex, cursor },
        handleSignals: false,
        agentOrderOverride: [CODEX_ENTRY, CURSOR_ENTRY],
      });

      expect(code).toBe(4);
      expect(claude.calls).toHaveLength(0);
      expect(codex.calls).toHaveLength(1);
      expect(cursor.calls).toHaveLength(1);
      expect(cap.err()).toContain("codex: no progress; escalating to next agent");
    });

    test("review panel and actuator ignore the implementation override", async () => {
      const env = setupReviewEnv({
        reviewPasses: 1,
        patchAgentOrder: [CODEX_ENTRY, CLAUDE_ENTRY],
        reviewAgentOrder: [CLAUDE_ENTRY],
      });
      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.patch.subRoleAgentOrder = { reviewActuator: [CLAUDE_ENTRY] };
      writeConfig(cfg, { dir: cfgDir });

      const cap = captureIo();
      let codexReviewCalls = 0;
      const codex = new FakeAgent("codex", (_callCount, prompt) => {
        if (isPatchReviewPrompt(prompt) || isPatchReviewActuatorPrompt(prompt)) {
          codexReviewCalls += 1;
          throw new Error("review must not use override implementation agent");
        }
        if (prompt.includes("PR description")) {
          return { kind: "ok", stdout: "Implements the feature.\n", stderr: "" };
        }
        writeFileSync(join(env.worktree, "impl.txt"), "impl\n");
        writeFileSync(
          join(env.worktree, "spec", "feature", "00-one.md"),
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });
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
        agents: { claude, codex },
        agentOrderOverride: [CODEX_ENTRY],
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(codex.calls).toHaveLength(2);
      expect(codexReviewCalls).toBe(0);
      expect(claude.calls.filter((c) => isPatchReviewPrompt(c.prompt))).toHaveLength(3);
      expect(claude.calls.filter((c) => isPatchReviewActuatorPrompt(c.prompt))).toHaveLength(1);
    });

    test("shrink ignores the implementation override ladder", async () => {
      const env = setupReviewEnv({
        reviewPasses: 0,
        patchAgentOrder: [CODEX_ENTRY, CLAUDE_ENTRY],
      });
      const cfg = loadConfig({ dir: cfgDir });
      cfg.modes.patch.subRoleAgentOrder = { reviewActuator: [CLAUDE_ENTRY] };
      writeConfig(cfg, { dir: cfgDir });

      const cap = captureIo();
      const codex = new FakeAgent("codex", (callCount, _prompt, opts) => {
        if (callCount > 2) {
          throw new Error("codex must not run shrink when reviewActuator is claude");
        }
        if (callCount === 2) {
          return { kind: "ok", stdout: "Implements the feature.\n", stderr: "" };
        }
        writeFileSync(join(opts.cwd, "impl.txt"), "impl\n");
        writeFileSync(
          join(opts.cwd, "spec", "feature", "00-one.md"),
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const claude = new FakeAgent("claude", (callCount, prompt) => {
        if (callCount !== 1) {
          throw new Error("claude should only run shrink");
        }
        if (!prompt.includes("Simplification checklist")) {
          throw new Error("expected shrink prompt");
        }
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex },
        agentOrderOverride: [CODEX_ENTRY],
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(codex.calls).toHaveLength(2);
      expect(claude.calls).toHaveLength(1);
    });

    test("review and shrink use pre-override patch order without subRoleAgentOrder", async () => {
      const env = setupReviewEnv({
        reviewPasses: 1,
        patchAgentOrder: [CLAUDE_ENTRY, CODEX_ENTRY],
        reviewAgentOrder: [CLAUDE_ENTRY],
      });

      const cap = captureIo();
      let codexReviewCalls = 0;
      const codex = new FakeAgent("codex", (_callCount, prompt) => {
        if (isPatchReviewPrompt(prompt) || isPatchReviewActuatorPrompt(prompt)) {
          codexReviewCalls += 1;
          throw new Error("review must not use override implementation agent");
        }
        if (prompt.includes("Simplification checklist")) {
          throw new Error("codex must not run shrink");
        }
        if (prompt.includes("PR description")) {
          return { kind: "ok", stdout: "Implements the feature.\n", stderr: "" };
        }
        writeFileSync(join(env.worktree, "impl.txt"), "impl\n");
        writeFileSync(
          join(env.worktree, "spec", "feature", "00-one.md"),
          "# 00 - One\n\n## Acceptance criteria\n\n- [x] One accepted.\n",
        );
        return { kind: "ok", stdout: "", stderr: "" };
      });
      const claude = new FakeAgent("claude", (_callCount, prompt, opts) => {
        if (isPatchReviewPrompt(prompt)) {
          return {
            kind: "ok",
            stdout: prompt.includes("Review: Adjudicator") ? "Refine code output.\n" : "",
            stderr: "",
          };
        }
        if (isPatchReviewActuatorPrompt(prompt)) {
          writeFileSync(join(opts.cwd, "code.txt"), "refined\n");
          return { kind: "ok", stdout: "", stderr: "" };
        }
        if (prompt.includes("Simplification checklist")) {
          return { kind: "ok", stdout: "", stderr: "" };
        }
        throw new Error("claude must not run implementation under override");
      });

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex },
        agentOrderOverride: [CODEX_ENTRY],
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(codexReviewCalls).toBe(0);
      expect(claude.calls.filter((c) => isPatchReviewPrompt(c.prompt))).toHaveLength(3);
      expect(claude.calls.filter((c) => isPatchReviewActuatorPrompt(c.prompt))).toHaveLength(1);
      expect(claude.calls.filter((c) => c.prompt.includes("Simplification checklist"))).toHaveLength(1);
      expect(codex.calls.filter((c) => c.prompt.includes("PR description"))).toHaveLength(1);
    });

    test("quota escalation operates on the overridden ladder", async () => {
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
      writeConfig(cfg, { dir: cfgDir });

      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("claude should be skipped by override");
      });
      const codex = new FakeAgent("codex", () => ({ kind: "quota", stderr: "limit" }));
      const cursor = new FakeAgent("cursor", () => {
        writeFileSync(spec, "- [x] todo\n");
        return { kind: "ok", stdout: "", stderr: "" };
      });

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex, cursor },
        handleSignals: false,
        agentOrderOverride: [CODEX_ENTRY, CURSOR_ENTRY],
      });

      expect(code).toBe(0);
      expect(claude.calls).toHaveLength(0);
      expect(codex.calls).toHaveLength(1);
      expect(cursor.calls).toHaveLength(1);
      expect(cap.err()).toContain(`codex: ${HARNESS_QUOTA_FALLBACK_STRICT}`);
    });

    test("idle-timeout escalation operates on the overridden ladder", async () => {
      const idleTimeoutMs = 1000;
      const hangScript = writeIdleHangScript(join(dir, "override-idle-hang.sh"));
      const cfg = loadConfig({ dir: cfgDir });
      cfg.git = false;
      cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
      cfg.idleOutputTimeoutMs = idleTimeoutMs;
      cfg.maxIterations = 3;
      writeConfig(cfg, { dir: cfgDir });

      const spec = writeSpec("- [ ] todo\n");
      const cap = captureIo();
      const claude = new FakeAgent("claude", () => {
        throw new Error("claude should be skipped by override");
      });
      const codex = createIdleHangAgent("codex", hangScript);
      const cursor = new FakeAgent("cursor", () => ({ kind: "ok", stdout: "", stderr: "" }));

      const code = await runWithDefaults({
        specPath: spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex, cursor },
        handleSignals: false,
        agentOrderOverride: [CODEX_ENTRY, CURSOR_ENTRY],
        __testKillGraceMs: 200,
      });

      expect(code).toBe(4);
      expect(claude.calls).toHaveLength(0);
      expect(codex.calls).toHaveLength(1);
      expect(cursor.calls).toHaveLength(1);
      expect(cap.err()).toContain(`codex: ${HARNESS_IDLE_TIMEOUT_FALLBACK}`);
    });

    test("--resume-review with override invokes no implementation agents", async () => {
      const env = setupReviewEnv({ reviewPasses: 1 });
      writeFileSync(env.spec, `repo: ${projectRoot}\n\n# Feature\n\n- [x] [00 - One](./00-one.md)\n`);
      execSync("git add -A && git commit -m complete && git push origin main", { cwd: projectRoot });
      execSync("git checkout -b feature && git push -u origin feature", { cwd: projectRoot });
      execSync("git checkout main", { cwd: projectRoot });
      writeFileSync(join(dirname(env.prReadyLog), "pr-state"), "");

      const cap = captureIo();
      let implementationAgentCalled = false;
      const codex = new FakeAgent("codex", () => {
        implementationAgentCalled = true;
        throw new Error("implementation agent must not run under resume-review");
      });
      const claude = reviewFakeAgent(
        "claude",
        (_n, _cwd, prompt) => ({
          kind: "ok",
          stdout: prompt.includes("Review: Adjudicator") ? "Good." : "",
          stderr: "",
        }),
        (_n, cwd) => {
          writeFileSync(join(cwd, "code.txt"), "x\n");
          return { kind: "ok", stdout: "", stderr: "" };
        },
      );

      const code = await runCommand({
        specPath: env.spec,
        io: cap.io,
        config: { dir: cfgDir },
        agents: { claude, codex },
        agentOrderOverride: [CODEX_ENTRY],
        resumeReview: true,
        logClient: { assertReachable: async () => {}, send: async () => {} },
        handleSignals: false,
      });

      expect(code).toBe(0);
      expect(implementationAgentCalled).toBe(false);
    });
  });

  test("no-progress escalation re-selects the same active subspec after advancing", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    setupGit();
    const specDir = join(projectRoot, "spec", "feature");
    mkdirSync(specDir, { recursive: true });
    const spec = join(specDir, "index.md");
    const firstSubspec = join(specDir, "00-one.md");
    const secondSubspec = join(specDir, "01-two.md");
    writeFileSync(spec, withRepo("- [ ] [00 - One](./00-one.md)\n- [ ] [01 - Two](./01-two.md)\n"));
    writeFileSync(firstSubspec, "# 00 - One\n\n## Acceptance criteria\n\n- [ ] One done.\n");
    writeFileSync(secondSubspec, "# 01 - Two\n\n## Acceptance criteria\n\n- [ ] Two done.\n");
    execSync("git add -A && git commit -m init", { cwd: projectRoot });

    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir },
      agents: { claude, codex },
      handleSignals: false,
    });

    expect(code).toBe(4);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    expect(claude.calls[0]?.prompt).toContain(firstSubspec);
    expect(codex.calls[0]?.prompt).toContain(firstSubspec);
    expect(claude.calls[0]?.prompt).not.toContain(secondSubspec);
    expect(codex.calls[0]?.prompt).not.toContain(secondSubspec);
  });

  test("maxIterations pre-empts no-progress ladder exhaustion before the final rung runs", async () => {
    const cfg = loadConfig({ dir: cfgDir });
    cfg.modes.patch.agentOrder = [CLAUDE_ENTRY, CODEX_ENTRY, CURSOR_ENTRY];
    writeConfig(cfg, { dir: cfgDir });

    const spec = writeSpec("- [ ] todo\n");
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));
    const cursor = new FakeAgent("cursor", () => ({ kind: "ok", stdout: "", stderr: "" }));

    const code = await runWithDefaults({
      specPath: spec,
      io: cap.io,
      config: { dir: cfgDir, maxIterations: 2 },
      agents: { claude, codex, cursor },
      handleSignals: false,
    });

    expect(code).toBe(5);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    expect(cursor.calls).toHaveLength(0);
    expect(cap.err()).toContain("max iterations (2) reached");
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
    expect(cap.out()).toContain("spec complete");
    expect(claude.calls).toHaveLength(2);
  });
});
