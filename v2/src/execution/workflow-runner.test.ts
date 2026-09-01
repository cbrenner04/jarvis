import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectSafeId } from "../../../shared/project-safe-id.ts";
import { jarvisHome } from "../paths.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import { excludeExternalSpecGitPaths } from "./external-spec-git.ts";
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
  test("commits only code from an external linked implement", async () => {
    const projectKey = "Org/External-Git-Surfaces";
    const { projectRoot, specReadRoot, indexPath, firstSubspecPath } = writeExternalPlanFixture(
      projectKey,
      "git-surfaces",
    );
    roots.push(projectRoot, specReadRoot);
    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
    writeFileSync(join(projectRoot, "README.md"), "base\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: projectRoot });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: projectRoot });
    const baseRef = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
    const shadowLink = join(projectRoot, "external-spec-link");
    const copiedSubspec = join(projectRoot, "00-work.md");
    const copiedIndex = join(projectRoot, "index.md");
    let invocation = 0;

    const step: WriteWorkflowStep = {
      ...createStep({
        stepId: "implement",
        role: "implement",
        branchName: "external-git-surfaces",
        promptId: "patch.prompt.body",
        stepRules: IMPLEMENT_WRITE_STEP_RULES,
        specPath: realpathSync(indexPath),
        expectedArtifactPath: realpathSync(indexPath),
        suppressShrink: true,
        createBinding: ({ agentId, adapterModel }) => ({
          id: `${agentId}/${adapterModel}`,
          metadata: { agent: agentId, model: adapterModel },
          invoke: async ({ prompt }) => {
            invocation += 1;
            const subspecPath = prompt.includes(realpathSync(firstSubspecPath))
              ? firstSubspecPath
              : join(specReadRoot, "01-more.md");
            writeFileSync(subspecPath, readFileSync(subspecPath, "utf8").replace("- [ ]", "- [x]"), "utf8");
            if (invocation === 1) {
              mkdirSync(join(projectRoot, "src"), { recursive: true });
              writeFileSync(join(projectRoot, "src", "feature.ts"), "export const feature = true;\n", "utf8");
              symlinkSync(specReadRoot, shadowLink, "dir");
              copyFileSync(firstSubspecPath, copiedSubspec);
              copyFileSync(indexPath, copiedIndex);
              const candidates = ["src/feature.ts", "external-spec-link", "00-work.md", "index.md"];
              expect(
                excludeExternalSpecGitPaths(projectRoot, candidates, {
                  externalPlanSpec: true,
                  specReadRoot,
                }),
              ).toEqual(["src/feature.ts"]);
              expect(excludeExternalSpecGitPaths(projectRoot, candidates, {})).toEqual(candidates);
            } else {
              rmSync(shadowLink, { force: true });
              rmSync(copiedSubspec, { force: true });
              rmSync(copiedIndex, { force: true });
            }
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          },
        }),
      }),
      externalPlanSpec: true,
      specReadRoot: realpathSync(specReadRoot),
      linkedIndexRouting: true,
      worktree: {
        projectRoot,
        projectName: "demo",
        branchName: "external-git-surfaces",
        baseRef,
        git: false,
        localPath: projectRoot,
      },
      withExternalWorktree: async <T>(
        _args: { branchName: string; projectName: string },
        run: (worktree: ExternalWorktree) => Promise<T> | T,
      ): Promise<WithExternalWorktreeResult<T>> => ({
        worktree: { path: projectRoot, reused: true },
        lock: { kind: "acquired" },
        value: await run({ path: projectRoot, reused: true }),
      }),
    };

    try {
      await withStateStore(async (store) => {
        const result = await executeWorkflow({
          steps: [step],
          stateStore: store,
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
        });
        expect(result.kind).toBe("complete");
      });

      const log = execFileSync("git", ["log", "--format=%s", "--name-only", `${baseRef}..HEAD`], {
        cwd: projectRoot,
        encoding: "utf8",
      });
      const diff = execFileSync("git", ["diff", "--name-only", `${baseRef}..HEAD`], {
        cwd: projectRoot,
        encoding: "utf8",
      });
      const tracked = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
        cwd: projectRoot,
        encoding: "utf8",
      });
      expect(log).toContain("src/feature.ts");
      expect(log).not.toMatch(/00-work\.md|01-more\.md|index\.md|external-spec-link/);
      expect(diff.trim()).toBe("src/feature.ts");
      expect(tracked).toContain("src/feature.ts");
      expect(tracked).not.toMatch(/00-work\.md|01-more\.md|index\.md|external-spec-link/);
      expect(execFileSync("git", ["status", "--porcelain"], { cwd: projectRoot, encoding: "utf8" })).toBe("");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(specReadRoot, { recursive: true, force: true });
    }
  });

  test("completes external linked subspecs in place while cwd stays in a spec-free worktree", async () => {
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
    let observedSecondPrompt = "";
    let indexBeforeSecondPass = "";
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
              observedSecondPrompt = prompt;
              indexBeforeSecondPass = readFileSync(indexPath, "utf8");
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
        expect(indexBeforeSecondPass).toContain("- [x] [Work](./00-work.md)");
        expect(indexBeforeSecondPass).toContain("- [ ] [More](./01-more.md)");
        expect(observedSecondPrompt).toContain(resolvedSecondSubspecPath);
        expect(observedSecondPrompt).toContain("- [ ] More");
        expect(readFileSync(indexPath, "utf8")).toContain("- [x] [Work](./00-work.md)");
        expect(readFileSync(indexPath, "utf8")).toContain("- [x] [More](./01-more.md)");
        expect(existsSync(join(worktreePath, "index.md"))).toBe(false);
        expect(existsSync(join(worktreePath, "00-work.md"))).toBe(false);
        expect(existsSync(join(worktreePath, "01-more.md"))).toBe(false);
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(specReadRoot, { recursive: true, force: true });
    }
  });

  test("routes external linked index through dirname(specPath) when specReadRoot is absent", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "step.externalPlanSpec === true" -> "step.externalPlanSpec !== true"
    const projectKey = "Org/External-Linked-Fallback";
    const planName = "feature-fallback";
    const { projectRoot, specReadRoot, indexPath, firstSubspecPath } = writeExternalPlanFixture(projectKey, planName);
    roots.push(projectRoot, specReadRoot);

    const homeJarvisRoot = join(mkdtempSync(join(tmpdir(), "workflow-runner-external-home-")), ".jarvis");
    roots.push(homeJarvisRoot);
    const branchName = "external-linked-fallback";
    const worktreePath = join(homeJarvisRoot, "worktrees", "demo", branchName);
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, "README.md"), "implement only\n", "utf8");

    const resolvedFirstSubspecPath = realpathSync(firstSubspecPath);
    const resolvedSecondSubspecPath = realpathSync(join(specReadRoot, "01-more.md"));
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
          invoke: async ({ prompt }) => {
            implementInvocations += 1;
            if (implementInvocations === 1) {
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
        expect(observedPrompt).toContain(resolvedFirstSubspecPath);
        expect(readFileSync(indexPath, "utf8")).toContain("- [x] [Work](./00-work.md)");
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(specReadRoot, { recursive: true, force: true });
    }
  });
});
