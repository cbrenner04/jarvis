import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStateStore } from "../testing/write-fixtures.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "./workflow-runner.test-support.ts";
import { reconstructPausedWriteResumeInput } from "./workflow-runner-resume.ts";

describe("reconstructPausedWriteResumeInput", () => {
  test("threads specReadRoot and absolute expectedArtifactPath for a paused external implement~link-N row", async () => {
    const specReadRoot = mkdtempSync(join(tmpdir(), "paused-linked-external-spec-"));
    const indexPath = join(specReadRoot, "index.md");
    const firstSubspecPath = join(specReadRoot, "00-work.md");
    writeFileSync(indexPath, "- [ ] [Work](./00-work.md)\n- [ ] [More](./01-more.md)\n", "utf8");
    writeFileSync(firstSubspecPath, "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n", "utf8");
    writeFileSync(join(specReadRoot, "01-more.md"), "# More\n\n## Acceptance criteria\n\n- [ ] More\n", "utf8");
    const resolvedSpecReadRoot = realpathSync(specReadRoot);
    const resolvedIndexPath = realpathSync(indexPath);
    const resolvedFirstSubspecPath = realpathSync(firstSubspecPath);
    const worktreePath = mkdtempSync(join(tmpdir(), "paused-linked-external-worktree-"));

    await withStateStore(async (store) => {
      const snapshot = {
        invocationId: "paused-linked-external",
        steps: [
          {
            stepId: "implement",
            role: "implement",
            stepRules: "implement rules",
            expectedArtifactPath: resolvedIndexPath,
            externalPlanSpec: true as const,
            specReadRoot: resolvedSpecReadRoot,
            agents: ["codex"],
            agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
          },
        ],
      };
      const runId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath,
        branch: "paused-linked/external",
        specPath: resolvedIndexPath,
        stepId: "implement~link-0",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(runId, "paused");

      const run = store.loadRun(runId);
      if (!run) throw new Error("expected paused linked run");
      const reconstructed = reconstructPausedWriteResumeInput(run);
      expect(reconstructed.ok).toBe(true);
      if (!reconstructed.ok) return;
      expect(reconstructed.input.resumeReentry).toBe(true);
      expect(reconstructed.input.specReadRoot).toBe(resolvedSpecReadRoot);
      expect(reconstructed.input.expectedArtifactPath).toBe(resolvedFirstSubspecPath);
    });

    rmSync(specReadRoot, { recursive: true, force: true });
    rmSync(worktreePath, { recursive: true, force: true });
  });

  test("threads worktree-relative expectedArtifactPath without specReadRoot for a paused in-repo implement~link-N row", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "paused-linked-in-repo-"));
    writeFileSync(join(worktreePath, "index.md"), "- [ ] [One](./one.md)\n- [ ] [Two](./two.md)\n", "utf8");
    writeFileSync(join(worktreePath, "one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] One\n", "utf8");
    writeFileSync(join(worktreePath, "two.md"), "# Two\n\n## Acceptance criteria\n\n- [ ] Two\n", "utf8");

    await withStateStore(async (store) => {
      const snapshot = {
        invocationId: "paused-linked-in-repo",
        steps: [
          {
            stepId: "implement",
            role: "implement",
            stepRules: "implement rules",
            expectedArtifactPath: "index.md",
            agents: ["codex"],
            agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
          },
        ],
      };
      const runId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath,
        branch: "paused-linked/in-repo",
        specPath: "index.md",
        stepId: "implement~link-1",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(runId, "paused");

      const run = store.loadRun(runId);
      if (!run) throw new Error("expected paused linked run");
      const reconstructed = reconstructPausedWriteResumeInput(run);
      expect(reconstructed.ok).toBe(true);
      if (!reconstructed.ok) return;
      expect(reconstructed.input.resumeReentry).toBe(true);
      expect(reconstructed.input.specReadRoot).toBeUndefined();
      expect(reconstructed.input.expectedArtifactPath).toBe("two.md");
    });

    rmSync(worktreePath, { recursive: true, force: true });
  });
});
