import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
let remoteDir: string;

function createTrackedWorktree(specName: string): string {
  const worktreePath = join(worktreeDir, specName);
  execSync(`git branch ${specName} main`, { cwd: projectRoot, stdio: "pipe" });
  execSync(`git push -u origin ${specName}`, {
    cwd: projectRoot,
    stdio: "pipe",
  });
  execSync(`git worktree add \"${worktreePath}\" ${specName}`, {
    cwd: projectRoot,
    stdio: "pipe",
  });
  return worktreePath;
}

function createTrackedPlanWorktree(name: string): string {
  const branch = `plan/${name}`;
  const dirName = `plan-${name}`;
  const worktreePath = join(worktreeDir, dirName);
  execSync(`git branch ${branch} main`, { cwd: projectRoot, stdio: "pipe" });
  execSync(`git push -u origin ${branch}`, {
    cwd: projectRoot,
    stdio: "pipe",
  });
  execSync(`git worktree add \"${worktreePath}\" ${branch}`, {
    cwd: projectRoot,
    stdio: "pipe",
  });
  return worktreePath;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jarvis-cleanup-"));
  projectRoot = root;
  worktreeDir = join(projectRoot, ".worktree");
  remoteDir = join(projectRoot, "remote.git");
  mkdirSync(worktreeDir, { recursive: true });
  mkdirSync(remoteDir, { recursive: true });

  execSync("git init -b main", { cwd: projectRoot, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", {
    cwd: projectRoot,
    stdio: "pipe",
  });
  execSync("git config user.name 'Test User'", {
    cwd: projectRoot,
    stdio: "pipe",
  });
  writeFileSync(join(projectRoot, "README.md"), "test");
  execSync("git add README.md", { cwd: projectRoot, stdio: "pipe" });
  execSync("git commit -m 'initial'", { cwd: projectRoot, stdio: "pipe" });

  execSync("git init --bare -b main", { cwd: remoteDir, stdio: "pipe" });
  execSync(`git remote add origin ${remoteDir}`, {
    cwd: projectRoot,
    stdio: "pipe",
  });
  execSync("git push -u origin main", { cwd: projectRoot, stdio: "pipe" });
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

  test("archives patch-mode spec after successful cleanup", () => {
    const { io } = captureIo(["y"]);

    const specName = "patch-spec";
    const worktreePath = createTrackedWorktree(specName);
    const source = join(projectRoot, "spec", specName);
    const destination = join(projectRoot, "spec", "completed", specName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# patch\n");

    const code = cleanupCommand({ projectRoot, io, isMergedPr: () => true });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(readFileSync(join(destination, "index.md"), "utf8")).toBe("# patch\n");
  });

  test("archives plan-mode spec from spec/<name>", () => {
    const { io } = captureIo(["yes"]);

    const name = "plan-spec";
    const worktreePath = createTrackedPlanWorktree(name);
    const source = join(projectRoot, "spec", name);
    const destination = join(projectRoot, "spec", "completed", name);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# plan\n");

    const code = cleanupCommand({ projectRoot, io, isMergedPr: () => true });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
  });

  test("dry-run does not mutate worktrees or spec directories", () => {
    const { io } = captureIo();

    const specName = "dry-run-spec";
    const worktreePath = createTrackedWorktree(specName);
    const source = join(projectRoot, "spec", specName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# dry run\n");

    const code = cleanupCommand({
      projectRoot,
      io,
      dryRun: true,
      isMergedPr: () => true,
    });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(true);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(join(projectRoot, "spec", "completed"))).toBe(false);
  });

  test("missing source spec is non-fatal", () => {
    const { io, out, err } = captureIo(["y"]);

    const specName = "missing-spec";
    const worktreePath = createTrackedWorktree(specName);

    const code = cleanupCommand({ projectRoot, io, isMergedPr: () => true });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(out()).toContain("no spec directory moved");
    expect(err()).toBe("");
  });

  test("reserved completed name reports failure and continues", () => {
    const { io, err } = captureIo(["y"]);

    const unsafe = createTrackedWorktree("completed");
    const safe = createTrackedWorktree("safe-spec");
    const safeSource = join(projectRoot, "spec", "safe-spec");
    const safeDestination = join(projectRoot, "spec", "completed", "safe-spec");
    mkdirSync(safeSource, { recursive: true });

    const code = cleanupCommand({ projectRoot, io, isMergedPr: () => true });

    expect(code).toBe(1);
    expect(existsSync(unsafe)).toBe(false);
    expect(existsSync(safe)).toBe(false);
    expect(existsSync(safeDestination)).toBe(true);
    expect(err()).toContain("unsafe spec archive mapping");
  });

  test("destination collision keeps source, reports failure, and continues", () => {
    const { io, err } = captureIo(["y"]);

    createTrackedWorktree("collide-spec");
    createTrackedWorktree("ok-spec");

    const collidingSource = join(projectRoot, "spec", "collide-spec");
    const collidingDestination = join(projectRoot, "spec", "completed", "collide-spec");
    const okSource = join(projectRoot, "spec", "ok-spec");
    const okDestination = join(projectRoot, "spec", "completed", "ok-spec");

    mkdirSync(collidingSource, { recursive: true });
    mkdirSync(collidingDestination, { recursive: true });
    mkdirSync(okSource, { recursive: true });

    const code = cleanupCommand({ projectRoot, io, isMergedPr: () => true });

    expect(code).toBe(1);
    expect(existsSync(collidingSource)).toBe(true);
    expect(existsSync(collidingDestination)).toBe(true);
    expect(existsSync(okDestination)).toBe(true);
    expect(err()).toContain("spec archive destination already exists");
    expect(err()).toContain(collidingSource);
    expect(err()).toContain(collidingDestination);
  });

  test("if removal fails, spec is not moved", () => {
    const { io, err } = captureIo(["y"]);

    const specName = "remove-fails";
    createTrackedWorktree(specName);
    const source = join(projectRoot, "spec", specName);
    const destination = join(projectRoot, "spec", "completed", specName);
    mkdirSync(source, { recursive: true });

    const code = cleanupCommand({
      projectRoot,
      io,
      isMergedPr: () => true,
      removeItem: () => {
        throw new Error("simulated removal failure");
      },
    });

    expect(code).toBe(1);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(destination)).toBe(false);
    expect(err()).toContain("failed to remove");
  });
});
