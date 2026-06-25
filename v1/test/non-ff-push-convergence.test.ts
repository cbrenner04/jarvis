import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isNonFastForwardPushError,
  tryConvergeNonFfActuatorPush,
} from "../src/worktree.ts";

describe("isNonFastForwardPushError", () => {
  test("detects 'non-fast-forward' error", () => {
    const stderr = "error: failed to push some refs to 'origin'\n\
hint: Updates were rejected because the tip of your current branch is behind\n\
hint: its remote counterpart. Integrate the remote changes before pushing again.";
    expect(isNonFastForwardPushError(stderr)).toBe(true);
  });

  test("detects 'failed to push some refs' error", () => {
    const stderr = "error: failed to push some refs to 'origin'";
    expect(isNonFastForwardPushError(stderr)).toBe(true);
  });

  test("detects 'Updates were rejected because' error", () => {
    const stderr = "Updates were rejected because the tip of your current branch is behind";
    expect(isNonFastForwardPushError(stderr)).toBe(true);
  });

  test("detects 'tip of your current branch is behind' error", () => {
    const stderr = "error: tip of your current branch is behind 'origin/main'";
    expect(isNonFastForwardPushError(stderr)).toBe(true);
  });

  test("returns false for auth errors", () => {
    const stderr = "fatal: Authentication failed";
    expect(isNonFastForwardPushError(stderr)).toBe(false);
  });

  test("returns false for transient network errors", () => {
    const stderr = "connection reset";
    expect(isNonFastForwardPushError(stderr)).toBe(false);
  });

  test("returns false for empty stderr", () => {
    expect(isNonFastForwardPushError("")).toBe(false);
  });

  test("is case-insensitive", () => {
    const stderr = "ERROR: FAILED TO PUSH SOME REFS TO 'ORIGIN'";
    expect(isNonFastForwardPushError(stderr)).toBe(true);
  });
});

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

describe("tryConvergeNonFfActuatorPush", () => {
  test("converges when local HEAD tree equals fetched PR-head tree", () => {
    // Create a commit on remote (simulating someone else pushing while we're processing)
    const remoteCommitFile = join(localDir, "remote.txt");
    writeFileSync(remoteCommitFile, "remote change\n");
    execSync("git add remote.txt && git commit -m remote", { cwd: localDir });
    execSync("git push origin main", { cwd: localDir });

    // Get the remote SHA
    const remoteSha = execSync("git rev-parse origin/main", { cwd: localDir, encoding: "utf8" }).trim();

    // Reset local to before the remote push
    const baselineSha = execSync("git rev-parse HEAD~1", { cwd: localDir, encoding: "utf8" }).trim();
    execSync(`git reset --hard ${baselineSha}`, { cwd: localDir });

    // Create an actuator commit that touches a different file (same tree content as remote)
    const actuatorFile = join(localDir, "other.txt");
    writeFileSync(actuatorFile, "other change\n");
    execSync("git add other.txt && git commit -m actuator", { cwd: localDir });

    // Now squash this with remote's commit to create the same tree (different commit)
    writeFileSync(remoteCommitFile, "remote change\n");
    execSync("git add remote.txt", { cwd: localDir });
    execSync("git commit --amend -m 'both changes'", { cwd: localDir });

    // Verify trees are the same
    const localTree = execSync("git rev-parse HEAD^{tree}", { cwd: localDir, encoding: "utf8" }).trim();
    const remoteTree = execSync("git rev-parse origin/main^{tree}", {
      cwd: localDir,
      encoding: "utf8",
    }).trim();

    if (localTree !== remoteTree) {
      // If trees don't match, reset local to exactly match remote tree
      execSync(`git reset --hard origin/main`, { cwd: localDir });
      execSync("git commit --allow-empty -m actuator", { cwd: localDir });
    }

    // Now try convergence
    const result = tryConvergeNonFfActuatorPush(localDir, "main");

    expect(result.converged).toBe(true);
    expect(result.reason).toBeUndefined();

    // Verify HEAD is now at the remote commit
    const convergedSha = execSync("git rev-parse HEAD", { cwd: localDir, encoding: "utf8" }).trim();
    expect(convergedSha).toBe(remoteSha);
  });

  test("does not converge when local HEAD tree differs from fetched PR-head tree", () => {
    // Create and push a commit on remote
    writeFileSync(join(localDir, "remote.txt"), "remote change\n");
    execSync("git add remote.txt && git commit -m remote", { cwd: localDir });
    execSync("git push origin main", { cwd: localDir });

    // Get local SHA before reset
    const beforeResetSha = execSync("git rev-parse HEAD", { cwd: localDir, encoding: "utf8" }).trim();

    // Reset to before the remote push
    const baselineSha = execSync("git rev-parse HEAD~1", { cwd: localDir, encoding: "utf8" }).trim();
    execSync(`git reset --hard ${baselineSha}`, { cwd: localDir });

    // Create an actuator commit with different content (different tree than remote)
    writeFileSync(join(localDir, "different.txt"), "different content\n");
    execSync("git add different.txt && git commit -m actuator", { cwd: localDir });

    // Verify trees are different
    const localTree = execSync("git rev-parse HEAD^{tree}", { cwd: localDir, encoding: "utf8" }).trim();
    const remoteTree = execSync("git rev-parse origin/main^{tree}", {
      cwd: localDir,
      encoding: "utf8",
    }).trim();
    expect(localTree).not.toBe(remoteTree);

    // Try convergence
    const result = tryConvergeNonFfActuatorPush(localDir, "main");

    expect(result.converged).toBe(false);
    expect(result.reason).toBe("tree mismatch");

    // Verify worktree was not changed
    const afterSha = execSync("git rev-parse HEAD", { cwd: localDir, encoding: "utf8" }).trim();
    expect(afterSha).not.toBe(beforeResetSha);
  });

  test("returns failure reason when fetch fails", () => {
    // Create a local branch with no upstream or with a bad remote
    execSync("git checkout -b isolated-branch", { cwd: localDir });
    writeFileSync(join(localDir, "isolated.txt"), "isolated\n");
    execSync("git add isolated.txt && git commit -m isolated", { cwd: localDir });

    // Try to converge on a non-existent remote branch
    const result = tryConvergeNonFfActuatorPush(localDir, "nonexistent-branch");

    expect(result.converged).toBe(false);
    expect(result.reason).toBe("fetch failed");
  });
});
