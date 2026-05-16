import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  commitPlanBlocker,
  commitPlanDraft,
  commitPlanInterview,
  commitPlanReview,
} from "../../../src/modes/plan/commits.ts";
import { setupPlanRemote } from "../../helpers/plan-fixtures.ts";

describe("commitPlanInterview", () => {
  test("creates interview commit with correct message for file mode", () => {
    const { origin, worktreeRoot, cleanup } = setupPlanRemote();
    try {
      // Create a new branch for plan
      execSync("git branch plan/test-spec", { cwd: worktreeRoot });
      const worktreePath = join(worktreeRoot, "worktree");
      mkdirSync(worktreePath);

      // Set up a minimal git worktree
      execSync("git worktree add --no-checkout worktree plan/test-spec", {
        cwd: worktreeRoot,
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
      expect(commitMsg).toBe(
        "plan: interview\n\nSpec: spec/test-spec/intent.md\n\nSeeded from test-intent.md",
      );

      // Verify commit was pushed
      const remoteCommits = execSync("git log --oneline", {
        cwd: origin,
        encoding: "utf8",
      })
        .trim()
        .split("\n");
      expect(remoteCommits.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  test("creates interview commit with correct message for inline mode", () => {
    const { origin, worktreeRoot, cleanup } = setupPlanRemote();
    try {
      // Create a new branch for plan
      execSync("git branch plan/test-spec", { cwd: worktreeRoot });
      const worktreePath = join(worktreeRoot, "worktree");
      mkdirSync(worktreePath);

      // Set up a minimal git worktree
      execSync("git worktree add --no-checkout worktree plan/test-spec", {
        cwd: worktreeRoot,
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
      expect(commitMsg).toBe(
        "plan: interview\n\nSpec: spec/test-spec/intent.md\n\nSeeded from inline",
      );

      // Verify commit was pushed
      const remoteCommits = execSync("git log --oneline", {
        cwd: origin,
        encoding: "utf8",
      })
        .trim()
        .split("\n");
      expect(remoteCommits.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});

describe("commitPlanDraft", () => {
  test("creates draft commit and placeholder files", () => {
    const { origin, worktreeRoot, cleanup } = setupPlanRemote();
    try {
      // Create a new branch for plan
      execSync("git branch plan/test-spec", { cwd: worktreeRoot });
      const worktreePath = join(worktreeRoot, "worktree");
      mkdirSync(worktreePath);

      // Set up a minimal git worktree
      execSync("git worktree add --no-checkout worktree plan/test-spec", {
        cwd: worktreeRoot,
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
        cwd: origin,
        encoding: "utf8",
      })
        .trim()
        .split("\n");
      expect(remoteCommits.length).toBe(3);
      // Verify the last two are interview and draft
      expect(remoteCommits[0]).toContain("plan: draft");
      expect(remoteCommits[1]).toContain("plan: interview");
    } finally {
      cleanup();
    }
  });

  test("writes Jarvis-Agent trailer with the agent label", () => {
    const { worktreeRoot, cleanup } = setupPlanRemote();
    try {
      execSync("git branch plan/test-spec", { cwd: worktreeRoot });
      const worktreePath = join(worktreeRoot, "worktree");
      mkdirSync(worktreePath);
      execSync("git worktree add --no-checkout worktree plan/test-spec", {
        cwd: worktreeRoot,
      });
      execSync("git checkout plan/test-spec", { cwd: worktreePath });

      mkdirSync(join(worktreePath, "spec", "test-spec"), {
        recursive: true,
      });
      writeFileSync(
        join(worktreePath, "spec", "test-spec", "intent.md"),
        "intent",
      );
      commitPlanInterview({
        worktreePath,
        name: "test-spec",
        mode: "inline",
        intentPathOrLabel: "x",
      });

      writeFileSync(
        join(worktreePath, "spec", "test-spec", "index.md"),
        "# Test\n",
      );
      writeFileSync(
        join(worktreePath, "spec", "test-spec", "00-task.md"),
        "# Task\n## Acceptance criteria\n- [ ] x\n",
      );

      commitPlanDraft({
        worktreePath,
        name: "test-spec",
        agentLabel: "Claude Opus 4.7",
        subspecCount: 1,
      });

      const trailerValue = execSync(
        'git log -1 --format="%(trailers:key=Jarvis-Agent,valueonly)"',
        { cwd: worktreePath, encoding: "utf8" },
      ).trim();
      expect(trailerValue).toBe("Claude Opus 4.7");
    } finally {
      cleanup();
    }
  });
});

describe("commitPlanReview", () => {
  test("writes plan: review N commit with Spec line and trailer", () => {
    const { worktreeRoot, cleanup } = setupPlanRemote();
    try {
      execSync("git branch plan/test-spec", { cwd: worktreeRoot });
      const worktreePath = join(worktreeRoot, "worktree");
      mkdirSync(worktreePath);
      execSync("git worktree add --no-checkout worktree plan/test-spec", {
        cwd: worktreeRoot,
      });
      execSync("git checkout plan/test-spec", { cwd: worktreePath });

      mkdirSync(join(worktreePath, "spec", "test-spec"), {
        recursive: true,
      });
      writeFileSync(
        join(worktreePath, "spec", "test-spec", "intent.md"),
        "intent",
      );
      commitPlanInterview({
        worktreePath,
        name: "test-spec",
        mode: "inline",
        intentPathOrLabel: "x",
      });

      // Stage some change to commit as review.
      writeFileSync(
        join(worktreePath, "spec", "test-spec", "index.md"),
        "# Reviewed\n",
      );

      commitPlanReview({
        worktreePath,
        name: "test-spec",
        passNumber: 1,
        agentLabel: "Codex GPT-5.3",
      });

      const msg = execSync("git log -1 --format=%B", {
        cwd: worktreePath,
        encoding: "utf8",
      });
      expect(msg).toContain("plan: review 1");
      expect(msg).toContain("Spec: spec/test-spec/intent.md");
      expect(msg).toContain("Reviewed by Codex GPT-5.3.");
      const trailerValue = execSync(
        'git log -1 --format="%(trailers:key=Jarvis-Agent,valueonly)"',
        { cwd: worktreePath, encoding: "utf8" },
      ).trim();
      expect(trailerValue).toBe("Codex GPT-5.3");
    } finally {
      cleanup();
    }
  });
});

describe("commitPlanBlocker", () => {
  test("body matches docs shape (Blocked by / Spec files to date / Raised by) and includes trailer", () => {
    const { worktreeRoot, cleanup } = setupPlanRemote();
    try {
      execSync("git branch plan/test-spec", { cwd: worktreeRoot });
      const worktreePath = join(worktreeRoot, "worktree");
      mkdirSync(worktreePath);
      execSync("git worktree add --no-checkout worktree plan/test-spec", {
        cwd: worktreeRoot,
      });
      execSync("git checkout plan/test-spec", { cwd: worktreePath });

      mkdirSync(join(worktreePath, "spec", "test-spec"), {
        recursive: true,
      });
      writeFileSync(
        join(worktreePath, "spec", "test-spec", "intent.md"),
        "intent\n\n## Blocker\nNeed clarification on X.\n",
      );
      commitPlanInterview({
        worktreePath,
        name: "test-spec",
        mode: "inline",
        intentPathOrLabel: "x",
      });

      // Modify intent so there's something to commit as blocker.
      writeFileSync(
        join(worktreePath, "spec", "test-spec", "intent.md"),
        "intent\n\n## Blocker\nNeed clarification on X.\nMore detail.\n",
      );

      commitPlanBlocker({
        worktreePath,
        name: "test-spec",
        agentLabel: "Claude Haiku",
        reason: "Need clarification on X.",
        specFilesCount: 3,
      });

      const msg = execSync("git log -1 --format=%B", {
        cwd: worktreePath,
        encoding: "utf8",
      });
      expect(msg).toContain("plan: blocker");
      expect(msg).toContain("Spec: spec/test-spec/intent.md");
      expect(msg).toContain("Blocked by Need clarification on X.");
      expect(msg).toContain("Spec files to date: 3");
      expect(msg).toContain("Raised by Claude Haiku.");
      const trailerValue = execSync(
        'git log -1 --format="%(trailers:key=Jarvis-Agent,valueonly)"',
        { cwd: worktreePath, encoding: "utf8" },
      ).trim();
      expect(trailerValue).toBe("Claude Haiku");
    } finally {
      cleanup();
    }
  });
});
