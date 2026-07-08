import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../../src/agents/types.ts";
import type { Io } from "../../../src/cli.ts";
import { DEFAULT_CONFIG, registerProject, writeConfig } from "../../../src/config.ts";
import type { DescendantTracker } from "../../../src/modes/patch/reap.ts";
import { promptCommand } from "../../../src/modes/prompt/run.ts";
import {
  HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessAuthRotateLine,
} from "../../../src/quota-harness-messages.ts";
import { FAKE_AGENT_SPAWN_PID, waitForPollCount } from "../../descendant-poll-test-helpers.ts";

class FakeAgent implements Agent {
  readonly name: AgentName;
  readonly calls: { prompt: string; cwd: string }[] = [];
  readonly #run: (callCount: number, prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>;
  readonly #invokeOnSpawned: boolean;

  constructor(
    name: AgentName,
    run: (callCount: number, prompt: string, opts: AgentRunOptions) => AgentResult | Promise<AgentResult>,
    invokeOnSpawned = false,
  ) {
    this.name = name;
    this.#run = run;
    this.#invokeOnSpawned = invokeOnSpawned;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    this.calls.push({ prompt, cwd: opts.cwd });
    if (this.#invokeOnSpawned) {
      opts.onSpawned?.({ pid: FAKE_AGENT_SPAWN_PID });
    }
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
      iterationTimeoutMs: DEFAULT_CONFIG.iterationTimeoutMs,
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
  printf 'https://github.com/test/repo/pull/123\\n'
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

type PromptTestHooks = {
  testReapFn?: (tracker: DescendantTracker) => void;
  testAfterPollFn?: () => void;
  testDescendantPollIntervalMs?: number;
};

async function runPrompt(
  agents: Partial<Record<AgentName, Agent>>,
  cap: ReturnType<typeof captureIo>,
  promptText = "do the thing",
  testHooks?: PromptTestHooks,
  pinnedAgent?: { agent: AgentName; model: string },
): Promise<number> {
  return promptCommand({
    promptText,
    io: cap.io,
    projectPath: projectRoot,
    config: { dir: cfgDir },
    skipGhCheck: true,
    agents,
    ...(pinnedAgent !== undefined ? { pinnedAgent } : {}),
    ...(testHooks?.testReapFn !== undefined ? { __testReapFn: testHooks.testReapFn } : {}),
    ...(testHooks?.testAfterPollFn !== undefined ? { __testAfterPollFn: testHooks.testAfterPollFn } : {}),
    ...(testHooks?.testDescendantPollIntervalMs !== undefined
      ? { __testDescendantPollIntervalMs: testHooks.testDescendantPollIntervalMs }
      : {}),
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
    const out = cap.out();
    expect(out).toContain("codex answer");
    expect(out).toContain("─── prompt summary ───");
    expect(out).toContain("No changes were made.");
    expect(cap.err()).toContain(`claude: ${HARNESS_QUOTA_FALLBACK_STRICT}`);
    expect(cap.err()).toContain("limit");
    expect(cap.err()).not.toContain(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
  });

  test("falls through claude to codex on auth failure; emits auth-rotation note", async () => {
    setupPromptEnv();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({
      kind: "quota",
      stderr: "refresh token revoked",
      authFailure: true,
    }));
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "codex answer\n", stderr: "" }));

    const code = await runPrompt({ claude, codex }, cap);

    expect(code).toBe(0);
    expect(claude.calls).toHaveLength(1);
    expect(codex.calls).toHaveLength(1);
    const out = cap.out();
    expect(out).toContain("codex answer");
    expect(cap.err()).toContain(`claude: ${harnessAuthRotateLine("claude")}`);
    expect(cap.err()).not.toContain(HARNESS_QUOTA_FALLBACK_STRICT);
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
    const out = cap.out();
    expect(out).toContain("read-only answer");
    expect(out).toContain("─── prompt summary ───");
    expect(out).toContain("No changes were made.");
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
    const out = cap.out();
    expect(out).toContain("─── prompt summary ───");
    expect(out).toContain("PR created: https://github.com/test/repo/pull/123");
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
    const out = cap.out();
    expect(out).toContain("─── prompt summary ───");
    expect(out).toContain("PR created: https://github.com/test/repo/pull/123");
  });

  test("polls on spawn and interval then reaps once per successful attempt", async () => {
    setupPromptEnv();
    const cap = captureIo();
    let pollCount = 0;
    let reapCount = 0;
    const pollIntervalMs = 1;
    const claude = new FakeAgent(
      "claude",
      async () => {
        await waitForPollCount(() => pollCount, 2);
        return { kind: "ok", stdout: "answer\n", stderr: "" };
      },
      true,
    );

    const code = await runPrompt({ claude }, cap, "do the thing", {
      testAfterPollFn: () => {
        pollCount += 1;
      },
      testDescendantPollIntervalMs: pollIntervalMs,
      testReapFn: () => {
        reapCount += 1;
      },
    });

    expect(code).toBe(0);
    expect(pollCount).toBeGreaterThanOrEqual(2);
    expect(reapCount).toBe(1);
  });

  test("reap is invoked on successful agent attempt", async () => {
    setupPromptEnv();
    const cap = captureIo();
    let reapCallCount = 0;
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "answer\n", stderr: "" }), true);

    const code = await runPrompt({ claude }, cap, "do the thing", {
      testReapFn: () => {
        reapCallCount += 1;
      },
    });

    expect(code).toBe(0);
    expect(reapCallCount).toBe(1);
  });

  test("reap is invoked on quota fallback attempt", async () => {
    setupPromptEnv();
    const cap = captureIo();
    let reapCallCount = 0;
    const claude = new FakeAgent("claude", () => ({ kind: "quota", stderr: "limit" }), true);
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "answer\n", stderr: "" }), true);

    const code = await runPrompt({ claude, codex }, cap, "do the thing", {
      testReapFn: () => {
        reapCallCount += 1;
      },
    });

    expect(code).toBe(0);
    expect(reapCallCount).toBe(2);
  });

  test("reap is invoked on model_config fallback attempt", async () => {
    setupPromptEnv();
    const cap = captureIo();
    let reapCallCount = 0;
    const claude = new FakeAgent("claude", () => ({ kind: "model_config", stderr: "bad model" }), true);
    const codex = new FakeAgent("codex", () => ({ kind: "ok", stdout: "answer\n", stderr: "" }), true);

    const code = await runPrompt({ claude, codex }, cap, "do the thing", {
      testReapFn: () => {
        reapCallCount += 1;
      },
    });

    expect(code).toBe(0);
    expect(reapCallCount).toBe(2);
  });

  test("reap is invoked on generic error attempt", async () => {
    setupPromptEnv();
    const cap = captureIo();
    let reapCallCount = 0;
    const claude = new FakeAgent("claude", () => ({ kind: "error", exitCode: 1, stderr: "hard failure" }), true);

    const code = await runPrompt({ claude }, cap, "do the thing", {
      testReapFn: () => {
        reapCallCount += 1;
      },
    });

    expect(code).toBe(3);
    expect(reapCallCount).toBe(1);
  });

  test("watchdog timeout reaps in per-attempt finally and exits 8", async () => {
    setupPromptEnv();
    writeConfig(
      {
        version: 2,
        modes: {
          patch: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          plan: { agentOrder: [CLAUDE_ENTRY, CODEX_ENTRY] },
          prompt: { agentOrder: [CLAUDE_ENTRY] },
          review: { passes: 2 },
        },
        quotaFallback: "strict",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: 1,
        git: true,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );
    const cap = captureIo();
    let reapCallCount = 0;
    const claude = new FakeAgent(
      "claude",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { kind: "ok", stdout: "answer\n", stderr: "" };
      },
      true,
    );

    const code = await runPrompt({ claude }, cap, "do the thing", {
      testReapFn: () => {
        reapCallCount += 1;
      },
    });

    expect(code).toBe(8);
    expect(reapCallCount).toBe(1);
    expect(cap.err()).toContain("[watchdog] iteration timeout fired after 1ms");
  });

  test("reap failure does not change exit code", async () => {
    setupPromptEnv();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "answer\n", stderr: "" }), true);

    const code = await runPrompt({ claude }, cap, "do the thing", {
      testReapFn: () => {
        throw new Error("reap failure");
      },
    });

    expect(code).toBe(0);
  });

  test("reap failure on quota does not change exit code", async () => {
    setupPromptEnv();
    const cap = captureIo();
    const claude = new FakeAgent("claude", () => ({ kind: "quota", stderr: "limit" }), true);
    const codex = new FakeAgent("codex", () => ({ kind: "quota", stderr: "limit" }), true);

    const code = await runPrompt({ claude, codex }, cap, "do the thing", {
      testReapFn: () => {
        throw new Error("reap failure");
      },
    });

    expect(code).toBe(2);
  });

  test("pinned agent runs first when absent from config order", async () => {
    setupPromptEnv();
    const cap = captureIo();
    const opencode = new FakeAgent("opencode", () => ({ kind: "ok", stdout: "opencode answer\n", stderr: "" }));
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "claude answer\n", stderr: "" }));

    const code = await runPrompt({ opencode, claude }, cap, "probe", undefined, {
      agent: "opencode",
      model: "opencode/glm-5.2",
    });

    expect(code).toBe(0);
    expect(opencode.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(0);
    expect(cap.out()).toContain("opencode answer");
  });

  test("pinned agent dedupes matching config entry and keeps suffix order", async () => {
    setupPromptEnv();
    const cap = captureIo();
    const codex = new FakeAgent("codex", () => ({ kind: "quota", stderr: "limit" }));
    const claude = new FakeAgent("claude", () => ({ kind: "ok", stdout: "claude answer\n", stderr: "" }));

    const code = await runPrompt({ codex, claude }, cap, "probe", undefined, {
      agent: "codex",
      model: "gpt-5.4-mini",
    });

    expect(code).toBe(0);
    expect(codex.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(1);
    expect(cap.err().indexOf("jarvis1: invoking codex")).toBeLessThan(cap.err().indexOf("jarvis1: invoking claude"));
  });

  test("pinned override model is recorded in telemetry configured_model", async () => {
    setupPromptEnv();
    const telemetryPath = join(cfgDir, "runs.jsonl");
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
        telemetryPath,
        git: true,
        projects: { project: { root: projectRoot } },
      },
      { dir: cfgDir },
    );
    const cap = captureIo();
    const opencode = new FakeAgent("opencode", () => ({ kind: "ok", stdout: "answer\n", stderr: "" }));

    const code = await runPrompt({ opencode }, cap, "probe", undefined, {
      agent: "opencode",
      model: "opencode/glm-5.2",
    });

    expect(code).toBe(0);
    const rows = readFileSync(telemetryPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { configured_model?: string; agent?: string });
    expect(rows.at(-1)?.agent).toBe("opencode");
    expect(rows.at(-1)?.configured_model).toBe("opencode/glm-5.2");
  });
});
