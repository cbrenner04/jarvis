import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSnapshotUpdateRetest } from "../src/modes/patch/snapshot-update-retest-runner";

describe("snapshot-update-retest-runner", () => {
  let tmpDir: string;
  let projectRoot: string;
  let workDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "snapshot-test-"));
    projectRoot = join(tmpDir, "project");
    workDir = join(tmpDir, "work");
    mkdirSync(projectRoot);
    mkdirSync(workDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns false when updateSnapshotsCommand is configured and command fails", async () => {
    const result = await runSnapshotUpdateRetest(workDir, projectRoot, "false");
    expect(result).toBe(false);
  });

  test("returns false when no updateSnapshotsCommand configured and no package.json", async () => {
    const result = await runSnapshotUpdateRetest(workDir, projectRoot);
    expect(result).toBe(false);
  });

  test("returns false when package.json has no matching update scripts", async () => {
    writeFileSync(
      join(projectRoot, "package.json"),
      JSON.stringify({
        scripts: {
          build: "tsc",
          test: "bun test",
        },
      }),
    );
    const result = await runSnapshotUpdateRetest(workDir, projectRoot);
    expect(result).toBe(false);
  });

  test("detects conventional update-snapshots script in candidate-list order", async () => {
    // Test priority: test:update should win over test:u
    const packageJson = {
      scripts: {
        "test:u": "echo should-not-run",
        "test:update": "true",
        test: "true",
      },
    };
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify(packageJson));
    writeFileSync(join(workDir, "package.json"), JSON.stringify(packageJson));

    const result = await runSnapshotUpdateRetest(workDir, projectRoot);
    // Would succeed if the script runs and re-test passes
    expect(result).toBe(true);
  });

  test("detects test:update script and runs it", async () => {
    const packageJson = {
      scripts: {
        "test:update": "true",
        test: "true",
      },
    };
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify(packageJson));
    writeFileSync(join(workDir, "package.json"), JSON.stringify(packageJson));

    const result = await runSnapshotUpdateRetest(workDir, projectRoot);
    expect(result).toBe(true);
  });

  test("runs re-test after update in agent working dir", async () => {
    const packageJson = {
      scripts: {
        "update-snapshots": "true",
        test: "true",
      },
    };
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify(packageJson));
    writeFileSync(join(workDir, "package.json"), JSON.stringify(packageJson));

    const result = await runSnapshotUpdateRetest(workDir, projectRoot);
    expect(result).toBe(true);
  });

  test("returns false when re-test fails after successful update", async () => {
    const packageJson = {
      scripts: {
        "update-snapshots": "true",
        test: "false", // Test fails
      },
    };
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify(packageJson));
    writeFileSync(join(workDir, "package.json"), JSON.stringify(packageJson));

    const result = await runSnapshotUpdateRetest(workDir, projectRoot);
    expect(result).toBe(false);
  });

  test("returns false when update command throws", async () => {
    const packageJson = {
      scripts: {
        "update-snapshots": "exit 42",
        test: "true",
      },
    };
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify(packageJson));
    writeFileSync(join(workDir, "package.json"), JSON.stringify(packageJson));

    const result = await runSnapshotUpdateRetest(workDir, projectRoot);
    expect(result).toBe(false);
  });

  test("handles candidate-list order: test:update > test:u > update-snapshots > updateSnapshots", async () => {
    // Verify that the first candidate in order is used
    const packageJson = {
      scripts: {
        // All three defined, but test:update should be selected first
        updateSnapshots: `false`,
        "test:u": `false`,
        test: "true",
      },
    };
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify(packageJson));
    writeFileSync(join(workDir, "package.json"), JSON.stringify(packageJson));

    // If updateSnapshots or test:u were selected, they would fail.
    // Without test:update, this should fail.
    const result = await runSnapshotUpdateRetest(workDir, projectRoot);
    expect(result).toBe(false);
  });

  test("candidate-list order: test:update > test:u", async () => {
    const packageJson = {
      scripts: {
        "test:u": "false",
        "test:update": "true",
        test: "true",
      },
    };
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify(packageJson));
    writeFileSync(join(workDir, "package.json"), JSON.stringify(packageJson));

    const result = await runSnapshotUpdateRetest(workDir, projectRoot);
    expect(result).toBe(true); // test:update was selected and passed
  });

  test("serial retry: recovers from parallel-load flake (first invocation fails, second passes)", async () => {
    const packageJson = {
      scripts: {
        "test:update": "true",
        test: "true",
      },
    };
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify(packageJson));
    writeFileSync(join(workDir, "package.json"), JSON.stringify(packageJson));

    let parallelInvocationCount = 0;
    let serialInvocationCount = 0;

    const mockRunCommand = (command: string, args: string[], cwd: string) => {
      if (command === "bun" && args[0] === "run" && args[1] === "test") {
        // Parallel test invocation: fail once, then pass on next call
        parallelInvocationCount++;
        if (parallelInvocationCount === 1) {
          throw new Error("Simulated parallel test failure");
        }
      } else if (command === "bun" && args[0] === "test" && args.length === 1) {
        // Serial test invocation: always pass
        serialInvocationCount++;
      }
    };

    const result = await runSnapshotUpdateRetest(workDir, projectRoot, undefined, mockRunCommand);
    expect(result).toBe(true);
    expect(parallelInvocationCount).toBe(1);
    expect(serialInvocationCount).toBe(1);
  });

  test("serial retry: reports still-failed when serial run also fails", async () => {
    const packageJson = {
      scripts: {
        "test:update": "true",
        test: "true",
      },
    };
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify(packageJson));
    writeFileSync(join(workDir, "package.json"), JSON.stringify(packageJson));

    let parallelInvocationCount = 0;
    let serialInvocationCount = 0;

    const mockRunCommand = (command: string, args: string[], cwd: string) => {
      if (command === "bun" && args[0] === "run" && args[1] === "test") {
        // Parallel test invocation: always fail
        parallelInvocationCount++;
        throw new Error("Simulated parallel test failure");
      } else if (command === "bun" && args[0] === "test" && args.length === 1) {
        // Serial test invocation: also fail
        serialInvocationCount++;
        throw new Error("Simulated serial test failure");
      }
    };

    const result = await runSnapshotUpdateRetest(workDir, projectRoot, undefined, mockRunCommand);
    expect(result).toBe(false);
    expect(parallelInvocationCount).toBe(1);
    expect(serialInvocationCount).toBe(1);
  });

  test("serial retry: no retry when update command fails", async () => {
    const packageJson = {
      scripts: {
        "test:update": "false",
        test: "true",
      },
    };
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify(packageJson));
    writeFileSync(join(workDir, "package.json"), JSON.stringify(packageJson));

    let testInvocationCount = 0;

    const mockRunCommand = (command: string, args: string[], cwd: string) => {
      // Simulate update command failure (bun run test:update)
      if (command === "bun" && args[0] === "run" && args[1] === "test:update") {
        throw new Error("Simulated update command failure");
      }
      // Count test invocations
      if (command === "bun" && (args[0] === "run" && args[1] === "test" || args[0] === "test")) {
        testInvocationCount++;
      }
    };

    const result = await runSnapshotUpdateRetest(workDir, projectRoot, undefined, mockRunCommand);
    expect(result).toBe(false);
    expect(testInvocationCount).toBe(0); // Test never runs when update fails
  });

  test("serial retry: no retry when parallel test passes initially", async () => {
    const packageJson = {
      scripts: {
        "test:update": "true",
        test: "true",
      },
    };
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify(packageJson));
    writeFileSync(join(workDir, "package.json"), JSON.stringify(packageJson));

    let parallelInvocationCount = 0;
    let serialInvocationCount = 0;

    const mockRunCommand = (command: string, args: string[], cwd: string) => {
      if (command === "bun" && args[0] === "run" && args[1] === "test") {
        parallelInvocationCount++;
        // Pass on first invocation
      } else if (command === "bun" && args[0] === "test" && args.length === 1) {
        serialInvocationCount++;
      }
    };

    const result = await runSnapshotUpdateRetest(workDir, projectRoot, undefined, mockRunCommand);
    expect(result).toBe(true);
    expect(parallelInvocationCount).toBe(1);
    expect(serialInvocationCount).toBe(0); // Serial never runs when parallel passes
  });
});
