import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { ReviewCycleInput } from "./review-cycle.ts";
import {
  checkVerdictOwnershipBefore,
  discardSnapshot,
  executeReviewCycleEnforced,
  getChangedPaths,
  restoreWorkingTree,
  snapshotWorkingTree,
  VERDICT_FILE,
} from "./review-intent-enforcement.ts";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "review-intent-enforcement-"));
}

function mockGitStatusRunner(inventoryOutput: string): AsyncSubprocessRunner {
  return {
    runAsync: async (cmd, args) => {
      if (cmd === "git" && args[0] === "status") return inventoryOutput;
      throw new Error(`unexpected: ${cmd} ${args.join(" ")}`);
    },
  };
}

async function changedPathsFromInventory(inventoryOutput: string): Promise<Set<string>> {
  const repo = dir();
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const before = await snapshotWorkingTree(repo);
  const changed = await getChangedPaths(repo, before, mockGitStatusRunner(inventoryOutput));
  discardSnapshot(before);
  return changed;
}

describe("review-intent-enforcement", () => {
  test("checkVerdictOwnershipBefore: missing verdict file is owned by this invocation", () => {
    const path = join(dir(), "verdict.md");
    const result = checkVerdictOwnershipBefore(path, "inv-1");
    expect(result.kind).toBe("owned");
  });

  test("checkVerdictOwnershipBefore: empty verdict file with no marker is treated as owned", () => {
    const parent = dir();
    const path = join(parent, VERDICT_FILE);
    writeFileSync(path, "", "utf8");
    const result = checkVerdictOwnershipBefore(path, "inv-1");
    expect(result.kind).toBe("owned");
  });

  test("checkVerdictOwnershipBefore: non-empty verdict file with no marker is treated as foreign", () => {
    const parent = dir();
    const path = join(parent, VERDICT_FILE);
    writeFileSync(path, "some verdict content\n", "utf8");
    const result = checkVerdictOwnershipBefore(path, "inv-1");
    expect(result.kind).toBe("foreign");
  });

  test("checkVerdictOwnershipBefore: marker matching this invocation is owned regardless of content", () => {
    const parent = dir();
    const path = join(parent, VERDICT_FILE);
    writeFileSync(path, "partial verdict\n", "utf8");
    writeFileSync(`${path}.owner`, "inv-1", "utf8");
    const result = checkVerdictOwnershipBefore(path, "inv-1");
    expect(result).toEqual({ kind: "owned", invocationId: "inv-1" });
  });

  test("checkVerdictOwnershipBefore: marker from a different invocation is foreign", () => {
    const parent = dir();
    const path = join(parent, VERDICT_FILE);
    writeFileSync(path, "", "utf8");
    writeFileSync(`${path}.owner`, "inv-other", "utf8");
    const result = checkVerdictOwnershipBefore(path, "inv-1");
    expect(result.kind).toBe("foreign");
  });

  test("VERDICT_FILE constant has correct name", () => {
    expect(VERDICT_FILE).toBe(".jarvis-intent-review-verdict.md");
  });

  test("git-enabled: getChangedPaths preserves path when first porcelain line is unstaged tracked", async () => {
    const path = ".jarvis-intent-stage/one.md";
    expect((await changedPathsFromInventory(` M ${path}\0`)).has(path)).toBe(true);
  });

  test("git-enabled: getChangedPaths preserves every path for mixed untracked and staged lines", async () => {
    const untracked = "new-file.md";
    const staged = "staged-file.md";
    const changed = await changedPathsFromInventory(`?? ${untracked}\0A  ${staged}\0`);
    expect(changed.has(untracked)).toBe(true);
    expect(changed.has(staged)).toBe(true);
  });

  test("git-enabled: getChangedPaths records rename destination path", async () => {
    const dest = "new-name.md";
    const changed = await changedPathsFromInventory(`R  ${dest}\0old-name.md\0`);
    expect(changed.has(dest)).toBe(true);
    expect(changed.has("old-name.md")).toBe(false);
  });

  test("git-enabled: getChangedPaths preserves lossless status paths", async () => {
    // @mutate v2/src/execution/review-intent-enforcement.ts "return new Set(inventory.map((entry) => entry.currentPath));" -> "return new Set(inventory.map((entry) => entry.currentPath.trim()));"
    const paths = ["space path.md", "line\nbreak.md", "café/雪.md", " leading-and-trailing.md "];
    const changed = await changedPathsFromInventory(paths.map((path) => `?? ${path}\0`).join(""));
    expect(changed).toEqual(new Set(paths));
  });

  test("git-enabled: getChangedPaths detects an edit outside the staging directory", async () => {
    const repo = dir();
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
    writeFileSync(join(repo, "tracked.txt"), "base\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: repo });

    const before = await snapshotWorkingTree(repo);
    writeFileSync(join(repo, "rogue.txt"), "unauthorized\n", "utf8");
    const changed = await getChangedPaths(repo, before);
    expect(changed.has("rogue.txt")).toBe(true);
    discardSnapshot(before);
  });

  test("git-disabled: getChangedPaths detects an edit outside the staging directory", async () => {
    const plain = dir();
    writeFileSync(join(plain, "tracked.txt"), "base\n", "utf8");

    const before = await snapshotWorkingTree(plain);
    expect(before.kind).toBe("fs");
    writeFileSync(join(plain, "rogue.txt"), "unauthorized\n", "utf8");
    const changed = await getChangedPaths(plain, before);
    expect(changed.has("rogue.txt")).toBe(true);
    discardSnapshot(before);
  });

  test("git-disabled: getChangedPaths detects an in-place content edit", async () => {
    const plain = dir();
    writeFileSync(join(plain, "tracked.txt"), "base\n", "utf8");

    const before = await snapshotWorkingTree(plain);
    writeFileSync(join(plain, "tracked.txt"), "modified\n", "utf8");
    const changed = await getChangedPaths(plain, before);
    expect(changed.has("tracked.txt")).toBe(true);
    discardSnapshot(before);
  });

  test("git-disabled: restoreWorkingTree discards unauthorized changes", async () => {
    const plain = dir();
    writeFileSync(join(plain, "tracked.txt"), "base\n", "utf8");

    const before = await snapshotWorkingTree(plain);
    writeFileSync(join(plain, "tracked.txt"), "modified\n", "utf8");
    writeFileSync(join(plain, "rogue.txt"), "unauthorized\n", "utf8");
    await restoreWorkingTree(plain, before);
    discardSnapshot(before);

    expect(readFileSync(join(plain, "tracked.txt"), "utf8")).toBe("base\n");
    expect(existsSync(join(plain, "rogue.txt"))).toBe(false);
  });

  test("git-disabled: getChangedPaths allows edits confined to the staging directory", async () => {
    const plain = dir();
    const stagingDir = join(plain, ".jarvis-intent-stage");
    mkdirSync(stagingDir, { recursive: true });

    const before = await snapshotWorkingTree(plain);
    writeFileSync(join(stagingDir, "one.md"), "content\n", "utf8");
    const changed = await getChangedPaths(plain, before);
    expect(Array.from(changed)).toEqual([".jarvis-intent-stage/one.md"]);
    discardSnapshot(before);
    rmSync(plain, { recursive: true, force: true });
  });

  test("git-enabled: executeReviewCycleEnforced names unmangled outside path when first porcelain line is unstaged tracked", async () => {
    const repo = dir();
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
    writeFileSync(join(repo, "base.txt"), "base\n", "utf8");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: repo });

    const stagingDir = join(repo, ".jarvis-intent-stage");
    mkdirSync(stagingDir, { recursive: true });
    const verdictPath = join(repo, VERDICT_FILE);
    const outsidePath = "rogue-outside.txt";

    const result = await executeReviewCycleEnforced({
      input: {
        cwd: repo,
        prompt: "inspect",
        verdictPath,
        maxCycles: 1,
        bindings: {
          critic: [{ id: "critic", invoke: async () => ({ kind: "ok" as const, stdout: "", stderr: "" }) }],
          actuator: [],
        },
      },
      invocationId: "inv-1",
      stagingDir,
      cwd: repo,
      verdictPath,
      runner: mockGitStatusRunner(` M ${outsidePath}\0`),
    });

    expect(result.boundaryViolation).toContain("modified files outside");
    expect(result.boundaryViolation).toContain(outsidePath);
  });

  test("git-enabled: getChangedPaths reports shared-inventory inspection failure", async () => {
    const repo = dir();
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const verdictPath = join(repo, VERDICT_FILE);
    const input: ReviewCycleInput = {
      cwd: repo,
      prompt: "inspect",
      verdictPath,
      maxCycles: 1,
      bindings: {
        critic: [{ id: "critic", invoke: async () => ({ kind: "ok" as const, stdout: "", stderr: "" }) }],
        actuator: [],
      },
    };
    const result = await executeReviewCycleEnforced({
      input,
      invocationId: "inv-1",
      stagingDir: join(repo, ".jarvis-intent-stage"),
      cwd: repo,
      verdictPath,
      runner: { runAsync: async () => Promise.reject(new Error("git status denied")) },
    });
    expect(result.boundaryViolation).toContain("git status denied");
  });
});
