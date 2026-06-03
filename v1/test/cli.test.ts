import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Io, parseArgs, run } from "../src/cli.ts";

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
    expect(
      parseArgs([
        "run",
        "--repo",
        "owner/repo",
        "--max-iterations",
        "2",
        "./spec.md",
      ]),
    ).toEqual({
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
});

describe("run", () => {
  test("help prints usage with all subcommands and exits 0", () => {
    const cap = captureIo();
    const code = run(["help"], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(0);
    const out = cap.out();
    expect(out).toContain(
      "run [--max-iterations <n>] [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] <spec-path>",
    );
    expect(out).toContain("init");
    expect(out).toContain("config");
    expect(out).toContain("log-server");
    expect(out).toContain("review-feedback <worktree-name>");
    expect(out).toContain("plan [--refine-turns <n>]");
    expect(out).toContain("Draft specs via plan mode");
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

  test.each([
    "0",
    "-1",
    "abc",
  ])("invalid --max-iterations %s exits before the loop", async (value) => {
    const cap = captureIo();
    const code = await run(
      ["run", "--max-iterations", value, "./somewhere.md"],
      {
        io: cap.io,
        config: { dir: cfgDir },
        run: { agents: {}, handleSignals: false },
      },
    );

    expect(code).toBe(1);
    expect(cap.err()).toContain("--max-iterations must be a positive integer");
    expect(cap.err()).not.toContain("spec path does not exist");
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
        init: { workRoot },
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
      { agent: "codex", model: "gpt-5.3-codex" },
      { agent: "cursor", model: "Composer 2" },
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

  test("plan with no args fails the log-server preflight (exit 1) when the log server is not reachable", async () => {
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
    // The stub message is gated behind a successful preflight; see
    // test/plan-command.test.ts for the stub-message coverage with an
    // injected log client.
    expect(code).toBe(1);
    expect(cap.err()).toContain("log server unreachable");
  });

  test("plan --help prints usage to stdout and exits 0", async () => {
    const cap = captureIo();
    const code = await run(["plan", "--help"], {
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    expect(cap.out()).toContain("--refine-turns");
    expect(cap.out()).toContain("docs/plan-mode.md");
  });

  test("run without spec path exits 1", () => {
    const cap = captureIo();
    const code = run(["run"], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(1);
    expect(cap.err()).toContain("spec-path");
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
      init: { workRoot },
    });
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    expect(existsSync(join(cfgDir, "config.json"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("bin/jarvis1", () => {
  test("resolves the repo path when invoked through a symlink", () => {
    const binDir = mkdtempSync(join(tmpdir(), "jarvis-bin-"));
    const linkPath = join(binDir, "jarvis1");
    symlinkSync(resolve("bin/jarvis1"), linkPath);

    try {
      const result = Bun.spawnSync([linkPath, "help"], {
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("Usage: jarvis1");
      expect(result.stderr.toString()).toBe("");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
