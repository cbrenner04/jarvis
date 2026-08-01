import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Io, parseArgs, run } from "../src/cli.ts";
import { buildEffectivePromptAgentEntries, parsePromptAgentOverride } from "../src/parse-agent-flag.ts";

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

let cfgDir: string;
beforeEach(() => {
  cfgDir = mkdtempSync(join(tmpdir(), "jarvis-cli-"));
});
afterEach(() => {
  rmSync(cfgDir, { recursive: true, force: true });
});

describe("parseArgs", () => {
  test("no args → help", () => {
    expect(parseArgs([])).toEqual({ kind: "help" });
  });

  test.each(["help", "-h", "--help"])("%s flag → help", (flag) => {
    expect(parseArgs([flag])).toEqual({ kind: "help" });
  });

  test("run with spec path", () => {
    expect(parseArgs(["run", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
    });
  });

  test("run with max iterations", () => {
    expect(parseArgs(["run", "--max-iterations", "3", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
      maxIterations: "3",
    });
  });

  test("run with --repo flag", () => {
    expect(parseArgs(["run", "--repo", "project-a", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
      repo: "project-a",
    });
  });

  test("run with --repo and --max-iterations", () => {
    expect(parseArgs(["run", "--repo", "owner/repo", "--max-iterations", "2", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
      maxIterations: "2",
      repo: "owner/repo",
    });
  });

  test("run without --repo value → error", () => {
    const parsed = parseArgs(["run", "--repo"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      expect(parsed.message).toContain("--repo");
    }
  });

  test("run with --cwd flag", () => {
    expect(parseArgs(["run", "--cwd", "/some/dir", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
      cwd: "/some/dir",
    });
  });

  test("run without --cwd value → error", () => {
    const parsed = parseArgs(["run", "--cwd"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      expect(parsed.message).toContain("--cwd");
    }
  });

  test("run with --review-passes flag", () => {
    expect(parseArgs(["run", "--review-passes", "3", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
      reviewPasses: "3",
    });
  });

  test("run with --review-passes 0", () => {
    expect(parseArgs(["run", "--review-passes", "0", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
      reviewPasses: "0",
    });
  });

  test("run with --tier flag", () => {
    expect(parseArgs(["run", "--tier", "hard", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
      tier: "hard",
    });
  });

  test("run with repeatable --agent flags", () => {
    expect(parseArgs(["run", "--agent", "codex:gpt-5.4", "--agent", "claude", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
      agentFlags: ["codex:gpt-5.4", "claude"],
    });
  });

  test("run without --agent value → error", () => {
    const parsed = parseArgs(["run", "--agent"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      expect(parsed.message).toContain("--agent");
    }
  });

  test("run without --tier value → error", () => {
    const parsed = parseArgs(["run", "--tier"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      expect(parsed.message).toContain("--tier");
    }
  });

  test("run without --review-passes value → error", () => {
    const parsed = parseArgs(["run", "--review-passes"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      expect(parsed.message).toContain("--review-passes");
    }
  });

  test("run with multiple flags including --review-passes", () => {
    expect(parseArgs(["run", "--max-iterations", "5", "--review-passes", "2", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
      maxIterations: "5",
      reviewPasses: "2",
    });
  });

  test("run with --resume-review flag", () => {
    expect(parseArgs(["run", "--resume-review", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
      resumeReview: true,
    });
  });

  test("run with --resume-review and --max-iterations", () => {
    expect(parseArgs(["run", "--resume-review", "--max-iterations", "5", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
      maxIterations: "5",
      resumeReview: true,
    });
  });

  test("run with --resume-review and --review-passes", () => {
    expect(parseArgs(["run", "--resume-review", "--review-passes", "2", "./spec.md"])).toEqual({
      kind: "run",
      specPath: "./spec.md",
      reviewPasses: "2",
      resumeReview: true,
    });
  });

  test("run without spec → error", () => {
    const parsed = parseArgs(["run"]);
    expect(parsed.kind).toBe("error");
  });

  test("init", () => {
    expect(parseArgs(["init"])).toEqual({ kind: "init" });
  });

  test("config with extra args", () => {
    expect(parseArgs(["config", "get", "agentOrder"])).toEqual({
      kind: "config",
      rest: ["get", "agentOrder"],
    });
  });

  test("log-server", () => {
    expect(parseArgs(["log-server"])).toEqual({ kind: "log-server" });
  });

  test("unknown subcommand", () => {
    expect(parseArgs(["bogus"])).toEqual({ kind: "unknown", name: "bogus" });
  });

  test("review-feedback with worktree name", () => {
    expect(parseArgs(["review-feedback", "my-worktree"])).toEqual({
      kind: "review-feedback",
      worktreeName: "my-worktree",
    });
  });

  test("plan with no args", () => {
    expect(parseArgs(["plan"])).toEqual({ kind: "plan", rest: [] });
  });

  test("plan with extra args", () => {
    expect(parseArgs(["plan", "--repo", "foo", "intent.md"])).toEqual({
      kind: "plan",
      rest: ["--repo", "foo", "intent.md"],
    });
  });

  test("intent with extra args", () => {
    expect(parseArgs(["intent", "--repo", "foo", "seed.md"])).toEqual({
      kind: "intent",
      rest: ["--repo", "foo", "seed.md"],
    });
  });

  test("intent with --agent colon model", () => {
    expect(parseArgs(["intent", "--agent", "codex:gpt-5.5", "seed.md"])).toEqual({
      kind: "intent",
      rest: ["--agent", "codex:gpt-5.5", "seed.md"],
      agentFlag: "codex:gpt-5.5",
    });
  });

  test("prompt with text", () => {
    expect(parseArgs(["prompt", "hello world"])).toEqual({
      kind: "prompt",
      text: "hello world",
    });
  });

  test("prompt with --repo flag", () => {
    expect(parseArgs(["prompt", "--repo", "my-project", "explain this code"])).toEqual({
      kind: "prompt",
      text: "explain this code",
      repo: "my-project",
    });
  });

  test("prompt with --agent and --model flags", () => {
    expect(
      parseArgs([
        "prompt",
        "--repo",
        "my-project",
        "--agent",
        "opencode",
        "--model",
        "opencode/glm-5.2",
        "multi word text",
      ]),
    ).toEqual({
      kind: "prompt",
      text: "multi word text",
      repo: "my-project",
      agentFlag: "opencode",
      modelFlag: "opencode/glm-5.2",
    });
  });

  test("prompt with --agent colon model", () => {
    expect(parseArgs(["prompt", "--agent", "codex:gpt-5.4", "hello"])).toEqual({
      kind: "prompt",
      text: "hello",
      agentFlag: "codex:gpt-5.4",
    });
  });

  test("prompt flag parse errors", () => {
    for (const argv of [
      ["prompt", "--agent"],
      ["prompt", "--agent", "claude", "--agent", "codex", "hello"],
      ["prompt", "--model"],
    ] as const) {
      const parsed = parseArgs([...argv]);
      expect(parsed.kind).toBe("error");
    }
  });

  test("unsupported subcommands reject --agent", () => {
    for (const argv of [["config", "--agent", "claude", "show"]] as const) {
      const parsed = parseArgs([...argv]);
      expect(parsed.kind).toBe("error");
      if (parsed.kind === "error") {
        expect(parsed.message).toContain("--agent is not supported");
      }
    }
  });

  test("parsePromptAgentOverride", () => {
    const colonModel = parsePromptAgentOverride("codex:gpt-5.4", "haiku", []);
    expect(colonModel.ok).toBe(true);
    if (colonModel.ok) {
      expect(colonModel.pinned).toEqual({ agent: "codex", model: "gpt-5.4" });
    }

    expect(parsePromptAgentOverride(":model", undefined, []).ok).toBe(false);

    const emptyColonModel = parsePromptAgentOverride("claude:", undefined, []);
    expect(emptyColonModel.ok).toBe(false);
    if (!emptyColonModel.ok) {
      expect(emptyColonModel.message).toContain("non-empty string");
    }

    const configModel = parsePromptAgentOverride("claude", undefined, [{ agent: "claude", model: "sonnet" }]);
    expect(configModel.ok).toBe(true);
    if (configModel.ok) {
      expect(configModel.pinned.model).toBe("sonnet");
    }
  });

  test("buildEffectivePromptAgentEntries with empty order yields pinned only", () => {
    expect(buildEffectivePromptAgentEntries({ agent: "opencode", model: "opencode/glm-5.2" }, [])).toEqual([
      { agent: "opencode", model: "opencode/glm-5.2" },
    ]);
  });

  test("prompt without text → error", () => {
    const parsed = parseArgs(["prompt"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      expect(parsed.message).toContain("missing <text>");
    }
  });

  test("prompt with --cwd → error", () => {
    const parsed = parseArgs(["prompt", "--cwd", "/some/dir", "text"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      expect(parsed.message).toContain("--cwd is not allowed");
    }
  });

  test("prompt with --repo but no value → error", () => {
    const parsed = parseArgs(["prompt", "--repo", "hello"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      expect(parsed.message).toContain("missing <text>");
    }
  });

  test("cleanup with --abandon and --dry-run", () => {
    expect(parseArgs(["cleanup", "--abandon", "--dry-run"])).toEqual({
      kind: "cleanup",
      abandon: true,
      dryRun: true,
    });
  });

  test("cleanup scoped abandon parses worktree name with flag order independence", () => {
    expect(parseArgs(["cleanup", "--abandon", "my-tree"])).toEqual({
      kind: "cleanup",
      abandon: true,
      dryRun: false,
      worktreeName: "my-tree",
    });
    expect(parseArgs(["cleanup", "my-tree", "--abandon"])).toEqual({
      kind: "cleanup",
      abandon: true,
      dryRun: false,
      worktreeName: "my-tree",
    });
    expect(parseArgs(["cleanup", "--dry-run", "--abandon", "my-tree"])).toEqual({
      kind: "cleanup",
      abandon: true,
      dryRun: true,
      worktreeName: "my-tree",
    });
  });

  test("cleanup scoped abandon extra positional is usage error", () => {
    const parsed = parseArgs(["cleanup", "--abandon", "one", "two"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      expect(parsed.message).toContain("too many arguments");
    }
  });

  test("cleanup with a spec name and no --abandon scopes the root-archival pass", () => {
    expect(parseArgs(["cleanup", "my-spec"])).toEqual({
      kind: "cleanup",
      abandon: false,
      dryRun: false,
      worktreeName: "my-spec",
    });
  });

  test("cleanup with a spec name and no --abandon plus extra positional is usage error", () => {
    const parsed = parseArgs(["cleanup", "one", "two"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") {
      expect(parsed.message).toContain("too many arguments");
    }
  });

  test.each([
    ["run", "--help", "run"],
    ["run", "-h", "run"],
    ["init", "--help", "init"],
    ["init", "-h", "init"],
    ["config", "--help", "config"],
    ["config", "-h", "config"],
    ["log-server", "--help", "log-server"],
    ["log-server", "-h", "log-server"],
    ["cleanup", "--help", "cleanup"],
    ["cleanup", "-h", "cleanup"],
    ["triage", "--help", "triage"],
    ["triage", "-h", "triage"],
    ["review-feedback", "--help", "review-feedback"],
    ["review-feedback", "-h", "review-feedback"],
    ["plan", "--help", "plan"],
    ["plan", "-h", "plan"],
    ["intent", "--help", "intent"],
    ["intent", "-h", "intent"],
    ["prompt", "--help", "prompt"],
    ["prompt", "-h", "prompt"],
    ["prices", "--help", "prices"],
    ["prices", "-h", "prices"],
  ])("%s %s → help with command %s", (cmd, flag, expectedCmd) => {
    expect(parseArgs([cmd, flag])).toEqual({ kind: "help", command: expectedCmd });
  });
});

describe("run", () => {
  test("help prints usage with all subcommands and exits 0", () => {
    const cap = captureIo();
    const code = run(["help"], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(0);
    const out = cap.out();
    expect(out).toContain(
      "run [--max-iterations <n>] [--review-passes <n>] [--tier <tier>] [--agent <name>[:<model>]] [--repo <name|path|url>] [--cwd <dir>] [--resume-review] <spec-path>",
    );
    expect(out).toContain("init");
    expect(out).toContain("config");
    expect(out).toContain("log-server");
    expect(out).toContain("review-feedback <worktree-name>");
    expect(out).toContain("plan [--review-passes <n>]");
    expect(out).toContain("Draft specs via plan mode");
    expect(out).toContain(
      'intent [--agent <name>[:<model>]] [--repo <name|path|url>] [--cwd <dir>] [--target-dir <dir>] <raw-seed-file|"inline text">',
    );
    expect(out).toContain("help");
  });

  test("run dispatches to the loop", async () => {
    const cap = captureIo();
    const code = await run(["run", "./somewhere.md"], {
      io: cap.io,
      config: { dir: cfgDir },
      run: { agents: {}, handleSignals: false },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("spec path does not exist");
  });

  test.each(["0", "-1", "abc"])("invalid --max-iterations %s exits before the loop", async (value) => {
    const cap = captureIo();
    const code = await run(["run", "--max-iterations", value, "./somewhere.md"], {
      io: cap.io,
      config: { dir: cfgDir },
      run: { agents: {}, handleSignals: false },
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("--max-iterations must be a positive integer");
    expect(cap.err()).not.toContain("spec path does not exist");
  });

  test.each(["-1", "abc"])("invalid --review-passes %s exits before the loop", async (value) => {
    const cap = captureIo();
    const code = await run(["run", "--review-passes", value, "./somewhere.md"], {
      io: cap.io,
      config: { dir: cfgDir },
      run: { agents: {}, handleSignals: false },
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("--review-passes must be a non-negative integer");
    expect(cap.err()).not.toContain("spec path does not exist");
  });

  test.each(["Hard", ""])("invalid --tier %p exits before the loop", async (value) => {
    const cap = captureIo();
    const code = await run(["run", "--tier", value, "./somewhere.md"], {
      io: cap.io,
      config: { dir: cfgDir },
      run: { agents: {}, handleSignals: false },
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("--tier must be one of trivial, standard, hard");
    expect(cap.err()).not.toContain("spec path does not exist");
  });

  test("invalid --agent exits before the loop", async () => {
    const cap = captureIo();
    const code = await run(["run", "--agent", "bogus", "./somewhere.md"], {
      io: cap.io,
      config: { dir: cfgDir },
      run: { agents: {}, handleSignals: false },
    });

    expect(code).toBe(1);
    expect(cap.err()).toContain("run:");
    expect(cap.err()).toContain("bogus");
    expect(cap.err()).not.toContain("spec path does not exist");
  });

  test("valid --review-passes 0 passes to the loop", async () => {
    const cap = captureIo();
    const code = await run(["run", "--review-passes", "0", "./somewhere.md"], {
      io: cap.io,
      config: { dir: cfgDir },
      run: { agents: {}, handleSignals: false },
    });
    // Since the file doesn't exist, we should get "spec path does not exist"
    // not a validation error (meaning validation passed)
    expect(code).toBe(1);
    expect(cap.err()).toContain("spec path does not exist");
  });

  test("init runs in a temp cwd and registers the project", () => {
    const cap = captureIo();
    const root = mkdtempSync(join(tmpdir(), "jarvis-init-cli-"));
    const workRoot = join(root, "Work");
    const projectDir = join(workRoot, "app");
    try {
      const { mkdirSync } = require("node:fs") as typeof import("node:fs");
      mkdirSync(projectDir, { recursive: true });
      const code = run(["init"], {
        io: cap.io,
        config: { dir: cfgDir },
        cwd: projectDir,
        init: { workRoot, readOriginUrl: () => undefined },
      });
      expect(code).toBe(0);
      expect(cap.out()).toContain("registered project");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("config with no subcommand prints usage and exits 1", () => {
    const cap = captureIo();
    const code = run(["config"], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(1);
    expect(cap.err()).toContain("Usage: jarvis1 config");
  });

  test("config show prints the loaded config", () => {
    const cap = captureIo();
    const code = run(["config", "show"], {
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out());
    expect(parsed.version).toBe(2);
    const expectedOrder = [
      { agent: "claude", model: "haiku" },
      { agent: "codex", model: "gpt-5.4" },
      { agent: "cursor", model: "Composer 2.5" },
    ];
    expect(parsed.modes.patch.agentOrder).toEqual(expectedOrder);
    expect(parsed.modes.plan.agentOrder).toEqual(expectedOrder);
    expect(parsed.maxIterations).toBe(10);
  });

  test("unknown subcommand exits 1 and prints to stderr", () => {
    const cap = captureIo();
    const code = run(["bogus"], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(1);
    expect(cap.err()).toContain("unknown command");
    expect(cap.err()).toContain("bogus");
  });

  test("plan with no args fails parsing before the log-server preflight", async () => {
    // Pin logServerUrl to a deliberately-unreachable port so the test is
    // robust to whether a real log server is running on the host.
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: {
            agentOrder: [
              { agent: "claude", model: "haiku" },
              { agent: "codex", model: "gpt-5.3-codex" },
              { agent: "cursor", model: "Composer 2" },
            ],
          },
          plan: {
            agentOrder: [
              { agent: "claude", model: "haiku" },
              { agent: "codex", model: "gpt-5.3-codex" },
              { agent: "cursor", model: "Composer 2" },
            ],
          },
          review: { passes: 2 },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: 1800000,
        logServerUrl: "http://127.0.0.1:1/logs",
        logServerBind: "127.0.0.1:4310",
        git: true,
        projects: {},
      }),
    );
    const cap = captureIo();
    const code = await run(["plan"], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(1);
    expect(cap.err()).toContain("missing required ready-intent");
  });

  test("plan --help prints usage to stdout and exits 0", async () => {
    const cap = captureIo();
    const code = await run(["plan", "--help"], {
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    expect(cap.out()).toContain("--review-passes");
    expect(cap.out()).toContain("docs/plan-mode.md");
  });

  test("run without spec path exits 1", () => {
    const cap = captureIo();
    const code = run(["run"], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(1);
    expect(cap.err()).toContain("spec-path");
  });

  test("prompt with empty text exits 1", () => {
    const cap = captureIo();
    const code = run(["prompt", ""], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(1);
    expect(cap.err()).toContain("empty or whitespace-only");
  });

  test("prompt with whitespace-only text exits 1", () => {
    const cap = captureIo();
    const code = run(["prompt", "   "], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(1);
    expect(cap.err()).toContain("empty or whitespace-only");
  });

  test("prompt with git disabled exits 1", () => {
    const cap = captureIo();
    const agentOrder = [
      { agent: "claude", model: "haiku" },
      { agent: "codex", model: "gpt-5.3-codex" },
      { agent: "cursor", model: "Composer 2" },
    ];
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        version: 2,
        modes: {
          patch: { agentOrder },
          plan: { agentOrder },
          prompt: { agentOrder },
        },
        quotaFallback: "lenient",
        weakQuotaExitCodes: [],
        maxIterations: 10,
        iterationTimeoutMs: 1800000,
        logServerUrl: "http://127.0.0.1:4310/logs",
        logServerBind: "127.0.0.1:4310",
        git: false,
        projects: {},
      }),
    );
    const code = run(["prompt", "hello"], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(1);
    expect(cap.err()).toContain("requires git to be enabled");
  });

  test("prompt with unregistered repo exits 1", () => {
    const cap = captureIo();
    const code = run(["prompt", "--repo", "nonexistent", "hello"], {
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("no project matches");
  });

  test("prompt with no registered project in cwd exits 1", () => {
    const cap = captureIo();
    const tempDir = mkdtempSync(join(tmpdir(), "jarvis-prompt-"));
    try {
      const code = run(["prompt", "hello"], {
        io: cap.io,
        config: { dir: cfgDir },
        cwd: tempDir,
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("repo resolution failed");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("prompt with bogus --agent exits before worktree creation", () => {
    const cap = captureIo();
    const root = mkdtempSync(join(tmpdir(), "jarvis-prompt-agent-"));
    const workRoot = join(root, "Work");
    const projectDir = join(workRoot, "app");
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(projectDir, { recursive: true });
    try {
      run(["init"], {
        io: cap.io,
        config: { dir: cfgDir },
        cwd: projectDir,
        init: { workRoot, readOriginUrl: () => undefined },
      });
      const code = run(["prompt", "--agent", "bogus", "hello"], {
        io: cap.io,
        config: { dir: cfgDir },
        cwd: projectDir,
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("prompt:");
      expect(cap.err()).toContain("bogus");
      expect(cap.err()).toContain("claude");
      expect(cap.err()).toContain("codex");
      const worktreeDir = join(projectDir, ".worktree");
      const { existsSync } = require("node:fs") as typeof import("node:fs");
      expect(existsSync(worktreeDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("prompt with empty colon --agent model exits before worktree creation", () => {
    const cap = captureIo();
    const root = mkdtempSync(join(tmpdir(), "jarvis-prompt-agent-colon-"));
    const workRoot = join(root, "Work");
    const projectDir = join(workRoot, "app");
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(projectDir, { recursive: true });
    try {
      run(["init"], {
        io: cap.io,
        config: { dir: cfgDir },
        cwd: projectDir,
        init: { workRoot, readOriginUrl: () => undefined },
      });
      const code = run(["prompt", "--agent", "claude:", "hello"], {
        io: cap.io,
        config: { dir: cfgDir },
        cwd: projectDir,
      });
      expect(code).toBe(1);
      expect(cap.err()).toContain("prompt:");
      expect(cap.err()).toContain("non-empty string");
      const worktreeDir = join(projectDir, ".worktree");
      const { existsSync } = require("node:fs") as typeof import("node:fs");
      expect(existsSync(worktreeDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("intent --agent no longer rejected as unsupported", async () => {
    const cap = captureIo();
    // Non-git cwd: default process.cwd() is the jarvis checkout, which ad-hoc
    // repo resolution would target and then POST to the operator's log-server.
    const isolatedCwd = mkdtempSync(join(tmpdir(), "jarvis-cli-intent-"));
    try {
      const code = await run(["intent", "--agent", "claude", "seed.md"], {
        io: cap.io,
        config: { dir: cfgDir },
        cwd: isolatedCwd,
      });
      expect(code).toBe(1);
      expect(cap.err()).not.toContain("--agent is not supported");
    } finally {
      rmSync(isolatedCwd, { recursive: true, force: true });
    }
  });

  test("run/init/config bootstrap the config dir", () => {
    const cap = captureIo();
    const root = mkdtempSync(join(tmpdir(), "jarvis-init-cli-"));
    const workRoot = join(root, "Work");
    const projectDir = join(workRoot, "app");
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(projectDir, { recursive: true });
    run(["init"], {
      io: cap.io,
      config: { dir: cfgDir },
      cwd: projectDir,
      init: { workRoot, readOriginUrl: () => undefined },
    });
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    expect(existsSync(join(cfgDir, "config.json"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test.each([
    ["run", ["--max-iterations", "--review-passes", "--tier"]],
    ["init", ["Register the current target repo"]],
    ["config", ["View or edit"]],
    ["log-server", ["log aggregation server"]],
    ["cleanup", ["--abandon", "[<worktree-name>]", "Remove merged worktrees, or retire abandoned worktrees"]],
    ["triage", ["Inspect"]],
    ["review-feedback", ["PR review feedback"]],
    ["plan", []],
    ["intent", []],
    ["prompt", ["Run an agent against a prompt"]],
    ["prices", ["pricing data"]],
  ])("%s --help prints help and exits 0", (cmd, expectedStrings) => {
    const cap = captureIo();
    const code = run([cmd, "--help"], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(0);
    expect(cap.out()).toContain(`Usage: jarvis1 ${cmd}`);
    expectedStrings.forEach((str) => {
      expect(cap.out()).toContain(str);
    });
  });
});
