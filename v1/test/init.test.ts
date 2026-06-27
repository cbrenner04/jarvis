import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Io } from "../src/cli.ts";
import { init } from "../src/commands/init.ts";
import { loadConfig, registerProject } from "../src/config.ts";

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
let root: string;
let workRoot: string;
let cwd: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jarvis-init-"));
  cfgDir = join(root, "cfg");
  workRoot = join(root, "Work");
  cwd = join(workRoot, "app-a");
  mkdirSync(cwd, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function initAndReadRunbook(): string {
  const cap = captureIo();
  init({ cwd, io: cap.io, config: { dir: cfgDir }, workRoot, readOriginUrl: () => undefined });
  return readFileSync(join(cwd, "OPERATOR_RUNBOOK.md"), "utf8");
}

describe("init", () => {
  test("registers a repo under Work and creates OPERATOR_RUNBOOK.md", () => {
    const cap = captureIo();
    const code = init({
      cwd,
      io: cap.io,
      config: { dir: cfgDir },
      workRoot,
      readOriginUrl: () => undefined,
    });
    expect(code).toBe(0);

    expect(existsSync(join(cwd, "README.md"))).toBe(false);
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(cwd, "spec"))).toBe(false);
    expect(existsSync(join(cwd, ".jarvis"))).toBe(false);
    expect(existsSync(join(cwd, "OPERATOR_RUNBOOK.md"))).toBe(true);

    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.projects["app-a"]).toEqual({ root: cwd });

    expect(cap.out()).toContain("registered project");
  });

  test("records origin URL when the repo has an `origin` remote", () => {
    const cap = captureIo();
    const code = init({
      cwd,
      io: cap.io,
      config: { dir: cfgDir },
      workRoot,
      readOriginUrl: () => "git@github.com:you/app-a.git\n",
    });
    expect(code).toBe(0);

    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.projects["app-a"]).toEqual({
      root: cwd,
      origin: "git@github.com:you/app-a.git",
    });
    expect(cap.out()).not.toContain("no `origin` remote");
  });

  test("succeeds with a one-line note when no `origin` remote exists", () => {
    const cap = captureIo();
    const code = init({
      cwd,
      io: cap.io,
      config: { dir: cfgDir },
      workRoot,
      readOriginUrl: () => undefined,
    });
    expect(code).toBe(0);

    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.projects["app-a"]).toEqual({ root: cwd });
    expect(cap.out()).toContain("no `origin` remote");
  });

  test("leaves existing target files untouched", () => {
    writeFileSync(join(cwd, "README.md"), "# custom\n");
    mkdirSync(join(cwd, "spec"), { recursive: true });

    const cap = captureIo();
    const code = init({
      cwd,
      io: cap.io,
      config: { dir: cfgDir },
      workRoot,
      readOriginUrl: () => undefined,
    });
    expect(code).toBe(0);

    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe("# custom\n");

    expect(cap.out()).not.toContain("exists: ");
    expect(cap.out()).not.toContain("created: ");
  });

  test("uses nested project keys relative to Work", () => {
    const nested = join(workRoot, "client", "api");
    mkdirSync(nested, { recursive: true });
    const cap = captureIo();
    const code = init({
      cwd: nested,
      io: cap.io,
      config: { dir: cfgDir },
      workRoot,
      readOriginUrl: () => undefined,
    });
    expect(code).toBe(0);

    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.projects["client/api"]).toEqual({ root: nested });
  });

  test("fails clearly outside Work", () => {
    const outside = join(root, "elsewhere", "app");
    mkdirSync(outside, { recursive: true });
    const cap = captureIo();
    const code = init({
      cwd: outside,
      io: cap.io,
      config: { dir: cfgDir },
      workRoot,
      readOriginUrl: () => undefined,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("init must be run inside");
    expect(cap.err()).toContain(workRoot);

    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.projects).toEqual({});
  });

  test("idempotent: re-running on the same registered repo is a no-op", () => {
    init({
      cwd,
      io: captureIo().io,
      config: { dir: cfgDir },
      workRoot,
      readOriginUrl: () => undefined,
    });
    const cap = captureIo();
    const code = init({
      cwd,
      io: cap.io,
      config: { dir: cfgDir },
      workRoot,
      readOriginUrl: () => undefined,
    });
    expect(code).toBe(0);
    expect(cap.out()).not.toContain("created: ");
    expect(cap.out()).toContain("already registered");
  });

  test("name-collision: different root under same name fails with exit 1", () => {
    const name = "app-a";
    const otherRoot = "/tmp/jarvis-other-root";
    registerProject(name, otherRoot, { dir: cfgDir });

    const cap = captureIo();
    const code = init({
      cwd,
      io: cap.io,
      config: { dir: cfgDir },
      workRoot,
      readOriginUrl: () => undefined,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("already registered");
    expect(cap.err()).toContain("jarvis1 config");

    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.projects[name]).toEqual({ root: otherRoot });
  });

  test("preserves duplicate-root validation for another project key", () => {
    registerProject("old-name", cwd, { dir: cfgDir });

    const cap = captureIo();
    const code = init({
      cwd,
      io: cap.io,
      config: { dir: cfgDir },
      workRoot,
      readOriginUrl: () => undefined,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("already registered as");

    const cfg = loadConfig({ dir: cfgDir });
    expect(cfg.projects).toEqual({ "old-name": { root: cwd } });
  });

  test("runbook includes project facts (key, root, stack, modes)", () => {
    const cap = captureIo();
    init({
      cwd,
      io: cap.io,
      config: { dir: cfgDir },
      workRoot,
      readOriginUrl: () => "https://github.com/example/app-a.git",
    });

    const runbook = readFileSync(join(cwd, "OPERATOR_RUNBOOK.md"), "utf8");
    expect(runbook).toContain("app-a");
    expect(runbook).toContain(cwd);
    expect(runbook).toContain("https://github.com/example/app-a.git");
    expect(runbook).toContain("Inferred stack");
    expect(runbook).toContain("Ready command");
    expect(runbook).toContain("Plan commit mode");
    expect(runbook).toContain("Patch agent order");
  });

  test("runbook renders 'no origin configured' when origin is absent", () => {
    expect(initAndReadRunbook()).toContain("- **Origin:** no origin configured");
  });

  test("runbook renders 'not configured' for missing readyCommand", () => {
    expect(initAndReadRunbook()).toContain("- **Ready command:** not configured");
  });

  test("runbook includes repos-and-gates table", () => {
    const runbook = initAndReadRunbook();
    expect(runbook).toContain("| Repo | Path/URL | Gate |");
    expect(runbook).toContain("| Target |");
    expect(runbook).toContain(cwd);
  });

  test("runbook contains all fixed section headings in order", () => {
    const runbook = initAndReadRunbook();
    const headings = [
      "## Project facts",
      "## Spec layout",
      "## Repos and gates",
      "## Sandbox and network",
      "## Known gotchas",
      "## Manual finalize and recovery",
      "## Resume-first guidance",
      "## Gate blind spots",
      "## Cross-repo coordination",
    ];
    let lastPos = -1;
    for (const heading of headings) {
      const pos = runbook.indexOf(heading);
      expect(pos).toBeGreaterThan(-1);
      expect(pos).toBeGreaterThan(lastPos);
      lastPos = pos;
    }
  });

  test("runbook contains cited H3 headings that failure exits reference", () => {
    const runbook = initAndReadRunbook();
    expect(runbook).toContain("### Recovery by exit reason");
    expect(runbook).toContain("## Resume-first guidance");
  });

  test("runbook contains sandbox/network notes", () => {
    const runbook = initAndReadRunbook();
    expect(runbook).toContain("Sandbox blindness");
    expect(runbook).toContain("Network-restricted runs");
  });

  test("runbook contains known-gotchas with jarvis issue URLs", () => {
    const runbook = initAndReadRunbook();
    expect(runbook).toContain("External spec symlinks");
    expect(runbook).toContain("github.com/cbrenner04/jarvis/issues");
  });

  test("idempotent: does not overwrite existing runbook", () => {
    const runbookPath = join(cwd, "OPERATOR_RUNBOOK.md");
    const customContent = "# Custom Runbook\nCustom content here\n";
    writeFileSync(runbookPath, customContent, "utf8");

    const cap = captureIo();
    const code = init({
      cwd,
      io: cap.io,
      config: { dir: cfgDir },
      workRoot,
      readOriginUrl: () => undefined,
    });
    expect(code).toBe(0);

    const runbook = readFileSync(runbookPath, "utf8");
    expect(runbook).toBe(customContent);
  });

  test("runbook explains commit:false external specs arrangement", () => {
    const runbook = initAndReadRunbook();
    expect(runbook).toContain("External specs for `commit:false` mode");
    expect(runbook).toContain("~/.jarvis/specs/");
    expect(runbook).toContain("symlink");
  });
});
