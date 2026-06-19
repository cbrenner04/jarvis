import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../../src/agents/types.ts";
import type { Io } from "../../../src/cli.ts";
import { registerProject, writeConfig } from "../../../src/config.ts";
import { promptCommand } from "../../../src/modes/prompt/run.ts";
import {
  HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED,
  HARNESS_QUOTA_FALLBACK_STRICT,
} from "../../../src/quota-harness-messages.ts";

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

function captureIo(): { io: Io; out: () => string; err: () => string } {
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

const CLAUDE_ENTRY = { agent: "claude" as const, model: "haiku" };
const CODEX_ENTRY = { agent: "codex" as const, model: "gpt-5.3-codex" };

type PromptEnv = {
  prLog: string;
  prTitle: string;
  pushLog: string;
};

let dir: string;
let projectRoot: string;
let cfgDir: string;
let originalPath: string | undefined;

function setupPromptEnv(): PromptEnv {
  const origin = join(dir, "origin.git");
  execSync(`git init --bare ${origin}`);
  execSync("git init -b main", { cwd: projectRoot });
  execSync('git config user.email "jarvis-test@example.com"', { cwd: projectRoot });
  execSync('git config user.name "jarvis-test"', { cwd: projectRoot });
  execSync(`git remote add origin ${origin}`, { cwd: projectRoot });
  writeFileSync(join(projectRoot, "README.md"), "seed\n");
  execSync("git add README.md && git commit -m init && git push -u origin main", { cwd: projectRoot });

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

  const binDir = join(dir, "bin");
  mkdirSync(binDir);
  const realGit = execSync("command -v git", { encoding: "utf8" }).trim();
  const git = join(binDir, "git");
  const gh = join(binDir, "gh");
  const pushLog = join(dir, "push-log");
  const prLog = join(dir, "pr-log");
  const prTitle = join(dir, "pr-title");

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
if [[ "$1 $2" == "auth status" ]]; then exit 0; fi
if [[ "$1 $2" == "repo view" ]]; then printf 'main\\n'; exit 0; fi
if [[ "$1 $2" == "pr create" ]]; then
  printf 'create\\n' >> "${prLog}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --title)
        shift
        printf '%s' "$1" > "${prTitle}"
        ;;
    esac
    shift
  done
  exit 0
fi
exit 1
`,
  );
  chmodSync(gh, 0o755);
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;

  return { prLog, prTitle, pushLog };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-prompt-"));
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

async function runPrompt(
  agents: Partial<Record<AgentName, Agent>>,
  cap: ReturnType<typeof captureIo>,
  promptText = "do the thing",
  testReapFn?: () => void,
): Promise<number> {
  return promptCommand({
    promptText,
    io: cap.io,
    projectPath: projectRoot,
    config: { dir: cfgDir },
    skipGhCheck: true,
    agents,
    ...(testReapFn !== undefined ? { __testReapFn: testReapFn } : {}),
  });
}

describe("promptCommand", () => {
  test("falls through claude to codex on quota and prints codex stdout on no-diff success", async () => {
    setupPromptEnv();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "quota", stderr: "limit" }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "codex answer\n", stderr: "" }));

    const code = await runPrompt({ claude, codex }, cap);

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    expect(cap.out()).toBe("codex answer\n");
    expect(cap.err()).toContain(`claude: ${HARNESS_QUOTA_FALLBACK_STRICT}`);
    expect(cap.err()).toContain("limit");
    expect(cap.err()).not.toContain(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
  });

  test("exits 2 when all agents return quota", async () => {
    setupPromptEnv();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "quota", stderr: "limit" }));
    const codex = new FakeAgent("codex", () => ({ kind: "quota", stderr: "limit" }));

    const code = await runPrompt({ claude, codex }, cap);

    expect(code).toBe(2);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    const exhaustedAt = cap.err().lastIndexOf(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
    const codexInvokeAt = cap.err().lastIndexOf("jarvis1: invoking codex");
    expect(exhaustedAt).toBeGreaterThan(codexInvokeAt);
  });

  test("exits 3 when model_config fallthrough ends without success", async () => {
    setupPromptEnv();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "model_config", stderr: "bad model" }));
    const codex = new FakeAgent("codex", () => ({ kind: "quota", stderr: "limit" }));

    const code = await runPrompt({ claude, codex }, cap);

    expect(code).toBe(3);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    expect(cap.err()).not.toContain(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
  });

  test("halts on generic error without invoking the second agent", async () => {
    setupPromptEnv();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "error", exitCode: 1, stderr: "hard failure" }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "", stderr: "" }));

    const code = await runPrompt({ claude, codex }, cap);

    expect(code).toBe(3);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(0);
  });

  test("successful first agent prints stdout on no-diff", async () => {
    setupPromptEnv();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "read-only answer\n", stderr: "" }));

    const code = await runPrompt({ claude }, cap);

    expect(code).toBe(0);
    expect(cap.out()).toBe("read-only answer\n");
    expect(claude.calls).toHaveLength(1);
  });

  test("successful first agent commits, pushes, and opens a PR on diff", async () => {
    const env = setupPromptEnv();
    const cap = captureIo();
    const claude = new FakeAgent("claude", (_c, _p, opts) => {
      writeFileSync(join(opts.cwd, "change.txt"), "done\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runPrompt({ claude }, cap, "add a file");

    if (code !== 0) {
      throw new Error(`exit ${code}: ${cap.err()}`);
    }
    expect(code).toBe(0);
    expect(readFileSync(env.prLog, "utf8")).toContain("create");
    expect(readFileSync(env.pushLog, "utf8")).toContain("push");
    expect(readFileSync(env.prTitle, "utf8")).toBe("add a file");
  });

  test("successful fallback agent drives the diff flow identically", async () => {
    const env = setupPromptEnv();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "quota", stderr: "limit" }));
    const codex = new FakeAgent("codex", (_c, _p, opts) => {
      writeFileSync(join(opts.cwd, "change.txt"), "done\n");
      return { kind: "ok", stdout: "", stderr: "" };
    });

    const code = await runPrompt({ claude, codex }, cap, "add a file");

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    expect(readFileSync(env.prLog, "utf8")).toContain("create");
    expect(readFileSync(env.pushLog, "utf8")).toContain("push");
    expect(readFileSync(env.prTitle, "utf8")).toBe("add a file");
  });

  test("reap is invoked on successful agent attempt", async () => {
    setupPromptEnv();
    const cap = captureIo();
    let reapCallCount = 0;
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "answer\n", stderr: "" }));

    const code = await runPrompt({ claude }, cap, "do the thing", () => {
      reapCallCount += 1;
    });

    expect(code).toBe(0);
    expect(reapCallCount).toBeGreaterThanOrEqual(1); // At least once (per-attempt and/or final finally)
  });

  test("reap is invoked on quota fallback attempt", async () => {
    setupPromptEnv();
    const cap = captureIo();
    let reapCallCount = 0;
    const claude = new FakeAgent("claude", () => ({ kind: "quota", stderr: "limit" }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "answer\n", stderr: "" }));

    const code = await runPrompt({ claude, codex }, cap, "do the thing", () => {
      reapCallCount += 1;
    });

    expect(code).toBe(0);
    expect(reapCallCount).toBe(3); // Once for claude quota attempt, once for codex success attempt, once in final finally
  });

  test("reap is invoked on model_config fallback attempt", async () => {
    setupPromptEnv();
    const cap = captureIo();
    let reapCallCount = 0;
    const claude = new FakeAgent("claude", () => ({ kind: "model_config", stderr: "bad model" }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "answer\n", stderr: "" }));

    const code = await runPrompt({ claude, codex }, cap, "do the thing", () => {
      reapCallCount += 1;
    });

    expect(code).toBe(0);
    expect(reapCallCount).toBe(3); // Once for claude model_config attempt, once for codex success attempt, once in final finally
  });

  test("reap is invoked on generic error attempt", async () => {
    setupPromptEnv();
    const cap = captureIo();
    let reapCalled = false;
    const claude = new FakeAgent("claude", () => ({ kind: "error", exitCode: 1, stderr: "hard failure" }));

    const code = await runPrompt({ claude }, cap, "do the thing", () => {
      reapCalled = true;
    });

    expect(code).toBe(3);
    expect(reapCalled).toBe(true);
  });

  test("reap failure does not change exit code", async () => {
    setupPromptEnv();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "answer\n", stderr: "" }));

    const code = await runPrompt({ claude }, cap, "do the thing", () => {
      throw new Error("reap failure");
    });

    expect(code).toBe(0);
  });

  test("reap failure on quota does not change exit code", async () => {
    setupPromptEnv();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "quota", stderr: "limit" }));
    const codex = new FakeAgent("codex", () => ({ kind: "quota", stderr: "limit" }));

    const code = await runPrompt({ claude, codex }, cap, "do the thing", () => {
      throw new Error("reap failure");
    });

    expect(code).toBe(2);
  });
});
