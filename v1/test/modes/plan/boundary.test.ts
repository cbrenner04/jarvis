// Uses the SubprocessRunner seam (runner option) with a fake runner that returns
// canned `git status --porcelain=v1 -z` output and records invocations; no real git.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SubprocessRunner } from "../../../../shared/subprocess.ts";
import {
  appendBoundaryBlocker,
  assertPlanWriteBoundary,
  assertTargetRepoPlanBoundary,
  revertPaths,
} from "../../../src/modes/plan/boundary.ts";

function fakeRunner(porcelainOutput: string): SubprocessRunner & { calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  return {
    calls,
    run(cmd, args, cwd) {
      calls.push({ args: [cmd, ...args], cwd });
      if (cmd === "git" && args[0] === "status") return porcelainOutput;
      return "";
    },
  };
}

function porcelain(records: string[]): string {
  return records.length === 0 ? "" : records.join("\0") + "\0";
}

describe("assertPlanWriteBoundary", () => {
  const specName = "test-spec";

  test("clean tree returns ok: true", () => {
    const result = assertPlanWriteBoundary("/repo", specName, "spec", fakeRunner(""));
    expect(result.ok).toBe(true);
  });

  test("in-bounds write only returns ok: true", () => {
    const runner = fakeRunner(porcelain([" M spec/test-spec/01-test.md"]));
    const result = assertPlanWriteBoundary("/repo", specName, "spec", runner);
    expect(result.ok).toBe(true);
  });

  test("single out-of-bounds write returns offending path", () => {
    const runner = fakeRunner(porcelain([" M src/main.ts"]));
    const result = assertPlanWriteBoundary("/repo", specName, "spec", runner);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.offendingPaths).toContain("src/main.ts");
    }
  });

  test("mixed in-bounds and out-of-bounds returns only offending paths", () => {
    const runner = fakeRunner(
      porcelain([" M src/main.ts", " M README.md", "?? spec/test-spec/01-test.md"]),
    );
    const result = assertPlanWriteBoundary("/repo", specName, "spec", runner);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.offendingPaths.length).toBe(2);
      expect(result.offendingPaths).toContain("src/main.ts");
      expect(result.offendingPaths).toContain("README.md");
    }
  });

  test("deletion of out-of-bounds tracked file is detected", () => {
    const runner = fakeRunner(porcelain([" D src/main.ts"]));
    const result = assertPlanWriteBoundary("/repo", specName, "spec", runner);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.offendingPaths).toContain("src/main.ts");
    }
  });

  test("symlink path is judged by its own location, not its target", () => {
    // The boundary check operates on the path as reported by `git status`, not the
    // resolved symlink target: a symlink recorded under spec/<name>/ is in-bounds
    // even if it points outside that directory.
    const runner = fakeRunner(porcelain(["?? spec/test-spec/link.ts"]));
    const result = assertPlanWriteBoundary("/repo", specName, "spec", runner);
    expect(result.ok).toBe(true);
  });

  test("git status failure returns ok: false with a placeholder path", () => {
    const runner: SubprocessRunner = {
      run() {
        throw new Error("git status failed");
      },
    };
    const result = assertPlanWriteBoundary("/repo", specName, "spec", runner);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.offendingPaths).toContain("(git status failed)");
    }
  });
});

describe("assertTargetRepoPlanBoundary", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "boundary-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("flags changes under spec/", () => {
    mkdirSync(join(tempDir, ".git"));
    const runner = fakeRunner(porcelain(["?? spec/other/intent.md"]));
    const result = assertTargetRepoPlanBoundary(tempDir, runner);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.offendingPaths.some((p) => p.startsWith("spec/"))).toBe(true);
    }
  });

  test("returns ok for non-git root without invoking the runner", () => {
    const runner = fakeRunner("");
    const result = assertTargetRepoPlanBoundary(tempDir, runner);
    expect(result.ok).toBe(true);
    expect(runner.calls.length).toBe(0);
  });
});

describe("revertPaths", () => {
  test("checks out and cleans each path via git", () => {
    const runner = fakeRunner("");
    revertPaths("/repo", ["src/main.ts", "README.md"], runner);
    expect(runner.calls).toEqual([
      { args: ["git", "checkout", "--", "src/main.ts"], cwd: "/repo" },
      { args: ["git", "clean", "-fd", "--", "src/main.ts"], cwd: "/repo" },
      { args: ["git", "checkout", "--", "README.md"], cwd: "/repo" },
      { args: ["git", "clean", "-fd", "--", "README.md"], cwd: "/repo" },
    ]);
  });

  test("no-ops for an empty path list", () => {
    const runner = fakeRunner("");
    revertPaths("/repo", [], runner);
    expect(runner.calls.length).toBe(0);
  });
});

describe("appendBoundaryBlocker", () => {
  let tempDir: string;
  let specDir: string;
  const specName = "test-spec";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "boundary-blocker-"));
    specDir = join(tempDir, "spec", specName);
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "intent.md"), "# Test Intent\n");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("adds blocker section to intent.md", () => {
    const intentPath = join(specDir, "intent.md");
    const offendingPaths = ["src/main.ts", "README.md"];

    appendBoundaryBlocker(specDir, specName, offendingPaths);

    const content = readFileSync(intentPath, "utf8");
    expect(content).toContain("## Blocker");
    expect(content).toContain("Out-of-bounds write detected");
    expect(content).toContain("`src/main.ts`");
    expect(content).toContain("`README.md`");
  });

  test("replaces existing blocker section", () => {
    const intentPath = join(specDir, "intent.md");
    const oldBlocker = "## Blocker\n\nOld blocker content";
    writeFileSync(intentPath, `# Intent\n\n${oldBlocker}`, "utf8");

    appendBoundaryBlocker(specDir, specName, ["src/main.ts"]);

    const content = readFileSync(intentPath, "utf8");
    expect(content).not.toContain("Old blocker content");
    expect(content).toContain("Out-of-bounds write detected");
  });
});
