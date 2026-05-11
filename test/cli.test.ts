import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
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
});

describe("run", () => {
  test("help prints usage with all subcommands and exits 0", () => {
    const cap = captureIo();
    const code = run(["help"], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(0);
    const out = cap.out();
    expect(out).toContain("run [--max-iterations <n>] <spec-path>");
    expect(out).toContain("init");
    expect(out).toContain("config");
    expect(out).toContain("log-server");
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
    expect(cap.err()).toContain("Usage: jarvis config");
  });

  test("config show prints the loaded config", () => {
    const cap = captureIo();
    const code = run(["config", "show"], {
      io: cap.io,
      config: { dir: cfgDir },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out());
    expect(parsed.version).toBe(1);
    expect(parsed.agentOrder).toEqual(["claude", "codex", "cursor"]);
    expect(parsed.maxIterations).toBe(10);
  });

  test("unknown subcommand exits 1 and prints to stderr", () => {
    const cap = captureIo();
    const code = run(["bogus"], { io: cap.io, config: { dir: cfgDir } });
    expect(code).toBe(1);
    expect(cap.err()).toContain("unknown command");
    expect(cap.err()).toContain("bogus");
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

describe("bin/jarvis", () => {
  test("resolves the repo path when invoked through a symlink", () => {
    const binDir = mkdtempSync(join(tmpdir(), "jarvis-bin-"));
    const linkPath = join(binDir, "jarvis");
    symlinkSync(resolve("bin/jarvis"), linkPath);

    try {
      const result = Bun.spawnSync([linkPath, "help"], {
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("Usage: jarvis");
      expect(result.stderr.toString()).toBe("");
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
