# Move plan review onto shared flow

Route plan review through the shared review runner while preserving plan-specific prompt, validation, commits, resume numbering, PR body refresh, and telemetry.

## Decisions

- Plan review uses `resolveReviewAgentOrder(config)`, so `modes.review.agentOrder` wins and falls back to `modes.plan.agentOrder`.
- Plan review uses `resolveReviewPasses(cfg, inv.reviewPasses)`, so `--review-passes` overrides `modes.review.passes`, defaulting to 2.
- Plan review keeps current agent retry semantics only where they are part of the shared flow. If current plan and patch semantics differ, normalize review to the shared review behavior documented in subspec 00.
- Plan review still builds prompts from `prompts/plan/review.md`.
- Plan review still validates: no forbidden `intent.md` rewrite, blocker append allowed, and `index.md` must remain.
- Plan review still commits as `plan: review N` and resumed passes as `plan: review N rK`.

## Task checklist

- Replace the plan review pass loop in `v1/src/commands/plan.ts` / `v1/src/modes/plan/review.ts` with a plan adapter passed to the shared runner.
- Preserve fresh-run and resume-run pass numbering.
- Preserve no-change pass skip behavior.
- Preserve blocker handling and PR body refresh.
- Update tests so they fail if plan review bypasses the shared runner or reads raw `modes.plan.agentOrder` for review agents.

## Acceptance criteria

- [ ] Plan review calls the shared review runner for fresh and resume review passes.
- [ ] No plan review loop directly reads `opts.config.modes.plan.agentOrder`; review agents come through `resolveReviewAgentOrder`.
- [ ] Plan review pass counts come through `resolveReviewPasses(cfg, inv.reviewPasses)` in fresh and resume paths; no plan-review `inv.reviewPasses ?? 2` remains.
- [ ] A plan review test proves `modes.review.agentOrder` is used when set and `modes.plan.agentOrder` is used only as fallback.
- [ ] A plan command test proves `--review-passes` override -> `modes.review.passes` -> default 2 for fresh and resume review paths.
- [ ] Tests prove blocker append, no-change pass skip, resume `rK` subject suffix, and PR body refresh still behave as before.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record that plan review now uses the shared review flow, `modes.review.agentOrder ?? modes.plan.agentOrder`, and `modes.review.passes`.
- `v1/docs/plan-mode.md`: update review-pass, quota, and cost sections that currently name only `modes.plan.agentOrder` or hardcoded default 2.
- `v1/docs/config.md`: note `modes.review.{agentOrder,passes}` govern plan review and patch review.
- `v1/docs/workflows.md`: update the plan review/quota diagram text so review uses the shared review tier, while refine/draft remain on `modes.plan.agentOrder`.
