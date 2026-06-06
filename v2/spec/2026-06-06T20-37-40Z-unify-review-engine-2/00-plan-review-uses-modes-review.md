# Plan review reads `modes.review`

Plan review still resolves its agents from `modes.plan.agentOrder` (`v1/src/modes/plan/review.ts:214`) and its pass count from a hardcoded `inv.reviewPasses ?? 2` (`v1/src/commands/plan.ts`, both the resume and fresh review loops). `modes.review` is the dedicated critique tier and already has resolvers (`resolveReviewAgentOrder`, `resolveReviewPasses` in `v1/src/config.ts`) that patch review uses. Point plan review at them. This is the only behavior change in the tree.

## Decisions

- Plan review agents come from `resolveReviewAgentOrder(config)` (= `modes.review.agentOrder ?? modes.plan.agentOrder`), not the raw `modes.plan.agentOrder` — rules out leaving plan on its own tier while patch uses the shared one.
- Plan review passes come from `resolveReviewPasses(cfg, inv.reviewPasses)` (`--review-passes` → `modes.review.passes` → 2), applied to both plan loops (fresh and resume). Rules out keeping plan's hardcoded `?? 2`, which ignores `modes.review.passes`. Default stays 2, so default-config behavior is unchanged.
- Only the agent/passes *source* moves: quota-fallback stderr, telemetry, resume `rN` numbering, and commit subjects are unchanged.

## Task checklist

- Replace `opts.config.modes.plan.agentOrder` in `runReviewPass` with `resolveReviewAgentOrder(opts.config)`.
- Replace the two hardcoded `inv.reviewPasses ?? 2` plan-review pass counts with `resolveReviewPasses(cfg, inv.reviewPasses)`.
- Update tests covering plan review agent/passes resolution.

## Acceptance criteria

- [ ] `v1/src/modes/plan/review.ts` resolves review agents via `resolveReviewAgentOrder` (no direct `modes.plan.agentOrder` read in the review agent loop).
- [ ] Plan review pass count is resolved via `resolveReviewPasses` in both the fresh and resume loops; no `?? 2` literal remains for plan review passes.
- [ ] A test asserts plan review uses `modes.review.agentOrder` when set and falls back to `modes.plan.agentOrder` when unset.
- [ ] A test asserts plan review pass count honors `--review-passes` override → `modes.review.passes` → default 2.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record that plan review agents now resolve `modes.review.agentOrder ?? modes.plan.agentOrder` (mirroring the existing patch entry) and that plan review passes resolve via `modes.review.passes` (default 2); reconcile the existing "default 2" / "`modes.plan.agentOrder`" plan-review lines.
- `v1/docs/plan-mode.md`: update the review-pass and cost sections that name `modes.plan.agentOrder` / "default 2" to reflect the `modes.review` source.
- `v1/docs/config.md`: note `modes.review.{agentOrder,passes}` now govern plan review too, not only patch.
