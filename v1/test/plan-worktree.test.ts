import { describe, expect, test } from "bun:test";
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
import {
  createPlanWorktree,
  ensureExistingBranchWorktree,
  ensureWorktree,
} from "../src/worktree.ts";

describe("createPlanWorktree", () => {
  test("creates worktree at .worktree/plan-<name>/ on plan/<name> branch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-worktree-"));
    try {
      // Set up a minimal git repo
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });
      // Create initial commit so there's a base branch
      writeFileSync(join(dir, "README.md"), "test");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'initial'", { cwd: dir });

      // Create the plan worktree
      const testName = "test-plan";
      const worktreePath = await createPlanWorktree({
        projectRoot: dir,
        name: testName,
        baseBranch: "main",
      });

      // Verify worktree path
      expect(worktreePath).toBe(join(dir, ".worktree", `plan-${testName}`));
      expect(existsSync(worktreePath)).toBe(true);

      // Verify it's a git worktree with .git file
      expect(existsSync(join(worktreePath, ".git"))).toBe(true);

      // Verify the branch name
      const branchName = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: worktreePath,
        encoding: "utf8",
      }).trim();
      expect(branchName).toBe(`plan/${testName}`);

      // Verify the branch exists locally
      const branches = execSync("git branch", {
        cwd: dir,
        encoding: "utf8",
      });
      expect(branches).toContain(`plan/${testName}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails if worktree already exists at the target path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-exists-"));
    try {
      // Set up a minimal git repo
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });
      writeFileSync(join(dir, "README.md"), "test");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'initial'", { cwd: dir });

      const testName = "test-existing";
      // Create the first worktree
      await createPlanWorktree({
        projectRoot: dir,
        name: testName,
        baseBranch: "main",
      });

      // Try to create again at the same location
      try {
        await createPlanWorktree({
          projectRoot: dir,
          name: testName,
          baseBranch: "main",
        });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toContain("plan worktree already exists");
        expect(message).toContain("jarvis1 cleanup");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ensureWorktree (patch-mode)", () => {
  test("allows patch specs whose names start with plan-", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-patch-plan-prefix-"));
    try {
      // Set up a minimal git repo
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });
      writeFileSync(join(dir, "README.md"), "test");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'initial'", { cwd: dir });
      execSync("git branch plan-mode-updates main", { cwd: dir });

      // Create a spec dir with a plan- prefix
      const specDir = join(dir, "spec", "plan-mode-updates");
      const specFile = join(specDir, "index.md");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(specFile, "# Test spec\n");

      const worktreePath = await ensureWorktree(dir, specFile);

      expect(worktreePath).toBe(join(dir, ".worktree", "plan-mode-updates"));
      expect(existsSync(worktreePath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reuses a checkout already on the patch spec branch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-patch-resume-"));
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });
      writeFileSync(join(dir, "README.md"), "test");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'initial'", { cwd: dir });

      const specDir = join(dir, "spec", "feature");
      const specFile = join(specDir, "index.md");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(specFile, "# Test spec\n");
      execSync("git checkout -b feature", { cwd: dir });

      const worktreePath = await ensureWorktree(dir, specFile);

      expect(worktreePath).toBe(dir);
      expect(existsSync(join(dir, ".worktree", "feature"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ensureExistingBranchWorktree", () => {
  test("creates from local+remote and reports origin", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-existing-branch-both-"));
    const origin = mkdtempSync(join(tmpdir(), "jarvis-existing-branch-origin-"));
    try {
      execSync("git init --bare", { cwd: origin });
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });
      execSync(`git remote add origin "${origin}"`, { cwd: dir });
      writeFileSync(join(dir, "README.md"), "test");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'initial'", { cwd: dir });
      execSync("git checkout -b plan/test", { cwd: dir });
      execSync("git push -u origin plan/test", { cwd: dir });
      execSync("git checkout main", { cwd: dir });

      const out = ensureExistingBranchWorktree({
        projectRoot: dir,
        worktreeName: "plan-test",
        branchName: "plan/test",
        missingBranchMessage: "missing",
      });
      expect(existsSync(out.path)).toBe(true);
      expect(out.source).toBe("origin");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
    }
  });

  test("creates from remote-only and reports origin", () => {
    const origin = mkdtempSync(join(tmpdir(), "jarvis-existing-branch-origin-"));
    const seed = mkdtempSync(join(tmpdir(), "jarvis-existing-branch-seed-"));
    const dir = mkdtempSync(join(tmpdir(), "jarvis-existing-branch-local-"));
    try {
      execSync("git init --bare", { cwd: origin });
      execSync("git init -b main", { cwd: seed });
      execSync("git config user.email 'test@example.com'", { cwd: seed });
      execSync("git config user.name 'Test User'", { cwd: seed });
      execSync(`git remote add origin "${origin}"`, { cwd: seed });
      writeFileSync(join(seed, "README.md"), "test");
      execSync("git add README.md", { cwd: seed });
      execSync("git commit -m 'initial'", { cwd: seed });
      execSync("git checkout -b plan/test", { cwd: seed });
      execSync("git push -u origin plan/test", { cwd: seed });

      execSync(`git clone "${origin}" "${dir}"`, { cwd: tmpdir() });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      const out = ensureExistingBranchWorktree({
        projectRoot: dir,
        worktreeName: "plan-test",
        branchName: "plan/test",
        missingBranchMessage: "missing",
      });
      expect(existsSync(out.path)).toBe(true);
      expect(out.source).toBe("origin");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(seed, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
    }
  });

  test("creates from local-only and reports local", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-existing-branch-local-"));
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });
      writeFileSync(join(dir, "README.md"), "test");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'initial'", { cwd: dir });
      execSync("git checkout -b plan/test", { cwd: dir });
      execSync("git checkout main", { cwd: dir });

      const out = ensureExistingBranchWorktree({
        projectRoot: dir,
        worktreeName: "plan-test",
        branchName: "plan/test",
        missingBranchMessage: "missing",
      });
      expect(existsSync(out.path)).toBe(true);
      expect(out.source).toBe("local");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails when no local/remote branch exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-existing-branch-none-"));
    try {
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });
      writeFileSync(join(dir, "README.md"), "test");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'initial'", { cwd: dir });

      expect(() =>
        ensureExistingBranchWorktree({
          projectRoot: dir,
          worktreeName: "plan-test",
          branchName: "plan/test",
          missingBranchMessage: "custom missing",
        }),
      ).toThrow("custom missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
