import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Io } from "../src/cli.ts";
import { init } from "../src/commands/init.ts";
import { runbookCommand } from "../src/commands/runbook.ts";

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
let projectName: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jarvis-runbook-"));
  cfgDir = join(root, "cfg");
  workRoot = join(root, "Work");
  projectName = "test-app";
  cwd = join(workRoot, projectName);
  mkdirSync(cwd, { recursive: true });

  // Initialize the project
  const cap = captureIo();
  init({
    cwd,
    io: cap.io,
    config: { dir: cfgDir },
    workRoot,
    readOriginUrl: () => undefined,
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runbook add", () => {
  test("appends entry to Known gotchas section (default)", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "A new gotcha",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(0);

    const runbook = readFileSync(join(cwd, "OPERATOR_RUNBOOK.md"), "utf8");
    expect(runbook).toContain("- A new gotcha");

    // Verify it's in the Known gotchas section
    const knownGotchasIdx = runbook.indexOf("## Known gotchas");
    const nextSectionIdx = runbook.indexOf("## Manual finalize and recovery");
    const entryIdx = runbook.indexOf("- A new gotcha");
    expect(entryIdx).toBeGreaterThan(knownGotchasIdx);
    expect(entryIdx).toBeLessThan(nextSectionIdx);
  });

  test("appends entry with issue-url", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "A complex issue",
      issueUrl: "https://github.com/cbrenner04/jarvis/issues/123",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(0);

    const runbook = readFileSync(join(cwd, "OPERATOR_RUNBOOK.md"), "utf8");
    expect(runbook).toContain("- A complex issue ([jarvis issue](https://github.com/cbrenner04/jarvis/issues/123))");
  });

  test("appends to Gate blind spots section", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "The gate is incomplete",
      section: "Gate blind spots",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(0);

    const runbook = readFileSync(join(cwd, "OPERATOR_RUNBOOK.md"), "utf8");
    const blindSpotsIdx = runbook.indexOf("## Gate blind spots");
    const crossRepoIdx = runbook.indexOf("## Cross-repo coordination");
    const entryIdx = runbook.indexOf("- The gate is incomplete");
    expect(entryIdx).toBeGreaterThan(blindSpotsIdx);
    expect(entryIdx).toBeLessThan(crossRepoIdx);
  });

  test("appends to Cross-repo coordination section", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "Coordinate with other team",
      section: "Cross-repo coordination",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(0);

    const runbook = readFileSync(join(cwd, "OPERATOR_RUNBOOK.md"), "utf8");
    const coordIdx = runbook.indexOf("## Cross-repo coordination");
    const entryIdx = runbook.indexOf("- Coordinate with other team");
    expect(entryIdx).toBeGreaterThan(coordIdx);
  });

  test("section parameter is case-insensitive", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "Test case insensitive",
      section: "GATE BLIND SPOTS",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(0);

    const runbook = readFileSync(join(cwd, "OPERATOR_RUNBOOK.md"), "utf8");
    const blindSpotsIdx = runbook.indexOf("## Gate blind spots");
    const entryIdx = runbook.indexOf("- Test case insensitive");
    expect(entryIdx).toBeGreaterThan(blindSpotsIdx);
  });

  test("appends multiple entries to same section", () => {
    const cap1 = captureIo();
    runbookCommand({
      action: "add",
      entry: "First issue",
      io: cap1.io,
      config: { dir: cfgDir },
      cwd,
    });

    const cap2 = captureIo();
    runbookCommand({
      action: "add",
      entry: "Second issue",
      io: cap2.io,
      config: { dir: cfgDir },
      cwd,
    });

    const runbook = readFileSync(join(cwd, "OPERATOR_RUNBOOK.md"), "utf8");
    expect(runbook).toContain("- First issue");
    expect(runbook).toContain("- Second issue");

    // Verify first entry is before second entry
    const firstIdx = runbook.indexOf("- First issue");
    const secondIdx = runbook.indexOf("- Second issue");
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  test("does not overwrite existing entries", () => {
    const runbookPath = join(cwd, "OPERATOR_RUNBOOK.md");
    const runbookBefore = readFileSync(runbookPath, "utf8");
    const lineCountBefore = runbookBefore.split("\n").length;

    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "New entry",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(0);

    const runbookAfter = readFileSync(runbookPath, "utf8");
    const lineCountAfter = runbookAfter.split("\n").length;

    expect(lineCountAfter).toBe(lineCountBefore + 1);
    expect(runbookAfter).toContain("- New entry");
  });

  test("fails outside a registered project", () => {
    const outsidePath = join(root, "not-registered");
    mkdirSync(outsidePath, { recursive: true });

    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "Some entry",
      io: cap.io,
      config: { dir: cfgDir },
      cwd: outsidePath,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("not inside any project registered");
    expect(cap.err()).toContain("jarvis1 init");
  });

  test("fails when OPERATOR_RUNBOOK.md does not exist", () => {
    const runbookPath = join(cwd, "OPERATOR_RUNBOOK.md");
    rmSync(runbookPath);

    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "Some entry",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("OPERATOR_RUNBOOK.md not found");
    expect(cap.err()).toContain("jarvis1 init");
  });

  test("fails with empty entry text", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("Usage:");
  });

  test("fails with whitespace-only entry text", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "   \t  ",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("Usage:");
  });

  test("fails with unknown section", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "Some entry",
      section: "Unknown Section",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("unknown section");
    expect(cap.err()).toContain("Valid sections:");
    expect(cap.err()).toContain("Known gotchas");
    expect(cap.err()).toContain("Gate blind spots");
    expect(cap.err()).toContain("Cross-repo coordination");
  });

  test("fails with scaffold-present but non-list-safe section (Repos and gates)", () => {
    const runbookPath = join(cwd, "OPERATOR_RUNBOOK.md");
    const runbookBefore = readFileSync(runbookPath, "utf8");

    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "Some entry",
      section: "Repos and gates",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("unknown section");

    const runbookAfter = readFileSync(runbookPath, "utf8");
    expect(runbookAfter).toBe(runbookBefore);
  });

  test("fails with empty issue-url value", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "Some entry",
      issueUrl: "   ",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("Usage:");
  });

  test("accepts non-empty issue-url without format validation", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "Test entry",
      issueUrl: "not-a-valid-url",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(0);

    const runbook = readFileSync(join(cwd, "OPERATOR_RUNBOOK.md"), "utf8");
    expect(runbook).toContain("- Test entry ([jarvis issue](not-a-valid-url))");
  });

  test("bare runbook action shows usage", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("Usage:");
    expect(cap.err()).toContain("runbook add");
  });

  test("unknown action shows usage", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "invalid",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("Usage:");
  });

  test("entry text with leading/trailing whitespace is trimmed", () => {
    const cap = captureIo();
    const code = runbookCommand({
      action: "add",
      entry: "  Entry with spaces  ",
      io: cap.io,
      config: { dir: cfgDir },
      cwd,
    });
    expect(code).toBe(0);

    const runbook = readFileSync(join(cwd, "OPERATOR_RUNBOOK.md"), "utf8");
    expect(runbook).toContain("- Entry with spaces");
    expect(runbook).not.toContain("- Entry with spaces  ");
  });
});
