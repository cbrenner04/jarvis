// This test requires real git porcelain output contract.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGitPorcelainSnapshot } from "../../../src/modes/plan/git-porcelain.ts";

describe("readGitPorcelainSnapshot", () => {
  test("returns empty string for clean repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-porcelain-"));
    execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "t@e.st"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    expect(readGitPorcelainSnapshot(dir)).toBe("");
  });

  test("detects untracked file", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-porcelain-"));
    execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "t@e.st"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    writeFileSync(join(dir, "x.txt"), "y\n");
    const snap = readGitPorcelainSnapshot(dir);
    expect(snap).not.toBe("");
    expect(snap).toContain("x.txt");
  });

  test("returns null when cwd is not a git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-nogit-"));
    mkdirSync(join(dir, "only-dir"));
    expect(readGitPorcelainSnapshot(dir)).toBeNull();
  });
});
