import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkVerdictOwnershipBefore,
  discardSnapshot,
  getChangedPaths,
  restoreWorkingTree,
  snapshotWorkingTree,
  VERDICT_FILE,
} from "./review-intent-enforcement.ts";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "review-intent-enforcement-"));
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
});
