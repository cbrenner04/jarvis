import { afterEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realAsyncSubprocessRunner } from "../subprocess.ts";
import {
  type ReviewDebateRenderContext,
  renderPatchReviewCriticPrompt,
  renderReviewDebateCyclePrompts,
} from "./review-implement.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function extractBranchDiff(rendered: string): string {
  const match = rendered.match(/<<<DIFF_BEGIN>>>\n([\s\S]*?)\n<<<DIFF_END>>>/);
  expect(match).not.toBeNull();
  if (!match?.[1]) throw new Error("branch diff not found in rendered prompt");
  return match[1].trim();
}

function reviewContext(): ReviewDebateRenderContext {
  const cwd = mkdtempSync(join(tmpdir(), "review-implement-branch-diff-"));
  tempDirs.push(cwd);
  execSync("git init -b main", { cwd, stdio: "pipe" });
  // CI runners have no global git identity; committing without one fails there but not locally.
  execSync("git config user.email test@example.com", { cwd, stdio: "pipe" });
  execSync("git config user.name Test", { cwd, stdio: "pipe" });
  writeFileSync(join(cwd, "README.md"), "base\n");
  execSync("git add README.md && git commit -m init", { cwd, stdio: "pipe" });
  execSync("git branch develop", { cwd, stdio: "pipe" });
  writeFileSync(join(cwd, "main-only.txt"), "main\n");
  execSync("git add main-only.txt && git commit -m main-only", { cwd, stdio: "pipe" });
  execSync("git checkout develop", { cwd, stdio: "pipe" });
  writeFileSync(join(cwd, "develop-only.txt"), "develop\n");
  execSync("git add develop-only.txt && git commit -m develop-only", { cwd, stdio: "pipe" });
  execSync("git checkout -b feature", { cwd, stdio: "pipe" });
  writeFileSync(join(cwd, "feature.txt"), "added\n");
  execSync("git add feature.txt && git commit -m feature", { cwd, stdio: "pipe" });
  mkdirSync(join(cwd, "spec"), { recursive: true });
  writeFileSync(join(cwd, "spec/00-task.md"), "# Task\n\n- [x] done\n");
  return { specPath: "spec/00-task.md", cwd, passNumber: 1, totalPasses: 1, baseBranch: "develop" };
}

describe("renderPatchReviewCriticPrompt branch diff", () => {
  test("renders stat, changed paths, and merge-base unified diff for critic and debate roles", async () => {
    const context = reviewContext();
    const runner = realAsyncSubprocessRunner;
    const critic = await renderPatchReviewCriticPrompt(context, runner);
    const debate = await renderReviewDebateCyclePrompts(context, {}, runner);
    // @mutate shared/prompts/review-implement.ts "adversary: \"implement.prompt.review.adversary\"," -> "adversary: \"patch.prompt.review.adversary\","
    const payloads = [critic, debate.adversary, debate.advocate, debate.adjudicator].map(extractBranchDiff);
    for (const branchDiff of payloads) {
      expect(branchDiff).toContain("Changed paths:");
      expect(branchDiff).toContain("feature.txt");
      expect(branchDiff).not.toContain("develop-only.txt");
      expect(branchDiff).toContain("diff --git");
      expect(branchDiff).toContain("@@");
    }
    const mainBaseDiff = extractBranchDiff(
      await renderPatchReviewCriticPrompt({ ...context, baseBranch: "main" }, runner),
    );
    expect(mainBaseDiff).toContain("develop-only.txt");
    expect(mainBaseDiff).not.toEqual(payloads[0]);
    // Critic and all three debate roles render implement.prompt.review.* prompts, each carrying
    // the merge-base unified-diff section — no role should fall back to patch's summary-only wording.
    for (const rendered of [critic, debate.adversary, debate.advocate, debate.adjudicator]) {
      expect(rendered).toContain("merge-base branch diff");
      expect(rendered).not.toContain("not a unified diff");
      // Pin the provenance sentence: each role must be told where the diff comes from, so a
      // reviewer knows the payload is base-relative rather than a working-tree diff.
      expect(rendered).toContain("git merge-base <base> HEAD");
      expect(rendered).toContain("git diff <mergeBase> HEAD");
    }
    expect(new Set(payloads).size).toBe(1);
  });
});
