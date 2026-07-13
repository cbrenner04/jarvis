That's the adjudicator prompt — the third and final role in plan mode's debate review (adversary critiques → advocate responds → adjudicator issues the verdict the refinement actuator acts on).

Key facts:
- **File:** `prompts/plan/review-adjudicator.md`, revision 2, `kind: step`, `behavior: plan`.
- **Contract:** read-only. It gets the intent, the current spec files, spec guidance, the advocate's response (which embeds the adversary's critique), and pass context — and must emit a *self-contained, outcome-focused* verdict. The actuator sees only the verdict, never the adversary/advocate artifacts. Empty verdict means "nothing to refine."
- **Consumers:** `v1/src/modes/plan/review.ts:74` selects it for the adjudicator pass; `v2/src/execution/plan-workflow-steps.ts:333` maps the same ID in the v2 debate-role table. The patch-mode twin is `prompts/patch/review-adjudicator.md`.
- **Tiering:** it's one of the read-only review roles, so it resolves through `modes.review.agentOrder` (falling back to `modes.plan.agentOrder`), not the patch order used by the actuators.

Your message was just the ID, so I stopped at showing it. What do you want done with it — edit the prompt, trace how the verdict flows into refinement, or something in the new `blocked-run-retains-worktree-and-branch` spec?