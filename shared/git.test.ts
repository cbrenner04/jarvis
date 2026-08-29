import { afterEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  branchExistsLocal,
  branchExistsOnOrigin,
  getCurrentBranch,
  getGitStatusInventory,
  isWorktreeDirty,
} from "./git.ts";
import type { AsyncSubprocessRunner, SubprocessRunner } from "./subprocess.ts";

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

function fakeAsyncRunner(output: string): AsyncSubprocessRunner & { calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  return {
    calls,
    async runAsync(cmd, args, cwd) {
      calls.push({ args: [cmd, ...args], cwd });
      return output;
    },
  };
}

describe("getGitStatusInventory", () => {
  const fixtureRoots: string[] = [];

  afterEach(() => {
    for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("inventory preserves typed porcelain entries including exact UTF-8 path text", async () => {
    // @mutate shared/git.ts "const originalPath = fields[index];" -> "const originalPath = undefined;"
    // @mutate shared/git.ts "const kind = twoPathKind(stagedCode, worktreeCode);" -> "const kind = undefined;"
    const stagedRenameCurrent = " staged rename current \n";
    const stagedRenameOriginal = " staged rename original \n";
    const worktreeRenameCurrent = "\nworktree rename current ";
    const worktreeRenameOriginal = "\nworktree rename original ";
    const stagedCopyCurrent = " staged copy current ";
    const stagedCopyOriginal = " staged copy original ";
    const worktreeCopyCurrent = " worktree copy current\n ";
    const worktreeCopyOriginal = " worktree copy original\n ";
    const output = [
      " M ordinary space.txt",
      "A  café\nfile.txt",
      "?? untracked/雪.txt",
      `R  ${stagedRenameCurrent}`,
      stagedRenameOriginal,
      ` R ${worktreeRenameCurrent}`,
      worktreeRenameOriginal,
      `C  ${stagedCopyCurrent}`,
      stagedCopyOriginal,
      ` C ${worktreeCopyCurrent}`,
      worktreeCopyOriginal,
      "",
    ].join("\0");
    const runner = fakeAsyncRunner(output);

    expect(await getGitStatusInventory("/repo", runner)).toEqual([
      { kind: "ordinary", stagedStatus: "unmodified", worktreeStatus: "modified", currentPath: "ordinary space.txt" },
      { kind: "ordinary", stagedStatus: "added", worktreeStatus: "unmodified", currentPath: "café\nfile.txt" },
      { kind: "ordinary", stagedStatus: "untracked", worktreeStatus: "untracked", currentPath: "untracked/雪.txt" },
      {
        kind: "rename",
        stagedStatus: "renamed",
        worktreeStatus: "unmodified",
        currentPath: stagedRenameCurrent,
        originalPath: stagedRenameOriginal,
      },
      {
        kind: "rename",
        stagedStatus: "unmodified",
        worktreeStatus: "renamed",
        currentPath: worktreeRenameCurrent,
        originalPath: worktreeRenameOriginal,
      },
      {
        kind: "copy",
        stagedStatus: "copied",
        worktreeStatus: "unmodified",
        currentPath: stagedCopyCurrent,
        originalPath: stagedCopyOriginal,
      },
      {
        kind: "copy",
        stagedStatus: "unmodified",
        worktreeStatus: "copied",
        currentPath: worktreeCopyCurrent,
        originalPath: worktreeCopyOriginal,
      },
    ]);
    expect(runner.calls).toEqual([
      { args: ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd: "/repo" },
    ]);
  });

  test("inventory expands nested untracked files", async () => {
    // @mutate shared/git.ts "\"--untracked-files=all\"" -> ""
    const scratchRoot = join(process.cwd(), ".scratch");
    mkdirSync(scratchRoot, { recursive: true });
    const repo = mkdtempSync(join(scratchRoot, "git-inventory-"));
    fixtureRoots.push(repo);
    execSync("git init", { cwd: repo });
    mkdirSync(join(repo, "nested", "deeper"), { recursive: true });
    writeFileSync(join(repo, "nested", "one.txt"), "one\n");
    writeFileSync(join(repo, "nested", "deeper", "two.txt"), "two\n");

    expect((await getGitStatusInventory(repo)).map((entry) => entry.currentPath).sort()).toEqual([
      "nested/deeper/two.txt",
      "nested/one.txt",
    ]);
  });

  test("inventory rejects malformed porcelain output", async () => {
    // @mutate shared/git.ts "if (record.length < 4 || record[2] !== \" \")" -> "if (false)"
    // @mutate shared/git.ts "if (originalPath === undefined || originalPath.length === 0)" -> "if (false)"
    // @mutate shared/git.ts "if (!output.endsWith(\"\\0\"))" -> "if (false)"
    await expect(getGitStatusInventory("/repo", fakeAsyncRunner(" M\0"))).rejects.toThrow("truncated record");
    await expect(getGitStatusInventory("/repo", fakeAsyncRunner("R  current\0"))).rejects.toThrow(
      "missing rename or copy origin",
    );
    await expect(getGitStatusInventory("/repo", fakeAsyncRunner(" M path"))).rejects.toThrow("missing terminal NUL");
  });
});

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
