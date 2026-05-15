import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commitPlanDraft,
  commitPlanInterview,
} from "../../../src/modes/plan/commits.ts";

describe("commitPlanInterview", () => {
  test("creates interview commit with correct message for file mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-commit-"));
    try {
      // Set up git repo
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      // Create initial commit
      writeFileSync(join(dir, "README.md"), "test");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'initial'", { cwd: dir });

      // Create a fake remote (bare repo)
      const remoteDir = mkdtempSync(join(tmpdir(), "jarvis-remote-"));
      try {
        execSync("git init --bare -b main", { cwd: remoteDir });
        execSync(`git remote add origin ${remoteDir}`, { cwd: dir });
        execSync("git push -u origin main", { cwd: dir });

        // Create a new branch for plan
        execSync("git branch plan/test-spec", { cwd: dir });
        const worktreePath = join(dir, "worktree");
        mkdirSync(worktreePath);

        // Set up a minimal git worktree
        execSync("git worktree add --no-checkout worktree plan/test-spec", {
          cwd: dir,
        });
        execSync("git checkout plan/test-spec", { cwd: worktreePath });

        // Create the spec directory and intent file
        mkdirSync(join(worktreePath, "spec", "test-spec"), {
          recursive: true,
        });
        writeFileSync(
          join(worktreePath, "spec", "test-spec", "intent.md"),
          "test intent",
        );

        // Test file mode
        commitPlanInterview({
          worktreePath,
          name: "test-spec",
          mode: "file",
          intentPathOrLabel: "/some/path/test-intent.md",
        });

        // Verify commit message
        const commitMsg = execSync("git log -1 --format=%B", {
          cwd: worktreePath,
          encoding: "utf8",
        }).trim();
        expect(commitMsg).toBe("plan: interview\n\nSeeded from test-intent.md");

        // Verify commit was pushed
        const remoteCommits = execSync("git log --oneline", {
          cwd: remoteDir,
          encoding: "utf8",
        })
          .trim()
          .split("\n");
        expect(remoteCommits.length).toBeGreaterThan(0);
      } finally {
        rmSync(remoteDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("creates interview commit with correct message for inline mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-commit-inline-"));
    try {
      // Set up git repo
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      // Create initial commit
      writeFileSync(join(dir, "README.md"), "test");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'initial'", { cwd: dir });

      // Create a fake remote (bare repo)
      const remoteDir = mkdtempSync(join(tmpdir(), "jarvis-remote-"));
      try {
        execSync("git init --bare -b main", { cwd: remoteDir });
        execSync(`git remote add origin ${remoteDir}`, { cwd: dir });
        execSync("git push -u origin main", { cwd: dir });

        // Create a new branch for plan
        execSync("git branch plan/test-spec", { cwd: dir });
        const worktreePath = join(dir, "worktree");
        mkdirSync(worktreePath);

        // Set up a minimal git worktree
        execSync("git worktree add --no-checkout worktree plan/test-spec", {
          cwd: dir,
        });
        execSync("git checkout plan/test-spec", { cwd: worktreePath });

        // Create the spec directory and intent file
        mkdirSync(join(worktreePath, "spec", "test-spec"), {
          recursive: true,
        });
        writeFileSync(
          join(worktreePath, "spec", "test-spec", "intent.md"),
          "test intent",
        );

        // Test inline mode
        commitPlanInterview({
          worktreePath,
          name: "test-spec",
          mode: "inline",
          intentPathOrLabel: "add csv export",
        });

        // Verify commit message
        const commitMsg = execSync("git log -1 --format=%B", {
          cwd: worktreePath,
          encoding: "utf8",
        }).trim();
        expect(commitMsg).toBe("plan: interview\n\nSeeded from inline");

        // Verify commit was pushed
        const remoteCommits = execSync("git log --oneline", {
          cwd: remoteDir,
          encoding: "utf8",
        })
          .trim()
          .split("\n");
        expect(remoteCommits.length).toBeGreaterThan(0);
      } finally {
        rmSync(remoteDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("commitPlanDraft", () => {
  test("creates draft commit and placeholder files", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-draft-"));
    try {
      // Set up git repo
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });

      // Create initial commit
      writeFileSync(join(dir, "README.md"), "test");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'initial'", { cwd: dir });

      // Create a fake remote (bare repo)
      const remoteDir = mkdtempSync(join(tmpdir(), "jarvis-remote-"));
      try {
        execSync("git init --bare -b main", { cwd: remoteDir });
        execSync(`git remote add origin ${remoteDir}`, { cwd: dir });
        execSync("git push -u origin main", { cwd: dir });

        // Create a new branch for plan
        execSync("git branch plan/test-spec", { cwd: dir });
        const worktreePath = join(dir, "worktree");
        mkdirSync(worktreePath);

        // Set up a minimal git worktree
        execSync("git worktree add --no-checkout worktree plan/test-spec", {
          cwd: dir,
        });
        execSync("git checkout plan/test-spec", { cwd: worktreePath });

        // Create spec directory and intent file for interview commit
        mkdirSync(join(worktreePath, "spec", "test-spec"), {
          recursive: true,
        });
        writeFileSync(
          join(worktreePath, "spec", "test-spec", "intent.md"),
          "test intent",
        );

        // Create interview commit first (this sets up the upstream branch)
        commitPlanInterview({
          worktreePath,
          name: "test-spec",
          mode: "inline",
          intentPathOrLabel: "test intent",
        });

        // Simulate agent having created spec files
        writeFileSync(
          join(worktreePath, "spec", "test-spec", "index.md"),
          "# Test Spec\n\n- [ ] [00-task](./00-task.md)\n",
        );
        writeFileSync(
          join(worktreePath, "spec", "test-spec", "00-task.md"),
          "# Task 1\n\n## Acceptance criteria\n\n- [ ] Test\n",
        );
        writeFileSync(
          join(worktreePath, "spec", "test-spec", "01-task.md"),
          "# Task 2\n\n## Acceptance criteria\n\n- [ ] Test\n",
        );

        // Create draft
        commitPlanDraft({
          worktreePath,
          name: "test-spec",
          agentLabel: "Claude Haiku",
          subspecCount: 2,
        });

        // Verify commit message
        const commitMsg = execSync("git log -1 --format=%B", {
          cwd: worktreePath,
          encoding: "utf8",
        }).trim();
        expect(commitMsg).toContain("plan: draft");
        expect(commitMsg).toContain("Drafted by Claude Haiku");
        expect(commitMsg).toContain("Subspecs: 2");

        // Verify both commits were pushed (should have initial + interview + draft)
        const remoteCommits = execSync("git log --oneline plan/test-spec", {
          cwd: remoteDir,
          encoding: "utf8",
        })
          .trim()
          .split("\n");
        expect(remoteCommits.length).toBe(3);
        // Verify the last two are interview and draft
        expect(remoteCommits[0]).toContain("plan: draft");
        expect(remoteCommits[1]).toContain("plan: interview");
      } finally {
        rmSync(remoteDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
