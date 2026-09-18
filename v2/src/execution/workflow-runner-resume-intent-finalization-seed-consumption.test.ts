import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import { seedFailedIntentReviewResumeRun, writeLintCleanIntentStageFile } from "./workflow-runner.test-support.ts";
import { DEFAULT_STAGED_MARKDOWN_LINT_RUNNER } from "./workflow-runner-resume.test-support.ts";
import {
  INTENT_RESUME_LANDING_INPUTS_NOT_RECORDED,
  resolveIntentFinalizationResumeContext,
  resumePopulatedIntentPublication,
} from "./workflow-runner-resume.ts";

describe("intent finalization resume seed consumption", () => {
  function stagedWorkspaceWithSeed(prefix: string): { workspace: string; sourceRoot: string; seedPath: string } {
    const workspace = trackedMkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeLintCleanIntentStageFile(join(workspace, ".jarvis-intent-stage"), "example.md");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });
    // A git-disabled worktree consumes from the source root, as the intent builder records it.
    const sourceRoot = trackedMkdtempSync(join(tmpdir(), `${prefix}source-`));
    const seedPath = join(sourceRoot, "example.md");
    writeFileSync(seedPath, "seed\n", "utf8");
    return { workspace, sourceRoot, seedPath };
  }

  test("intent resume consumes the seed recorded in the persisted landing inputs", async () => {
    const { workspace, sourceRoot, seedPath } = stagedWorkspaceWithSeed("intent-resume-consumes-seed-");
    await withStateStore(async (store) => {
      const reviewRunId = seedFailedIntentReviewResumeRun(store, workspace, {
        branch: "intent/consumes-seed",
        invocationId: "intent-consumes-seed",
        landingInputs: { sourceRoot, paths: [seedPath], consumeFrom: "source" },
      });
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");

      const outcome = await resumePopulatedIntentPublication(run, store, {
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome).toMatchObject({ ok: true });
      expect(existsSync(join(workspace, "ready-intents", "example.md"))).toBe(true);
      expect(existsSync(seedPath)).toBe(false);
    });
  });

  test("intent resume without recorded landing inputs refuses instead of publishing", async () => {
    const { workspace, seedPath } = stagedWorkspaceWithSeed("intent-resume-no-inputs-");
    await withStateStore(async (store) => {
      const reviewRunId = seedFailedIntentReviewResumeRun(store, workspace, {
        branch: "intent/no-inputs",
        invocationId: "intent-no-inputs",
        landingInputs: null,
      });
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");

      expect(resolveIntentFinalizationResumeContext(run, store)).toEqual({
        ok: false,
        message: INTENT_RESUME_LANDING_INPUTS_NOT_RECORDED,
      });
      let committed = false;
      const outcome = await resumePopulatedIntentPublication(run, store, {
        completionCommitter: async () => {
          committed = true;
          return { commitSha: "commit-1" };
        },
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome).toEqual({ ok: false, message: INTENT_RESUME_LANDING_INPUTS_NOT_RECORDED });
      expect(committed).toBe(false);
      expect(readdirSync(join(workspace, "ready-intents"))).toEqual([]);
      expect(existsSync(join(workspace, ".jarvis-intent-stage", "example.md"))).toBe(true);
      expect(existsSync(seedPath)).toBe(true);
      expect(store.loadRun(reviewRunId)?.status).toBe("failed");
    });
  });
});
