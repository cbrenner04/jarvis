import { describe, expect, test } from "bun:test";
import { branchExistsLocal, branchExistsOnOrigin, getCurrentBranch, isGitRepo, isWorktreeDirty } from "./git.ts";
import type { SubprocessRunner } from "./subprocess.ts";

/** Fake runner: resolves canned results by exact `cmd args` match, records argv+cwd. */
function fakeRunner(
  results: Record<string, string | Error>,
): SubprocessRunner & { calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  return {
    calls,
    run(cmd, args, cwd) {
      calls.push({ args: [cmd, ...args], cwd });
      const key = [cmd, ...args].join(" ");
      const result = results[key];
      if (result === undefined) throw new Error(`fakeRunner: no canned result for "${key}"`);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe("branchExistsLocal", () => {
  test("true for an existing branch, false otherwise", () => {
    const runner = fakeRunner({
      "git rev-parse --verify feature": "abc123\n",
      "git rev-parse --verify nope": new Error("not a valid ref"),
    });
    expect(branchExistsLocal("/repo", "feature", runner)).toBe(true);
    expect(branchExistsLocal("/repo", "nope", runner)).toBe(false);
    expect(runner.calls).toEqual([
      { args: ["git", "rev-parse", "--verify", "feature"], cwd: "/repo" },
      { args: ["git", "rev-parse", "--verify", "nope"], cwd: "/repo" },
    ]);
  });
});

describe("branchExistsOnOrigin", () => {
  test("true only after the branch is fetched into a remote-tracking ref", () => {
    const beforeFetch = fakeRunner({
      "git rev-parse --verify origin/main": new Error("not a valid ref"),
    });
    expect(branchExistsOnOrigin("/repo", "main", beforeFetch)).toBe(false);

    const afterFetch = fakeRunner({
      "git rev-parse --verify origin/main": "def456\n",
      "git rev-parse --verify origin/nope": new Error("not a valid ref"),
    });
    expect(branchExistsOnOrigin("/repo", "main", afterFetch)).toBe(true);
    expect(branchExistsOnOrigin("/repo", "nope", afterFetch)).toBe(false);
  });
});

describe("getCurrentBranch", () => {
  test("returns the checked-out branch", () => {
    const runner = fakeRunner({
      "git rev-parse --abbrev-ref HEAD": "main\n",
    });
    expect(getCurrentBranch("/repo", runner)).toBe("main");

    const afterCheckout = fakeRunner({
      "git rev-parse --abbrev-ref HEAD": "feature\n",
    });
    expect(getCurrentBranch("/repo", afterCheckout)).toBe("feature");
  });
});

describe("isWorktreeDirty", () => {
  test("true when git status --porcelain reports changes, false when clean", () => {
    const dirty = fakeRunner({ "git status --porcelain": " M src/file.ts\n" });
    expect(isWorktreeDirty("/repo", dirty)).toBe(true);

    const clean = fakeRunner({ "git status --porcelain": "" });
    expect(isWorktreeDirty("/repo", clean)).toBe(false);
  });
});

describe("isGitRepo", () => {
  test("uses the injected runner", () => {
    const repo = fakeRunner({ "git rev-parse --is-inside-work-tree": "true\n" });
    const plainDirectory = fakeRunner({ "git rev-parse --is-inside-work-tree": new Error("not a repository") });

    expect(isGitRepo("/repo", repo)).toBe(true);
    expect(isGitRepo("/plain", plainDirectory)).toBe(false);
  });
});
