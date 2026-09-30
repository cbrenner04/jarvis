import { describe, expect, test } from "bun:test";
import { renderPromptForStep } from "../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { PromptRenderingError } from "../../../shared/prompts/render.ts";
import { DEFAULT_WRITE_STEP_RULES } from "../../../shared/prompts/step-rules.ts";
import { mutationCoverageFixDetail } from "./diff-derived-mutation-verifier.ts";
import { SHRINK_FORBID_GUARD_TEST_DELETION_RULE, SHRINK_WRITE_STEP_RULES } from "./write-loop-input.ts";

/** v2 write-step rendering is the shared assembler; the shim keeps the historical call shape. */
function renderStepPrompt(promptId: string, placeholders: Record<string, string>): string {
  return renderPromptForStep({ stepPromptId: promptId, placeholders });
}

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
      const terseIndex = rendered.indexOf("Be terse everywhere");
      const noHardWrapIndex = rendered.indexOf("Do not hard-wrap authored markdown");
      expect(terseIndex).toBeGreaterThanOrEqual(0);
      expect(noHardWrapIndex).toBeGreaterThan(terseIndex);
    }
  });

  test("implement.rules directs scoped test runs and warns off the full aggregate", () => {
    const body = loadPromptRegistry().getById("implement.rules").body;

    expect(body).toContain("Run the tests target-repo guidance prescribes for the surfaces you touched");
    expect(body).toContain("never the full suite unless that guidance resolves to it");
    // Scoping policy lives in the target repo's guidance, not restated here.
    expect(body).not.toContain("exactly as target-repo `AGENTS.md` specifies");
    // The pre-fix rule made the aggregate the default and only allowed skipping it.
    expect(body).not.toContain("skip `bun run test` only when");
  });

  test("implement.rules ticks harness-run out-of-sandbox suites and never blocks on their sandbox failures", () => {
    const body = loadPromptRegistry().getById("implement.rules").body;

    expect(body).toContain(
      "cannot run inside the agent sandbox and are run by the harness outside it, do not run them",
    );
    expect(body).toContain("is ticked once your in-sandbox checks pass");
    expect(body).toContain("are never a reason to append `## Blocker`");
    expect(body).not.toMatch(/\bbun\b|test:integration/);
  });

  test("implement.prompt.body includes no-hard-wrap after global.terse", () => {
    const rendered = renderStepPrompt("implement.prompt.body", {
      SPEC_PATH: "spec/example/index.md",
      SIBLINGS_BLOCK: "",
      REPO_GUIDANCE: "Follow repo guidance.",
      ACTIVE_SUBSPEC_PATH: "spec/example/00-sub.md",
      ACTIVE_SUBSPEC_BODY: "Body.",
      PATCH_RULES: "Rules.",
      TIMEOUT_CHECKPOINT_CONTEXT: "",
      STEP_RULES: "Follow the contract.",
    });

    const terseIndex = rendered.indexOf("Be terse everywhere");
    const noHardWrapIndex = rendered.indexOf("Do not hard-wrap authored markdown");
    expect(rendered).toContain("## Repo Guidance");
    expect(terseIndex).toBeGreaterThanOrEqual(0);
    expect(noHardWrapIndex).toBeGreaterThan(terseIndex);
  });

  // Mutation checkpoint: inverting the `remove` exclusion in globalFragmentBodies
  // must turn this test red.
  test("implement.prompt.shrink includes no-hard-wrap after global.terse, omits documentation/naming", () => {
    const rendered = renderStepPrompt("implement.prompt.shrink", {
      SPEC_PATH: "spec/example/index.md",
      SPEC_TREE: "tree",
      ALLOWLIST: "allow",
      BRANCH_DIFF: "diff",
      RUN_SCOPED_DIFF: "diff",
      STEP_RULES: "Follow the contract.",
    });

    const terseIndex = rendered.indexOf("Be terse everywhere");
    const noHardWrapIndex = rendered.indexOf("Do not hard-wrap authored markdown");
    expect(terseIndex).toBeGreaterThanOrEqual(0);
    expect(noHardWrapIndex).toBeGreaterThan(terseIndex);
    expect(rendered).not.toContain("Before editing code, read the relevant durable docs/specs");
    expect(rendered).not.toContain("Never put planning labels");
  });

  test("implement.prompt.shrink forbids deleting guard killing tests in Rules and STEP_RULES", () => {
    const rendered = renderStepPrompt("implement.prompt.shrink", {
      SPEC_PATH: "spec/example/index.md",
      SPEC_TREE: "tree",
      ALLOWLIST: "allow",
      BRANCH_DIFF: "diff",
      RUN_SCOPED_DIFF: "diff",
      STEP_RULES: SHRINK_WRITE_STEP_RULES,
    });

    expect(rendered).toContain(SHRINK_FORBID_GUARD_TEST_DELETION_RULE);
    expect(rendered.trimEnd().endsWith(SHRINK_WRITE_STEP_RULES)).toBe(true);
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

  test("registry omits retired checkpoint reprompt prompts", () => {
    const registry = loadPromptRegistry();
    expect(() => registry.getById("write.guard-checkpoint-reprompt")).toThrow(/unknown prompt id/);
    expect(() => registry.getById("write.mutation-directive-reprompt")).toThrow(/unknown prompt id/);
    expect(() => registry.getById("write.keystone-directive-reprompt")).toThrow(/unknown prompt id/);
  });

  test("registers stable id write.surviving-mutation-reprompt", () => {
    const registry = loadPromptRegistry();
    expect(registry.getById("write.surviving-mutation-reprompt").metadata.id).toBe("write.surviving-mutation-reprompt");
  });

  test("write.surviving-mutation-reprompt renders the mutation site, both remedies, and injected rules", () => {
    const rendered = renderStepPrompt("write.surviving-mutation-reprompt", {
      SPEC_PATH: "spec/example/00-sub.md",
      STEP_RULES: "Follow the implement contract.",
      SURVIVING_MUTATION: "replace `a === b` with `a !== b`",
      SOURCE_FILE: "v2/src/execution/write-loop.ts",
      SOURCE_LINE: "142",
      DUAL_CONSTRAINT_DETAIL: "Determinism guard forbids a real-timer kill test.",
      MUTATION_COVERAGE_FIX_DETAIL: "",
    });

    expect(rendered).toContain("Read the spec at spec/example/00-sub.md.");
    expect(rendered).toContain("Mutation: replace `a === b` with `a !== b`");
    expect(rendered).toContain("Source: v2/src/execution/write-loop.ts:142");
    expect(rendered).toContain("Determinism guard forbids a real-timer kill test.");
    // Both remedies must be offered: a co-located killing test, or the equivalence directive.
    expect(rendered).toContain("co-located killing test");
    expect(rendered).toContain("@mutate-equivalent");
    expect(rendered).toContain("Follow the implement contract.");
  });

  test("write.surviving-mutation-reprompt requires the mutation-site placeholders", () => {
    expect(() =>
      renderStepPrompt("write.surviving-mutation-reprompt", {
        SPEC_PATH: "spec/example/00-sub.md",
        STEP_RULES: "Rules.",
      }),
    ).toThrow(PromptRenderingError);
  });

  const mutationRepromptBasePlaceholders = {
    SPEC_PATH: "spec/example/00-sub.md",
    STEP_RULES: "Rules.",
    SOURCE_FILE: "v2/src/execution/foo.ts",
    SOURCE_LINE: "10",
    DUAL_CONSTRAINT_DETAIL: "",
  };

  test.each([
    ["write.surviving-mutation-reprompt", "importer-discovery-cap-exceeded"],
    ["write.mutation-repair", "importer-discovery-cap-exceeded"],
    ["write.surviving-mutation-reprompt", "missing-killing-test"],
    ["write.mutation-repair", "missing-killing-test"],
  ] as const)("mutation coverage fix detail on %s for %s", (promptId, mutation) => {
    const fixDetail = mutationCoverageFixDetail(mutation, mutationRepromptBasePlaceholders.SOURCE_FILE);
    const rendered = renderStepPrompt(promptId, {
      ...mutationRepromptBasePlaceholders,
      SURVIVING_MUTATION: mutation,
      MUTATION_COVERAGE_FIX_DETAIL: fixDetail,
    });
    expect(rendered).toContain("v2/src/execution/foo.test.ts");
    expect(rendered).toContain("did not satisfy this failure");
    expect(rendered).toContain("non-co-located");
    expect(fixDetail).not.toContain("never count");
  });

  test.each([
    ["missing-killing-test", "v2/src/execution/foo.test.ts"],
    ["surviving-mutation", "v2/src/execution/foo.ts"],
  ] as const)("mutationCoverageFixDetail empty for %s", (mutation, sourceFile) => {
    expect(mutationCoverageFixDetail(mutation, sourceFile)).toBe("");
  });

  test.each([
    "write.surviving-mutation-reprompt",
    "write.mutation-repair",
  ] as const)("%s renders no fix line when MUTATION_COVERAGE_FIX_DETAIL is empty", (promptId) => {
    expect(
      renderStepPrompt(promptId, {
        ...mutationRepromptBasePlaceholders,
        SURVIVING_MUTATION: "missing-killing-test",
        MUTATION_COVERAGE_FIX_DETAIL: "",
      }),
    ).not.toContain("v2/src/execution/foo.test.ts");
  });
});
