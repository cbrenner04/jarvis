import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CleanupIo, cleanupCommand } from "../src/commands/cleanup.ts";

function captureIo(responses: string[] = []): {
  io: CleanupIo;
  out: () => string;
  err: () => string;
} {
  let out = "";
  let err = "";
  let readlineIndex = 0;

  return {
    io: {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
      readlineSync: (_prompt) => {
        const response = responses[readlineIndex] ?? "n";
        readlineIndex++;
        return response;
      },
    },
    out: () => out,
    err: () => err,
  };
}

let root: string;
let projectRoot: string;
let worktreeDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jarvis-cleanup-"));
  projectRoot = root;
  worktreeDir = join(projectRoot, ".worktree");
  mkdirSync(worktreeDir, { recursive: true });

  // Set up a minimal git repo
  execSync("git init -b main", { cwd: projectRoot });
  execSync("git config user.email 'test@example.com'", { cwd: projectRoot });
  execSync("git config user.name 'Test User'", { cwd: projectRoot });
  writeFileSync(join(projectRoot, "README.md"), "test");
  execSync("git add README.md", { cwd: projectRoot });
  execSync("git commit -m 'initial'", { cwd: projectRoot });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("cleanupCommand", () => {
  test("no worktrees prints no merged worktrees", () => {
    const { io, out } = captureIo();
    const code = cleanupCommand({ projectRoot, io });
    expect(code).toBe(0);
    expect(out()).toBe("no merged worktrees to remove\n");
  });

  test("clean patch worktree (no merged PR) is left alone", () => {
    const { io, out } = captureIo();

    // Create a patch worktree
    const specName = "test-spec";
    const worktreePath = join(worktreeDir, specName);
    execSync(`git branch ${specName} main`, { cwd: projectRoot });
    execSync(`git worktree add "${worktreePath}" ${specName}`, {
      cwd: projectRoot,
    });

    const code = cleanupCommand({ projectRoot, io });

    expect(code).toBe(0);
    // PR not merged (no remotes in test), so cleanup should not try to remove it
    expect(out()).toBe("no merged worktrees to remove\n");
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("clean plan worktree (no merged PR) is left alone", () => {
    const { io, out } = captureIo();

    // Create a plan worktree
    const planName = "test-plan";
    const planDirName = `plan-${planName}`;
    const worktreePath = join(worktreeDir, planDirName);
    execSync(`git branch plan/${planName} main`, { cwd: projectRoot });
    execSync(`git worktree add "${worktreePath}" plan/${planName}`, {
      cwd: projectRoot,
    });

    const code = cleanupCommand({ projectRoot, io });

    expect(code).toBe(0);
    // PR not merged, so cleanup should not try to remove it
    expect(out()).toBe("no merged worktrees to remove\n");
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("dry-run lists no worktrees when none are merged", () => {
    const { io, out } = captureIo();

    // Create a plan worktree
    const planName = "test-plan";
    const planDirName = `plan-${planName}`;
    const worktreePath = join(worktreeDir, planDirName);
    execSync(`git branch plan/${planName} main`, { cwd: projectRoot });
    execSync(`git worktree add "${worktreePath}" plan/${planName}`, {
      cwd: projectRoot,
    });

    // Create a patch worktree for comparison
    const patchName = "patch-spec";
    const patchPath = join(worktreeDir, patchName);
    execSync(`git branch ${patchName} main`, { cwd: projectRoot });
    execSync(`git worktree add "${patchPath}" ${patchName}`, {
      cwd: projectRoot,
    });

    const code = cleanupCommand({ projectRoot, io, dryRun: true });

    expect(code).toBe(0);
    // No merged PRs, so cleanup doesn't list anything
    expect(out()).toBe("no merged worktrees to remove\n");
  });

  test("patch-mode cleanup behavior unaffected by plan mode changes", () => {
    const { io, out } = captureIo();

    // Create a patch worktree with a regular name
    const specName = "regular-spec";
    const worktreePath = join(worktreeDir, specName);
    execSync(`git branch ${specName} main`, { cwd: projectRoot });
    execSync(`git worktree add "${worktreePath}" ${specName}`, {
      cwd: projectRoot,
    });

    const code = cleanupCommand({ projectRoot, io });

    expect(code).toBe(0);
    // PR not merged, so cleanup should not remove it
    expect(out()).toBe("no merged worktrees to remove\n");
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("cleanup enumerates both patch and plan worktrees", () => {
    const { io, out } = captureIo();

    // Create a patch worktree
    const patchName = "patch-spec";
    const patchPath = join(worktreeDir, patchName);
    execSync(`git branch ${patchName} main`, { cwd: projectRoot });
    execSync(`git worktree add "${patchPath}" ${patchName}`, {
      cwd: projectRoot,
    });

    // Create a plan worktree
    const planName = "test-plan";
    const planDirName = `plan-${planName}`;
    const planPath = join(worktreeDir, planDirName);
    execSync(`git branch plan/${planName} main`, { cwd: projectRoot });
    execSync(`git worktree add "${planPath}" plan/${planName}`, {
      cwd: projectRoot,
    });

    const code = cleanupCommand({ projectRoot, io });

    expect(code).toBe(0);
    // No merged PRs, so nothing to remove
    expect(out()).toBe("no merged worktrees to remove\n");
    // Both worktrees should still exist
    expect(existsSync(patchPath)).toBe(true);
    expect(existsSync(planPath)).toBe(true);
  });
});
