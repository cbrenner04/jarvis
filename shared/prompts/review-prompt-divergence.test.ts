import { describe, expect, test } from "bun:test";
import { loadPromptRegistry } from "./registry.ts";

/**
 * v1 patch review and v2 implement review share role names but must render distinct
 * branch-diff prose: patch stays summary-only (`git diff --stat`, not a unified diff);
 * implement supplies the merge-base unified diff. Pins the split so a future edit can't
 * silently point implement rendering back at the patch ids.
 */
describe("patch vs implement review prompt registry-body divergence", () => {
  test.each(["adversary", "advocate", "adjudicator"] as const)("%s branch-diff prose diverges", (role) => {
    const registry = loadPromptRegistry();
    const patchBody = registry.getById(`patch.prompt.review.${role}`).body;
    const implementBody = registry.getById(`implement.prompt.review.${role}`).body;

    expect(patchBody).toContain("not a unified diff");
    expect(implementBody).not.toContain("not a unified diff");
    expect(implementBody).toContain("merge-base branch diff");
    expect(implementBody).not.toEqual(patchBody);
  });

  test("critic branch-diff prose is merge-base unified diff on both patch.prompt.review.critic and implement.prompt.review.critic", () => {
    const registry = loadPromptRegistry();
    const patchCriticBody = registry.getById("patch.prompt.review.critic").body;
    const implementCriticBody = registry.getById("implement.prompt.review.critic").body;

    expect(patchCriticBody).toContain("merge-base branch diff");
    expect(implementCriticBody).toContain("merge-base branch diff");
    expect(implementCriticBody).not.toEqual(patchCriticBody);
  });
});
