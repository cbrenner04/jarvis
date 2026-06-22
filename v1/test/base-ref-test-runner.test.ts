import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runBaseRefTests } from "../src/modes/patch/base-ref-test-runner";

describe("base-ref-test-runner", () => {
  let tmpDir: string;
  let projectRoot: string;
  let gitDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "base-ref-test-"));
    projectRoot = join(tmpDir, "project");
    gitDir = join(projectRoot, ".git");
    mkdirSync(projectRoot);

    // Initialize git repo
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: projectRoot,
      stdio: "pipe",
    });
    execFileSync("git", ["config", "user.name", "Test User"], {
      cwd: projectRoot,
      stdio: "pipe",
    });

    // Create initial commit on main
    writeFileSync(join(projectRoot, "test.txt"), "test");
    execFileSync("git", ["add", "."], { cwd: projectRoot, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: projectRoot, stdio: "pipe" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns false when merge-base resolution fails", async () => {
    const result = await runBaseRefTests(projectRoot, "non-existent-branch");
    expect(result).toBe(false);
  });

  test("returns false when test fails", async () => {
    let testInvocationCount = 0;

    const mockRunCommand = (command: string, args: string[], cwd: string) => {
      if (command === "bun" && args[0] === "run" && args[1] === "test") {
        testInvocationCount++;
        throw new Error("Simulated test failure");
      } else if (command === "bun" && args[0] === "test" && args.length === 1) {
        // Serial: also fail
        throw new Error("Simulated serial test failure");
      }
    };

    const result = await runBaseRefTests(projectRoot, "main", mockRunCommand);
    expect(result).toBe(false);
    expect(testInvocationCount).toBe(1);
  });

  test("serial retry: recovers from parallel-load flake", async () => {
    let parallelInvocationCount = 0;
    let serialInvocationCount = 0;

    const mockRunCommand = (command: string, args: string[], cwd: string) => {
      if (command === "bun" && args[0] === "run" && args[1] === "test") {
        parallelInvocationCount++;
        throw new Error("Simulated parallel test failure");
      } else if (command === "bun" && args[0] === "test" && args.length === 1) {
        serialInvocationCount++;
        // Serial pass: recovery
      }
    };

    const result = await runBaseRefTests(projectRoot, "main", mockRunCommand);
    expect(result).toBe(true);
    expect(parallelInvocationCount).toBe(1);
    expect(serialInvocationCount).toBe(1);
  });

  test("serial retry: reports still-failed when serial also fails", async () => {
    let parallelInvocationCount = 0;
    let serialInvocationCount = 0;

    const mockRunCommand = (command: string, args: string[], cwd: string) => {
      if (command === "bun" && args[0] === "run" && args[1] === "test") {
        parallelInvocationCount++;
        throw new Error("Simulated parallel test failure");
      } else if (command === "bun" && args[0] === "test" && args.length === 1) {
        serialInvocationCount++;
        throw new Error("Simulated serial test failure");
      }
    };

    const result = await runBaseRefTests(projectRoot, "main", mockRunCommand);
    expect(result).toBe(false);
    expect(parallelInvocationCount).toBe(1);
    expect(serialInvocationCount).toBe(1);
  });

  test("serial retry: no retry when parallel test passes", async () => {
    let parallelInvocationCount = 0;
    let serialInvocationCount = 0;

    const mockRunCommand = (command: string, args: string[], cwd: string) => {
      if (command === "bun" && args[0] === "run" && args[1] === "test") {
        parallelInvocationCount++;
        // Parallel pass: no retry needed
      } else if (command === "bun" && args[0] === "test" && args.length === 1) {
        serialInvocationCount++;
      }
    };

    const result = await runBaseRefTests(projectRoot, "main", mockRunCommand);
    expect(result).toBe(true);
    expect(parallelInvocationCount).toBe(1);
    expect(serialInvocationCount).toBe(0);
  });
});
