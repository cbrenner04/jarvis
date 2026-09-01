import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectSafeId } from "../../../shared/project-safe-id.ts";
import { jarvisHome } from "../paths.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import type { ExternalWorktree, WithExternalWorktreeResult } from "./external-worktree.ts";
import { createStep, roots } from "./workflow-runner.test-support.ts";
import { executeWorkflow, type WriteWorkflowStep } from "./workflow-runner.ts";
import { IMPLEMENT_WRITE_STEP_RULES } from "./write-loop-input.ts";

function writeExternalPlanFixture(
  projectKey: string,
  planName: string,
): {
  projectRoot: string;
  specReadRoot: string;
  indexPath: string;
  firstSubspecPath: string;
} {
  const projectRoot = mkdtempSync(join(tmpdir(), "workflow-runner-external-project-"));
  const safeId = projectSafeId(projectKey);
  const specReadRoot = join(jarvisHome(), "specs", safeId, "plans", planName);
  mkdirSync(specReadRoot, { recursive: true });
  const firstSubspecPath = join(specReadRoot, "00-work.md");
  writeFileSync(join(specReadRoot, "index.md"), "- [ ] [Work](./00-work.md)\n- [ ] [More](./01-more.md)\n", "utf8");
  writeFileSync(firstSubspecPath, "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n", "utf8");
  writeFileSync(join(specReadRoot, "01-more.md"), "# More\n\n## Acceptance criteria\n\n- [ ] More\n", "utf8");
  return {
    projectRoot,
    specReadRoot,
    indexPath: join(specReadRoot, "index.md"),
    firstSubspecPath,
  };
}

describe("executeWorkflow external linked implement routing", () => {
  test("routes admitted external plan indexes through specReadRoot while cwd stays in the worktree", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "resolveLinkedImplementRoutingRoot(step, worktreePath)" -> "worktreePath"
    const projectKey = "Org/External-Linked";
    const planName = "feature";
    const { projectRoot, specReadRoot, indexPath, firstSubspecPath } = writeExternalPlanFixture(projectKey, planName);
    roots.push(projectRoot, specReadRoot);

    const homeJarvisRoot = join(mkdtempSync(join(tmpdir(), "workflow-runner-external-home-")), ".jarvis");
    roots.push(homeJarvisRoot);
    const branchName = "external-linked-routing";
    const worktreePath = join(homeJarvisRoot, "worktrees", "demo", branchName);
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, "README.md"), "implement only\n", "utf8");

    const resolvedFirstSubspecPath = realpathSync(firstSubspecPath);
    const resolvedSecondSubspecPath = realpathSync(join(specReadRoot, "01-more.md"));
    let observedCwd = "";
    let observedPrompt = "";
    let implementInvocations = 0;

    const implementStep: WriteWorkflowStep = {
      ...createStep({
        stepId: "implement",
        role: "implement",
        branchName,
        promptId: "patch.prompt.body",
        stepRules: IMPLEMENT_WRITE_STEP_RULES,
        specPath: realpathSync(indexPath),
        expectedArtifactPath: realpathSync(indexPath),
        createBinding: ({ agentId, adapterModel }) => ({
          id: `${agentId}/${adapterModel}`,
          invoke: async ({ cwd, prompt }) => {
            implementInvocations += 1;
            if (implementInvocations === 1) {
              observedCwd = cwd;
              observedPrompt = prompt;
            }
            if (prompt.includes(resolvedFirstSubspecPath)) {
              writeFileSync(resolvedFirstSubspecPath, "# Work\n\n## Acceptance criteria\n\n- [x] Work\n", "utf8");
            } else if (prompt.includes(resolvedSecondSubspecPath)) {
              writeFileSync(resolvedSecondSubspecPath, "# More\n\n## Acceptance criteria\n\n- [x] More\n", "utf8");
            }
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          },
          metadata: { agent: agentId, model: adapterModel },
        }),
      }),
      externalPlanSpec: true,
      specReadRoot: realpathSync(specReadRoot),
      linkedIndexRouting: true,
      worktree: {
        projectRoot,
        projectName: "demo",
        branchName,
        baseRef: "HEAD",
        jarvisRoot: homeJarvisRoot,
      },
      withExternalWorktree: async <T>(
        args: { branchName: string; projectName: string },
        run: (worktree: ExternalWorktree) => Promise<T> | T,
      ): Promise<WithExternalWorktreeResult<T>> => {
        const wtPath = join(homeJarvisRoot, "worktrees", args.projectName, args.branchName);
        const existed = existsSync(wtPath);
        mkdirSync(wtPath, { recursive: true });
        const value = await run({ path: wtPath, reused: existed });
        return { worktree: { path: wtPath, reused: existed }, lock: { kind: "acquired" }, value };
      },
    };

    try {
      await withStateStore(async (store) => {
        const result = await executeWorkflow({ steps: [implementStep], stateStore: store });

        expect(result.kind).toBe("complete");
        expect(observedCwd).toBe(worktreePath);
        expect(observedPrompt).toContain(resolvedFirstSubspecPath);
        expect(observedPrompt).toContain("## Acceptance criteria");
        expect(observedPrompt).toContain("- [ ] Work");
        expect(readFileSync(indexPath, "utf8")).toContain("- [x] [Work](./00-work.md)");
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(specReadRoot, { recursive: true, force: true });
    }
  });
});
