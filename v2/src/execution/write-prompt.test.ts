import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { PromptRenderingError } from "../../../shared/prompts/render.ts";
import { DEFAULT_WRITE_STEP_RULES } from "../../../shared/prompts/step-rules.ts";
import { renderStepPrompt } from "./write-prompt.ts";

const HUMAN_ONLY_STEP_RULES =
  "Human-only acceptance criteria contain `(Manual)`, `visual inspection only`, or `no automated guard` anywhere in the full bullet block (the first checklist line and any continuation lines). Recognition uses case-insensitive substring matching; markers need not be trailing or whole phrases.";

describe("write prompt", () => {
  test("registers stable id write.execute", () => {
    const registry = loadPromptRegistry();
    expect(registry.getById("write.execute").metadata.id).toBe("write.execute");
  });

  test("renders through shared registry contract", () => {
    const rendered = renderStepPrompt("write.execute", {
      SPEC_PATH: "spec/example/index.md",
      PRINCIPLES: "",
      STEP_RULES: "Follow the contract.",
    });

    expect(rendered).toContain("Read the spec at spec/example/index.md.");
    expect(rendered).toContain("Follow the contract.");
  });

  // Mutation checkpoint: inverting the global-fragment filter or sort in
  // globalFragmentBodies must turn this test red.
  // @mutate v2/src/execution/write-prompt.ts "artifact.metadata.behavior === \"global\"" -> "false"
  // @mutate v2/src/execution/write-prompt.ts "return ao - bo || a.metadata.id.localeCompare(b.metadata.id);" -> "return bo - ao;"
  test("write.execute and plan.prompt.draft include no-hard-wrap after global.terse", () => {
    const writeRendered = renderStepPrompt("write.execute", {
      SPEC_PATH: "spec/example/index.md",
      PRINCIPLES: "",
      STEP_RULES: "Follow the contract.",
    });
    const planRendered = renderStepPrompt("plan.prompt.draft", {
      WORKDIR: "/tmp/work",
      NAME: "example-spec",
      INTENT: "Do the thing.",
      SPEC_GUIDANCE: "Follow the guidance.",
    });

    for (const rendered of [writeRendered, planRendered]) {
      const terseIndex = rendered.indexOf("Be terse in communication artifacts");
      const noHardWrapIndex = rendered.indexOf("Do not hard-wrap authored markdown");
      expect(terseIndex).toBeGreaterThanOrEqual(0);
      expect(noHardWrapIndex).toBeGreaterThan(terseIndex);
    }
  });

  test("patch.prompt.body includes no-hard-wrap after global.terse", () => {
    const rendered = renderStepPrompt("patch.prompt.body", {
      SPEC_PATH: "spec/example/index.md",
      SIBLINGS_BLOCK: "",
      REPO_GUIDANCE: "Follow repo guidance.",
      ACTIVE_SUBSPEC_PATH: "spec/example/00-sub.md",
      ACTIVE_SUBSPEC_BODY: "Body.",
      PATCH_RULES: "Rules.",
      TIMEOUT_CHECKPOINT_CONTEXT: "",
      STEP_RULES: "Follow the contract.",
    });

    const terseIndex = rendered.indexOf("Be terse in communication artifacts");
    const noHardWrapIndex = rendered.indexOf("Do not hard-wrap authored markdown");
    expect(terseIndex).toBeGreaterThanOrEqual(0);
    expect(noHardWrapIndex).toBeGreaterThan(terseIndex);
  });

  // Mutation checkpoint: inverting the `remove` exclusion in globalFragmentBodies
  // must turn this test red.
  // @mutate v2/src/execution/write-prompt.ts "!remove.has(artifact.metadata.id)" -> "true"
  test("patch.prompt.shrink includes no-hard-wrap after global.terse, omits documentation/naming", () => {
    const rendered = renderStepPrompt("patch.prompt.shrink", {
      SPEC_PATH: "spec/example/index.md",
      SPEC_TREE: "tree",
      ALLOWLIST: "allow",
      BRANCH_DIFF: "diff",
      RUN_SCOPED_DIFF: "diff",
      STEP_RULES: "Follow the contract.",
    });

    const terseIndex = rendered.indexOf("Be terse in communication artifacts");
    const noHardWrapIndex = rendered.indexOf("Do not hard-wrap authored markdown");
    expect(terseIndex).toBeGreaterThanOrEqual(0);
    expect(noHardWrapIndex).toBeGreaterThan(terseIndex);
    expect(rendered).not.toContain("Before editing code, read the relevant durable docs/specs");
    expect(rendered).not.toContain("No planning labels in code.");
  });

  test("write.execute isolates the shared human-only step rules", () => {
    const principles = "MARKER_FREE_PRINCIPLES";
    const rendered = renderStepPrompt("write.execute", {
      SPEC_PATH: "spec/example/index.md",
      PRINCIPLES: principles,
      STEP_RULES: DEFAULT_WRITE_STEP_RULES,
    });
    const stepRules = rendered.slice(rendered.indexOf(DEFAULT_WRITE_STEP_RULES));

    expect(rendered).toContain(principles);
    expect(stepRules).toBe(DEFAULT_WRITE_STEP_RULES);
    expect(stepRules).toContain(HUMAN_ONLY_STEP_RULES);
  });

  test("renders an arbitrary registered prompt id from a caller-supplied placeholder map", () => {
    const rendered = renderStepPrompt("plan.prompt.draft", {
      WORKDIR: "/tmp/work",
      NAME: "example-spec",
      INTENT: "Do the thing.",
      SPEC_GUIDANCE: "Follow the guidance.",
    });

    expect(rendered).toContain("`/tmp/work`");
    expect(rendered).toContain("`example-spec`");
  });

  test("unknown prompt id surfaces the registry lookup error", () => {
    expect(() => renderStepPrompt("no.such.prompt", {})).toThrow(/unknown prompt id/);
  });

  test("missing a required declared placeholder surfaces the render layer's error", () => {
    expect(() => renderStepPrompt("write.execute", { SPEC_PATH: "spec.md" })).toThrow(PromptRenderingError);
  });

  test("write.guard-checkpoint-reprompt renders its structured repair contract", () => {
    const registry = loadPromptRegistry();
    expect(registry.getById("write.guard-checkpoint-reprompt").metadata.id).toBe("write.guard-checkpoint-reprompt");
    const rendered = renderStepPrompt("write.guard-checkpoint-reprompt", {
      ACTIVE_SUBSPEC_PATH: "spec/00-guard.md",
      REPAIR_LIST:
        '- kind: guard; criterion: guard pin; pin: guard.test.ts; reason: hollow; linked directive: guard.test.ts:3: // @mutate target.ts "a" -> "b"\n  Repair: repair the linked directive or pinning test.',
      STEP_RULES: "Return exactly one terminal token.",
    });

    expect(rendered).toContain("spec/00-guard.md");
    expect(rendered).toContain("kind: guard");
    expect(rendered).toContain("reason: hollow");
    expect(rendered).toContain("guard.test.ts:3");
    expect(rendered).toContain("repair the linked directive or pinning test");
    expect(rendered).toContain("Return exactly one terminal token.");
  });
});
