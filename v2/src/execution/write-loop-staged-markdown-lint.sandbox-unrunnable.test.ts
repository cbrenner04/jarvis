// Exercises the real markdownlint-cli2 binary via executeWriteLoop's plan-draft staged-lint gate.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openStateStore } from "../persistence/state-store.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import type { withExternalWorktree } from "./external-worktree.ts";
import { REVIEW_MD_LINT_FIXTURE_IDS, readReviewMdLintFixture, TestLogSink } from "./workflow-runner.test-support.ts";
import { executeWriteLoop } from "./write-loop.ts";

const { roots } = trackedTempRoots();

function gitAwareWorktree(jarvisRoot: string): typeof withExternalWorktree {
  const base = createFakeWithExternalWorktree(jarvisRoot);
  return async (args, run) =>
    base(args, async (worktree) => {
      if (!existsSync(join(worktree.path, ".git"))) {
        const git = (...gitArgs: string[]) => execFileSync("git", gitArgs, { cwd: worktree.path });
        git("init", "-q");
        git("config", "user.email", "test@example.com");
        git("config", "user.name", "Test");
        git("add", "-A");
        git("commit", "-qm", "baseline");
      }
      return run(worktree);
    });
}

function writePlanStage(stage: string, subspec: string): void {
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "intent.md"), "---\nname: test\n---\n", "utf8");
  writeFileSync(join(stage, "index.md"), "# Index\n\n- [ ] [00 - One](./00-one.md)\n", "utf8");
  writeFileSync(join(stage, "00-one.md"), subspec, "utf8");
}

type RealLintRun = {
  result: Awaited<ReturnType<typeof executeWriteLoop>>;
  prompts: string[];
  sink: TestLogSink;
  stage: string;
};

async function runPlanDraftWithRealLint(firstFixture: string, thenFixture: string): Promise<RealLintRun> {
  const { jarvisRoot, stateDbPath } = createJarvisHome();
  roots.push(join(jarvisRoot, ".."));
  const store = openStateStore(stateDbPath);
  const sink = new TestLogSink();
  const prompts: string[] = [];
  let stage = "";
  try {
    const result = await executeWriteLoop({
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: `plan-md-lint-real-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        baseRef: "HEAD",
        jarvisRoot,
      },
      specPath: "v2/spec/2099-01-01T00-00-00Z-plan-draft",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: ".jarvis-plan-stage",
      promptId: "plan.prompt.draft",
      intentSeed: "---\nname: test\n---\n\n## Prerequisites\n\nnone\n",
      publishCompletion: false,
      freshDispatch: true,
      maxIterations: 3,
      logSink: sink,
      stateStore: store,
      withExternalWorktree: gitAwareWorktree(jarvisRoot),
      sessionsDir: join(jarvisRoot, "sessions"),
      bindings: [
        {
          id: "draft",
          metadata: { agent: "test-agent", model: "test" },
          invoke: async ({ cwd, prompt }) => {
            prompts.push(prompt);
            stage = join(cwd, ".jarvis-plan-stage");
            writePlanStage(stage, readReviewMdLintFixture(prompts.length === 1 ? firstFixture : thenFixture));
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });
    return { result, prompts, sink, stage };
  } finally {
    store.close();
  }
}

describe("executeWriteLoop staged Markdown lint (real markdownlint binary)", () => {
  test("a real fixable MD012 violation is autofixed in place and finalizes without a reprompt", async () => {
    const { result, prompts, sink, stage } = await runPlanDraftWithRealLint(
      REVIEW_MD_LINT_FIXTURE_IDS.planMd012ViolationSubspec,
      REVIEW_MD_LINT_FIXTURE_IDS.planMd012CleanSubspec,
    );

    expect(result.kind).toBe("complete");
    expect(prompts).toHaveLength(1);
    expect(
      sink.getEventsForRun(result.runId).find((event) => event.kind === "staged_markdown_lint_reprompt"),
    ).toBeUndefined();
    // Mutation checkpoint: dropping `--fix` from the staged lint args must turn this RED.
    expect(readFileSync(join(stage, "00-one.md"), "utf8")).not.toContain("\n\n\n");
  });

  test("a real violation the autofix cannot repair reprompts the plan draft before finalize", async () => {
    const { result, prompts, sink } = await runPlanDraftWithRealLint(
      REVIEW_MD_LINT_FIXTURE_IDS.planMd025ViolationSubspec,
      REVIEW_MD_LINT_FIXTURE_IDS.planMd012CleanSubspec,
    );

    expect(result.kind).toBe("complete");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("MD025");
    expect(
      sink.getEventsForRun(result.runId).find((event) => event.kind === "staged_markdown_lint_reprompt"),
    ).toMatchObject({
      ruleId: "MD025",
      offendingFile: ".jarvis-plan-stage/00-one.md",
    });
  });
});
