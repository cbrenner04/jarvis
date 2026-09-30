import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSpecGuidance } from "../spec-guidance-path.ts";
import { trackedMkdtempSync } from "../tracked-temp-dir.test-support.ts";
import { buildPlanDraftPrompt } from "./plan-draft.ts";
import { FALSIFIABILITY_GUIDANCE_MARKERS } from "./review-falsifiability-fragment.test.ts";
import {
  renderPlanReviewActuatorPrompt,
  renderPlanReviewCriticPrompt,
  renderPlanReviewDebateRolePrompt,
} from "./review-plan.ts";

function specDirWithIntent(): string {
  const dir = trackedMkdtempSync(join(tmpdir(), "plan-review-falsifiability-"));
  writeFileSync(join(dir, "intent.md"), "# Intent\n", "utf8");
  return dir;
}

describe("plan review falsifiability fragment", () => {
  test("plan review critic, adversary, and advocate renders include falsifiability mandate, defect-shape taxonomy, and empty-verdict-when-nothing-found", () => {
    const specPath = specDirWithIntent();
    const context = { worktreePath: "/repo", specPath };
    const critic = renderPlanReviewCriticPrompt(context);
    const adversary = renderPlanReviewDebateRolePrompt("adversary", context);
    const advocate = renderPlanReviewDebateRolePrompt("advocate", context, "(none)");
    for (const rendered of [critic, adversary, advocate]) {
      expect(rendered.split("## Review falsifiability").length - 1).toBe(1);
      for (const marker of FALSIFIABILITY_GUIDANCE_MARKERS) {
        expect(rendered).toContain(marker);
      }
    }
    expect(critic).toContain("emit an empty verdict (critic)");
    expect(adversary).toContain("report no manufactured problems (adversary)");
    expect(advocate).toContain("concede only findings the evidence supports (advocate)");
  });

  test("plan review adjudicator, actuator, and draft renders omit falsifiability fragment", () => {
    const specPath = specDirWithIntent();
    const context = { worktreePath: "/repo", specPath };
    const adjudicator = renderPlanReviewDebateRolePrompt("adjudicator", context, "prior");
    const actuator = renderPlanReviewActuatorPrompt(context, "Tighten ACs.");
    const draft = buildPlanDraftPrompt({
      name: "my-plan",
      intent: "do thing",
      specGuidance: readSpecGuidance(),
    });
    for (const rendered of [adjudicator, actuator, draft]) {
      expect(rendered).not.toContain("## Review falsifiability");
      for (const marker of FALSIFIABILITY_GUIDANCE_MARKERS) {
        expect(rendered).not.toContain(marker);
      }
    }
  });
});
