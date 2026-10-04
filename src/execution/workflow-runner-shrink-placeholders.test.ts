import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../shared/subprocess.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { createStep } from "./workflow-runner.test-support.ts";
import { ShrinkSpecTreeContractError, shrinkPromptPlaceholders, type WriteWorkflowStep } from "./workflow-runner.ts";

function initForkedLaneAtMergeBase(): { worktreePath: string } {
  const worktreePath = trackedMkdtempSync(join(tmpdir(), "shrink-merge-base-"));
  execSync("git init -q", { cwd: worktreePath, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: worktreePath, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: worktreePath, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: worktreePath, stdio: "pipe" });
  execSync("git branch -M main", { cwd: worktreePath, stdio: "pipe" });
  writeFileSync(join(worktreePath, "x.txt"), "x-at-b\n");
  writeFileSync(join(worktreePath, "y.txt"), "y-at-b\n");
  writeFileSync(join(worktreePath, "z.txt"), "z-at-b\n");
  mkdirSync(join(worktreePath, "spec/test"), { recursive: true });
  writeFileSync(join(worktreePath, "spec/test/index.md"), "# spec\n");
  execSync("git add -A", { cwd: worktreePath, stdio: "pipe" });
  execSync('git commit -q -m "fork base"', { cwd: worktreePath, stdio: "pipe" });
  execSync("git branch -q lane", { cwd: worktreePath, stdio: "pipe" });
  execSync("git checkout -q main", { cwd: worktreePath, stdio: "pipe" });
  writeFileSync(join(worktreePath, "x.txt"), "x-on-main\n");
  writeFileSync(join(worktreePath, "w.txt"), "w-on-main\n");
  execSync("git rm -q z.txt", { cwd: worktreePath, stdio: "pipe" });
  execSync("git add -A", { cwd: worktreePath, stdio: "pipe" });
  execSync('git commit -q -m "advance main"', { cwd: worktreePath, stdio: "pipe" });
  execSync("git checkout -q lane", { cwd: worktreePath, stdio: "pipe" });
  return { worktreePath };
}

function laneShrinkStep(worktreePath: string): WriteWorkflowStep {
  const step = createStep({
    stepId: "implement",
    role: "implement",
    branchName: "lane",
    specPath: "spec/test/index.md",
    expectedArtifactPath: "spec/test/index.md",
  });
  step.worktree = {
    ...step.worktree,
    projectRoot: worktreePath,
    projectName: "demo",
    branchName: "lane",
    baseRef: "main",
    localPath: worktreePath,
  };
  return step;
}

function commitLaneEdit(worktreePath: string): void {
  writeFileSync(join(worktreePath, "y.txt"), "y-lane\n");
  execSync("git add y.txt", { cwd: worktreePath, stdio: "pipe" });
  execSync('git commit -q -m "lane y"', { cwd: worktreePath, stdio: "pipe" });
}

describe("shrinkPromptPlaceholders", () => {
  test("omits paths changed only on main after the lane fork", async () => {
    const { worktreePath } = initForkedLaneAtMergeBase();
    commitLaneEdit(worktreePath);

    const placeholders = await shrinkPromptPlaceholders(laneShrinkStep(worktreePath));

    expect(placeholders.ALLOWLIST).toContain("- y.txt");
    expect(placeholders.ALLOWLIST).not.toContain("w.txt");
    expect(placeholders.ALLOWLIST).not.toContain("x.txt");
    expect(placeholders.ALLOWLIST).not.toContain("z.txt");
    expect(placeholders.BRANCH_DIFF).not.toContain("w.txt");
    expect(placeholders.BRANCH_DIFF).not.toContain("x.txt");
    expect(placeholders.RUN_SCOPED_DIFF).not.toContain("w.txt");
    expect(placeholders.RUN_SCOPED_DIFF).not.toContain("x.txt");
  });

  test("uses baseRef when lane merge-base cannot be resolved", async () => {
    const { worktreePath } = initForkedLaneAtMergeBase();
    commitLaneEdit(worktreePath);
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd, opts) => {
        if (cmd === "git" && args[0] === "merge-base") return "";
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd, opts);
      },
    };

    const placeholders = await shrinkPromptPlaceholders(laneShrinkStep(worktreePath), runner);

    expect(placeholders.ALLOWLIST).toContain("w.txt");
  });

  test("a root-level spec file renders alone instead of walking the repository", async () => {
    const { worktreePath } = initForkedLaneAtMergeBase();
    writeFileSync(join(worktreePath, ".jarvis-review-feedback-response.md"), "- t1: addressed\n");
    writeFileSync(join(worktreePath, "README.md"), "REPO-CONTENT-MARKER\n");
    const step = laneShrinkStep(worktreePath);
    step.specPath = ".jarvis-review-feedback-response.md";

    const placeholders = await shrinkPromptPlaceholders(step);

    expect(placeholders.SPEC_TREE).toBe("## .jarvis-review-feedback-response.md\n\n- t1: addressed\n");
  });

  test("a repository-root spec directory rejects with a named contract error", async () => {
    const { worktreePath } = initForkedLaneAtMergeBase();
    const step = laneShrinkStep(worktreePath);
    step.specPath = ".";

    await expect(shrinkPromptPlaceholders(step)).rejects.toBeInstanceOf(ShrinkSpecTreeContractError);
  });

  test("a missing root-level spec file renders an empty tree, not the repository", async () => {
    const { worktreePath } = initForkedLaneAtMergeBase();
    writeFileSync(join(worktreePath, "README.md"), "REPO-CONTENT-MARKER\n");
    const step = laneShrinkStep(worktreePath);
    step.specPath = "absent.md";

    const placeholders = await shrinkPromptPlaceholders(step);

    expect(placeholders.SPEC_TREE).toBe("(empty spec tree)");
  });

  test("a spec directory path renders only that tree", async () => {
    const { worktreePath } = initForkedLaneAtMergeBase();
    writeFileSync(join(worktreePath, "README.md"), "REPO-CONTENT-MARKER\n");
    const step = laneShrinkStep(worktreePath);
    step.specPath = "spec/test";

    const placeholders = await shrinkPromptPlaceholders(step);

    expect(placeholders.SPEC_TREE).toContain("# spec");
    expect(placeholders.SPEC_TREE).not.toContain("REPO-CONTENT-MARKER");
  });
});
