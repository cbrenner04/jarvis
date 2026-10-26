import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { openStateStore, type PipelineContext, type StateStore } from "../persistence/state-store.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../shared/subprocess.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import { createJarvisHome } from "../testing/write-fixtures.ts";

export const HAND_PUBLISHED_CHAINED_DEFINITION: PipelineDefinition = {
  name: "hand-published",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

export type HandFinishedFixture = {
  repoRoot: string;
  configPath: string;
  context: PipelineContext;
  store: StateStore;
  pipelineId: string;
  planRunId: string;
  planWorktree: string;
  planBranch: string;
  laneBranch: string;
  defaultBranch: string;
  dispose: () => void;
};

function initGitRepo(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
}

export function ghPrListRunner(
  projectRoot: string,
  rows: Array<{ number: number; url: string; state: "OPEN" | "MERGED" | "CLOSED" }>,
): AsyncSubprocessRunner {
  return {
    runAsync: async (cmd, args, cwd) => {
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
        return JSON.stringify(rows.map((row) => ({ ...row, baseRefName: "main", isDraft: false })));
      }
      return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
    },
  };
}

export function setupHandFinishedImplement(completeSpec: boolean): HandFinishedFixture {
  const repoRoot = trackedMkdtempSync(join(tmpdir(), "hand-published-lane-"));
  initGitRepo(repoRoot);
  writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repoRoot });
  const defaultBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();

  const readyIntentRel = "spec/ready-intents/feature.md";
  const intentBranch = "intent/feature";
  const intentWorktree = join(repoRoot, ".jarvis-worktrees", intentBranch);
  mkdirSync(intentWorktree, { recursive: true });
  execFileSync("git", ["branch", intentBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", intentWorktree, intentBranch], { cwd: repoRoot });
  mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
  writeFileSync(join(intentWorktree, readyIntentRel), "---\nname: feature\n---\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: intentWorktree });
  execFileSync("git", ["commit", "-qm", "intent"], { cwd: intentWorktree });

  const planBranch = "plan/feature";
  const planSpecDir = "spec/feature";
  const planWorktree = join(repoRoot, ".jarvis-worktrees", planBranch);
  mkdirSync(planWorktree, { recursive: true });
  execFileSync("git", ["branch", planBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", planWorktree, planBranch], { cwd: repoRoot });
  mkdirSync(join(planWorktree, planSpecDir), { recursive: true });
  const box = completeSpec ? "x" : " ";
  writeFileSync(
    join(planWorktree, `${planSpecDir}/index.md`),
    `# Feature\n\n- [${box}] [Work](./00-work.md)\n`,
    "utf8",
  );
  writeFileSync(
    join(planWorktree, `${planSpecDir}/00-work.md`),
    `# Work\n\n## Acceptance criteria\n\n- [${box}] Work\n`,
    "utf8",
  );
  execFileSync("git", ["add", "-A"], { cwd: planWorktree });
  execFileSync("git", ["commit", "-qm", "plan"], { cwd: planWorktree });

  const previousJarvisHome = process.env.JARVIS_HOME;
  const { jarvisRoot } = createJarvisHome();
  process.env.JARVIS_HOME = jarvisRoot;
  const configPath = writeHomeMachineConfig({ projects: { demo: { root: repoRoot, specs: "repo" } } });

  const context: PipelineContext = { cwd: repoRoot, configPath, seed: "unused" };
  const store = openStateStore(":memory:");
  const pipelineId = store.createPipeline({ definition: HAND_PUBLISHED_CHAINED_DEFINITION, context });
  const intentRunId = store.createRun({
    project: "demo",
    specRef: defaultBranch,
    worktreePath: intentWorktree,
    branch: intentBranch,
    specPath: readyIntentRel,
  });
  const planRunId = store.createRun({
    project: "demo",
    specRef: defaultBranch,
    worktreePath: planWorktree,
    branch: planBranch,
    specPath: planSpecDir,
  });
  store.updateStage({
    pipelineId,
    stageId: "intent",
    patch: { status: "succeeded", artifact: { entryRunId: intentRunId, specPath: readyIntentRel } },
  });
  store.updateStage({
    pipelineId,
    stageId: "plan",
    patch: {
      status: "succeeded",
      artifact: { entryRunId: planRunId, specPath: planSpecDir },
      workflowInvocationId: planRunId,
    },
  });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    patch: { status: "pending" },
  });

  return {
    repoRoot,
    configPath,
    context,
    store,
    pipelineId,
    planRunId,
    planWorktree,
    planBranch,
    laneBranch: "feature",
    defaultBranch,
    dispose: () => {
      store.close();
      process.env.JARVIS_HOME = previousJarvisHome;
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(join(jarvisRoot, ".."), { recursive: true, force: true });
    },
  };
}
