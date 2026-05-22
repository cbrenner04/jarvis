import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

describe("init", () => {
  test("registers a repo under Work without creating target files", () => {
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
    expect(cap.err()).toContain("jarvis config");

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
});
