import { describe, expect, test } from "bun:test";
import { PLAN_DRAFT_PROMPT_ID } from "../../../shared/prompts/plan-draft.ts";
import type { StepRunResult } from "./step-runner.ts";
import { isEligibleDraftContractReprompt, type WriteLoopInput } from "./write-loop.ts";

const planDraftArgs = { promptId: PLAN_DRAFT_PROMPT_ID } as WriteLoopInput;
const miss = (failureReason: string) =>
  ({ kind: "contract_miss", token: "done", failedContractId: "artifact.exists", failureReason }) as StepRunResult;

describe("isEligibleDraftContractReprompt", () => {
  test("a non-shape plan-draft artifact miss is eligible", () => {
    expect(isEligibleDraftContractReprompt(planDraftArgs, miss("Plan index links unknown subspec 02-second.md"))).toBe(
      true,
    );
  });

  test("bare and suffixed plan.draft.shape misses are not eligible", () => {
    expect(isEligibleDraftContractReprompt(planDraftArgs, miss("plan.draft.shape"))).toBe(false);
    expect(isEligibleDraftContractReprompt(planDraftArgs, miss("plan.draft.shape:no-index"))).toBe(false);
  });
});
