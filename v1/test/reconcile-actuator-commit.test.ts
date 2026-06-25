import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reconcileActuatorCommit, RebaseConflictError } from "../src/worktree.ts";

let localDir = "";
let remoteDir = "";

beforeEach(() => {
  // Create a bare remote repo
  remoteDir = mkdtempSync(join(tmpdir(), "jarvis-remote-"));
  execSync("git init --bare", { cwd: remoteDir });

  // Create local repo
  localDir = mkdtempSync(join(tmpdir(), "jarvis-local-"));
  execSync("git init -b main", { cwd: localDir });
  execSync('git config user.email "test@example.com"', { cwd: localDir });
  execSync('git config user.name "test"', { cwd: localDir });
  execSync(`git remote add origin "${remoteDir}"`, { cwd: localDir });

  // Create initial commit
  writeFileSync(join(localDir, "base.txt"), "base\n");
  execSync("git add base.txt && git commit -m base", { cwd: localDir });
  execSync("git push -u origin main", { cwd: localDir });
});

afterEach(() => {
  rmSync(localDir, { recursive: true, force: true });
  rmSync(remoteDir, { recursive: true, force: true });
});

describe("reconcileActuatorCommit", () => {
  test("fast-forwards when origin/<branch> has unreachable commits", () => {
    // Push a commit to origin
    writeFileSync(join(localDir, "remote.txt"), "remote change\n");
    execSync("git add remote.txt && git commit -m remote", { cwd: localDir });
    execSync("git push origin main", { cwd: localDir });

    // Reset local to before the push (simulating the state in the spec)
    const beforeSha = execSync("git rev-parse HEAD~1", { cwd: localDir, encoding: "utf8" }).trim();
    execSync("git reset --hard " + beforeSha, { cwd: localDir });

    // Add a new commit locally (the actuator commit)
    writeFileSync(join(localDir, "local.txt"), "local change\n");
    execSync("git add local.txt && git commit -m local", { cwd: localDir });

    // Before reconcile, we should be diverged
    const beforeRemoteCount = execSync(
      "git rev-list --count HEAD..origin/main",
      { cwd: localDir, encoding: "utf8" }
    ).trim();
    expect(parseInt(beforeRemoteCount, 10)).toBeGreaterThan(0);

    // Reconcile should fast-forward
    reconcileActuatorCommit(localDir);

    // After reconcile, we should be up to date
    const afterRemoteCount = execSync(
      "git rev-list --count HEAD..origin/main",
      { cwd: localDir, encoding: "utf8" }
    ).trim();
    expect(parseInt(afterRemoteCount, 10)).toBe(0);

    // Verify both commits are in the history
    const log = execSync("git log --oneline", { cwd: localDir, encoding: "utf8" });
    expect(log).toContain("remote");
    expect(log).toContain("local");
  });

  test("skips when origin/<branch> is not ahead", () => {
    const beforeSha = execSync("git rev-parse HEAD", { cwd: localDir, encoding: "utf8" }).trim();

    // Reconcile when already up to date
    reconcileActuatorCommit(localDir);

    // Verify no changes
    const afterSha = execSync("git rev-parse HEAD", { cwd: localDir, encoding: "utf8" }).trim();
    expect(afterSha).toBe(beforeSha);
  });

  test("skips when no upstream configured", () => {
    // Create a local branch with no upstream
    execSync("git checkout -b feature", { cwd: localDir });
    writeFileSync(join(localDir, "feature.txt"), "feature\n");
    execSync("git add feature.txt && git commit -m feature", { cwd: localDir });

    const beforeSha = execSync("git rev-parse HEAD", { cwd: localDir, encoding: "utf8" }).trim();

    // Reconcile should skip (no upstream)
    reconcileActuatorCommit(localDir);

    // Verify no changes
    const afterSha = execSync("git rev-parse HEAD", { cwd: localDir, encoding: "utf8" }).trim();
    expect(afterSha).toBe(beforeSha);
  });

  test("aborts on rebase conflict", () => {
    // Create a conflict scenario:
    // 1. Remote has a commit that modifies file.txt
    // 2. Local has moved HEAD back and made a different change to file.txt

    // Push a commit to origin
    writeFileSync(join(localDir, "file.txt"), "remote version\n");
    execSync("git add file.txt && git commit -m remote", { cwd: localDir });
    const remoteCommitSha = execSync("git rev-parse HEAD", { cwd: localDir, encoding: "utf8" }).trim();
    execSync("git push origin main", { cwd: localDir });

    // Reset local to before the push
    const baselineSha = execSync("git rev-parse HEAD~1", { cwd: localDir, encoding: "utf8" }).trim();
    execSync("git reset --hard " + baselineSha, { cwd: localDir });

    // Make a conflicting change locally
    writeFileSync(join(localDir, "file.txt"), "local version\n");
    execSync("git add file.txt && git commit -m local", { cwd: localDir });
    const localCommitSha = execSync("git rev-parse HEAD", { cwd: localDir, encoding: "utf8" }).trim();

    // Reconcile should throw on conflict
    expect(() => {
      reconcileActuatorCommit(localDir);
    }).toThrow(RebaseConflictError);

    // Verify worktree is not left mid-rebase (rebase was aborted)
    const rebasePath = join(localDir, ".git", "rebase-merge");
    expect(execSync("git status --porcelain", { cwd: localDir, encoding: "utf8" }).trim()).toBe("");

    // Verify local commit is still present and not pushed
    const headSha = execSync("git rev-parse HEAD", { cwd: localDir, encoding: "utf8" }).trim();
    expect(headSha).toBe(localCommitSha);
  });
});
