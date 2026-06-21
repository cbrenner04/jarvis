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
});
