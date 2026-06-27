// This test requires real git branch/worktree/remote behavior for cleanup semantics and cannot run in sandbox mode.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
let externalSpecsRoot: string;

function createTrackedWorktree(specName: string): string {
  const worktreePath = join(worktreeDir, specName);
  execSync(`git branch ${specName} main`, { cwd: projectRoot, stdio: "pipe" });
  execSync(`git push -u origin ${specName}`, {
    cwd: projectRoot,
    stdio: "pipe",
  });
  execSync(`git worktree add "${worktreePath}" ${specName}`, {
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
  execSync(`git worktree add "${worktreePath}" ${branch}`, {
    cwd: projectRoot,
    stdio: "pipe",
  });
  return worktreePath;
}

function runExternalCleanup(io: CleanupIo, root: string = externalSpecsRoot): number {
  return cleanupCommand({
    projectRoot,
    io,
    commit: false,
    externalSpecsRoot: root,
    isMergedPr: () => true,
  });
}

function runAbandonCleanup(io: CleanupIo, opts: Partial<Parameters<typeof cleanupCommand>[0]> = {}): number {
  return cleanupCommand({
    projectRoot,
    io,
    abandon: true,
    isMergedPr: () => false,
    findMatchingOpenPrs: () => [],
    ...opts,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jarvis-cleanup-"));
  projectRoot = root;
  worktreeDir = join(projectRoot, ".worktree");
  remoteDir = join(projectRoot, "remote.git");
  externalSpecsRoot = join(projectRoot, "external-specs");
  mkdirSync(worktreeDir, { recursive: true });
  mkdirSync(remoteDir, { recursive: true });
  mkdirSync(externalSpecsRoot, { recursive: true });

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
    expect(
      execSync("git show --name-status --pretty=format:%s HEAD", {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf8",
      }),
    ).toContain("cleanup: archive spec patch-spec");
    expect(
      execSync("git rev-parse HEAD origin/main", {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf8",
      }).trim(),
    ).toMatch(/^(.*?)\n\1$/);
    const committedRename = execSync("git show --name-status --pretty=format: HEAD", {
      cwd: projectRoot,
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(committedRename).toContain("A\tspec/completed/patch-spec/index.md");
    expect(committedRename).not.toContain("README.md");
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

  test("archives timestamped plan-mode spec from configured targetDir", () => {
    const { io } = captureIo(["yes"]);

    const name = "plan-placeholder-safe-rendering";
    const timestampedName = `2026-05-23T17-53-16Z-${name}`;
    const worktreePath = createTrackedPlanWorktree(name);
    const source = join(projectRoot, "v1", "spec", timestampedName);
    const destination = join(projectRoot, "v1", "spec", "completed", timestampedName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# plan\n");

    const code = cleanupCommand({
      projectRoot,
      io,
      targetDir: "v1/spec",
      isMergedPr: () => true,
    });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
  });

  test("archives timestamped v2 spec to v2/spec/completed while targetDir is v1/spec", () => {
    const { io } = captureIo(["yes"]);

    const name = "route-cleanup-archival-by-target";
    const timestampedName = `2026-06-23T06-56-40Z-${name}`;
    const worktreePath = createTrackedPlanWorktree(name);
    const source = join(projectRoot, "v2", "spec", timestampedName);
    const destination = join(projectRoot, "v2", "spec", "completed", timestampedName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# v2 spec\n");

    const code = cleanupCommand({
      projectRoot,
      io,
      targetDir: "v1/spec",
      isMergedPr: () => true,
    });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(readFileSync(join(destination, "index.md"), "utf8")).toBe("# v2 spec\n");
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

  test("cleans up worktree after remote branch is deleted", () => {
    const { io, out } = captureIo(["y"]);

    const specName = "deleted-remote-spec";
    const worktreePath = createTrackedWorktree(specName);
    const source = join(projectRoot, "spec", specName);
    const destination = join(projectRoot, "spec", "completed", specName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# spec\n");

    execSync(`git push origin --delete ${specName}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });

    const code = cleanupCommand({ projectRoot, io, isMergedPr: () => true });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(out()).not.toContain("uncommitted or unpushed changes");
  });

  test("removes pushed merged branch even when not reachable from local main", () => {
    const { io } = captureIo(["y"]);

    const specName = "squash-merged-spec";
    const worktreePath = createTrackedWorktree(specName);
    const source = join(projectRoot, "spec", specName);
    const destination = join(projectRoot, "spec", "completed", specName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# spec\n");

    writeFileSync(join(worktreePath, "feature.txt"), "feature\n");
    execSync("git add feature.txt", { cwd: worktreePath, stdio: "pipe" });
    execSync("git commit -m 'feature'", {
      cwd: worktreePath,
      stdio: "pipe",
    });
    execSync(`git push origin ${specName}`, {
      cwd: worktreePath,
      stdio: "pipe",
    });

    const code = cleanupCommand({ projectRoot, io, isMergedPr: () => true });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(() =>
      execSync(`git rev-parse --verify ${specName}`, {
        cwd: projectRoot,
        stdio: "pipe",
      }),
    ).toThrow();
  });

  test("cleanup commit does not stage or commit unrelated main-checkout changes", () => {
    const { io } = captureIo(["y"]);

    const specName = "scoped-stage-spec";
    createTrackedWorktree(specName);
    const source = join(projectRoot, "spec", specName);
    const destination = join(projectRoot, "spec", "completed", specName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# scoped\n");

    writeFileSync(join(projectRoot, "README.md"), "modified main checkout\n");
    writeFileSync(join(projectRoot, "scratch.txt"), "untracked\n");

    const code = cleanupCommand({ projectRoot, io, isMergedPr: () => true });

    expect(code).toBe(0);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);

    const committedRename = execSync("git show --name-status --pretty=format: HEAD", {
      cwd: projectRoot,
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(committedRename).toContain("A\tspec/completed/scoped-stage-spec/index.md");
    expect(committedRename).not.toContain("README.md");
    expect(committedRename).not.toContain("scratch.txt");

    const status = execSync("git status --short", {
      cwd: projectRoot,
      stdio: "pipe",
      encoding: "utf8",
    });
    expect(status).toContain(" M README.md");
    expect(status).toContain("?? scratch.txt");
  });

  test("default-spec project with coincidental v1/spec dir archives to spec/completed, not v1/spec/completed", () => {
    const { io } = captureIo(["yes"]);

    const specName = "default-spec-test";
    const worktreePath = createTrackedWorktree(specName);
    const source = join(projectRoot, "spec", specName);
    const destination = join(projectRoot, "spec", "completed", specName);
    const coincidentalV1 = join(projectRoot, "v1", "spec");
    mkdirSync(source, { recursive: true });
    mkdirSync(coincidentalV1, { recursive: true });
    writeFileSync(join(source, "index.md"), "# default spec\n");

    const code = cleanupCommand({ projectRoot, io, isMergedPr: () => true });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(existsSync(join(projectRoot, "v1", "spec", "completed", specName))).toBe(false);
    expect(readFileSync(join(destination, "index.md"), "utf8")).toBe("# default spec\n");
  });

  test("commit:false archives external spec dir and prunes ready-intents by branch slug", () => {
    const { io } = captureIo(["yes"]);

    const name = "my-feature";
    createTrackedPlanWorktree(name);
    const timestampedName = `2026-06-27T05-48-27Z-${name}`;
    const source = join(externalSpecsRoot, timestampedName);
    const destination = join(externalSpecsRoot, "completed", timestampedName);
    const readyIntentPath = join(externalSpecsRoot, "ready-intents", `${name}.md`);
    mkdirSync(join(externalSpecsRoot, "ready-intents"), { recursive: true });
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# external plan\n");
    writeFileSync(readyIntentPath, "intent\n");

    const code = runExternalCleanup(io);

    expect(code).toBe(0);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(existsSync(readyIntentPath)).toBe(false);
    expect(readFileSync(join(destination, "index.md"), "utf8")).toBe("# external plan\n");
  });

  test("commit:false archives exact-match non-plan branch from external home", () => {
    const { io } = captureIo(["yes"]);

    const specName = "feature-branch";
    createTrackedWorktree(specName);
    const source = join(externalSpecsRoot, specName);
    const destination = join(externalSpecsRoot, "completed", specName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# external branch\n");

    const code = runExternalCleanup(io);

    expect(code).toBe(0);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
  });

  test("commit:false missing external source is non-fatal and names the external path", () => {
    const { io, out, err } = captureIo(["yes"]);

    createTrackedWorktree("missing-external");

    const code = runExternalCleanup(io);

    expect(code).toBe(0);
    expect(out()).toContain(
      `no spec directory moved for missing-external: missing ${join(externalSpecsRoot, "missing-external")}`,
    );
    expect(err()).toBe("");
  });

  test("commit:false destination collision keeps source and reports failure", () => {
    const { io, err } = captureIo(["yes"]);

    createTrackedWorktree("collide-external");
    const source = join(externalSpecsRoot, "collide-external");
    const destination = join(externalSpecsRoot, "completed", "collide-external");
    mkdirSync(source, { recursive: true });
    mkdirSync(destination, { recursive: true });

    const code = runExternalCleanup(io);

    expect(code).toBe(1);
    expect(existsSync(source)).toBe(true);
    expect(err()).toContain("spec archive destination already exists");
    expect(err()).toContain(source);
    expect(err()).toContain(destination);
  });

  test("commit:false external archival performs no git commit and works outside a git home", () => {
    const { io } = captureIo(["yes"]);

    const specName = "external-no-git";
    const branchHeadBefore = execSync("git rev-parse HEAD", {
      cwd: projectRoot,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
    createTrackedWorktree(specName);
    const detachedExternalRoot = join(root, "detached-external-specs");
    const source = join(detachedExternalRoot, specName);
    const destination = join(detachedExternalRoot, "completed", specName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# detached external\n");

    const code = runExternalCleanup(io, detachedExternalRoot);

    expect(code).toBe(0);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(
      execSync("git rev-parse HEAD", {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf8",
      }).trim(),
    ).toBe(branchHeadBefore);
  });

  test("abandon retires a closed-PR worktree and leaves the spec in place", () => {
    const { io } = captureIo(["yes"]);

    const specName = "abandon-closed-pr";
    const worktreePath = createTrackedWorktree(specName);
    const specDir = join(projectRoot, "spec", specName);
    const specPath = join(specDir, "index.md");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(specPath, "# rerun me\n");

    const code = runAbandonCleanup(io);

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(specDir)).toBe(true);
    expect(readFileSync(specPath, "utf8")).toBe("# rerun me\n");
    expect(() =>
      execSync(`git rev-parse --verify ${specName}`, {
        cwd: projectRoot,
        stdio: "pipe",
      }),
    ).toThrow();
    expect(() =>
      execSync(`git ls-remote --exit-code origin refs/heads/${specName}`, {
        cwd: projectRoot,
        stdio: "pipe",
      }),
    ).toThrow();
  });

  test("abandon retires a no-PR worktree", () => {
    const { io } = captureIo(["yes"]);

    const specName = "abandon-no-pr";
    const worktreePath = createTrackedWorktree(specName);
    execSync(`git push origin --delete ${specName}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });

    const code = runAbandonCleanup(io);

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(() =>
      execSync(`git rev-parse --verify ${specName}`, {
        cwd: projectRoot,
        stdio: "pipe",
      }),
    ).toThrow();
  });

  test("abandon closes an open draft PR before retiring", () => {
    const { io } = captureIo(["yes"]);

    const specName = "abandon-draft-pr";
    const worktreePath = createTrackedWorktree(specName);
    const closedPrs: number[] = [];

    const code = runAbandonCleanup(io, {
      closePr: (prNumber) => {
        closedPrs.push(prNumber);
      },
      findMatchingOpenPrs: () => [{ number: 42, isDraft: true }],
    });

    expect(code).toBe(0);
    expect(closedPrs).toEqual([42]);
    expect(existsSync(worktreePath)).toBe(false);
  });

  test("abandon skips merged worktrees", () => {
    const { io, out } = captureIo();

    const specName = "leave-merged-alone";
    const worktreePath = createTrackedWorktree(specName);

    const code = runAbandonCleanup(io, {
      isMergedPr: () => true,
    });

    expect(code).toBe(0);
    expect(out()).toBe("no abandoned worktrees to remove\n");
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("abandon skips ready PRs and multiple matching PRs", () => {
    const { io, out } = captureIo();

    const readyPath = createTrackedWorktree("skip-ready-pr");
    const multiplePath = createTrackedWorktree("skip-multiple-prs");

    const code = runAbandonCleanup(io, {
      findMatchingOpenPrs: (branch) => {
        if (branch === "skip-ready-pr") {
          return [{ number: 7, isDraft: false }];
        }
        if (branch === "skip-multiple-prs") {
          return [
            { number: 8, isDraft: true },
            { number: 9, isDraft: true },
          ];
        }
        return [];
      },
    });

    expect(code).toBe(0);
    expect(out()).toContain("skipping skip-ready-pr: open ready PR #7");
    expect(out()).toContain("skipping skip-multiple-prs: multiple open PRs match branch skip-multiple-prs");
    expect(existsSync(readyPath)).toBe(true);
    expect(existsSync(multiplePath)).toBe(true);
  });

  test("abandon force-removes a dirty worktree", () => {
    const { io } = captureIo(["yes"]);

    const specName = "dirty-abandon";
    const worktreePath = createTrackedWorktree(specName);
    writeFileSync(join(worktreePath, "dirty.txt"), "dirty\n");

    const code = runAbandonCleanup(io);

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
  });

  test("abandon tolerates missing remote branches", () => {
    const { io } = captureIo(["yes"]);

    const specName = "missing-remote-abandon";
    const worktreePath = createTrackedWorktree(specName);
    execSync(`git push origin --delete ${specName}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });

    const code = runAbandonCleanup(io);

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
  });

  test("abandon keeps retiring when closePr fails", () => {
    const { io, err } = captureIo(["yes"]);

    const specName = "close-pr-fails";
    const worktreePath = createTrackedWorktree(specName);

    const code = runAbandonCleanup(io, {
      closePr: () => {
        throw new Error("already closed");
      },
      findMatchingOpenPrs: () => [{ number: 11, isDraft: true }],
    });

    expect(code).toBe(0);
    expect(err()).toContain("failed to close PR #11");
    expect(existsSync(worktreePath)).toBe(false);
  });

  test("abandon dry-run previews eligible worktrees and makes no changes", () => {
    const { io, out, err } = captureIo();

    const worktreePath = createTrackedWorktree("preview-me");
    const closeCalls: number[] = [];

    const code = runAbandonCleanup(io, {
      closePr: (prNumber) => {
        closeCalls.push(prNumber);
      },
      dryRun: true,
      findMatchingOpenPrs: () => [{ number: 12, isDraft: true }],
    });

    expect(code).toBe(0);
    expect(out()).toContain("Worktrees to remove:");
    expect(out()).toContain("preview-me");
    expect(out()).not.toContain("Remove these worktrees?");
    expect(err()).toBe("");
    expect(closeCalls).toEqual([]);
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("abandon cancel leaves worktree and branches untouched", () => {
    const { io, out } = captureIo(["n"]);

    const specName = "cancel-abandon";
    const worktreePath = createTrackedWorktree(specName);

    const code = runAbandonCleanup(io);

    expect(code).toBe(0);
    expect(out()).toContain("cancelled");
    expect(existsSync(worktreePath)).toBe(true);
    expect(
      execSync(`git rev-parse --abbrev-ref ${specName}`, {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf8",
      }).trim(),
    ).toBe(specName);
  });
});
