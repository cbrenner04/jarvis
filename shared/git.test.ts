import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchExistsLocal, branchExistsOnOrigin, getCurrentBranch } from "./git.ts";

let repo: string;

function git(args: string[], cwd = repo): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "git-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  git(["commit", "-q", "--allow-empty", "-m", "init"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("branchExistsLocal", () => {
  test("true for an existing branch, false otherwise", () => {
    git(["branch", "feature"]);
    expect(branchExistsLocal(repo, "feature")).toBe(true);
    expect(branchExistsLocal(repo, "nope")).toBe(false);
  });
});

describe("branchExistsOnOrigin", () => {
  test("true only after the branch is fetched into a remote-tracking ref", () => {
    const remote = mkdtempSync(join(tmpdir(), "remote-"));
    git(["init", "-q", "--bare"], remote);
    git(["remote", "add", "origin", remote]);
    git(["push", "-q", "origin", "main"]);
    git(["fetch", "-q", "origin"]);
    expect(branchExistsOnOrigin(repo, "main")).toBe(true);
    expect(branchExistsOnOrigin(repo, "nope")).toBe(false);
    rmSync(remote, { recursive: true, force: true });
  });
});

describe("getCurrentBranch", () => {
  test("returns the checked-out branch", () => {
    expect(getCurrentBranch(repo)).toBe("main");
    git(["checkout", "-q", "-b", "feature"]);
    expect(getCurrentBranch(repo)).toBe("feature");
  });
});
