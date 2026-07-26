import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { branchExistsLocal, branchExistsOnOrigin, getCurrentBranch, isWorktreeDirty } from "./git.ts";
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
  test("true only when ls-remote reports a head", () => {
    const exists = fakeRunner({
      "git ls-remote --heads origin main": "abc123\trefs/heads/main\n",
      "git ls-remote --heads origin nope": "",
    });
    expect(branchExistsOnOrigin("/repo", "main", exists)).toBe(true);
    expect(branchExistsOnOrigin("/repo", "nope", exists)).toBe(false);
    expect(exists.calls).toEqual([
      { args: ["git", "ls-remote", "--heads", "origin", "main"], cwd: "/repo" },
      { args: ["git", "ls-remote", "--heads", "origin", "nope"], cwd: "/repo" },
    ]);

    const lsRemoteFails = fakeRunner({
      "git ls-remote --heads origin main": new Error("no origin"),
    });
    expect(branchExistsOnOrigin("/repo", "main", lsRemoteFails)).toBe(false);
  });

  const fixtureRoots: string[] = [];

  afterEach(() => {
    for (const root of fixtureRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("false when only a stale origin tracking ref remains", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-git-stale-origin-"));
    fixtureRoots.push(root);
    const bare = join(root, "origin.git");
    const repo = join(root, "repo");
    mkdirSync(repo, { recursive: true });
    execSync(`git init --bare ${bare}`);
    execSync("git init -b main", { cwd: repo });
    execSync('git config user.email "t@example.com"', { cwd: repo });
    execSync('git config user.name "t"', { cwd: repo });
    execSync(`git remote add origin ${bare}`, { cwd: repo });
    writeFileAndCommit(repo, "README.md", "seed\n", "init");
    execSync("git push -u origin main", { cwd: repo });
    execSync("git checkout -b feature", { cwd: repo });
    writeFileAndCommit(repo, "feature.txt", "x\n", "feature");
    execSync("git push -u origin feature", { cwd: repo });
    execSync("git update-ref -d refs/heads/feature", { cwd: bare });
    execSync("git checkout main", { cwd: repo });

    expect(execSync("git rev-parse --verify origin/feature", { cwd: repo, encoding: "utf8" }).trim()).toMatch(
      /^[0-9a-f]{40}$/,
    );
    expect(branchExistsOnOrigin(repo, "feature")).toBe(false);
  });
});

function writeFileAndCommit(repo: string, relPath: string, body: string, message: string): void {
  writeFileSync(join(repo, relPath), body);
  execSync(`git add ${relPath} && git commit -m ${message}`, { cwd: repo });
}

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
