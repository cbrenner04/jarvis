import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LogSink } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import type { InvocationBinding } from "../shared/invocation/execute.ts";
import { PLAN_DRAFT_PROMPT_ID } from "../shared/prompts/plan-draft.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import type { StepRunResult } from "./step-runner.ts";
import { createStubMarkdownlintRunner, TestLogSink } from "./workflow-runner.test-support.ts";
import { executeWriteLoop, isEligibleDraftContractReprompt, type WriteLoopInput } from "./write-loop.ts";

const { roots } = trackedTempRoots();
const PLAN_DRAFT_INTENT_SEED = "---\nname: test\n---\n\n## Prerequisites\n\nnone\n";
const PLAN_DRAFT_SPEC_PATH = "v2/spec/2099-01-01T00-00-00Z-plan-draft";
const markdownlintRunner = createStubMarkdownlintRunner();

const planDraftArgs = { promptId: PLAN_DRAFT_PROMPT_ID } as WriteLoopInput;
const miss = (failureReason: string) =>
  ({ kind: "contract_miss", token: "done", failedContractId: "artifact.exists", failureReason }) as StepRunResult;

async function runPlanDraftLoop(args: {
  jarvisRoot: string;
  stateDbPath: string;
  branchName: string;
  bindings: readonly InvocationBinding[];
  logSink?: LogSink;
}) {
  roots.push(join(args.jarvisRoot, ".."));
  const store = openStateStore(args.stateDbPath);
  const loopInput: WriteLoopInput = {
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: args.branchName,
      baseRef: "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    specPath: PLAN_DRAFT_SPEC_PATH,
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: ".jarvis-plan-stage",
    promptId: "plan.prompt.draft",
    intentSeed: PLAN_DRAFT_INTENT_SEED,
    publishCompletion: false,
    freshDispatch: true,
    bindings: args.bindings,
    stateStore: store,
    withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
    sessionsDir: join(args.jarvisRoot, "sessions"),
    ...(args.logSink !== undefined ? { logSink: args.logSink } : {}),
  };
  try {
    return await executeWriteLoop({ ...loopInput, stagedMarkdownLintRunner: markdownlintRunner });
  } finally {
    store.close();
  }
}

describe("isEligibleDraftContractReprompt", () => {
  test("a non-shape plan-draft artifact miss is eligible", () => {
    expect(isEligibleDraftContractReprompt(planDraftArgs, miss("Plan index links unknown subspec 02-second.md"))).toBe(
      true,
    );
  });

  test("bare plan.draft.shape and missing-dir are ineligible; repairable suffixes are eligible", () => {
    expect(isEligibleDraftContractReprompt(planDraftArgs, miss("plan.draft.shape"))).toBe(false);
    expect(isEligibleDraftContractReprompt(planDraftArgs, miss("plan.draft.shape:missing-dir"))).toBe(false);
    expect(isEligibleDraftContractReprompt(planDraftArgs, miss("plan.draft.shape:no-index"))).toBe(true);
    expect(isEligibleDraftContractReprompt(planDraftArgs, miss("plan.draft.shape:no-subspecs"))).toBe(true);
    expect(isEligibleDraftContractReprompt(planDraftArgs, miss("plan.draft.shape:nested-roots=2"))).toBe(true);
  });
});

describe("plan-draft shape draft contract reprompt", () => {
  test("plan.draft.shape:no-subspecs miss reprompts once with flat-layout detail then re-evaluates", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    let invocations = 0;

    const result = await runPlanDraftLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "plan-draft-shape-no-subspecs-reprompt",
      logSink: sink,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            invocations += 1;
            const stagePath = join(cwd, ".jarvis-plan-stage");
            mkdirSync(stagePath, { recursive: true });
            writeFileSync(join(stagePath, "intent.md"), PLAN_DRAFT_INTENT_SEED, "utf8");
            writeFileSync(join(stagePath, "index.md"), "# Index\n\n", "utf8");
            if (invocations >= 2) {
              writeFileSync(
                join(stagePath, "00-one.md"),
                "# One\n\n## Acceptance criteria\n\n- [ ] Valid criterion.\n",
                "utf8",
              );
              writeFileSync(join(stagePath, "index.md"), "# Index\n\n- [ ] [00 - One](./00-one.md)\n", "utf8");
            }
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });

    expect(result.iterationsConsumed).toBeGreaterThanOrEqual(2);
    expect(invocations).toBeGreaterThanOrEqual(2);
    const reprompts = sink.getEventsForRun(result.runId).filter((event) => event.kind === "draft_contract_reprompt");
    expect(reprompts).toHaveLength(1);
    expect(reprompts[0]).toMatchObject({ contractId: "artifact.exists" });
    const detail = reprompts[0]?.detail;
    expect(detail).toContain("intent.md");
    expect(detail).toContain("index.md");
    expect(detail).toContain("NN-*.md");
  });

  test("plan.draft.shape:missing-dir miss does not draft_contract_reprompt", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    let invocations = 0;

    const result = await runPlanDraftLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "plan-draft-shape-missing-dir-no-reprompt",
      logSink: sink,
      bindings: [
        {
          id: "agent",
          invoke: async ({ cwd }) => {
            invocations += 1;
            rmSync(join(cwd, ".jarvis-plan-stage"), { recursive: true, force: true });
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
    });

    expect(result).toMatchObject({ kind: "contract_miss", iterationsConsumed: 1 });
    expect(invocations).toBe(1);
    expect(sink.getEventsForRun(result.runId).some((event) => event.kind === "draft_contract_reprompt")).toBe(false);
    const detail = sink.getEventsForRun(result.runId).find((event) => event.kind === "contract_miss_detail");
    expect(detail).toMatchObject({ failureReason: "plan.draft.shape:missing-dir" });
  });
});
