import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlanWorktree, ensureExistingBranchWorktree, ensureWorktree } from "../src/worktree.ts";

function initRepo(dir: string): void {
  execSync("git init -b main", { cwd: dir });
  execSync("git config user.email 'test@example.com'", { cwd: dir });
  execSync("git config user.name 'Test User'", { cwd: dir });
  writeFileSync(join(dir, "README.md"), "test");
  execSync("git add README.md", { cwd: dir });
  execSync("git commit -m 'initial'", { cwd: dir });
}

function writeSpec(dir: string, name = "feature"): string {
  const specDir = join(dir, "spec", name);
  const specFile = join(specDir, "index.md");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(specFile, "# Test spec\n");
  return specFile;
}

describe("createPlanWorktree", () => {
  test("creates worktree at .worktree/plan-<name>/ on plan/<name> branch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-worktree-"));
    try {
      initRepo(dir);

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
      initRepo(dir);

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

function setupRepoWithOrigin(): { dir: string; origin: string } {
  const origin = mkdtempSync(join(tmpdir(), "jarvis-origin-"));
  const dir = mkdtempSync(join(tmpdir(), "jarvis-repo-"));
  execSync("git init --bare", { cwd: origin });
  initRepo(dir);
  execSync(`git remote add origin "${origin}"`, { cwd: dir });
  execSync("git push -u origin main", { cwd: dir });
  return { dir, origin };
}

function revParse(cwd: string, rev: string): string {
  return execSync(`git rev-parse ${rev}`, { cwd, encoding: "utf8" }).trim();
}

function advanceOriginMain(origin: string): string {
  const writer = mkdtempSync(join(tmpdir(), "jarvis-origin-writer-"));
  execSync(`git clone "${origin}" "${writer}"`, { cwd: tmpdir() });
  execSync("git config user.email 'test@example.com'", { cwd: writer });
  execSync("git config user.name 'Test User'", { cwd: writer });
  writeFileSync(join(writer, "remote.txt"), "remote");
  execSync("git add remote.txt", { cwd: writer });
  execSync("git commit -m 'remote advance'", { cwd: writer });
  execSync("git push origin main", { cwd: writer });
  const sha = revParse(writer, "HEAD");
  rmSync(writer, { recursive: true, force: true });
  return sha;
}

describe("ensureWorktree (patch-mode)", () => {
  test("allows patch specs whose names start with plan-", async () => {
    const { dir, origin } = setupRepoWithOrigin();
    try {
      execSync("git branch plan-mode-updates main", { cwd: dir });
      execSync("git push -u origin plan-mode-updates", { cwd: dir });

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
      rmSync(origin, { recursive: true, force: true });
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

  test("retires and recreates iter-0 orphan worktree (zero commits ahead)", async () => {
    const { dir, origin } = setupRepoWithOrigin();
    try {
      const specDir = join(dir, "spec", "feature");
      const specFile = join(specDir, "index.md");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(specFile, "# Test spec\n");

      // Create an orphan: branch at base with zero commits ahead
      execSync("git branch feature main", { cwd: dir });
      // Push it to origin so it exists remotely (simulating a spec branch pushed but never used)
      execSync("git push -u origin feature", { cwd: dir });
      const worktreePath = join(dir, ".worktree", "feature");
      mkdirSync(join(dir, ".worktree"), { recursive: true });
      execSync(`git worktree add ${worktreePath} feature`, { cwd: dir });

      // Verify the orphan is created
      expect(existsSync(worktreePath)).toBe(true);
      const commitsBefore = execSync("git rev-list --count main..feature", { cwd: dir, encoding: "utf8" }).trim();
      expect(commitsBefore).toBe("0");

      // Call ensureWorktree to retire and recreate
      const resultPath = await ensureWorktree(dir, specFile);

      // Verify the orphan was retired and recreated
      expect(resultPath).toBe(worktreePath);
      expect(existsSync(worktreePath)).toBe(true);
      // The branch should still exist but with a fresh worktree
      const commitsAfter = execSync("git rev-list --count main..feature", { cwd: dir, encoding: "utf8" }).trim();
      expect(commitsAfter).toBe("0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
    }
  });

  test("preserves WIP branch with commits and resumes from it", async () => {
    const { dir, origin } = setupRepoWithOrigin();
    try {
      const specDir = join(dir, "spec", "feature");
      const specFile = join(specDir, "index.md");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(specFile, "# Test spec\n");

      // Create a WIP branch with commits
      execSync("git branch feature main", { cwd: dir });
      execSync("git push -u origin feature", { cwd: dir });
      const worktreePath = join(dir, ".worktree", "feature");
      mkdirSync(join(dir, ".worktree"), { recursive: true });
      execSync(`git worktree add ${worktreePath} feature`, { cwd: dir });

      // Add a commit to make it WIP
      writeFileSync(join(worktreePath, "test.txt"), "WIP content");
      execSync("git add test.txt", { cwd: worktreePath });
      execSync("git commit -m 'WIP commit'", { cwd: worktreePath });

      // Verify WIP branch has commits
      const commitsBefore = execSync("git rev-list --count main..feature", { cwd: dir, encoding: "utf8" }).trim();
      expect(parseInt(commitsBefore, 10)).toBeGreaterThan(0);

      // Call ensureWorktree - should preserve the WIP branch
      const resultPath = await ensureWorktree(dir, specFile);

      // Verify the WIP branch is preserved
      expect(resultPath).toBe(worktreePath);
      expect(existsSync(worktreePath)).toBe(true);
      const commitsAfter = execSync("git rev-list --count main..feature", { cwd: dir, encoding: "utf8" }).trim();
      expect(commitsAfter).toBe(commitsBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
    }
  });

  test("clears litter (gitignored files) in resumed WIP worktree", async () => {
    const { dir, origin } = setupRepoWithOrigin();
    try {
      // Create .gitignore
      writeFileSync(join(dir, ".gitignore"), "*.log\ntest_output.txt\n");
      execSync("git add .gitignore", { cwd: dir });
      execSync("git commit -m 'add gitignore'", { cwd: dir });
      execSync("git push", { cwd: dir });

      const specDir = join(dir, "spec", "feature");
      const specFile = join(specDir, "index.md");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(specFile, "# Test spec\n");

      // Create a WIP branch with commits
      execSync("git branch feature main", { cwd: dir });
      execSync("git push -u origin feature", { cwd: dir });
      const worktreePath = join(dir, ".worktree", "feature");
      mkdirSync(join(dir, ".worktree"), { recursive: true });
      execSync(`git worktree add ${worktreePath} feature`, { cwd: dir });

      // Add a commit to make it WIP
      writeFileSync(join(worktreePath, "test.txt"), "WIP content");
      execSync("git add test.txt", { cwd: worktreePath });
      execSync("git commit -m 'WIP commit'", { cwd: worktreePath });

      // Create litter files (gitignored)
      writeFileSync(join(worktreePath, "test_output.txt"), "litter");
      writeFileSync(join(worktreePath, "error.log"), "more litter");
      expect(existsSync(join(worktreePath, "test_output.txt"))).toBe(true);
      expect(existsSync(join(worktreePath, "error.log"))).toBe(true);

      // Call ensureWorktree - should clear litter
      await ensureWorktree(dir, specFile);

      // Verify litter is cleared
      expect(existsSync(join(worktreePath, "test_output.txt"))).toBe(false);
      expect(existsSync(join(worktreePath, "error.log"))).toBe(false);
      // Verify WIP commit is still there
      const commitsAfter = execSync("git rev-list --count main..feature", { cwd: dir, encoding: "utf8" }).trim();
      expect(parseInt(commitsAfter, 10)).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
    }
  });

  test("orphan worktree is removed even if branch already checked out elsewhere", async () => {
    const { dir, origin } = setupRepoWithOrigin();
    try {
      const specDir = join(dir, "spec", "feature");
      const specFile = join(specDir, "index.md");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(specFile, "# Test spec\n");

      // Create an orphan branch with a worktree
      execSync("git branch feature main", { cwd: dir });
      execSync("git push -u origin feature", { cwd: dir });
      const worktreePath = join(dir, ".worktree", "feature");
      mkdirSync(join(dir, ".worktree"), { recursive: true });
      execSync(`git worktree add ${worktreePath} feature`, { cwd: dir });

      // Verify orphan setup
      expect(existsSync(worktreePath)).toBe(true);

      // Call ensureWorktree - should retire the orphan using --force
      const resultPath = await ensureWorktree(dir, specFile);

      // Verify the orphan was retired and recreated
      expect(resultPath).toBe(worktreePath);
      expect(existsSync(worktreePath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
    }
  });

  test("creates a new patch worktree branch from origin base when local base is stale", async () => {
    const { dir, origin } = setupRepoWithOrigin();
    try {
      const specFile = writeSpec(dir);

      const staleLocalBase = revParse(dir, "main");
      const remoteBase = advanceOriginMain(origin);

      const worktreePath = await ensureWorktree(dir, specFile);

      expect(worktreePath).toBe(join(dir, ".worktree", "feature"));
      expect(revParse(dir, "feature")).toBe(remoteBase);
      expect(revParse(dir, "feature")).not.toBe(staleLocalBase);
      expect(revParse(dir, "origin/main")).toBe(remoteBase);
      expect(revParse(dir, "main")).toBe(staleLocalBase);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
    }
  });

  test("falls back to local base when origin is not configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-patch-no-origin-"));
    try {
      initRepo(dir);
      const specFile = writeSpec(dir);

      const localBase = revParse(dir, "main");
      await ensureWorktree(dir, specFile);

      expect(revParse(dir, "feature")).toBe(localBase);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("falls back to local base when origin base ref has never been fetched", async () => {
    const origin = mkdtempSync(join(tmpdir(), "jarvis-patch-never-fetched-origin-"));
    const dir = mkdtempSync(join(tmpdir(), "jarvis-patch-never-fetched-local-"));
    try {
      execSync("git init --bare", { cwd: origin });
      initRepo(dir);
      execSync(`git remote add origin "${origin}"`, { cwd: dir });
      const specFile = writeSpec(dir);

      const localBase = revParse(dir, "main");
      await ensureWorktree(dir, specFile);

      expect(revParse(dir, "feature")).toBe(localBase);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
    }
  });
});

describe("createPlanWorktree", () => {
  test("creates a new plan worktree branch from origin base when local base is stale", async () => {
    const { dir, origin } = setupRepoWithOrigin();
    try {
      const staleLocalBase = revParse(dir, "main");
      const remoteBase = advanceOriginMain(origin);

      const worktreePath = await createPlanWorktree({
        projectRoot: dir,
        name: "test-plan",
        baseBranch: "main",
      });

      expect(worktreePath).toBe(join(dir, ".worktree", "plan-test-plan"));
      expect(revParse(dir, "plan/test-plan")).toBe(remoteBase);
      expect(revParse(dir, "plan/test-plan")).not.toBe(staleLocalBase);
      expect(revParse(dir, "origin/main")).toBe(remoteBase);
      expect(revParse(dir, "main")).toBe(staleLocalBase);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
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
