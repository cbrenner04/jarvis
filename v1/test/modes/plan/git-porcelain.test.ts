// Uses the SubprocessRunner seam (runner option) with a fake runner; no real git.
import { describe, expect, test } from "bun:test";
import type { SubprocessRunner } from "../../../../shared/subprocess.ts";
import { readGitPorcelainSnapshot } from "../../../src/modes/plan/git-porcelain.ts";

function fakeRunner(result: string | Error): SubprocessRunner {
  return {
    run() {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe("readGitPorcelainSnapshot", () => {
  test("returns empty string for clean repo", () => {
    expect(readGitPorcelainSnapshot("/repo", fakeRunner(""))).toBe("");
  });

  test("detects untracked file", () => {
    const snap = readGitPorcelainSnapshot("/repo", fakeRunner("?? x.txt\n"));
    expect(snap).not.toBe("");
    expect(snap).toContain("x.txt");
  });

  test("returns null when cwd is not a git repo", () => {
    expect(readGitPorcelainSnapshot("/not-a-repo", fakeRunner(new Error("not a git repository")))).toBeNull();
  });
});
