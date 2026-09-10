import { describe, expect, test } from "bun:test";
import { assembledStepArtifact, assemblePrompt, assembleStepTemplate, renderPromptForStep } from "./assemble.ts";
import { loadPromptRegistry } from "./registry.ts";
import { renderArtifactTemplate } from "./render.ts";
import type { PromptRegistry } from "./types.ts";

const registry = loadPromptRegistry();
const steps = registry.all().filter((artifact) => artifact.metadata.kind === "step");

/** The retired v2 write path: ranked globals minus `remove`, then the body — no lane fragments, no `add`. */
function legacyGlobalsOnlyAssembly(reg: PromptRegistry, stepPromptId: string): string {
  const step = reg.getById(stepPromptId);
  const remove = new Set(step.metadata.remove);
  const globals = reg
    .all()
    .filter((a) => a.metadata.kind === "fragment" && a.metadata.behavior === "global" && !remove.has(a.metadata.id))
    .sort((a, b) => {
      const ao = a.metadata.order;
      const bo = b.metadata.order;
      if (ao !== null && bo !== null) return ao - bo || a.metadata.id.localeCompare(b.metadata.id);
      if (ao !== null) return -1;
      if (bo !== null) return 1;
      return a.metadata.id.localeCompare(b.metadata.id);
    })
    .map((a) => a.body.trim());
  return [...globals, step.body.trim()].join("\n\n");
}

/** The retired shared path: globals + behavior lane + add − remove, regardless of policy. */
function legacyBehaviorAssembly(reg: PromptRegistry, stepPromptId: string): string {
  const step = reg.getById(stepPromptId);
  const ranked = (behavior: string) =>
    reg
      .all()
      .filter((a) => a.metadata.kind === "fragment" && a.metadata.behavior === behavior)
      .map((a) => a.metadata.id)
      .sort();
  return assemblePrompt({
    registry: reg,
    globalFragmentIds: ranked("global").sort((a, b) => {
      const ao = reg.getById(a).metadata.order ?? Number.MAX_SAFE_INTEGER;
      const bo = reg.getById(b).metadata.order ?? Number.MAX_SAFE_INTEGER;
      return ao - bo || a.localeCompare(b);
    }),
    behaviorFragmentIds: ranked(step.metadata.behavior),
    stepPromptId,
    addFragmentIds: step.metadata.add,
    removeFragmentIds: step.metadata.remove,
  });
}

describe("one assembler for every step prompt", () => {
  test("every step declares a fragment policy and assembles through the single assembler", () => {
    expect(steps.length).toBeGreaterThan(20);
    for (const step of steps) {
      const id = step.metadata.id;
      expect(step.metadata.fragmentPolicy, id).not.toBeNull();
      const assembled = assembleStepTemplate(registry, id);
      const lane = registry
        .all()
        .filter((a) => a.metadata.kind === "fragment" && a.metadata.behavior === step.metadata.behavior)
        .map((a) => a.body.trim());
      const added = step.metadata.add.map((fragmentId) => registry.getById(fragmentId).body.trim());
      switch (step.metadata.fragmentPolicy) {
        case "global":
          // Globals-only when nothing is added: byte-identical to the retired v2 write path.
          if (added.length === 0) expect(assembled, id).toBe(legacyGlobalsOnlyAssembly(registry, id));
          for (const fragment of lane) expect(assembled, id).not.toContain(fragment);
          for (const fragment of added) expect(assembled, id).toContain(fragment);
          break;
        case "behavior":
          expect(assembled, id).toBe(legacyBehaviorAssembly(registry, id));
          break;
        case "none":
          expect(assembled, id).toBe(step.body.trim());
          break;
      }
    }
  });

  test("the ids that used to diverge now render identical bytes through the one path", () => {
    // Pre-fix: v2 rendered `write.execute` globals-only while the shared path added `write.principles`;
    // `plan.prompt.draft` was globals-only on the write path and plan-lane on the shared path.
    expect(registry.getById("write.execute").metadata.fragmentPolicy).toBe("global");
    const writeExecute = assembleStepTemplate(registry, "write.execute");
    expect(writeExecute).toBe(legacyGlobalsOnlyAssembly(registry, "write.execute"));
    expect(writeExecute).not.toBe(legacyBehaviorAssembly(registry, "write.execute"));
    expect(writeExecute).not.toContain(registry.getById("write.principles").body.trim());
    expect(registry.getById("plan.prompt.draft").metadata.fragmentPolicy).toBe("behavior");
    const planDraft = assembleStepTemplate(registry, "plan.prompt.draft");
    expect(planDraft).toBe(legacyBehaviorAssembly(registry, "plan.prompt.draft"));
    expect(planDraft).not.toBe(legacyGlobalsOnlyAssembly(registry, "plan.prompt.draft"));
    expect(planDraft).toContain(registry.getById("plan.decisions-ledger").body.trim());
    for (const role of ["critic", "adversary", "advocate", "adjudicator"]) {
      expect(registry.getById(`plan.prompt.review.${role}`).metadata.fragmentPolicy).toBe("behavior");
    }
    expect(registry.getById("plan.prompt.review-actuator").metadata.fragmentPolicy).toBe("behavior");
  });

  test("renderPromptForStep is the assembled artifact rendered, trimmed", () => {
    const placeholders = { RESPONSE_TEXT: "no token" };
    expect(renderPromptForStep({ registry, stepPromptId: "write.token-reprompt", placeholders })).toBe(
      renderArtifactTemplate(assembledStepArtifact(registry, "write.token-reprompt"), placeholders).trim(),
    );
    expect(renderPromptForStep({ stepPromptId: "write.token-reprompt", placeholders })).toContain("no token");
  });

  test("a fragment or a step without a policy is refused by the assembler", () => {
    expect(() => assembleStepTemplate(registry, "global.terse")).toThrow("not a step artifact with a fragment policy");
  });
});
