// This test requires real git branch/worktree/remote behavior for cleanup semantics and cannot run in sandbox mode.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CleanupIo, cleanupCommand } from "../src/commands/cleanup.ts";
import { stripPlanSpecTimestampPrefix } from "../src/modes/plan/spec-paths.ts";

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

function setupExternalSpec(
  externalRoot: string,
  projectId: string,
  specName: string,
  includeIntent: boolean = true,
): string {
  const specDir = join(externalRoot, "specs", projectId, specName);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "index.md"), "# spec\n");

  if (includeIntent) {
    const intentDir = join(externalRoot, "specs", projectId, "ready-intents");
    mkdirSync(intentDir, { recursive: true });
    const intentName = stripPlanSpecTimestampPrefix(specName);
    writeFileSync(join(intentDir, `${intentName}.md`), "# intent\n");
  }

  return specDir;
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

  test("commit:false project archives to external home and prunes ready-intent", () => {
    const { io } = captureIo(["y"]);

    const specName = "external-spec";
    const externalRoot = mkdtempSync(join(tmpdir(), "jarvis-external-"));
    const projectId = "test";
    const externalSpecDir = setupExternalSpec(externalRoot, projectId, specName);

    const worktreePath = createTrackedWorktree(specName);

    const code = cleanupCommand({
      projectRoot,
      io,
      isMergedPr: () => true,
      commit: false,
      project: { key: projectId, root: projectRoot },
      jarvisConfigDir: externalRoot,
    });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    const destination = join(externalRoot, "specs", projectId, "completed", specName);
    expect(existsSync(externalSpecDir)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(readFileSync(join(destination, "index.md"), "utf8")).toBe("# spec\n");
    expect(existsSync(join(externalRoot, "specs", projectId, "ready-intents", `${specName}.md`))).toBe(false);
    rmSync(externalRoot, { recursive: true, force: true });
  });

  test("commit:false with missing external spec is non-fatal", () => {
    const { io, out } = captureIo(["y"]);

    const specName = "missing-external";
    const externalRoot = mkdtempSync(join(tmpdir(), "jarvis-external-"));
    const projectId = "test";
    const worktreePath = createTrackedWorktree(specName);

    const code = cleanupCommand({
      projectRoot,
      io,
      isMergedPr: () => true,
      commit: false,
      project: { key: projectId, root: projectRoot },
      jarvisConfigDir: externalRoot,
    });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(out()).toContain("no spec directory moved for external spec");
    rmSync(externalRoot, { recursive: true, force: true });
  });

  test("commit:false with missing ready-intent prunes to no-op", () => {
    const { io } = captureIo(["y"]);

    const specName = "no-intent";
    const externalRoot = mkdtempSync(join(tmpdir(), "jarvis-external-"));
    const projectId = "test";
    const _externalSpecDir = setupExternalSpec(externalRoot, projectId, specName, false);

    const worktreePath = createTrackedWorktree(specName);

    const code = cleanupCommand({
      projectRoot,
      io,
      isMergedPr: () => true,
      commit: false,
      project: { key: projectId, root: projectRoot },
      jarvisConfigDir: externalRoot,
    });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    const destination = join(externalRoot, "specs", projectId, "completed", specName);
    expect(existsSync(destination)).toBe(true);
    rmSync(externalRoot, { recursive: true, force: true });
  });

  test("commit:false with existing external destination leaves source and intent intact", () => {
    const { io, err } = captureIo(["y"]);

    const specName = "collide-external";
    const externalRoot = mkdtempSync(join(tmpdir(), "jarvis-external-"));
    const projectId = "test";
    const externalSpecDir = setupExternalSpec(externalRoot, projectId, specName);
    const externalDestination = join(externalRoot, "specs", projectId, "completed", specName);
    mkdirSync(externalDestination, { recursive: true });

    const worktreePath = createTrackedWorktree(specName);

    const code = cleanupCommand({
      projectRoot,
      io,
      isMergedPr: () => true,
      commit: false,
      project: { key: projectId, root: projectRoot },
      jarvisConfigDir: externalRoot,
    });

    expect(code).toBe(1);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(externalSpecDir)).toBe(true);
    expect(existsSync(join(externalRoot, "specs", projectId, "ready-intents", `${specName}.md`))).toBe(true);
    expect(err()).toContain("spec archive destination already exists");
    rmSync(externalRoot, { recursive: true, force: true });
  });

  test("commit:false refuses reserved-name spec dirs", () => {
    const { io, err } = captureIo(["y"]);

    const specName = "completed";
    const externalRoot = mkdtempSync(join(tmpdir(), "jarvis-external-"));
    const projectId = "test";
    const externalSpecDir = join(externalRoot, "specs", projectId, specName);
    mkdirSync(externalSpecDir, { recursive: true });
    writeFileSync(join(externalSpecDir, "index.md"), "# spec\n");

    const worktreePath = createTrackedWorktree(specName);

    const code = cleanupCommand({
      projectRoot,
      io,
      isMergedPr: () => true,
      commit: false,
      project: { key: projectId, root: projectRoot },
      jarvisConfigDir: externalRoot,
    });

    expect(code).toBe(1);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(externalSpecDir)).toBe(true);
    expect(err()).toContain("unsafe spec archive mapping");
    expect(err()).toContain("reserved name");
    rmSync(externalRoot, { recursive: true, force: true });
  });

  test("commit:false skips plan-mode worktrees", () => {
    const { io, out } = captureIo(["y"]);

    const name = "plan-spec";
    const externalRoot = mkdtempSync(join(tmpdir(), "jarvis-external-"));
    const projectId = "test";
    const externalSpecDir = join(externalRoot, "specs", projectId, `plan/${name}`);
    mkdirSync(externalSpecDir, { recursive: true });

    const worktreePath = createTrackedPlanWorktree(name);

    const code = cleanupCommand({
      projectRoot,
      io,
      isMergedPr: () => true,
      commit: false,
      project: { key: projectId, root: projectRoot },
      jarvisConfigDir: externalRoot,
    });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(externalSpecDir)).toBe(true);
    expect(out()).toContain("skipping external archive for plan-mode worktree");
    rmSync(externalRoot, { recursive: true, force: true });
  });

  test("commit:false archives timestamped spec", () => {
    const { io } = captureIo(["y"]);

    const name = "timestamped-spec";
    const timestampedName = `2026-06-23T10-30-45Z-${name}`;
    const externalRoot = mkdtempSync(join(tmpdir(), "jarvis-external-"));
    const projectId = "test";
    const externalSpecDir = setupExternalSpec(externalRoot, projectId, timestampedName);

    const worktreePath = createTrackedWorktree(timestampedName);

    const code = cleanupCommand({
      projectRoot,
      io,
      isMergedPr: () => true,
      commit: false,
      project: { key: projectId, root: projectRoot },
      jarvisConfigDir: externalRoot,
    });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    const destination = join(externalRoot, "specs", projectId, "completed", timestampedName);
    expect(existsSync(externalSpecDir)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(existsSync(join(externalRoot, "specs", projectId, "ready-intents", `${name}.md`))).toBe(false);
    rmSync(externalRoot, { recursive: true, force: true });
  });

  test("commit:false refuses ready-intents as spec dir", () => {
    const { io, err } = captureIo(["y"]);

    const specName = "ready-intents";
    const externalRoot = mkdtempSync(join(tmpdir(), "jarvis-external-"));
    const projectId = "test";
    const externalSpecDir = join(externalRoot, "specs", projectId, specName);
    mkdirSync(externalSpecDir, { recursive: true });

    const _worktreePath = createTrackedWorktree(specName);

    const code = cleanupCommand({
      projectRoot,
      io,
      isMergedPr: () => true,
      commit: false,
      project: { key: projectId, root: projectRoot },
      jarvisConfigDir: externalRoot,
    });

    expect(code).toBe(1);
    expect(existsSync(externalSpecDir)).toBe(true);
    expect(err()).toContain("unsafe spec archive mapping");
    rmSync(externalRoot, { recursive: true, force: true });
  });

  test("commit:true ignores external home (unchanged)", () => {
    const { io } = captureIo(["y"]);

    const specName = "in-repo-spec";
    const worktreePath = createTrackedWorktree(specName);
    const source = join(projectRoot, "spec", specName);
    const destination = join(projectRoot, "spec", "completed", specName);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), "# in-repo\n");

    const externalRoot = mkdtempSync(join(tmpdir(), "jarvis-external-"));
    const projectId = "test";

    const code = cleanupCommand({
      projectRoot,
      io,
      isMergedPr: () => true,
      commit: true,
      project: { key: projectId, root: projectRoot },
      jarvisConfigDir: externalRoot,
    });

    expect(code).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect(readFileSync(join(destination, "index.md"), "utf8")).toBe("# in-repo\n");
    rmSync(externalRoot, { recursive: true, force: true });
  });
});
