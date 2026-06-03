import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { buildPrDescriptionPrompt as buildPatchPrDescriptionPrompt } from "../../src/modes/patch/pr-description-prompt.ts";
import { buildPrompt } from "../../src/modes/patch/prompt.ts";
import { buildDraftPrompt } from "../../src/modes/plan/draft.ts";
import { buildPrDescriptionPrompt as buildPlanPrDescriptionPrompt } from "../../src/modes/plan/pr-description-prompt.ts";
import { buildRefinePrompt } from "../../src/modes/plan/refine.ts";
import { buildReviewPrompt } from "../../src/modes/plan/review.ts";

type WrapperVariant = "codex.exec.stdin+marker";

function applyWrapper(variant: WrapperVariant, rendered: string): string {
  switch (variant) {
    case "codex.exec.stdin+marker":
      return `${rendered}\n<!-- jarvis-codex-invocation: fixture -->`;
    default: {
      const neverVariant: never = variant;
      throw new Error(`unknown wrapper variant: ${neverVariant}`);
    }
  }
}

function fixturePath(name: string): string {
  return join(import.meta.dir, "..", "fixtures", "prompts", "rendered", name);
}

function readFixture(name: string): string {
  return readFileSync(fixturePath(name), "utf8");
}

describe("rendered prompt snapshots", () => {
  const registry = loadPromptRegistry();

  test("shared snapshots are keyed by id and revision", () => {
    expect(registry.getById("patch.prompt.body").metadata.revision).toBe("3");
    expect(registry.getById("plan.prompt.draft").metadata.revision).toBe("6");
    expect(registry.getById("plan.prompt.review").metadata.revision).toBe("6");
    expect(registry.getById("plan.prompt.refine").metadata.revision).toBe("8");

    const patchKey = `${registry.getById("patch.prompt.body").metadata.id}@r${registry.getById("patch.prompt.body").metadata.revision}.shared.txt`;
    const draftKey = `${registry.getById("plan.prompt.draft").metadata.id}@r${registry.getById("plan.prompt.draft").metadata.revision}.shared.txt`;
    const reviewStepOneKey = `${registry.getById("plan.prompt.review").metadata.id}@r${registry.getById("plan.prompt.review").metadata.revision}.pass-1.shared.txt`;
    const reviewStepTwoKey = `${registry.getById("plan.prompt.review").metadata.id}@r${registry.getById("plan.prompt.review").metadata.revision}.pass-2.shared.txt`;
    const refineKey = `${registry.getById("plan.prompt.refine").metadata.id}@r${registry.getById("plan.prompt.refine").metadata.revision}.shared.txt`;

    const patch = buildPrompt("v1/spec/example/index.md", [
      "../shared-lib",
      "../infra",
    ]);
    const draft = buildDraftPrompt({
      name: "prompt-registry",
      intent: "Intent with <SPEC_GUIDANCE> token",
      specGuidance: "Guidance block",
    });
    const reviewPass1 = buildReviewPrompt({
      name: "prompt-registry",
      intent: "Intent",
      specGuidance: "Guide",
      currentSpec:
        '<<<FILE name="00-task.md" BEGIN>>>\n- [ ] Task\n<<<FILE END>>>',
      passNumber: 1,
      totalPasses: 2,
    });
    const reviewPass2 = buildReviewPrompt({
      name: "prompt-registry",
      intent: "Intent",
      specGuidance: "Guide",
      currentSpec:
        '<<<FILE name="00-task.md" BEGIN>>>\n- [ ] Task\n<<<FILE END>>>',
      passNumber: 2,
      totalPasses: 2,
    });
    const refine = buildRefinePrompt({
      name: "prompt-registry",
      intent: "Intent",
      specGuidance: "Guide",
      turnsRemaining: 2,
    });

    expect(patch).toBe(readFixture(patchKey));
    expect(draft).toBe(readFixture(draftKey));
    expect(reviewPass1).toBe(readFixture(reviewStepOneKey));
    expect(reviewPass2).toBe(readFixture(reviewStepTwoKey));
    expect(refine).toBe(readFixture(refineKey));
  });

  test("wrapper snapshots are separate from shared snapshots and include wrapper variant", () => {
    const artifact = registry.getById("patch.prompt.body");
    const key = `${artifact.metadata.id}@r${artifact.metadata.revision}.wrapper.codex.exec.stdin+marker.txt`;
    const shared = buildPrompt("v1/spec/example/index.md");

    const wrapped = applyWrapper("codex.exec.stdin+marker", shared);

    expect(wrapped).toBe(readFixture(key));
  });

  test("wrapper selection is explicit", () => {
    const rendered = "prompt";
    expect(applyWrapper("codex.exec.stdin+marker", rendered)).toContain(
      "jarvis-codex-invocation",
    );
  });

  test("patch and plan PR-description prompts include shared fragment", () => {
    expect(
      registry.getById("patch.prompt.pr-description").metadata.revision,
    ).toBe("1");
    expect(
      registry.getById("plan.prompt.pr-description").metadata.revision,
    ).toBe("1");

    const patchKey = `patch.prompt.pr-description@r1.shared.txt`;
    const planKey = `plan.prompt.pr-description@r1.shared.txt`;

    const patch = buildPatchPrDescriptionPrompt({
      specPath: "v1/spec/example/index.md",
      specContext: "Example spec context",
    });
    const plan = buildPlanPrDescriptionPrompt({
      intent: "Example intent",
      specContext: "Example spec context",
    });

    expect(patch).toBe(readFixture(patchKey));
    expect(plan).toBe(readFixture(planKey));

    // Verify both include the shared fragment text
    const sharedFragmentMarker =
      "Author a PR description consisting of a short summary";
    expect(patch).toContain(sharedFragmentMarker);
    expect(plan).toContain(sharedFragmentMarker);
  });
});
