# 00 - Add review-mode config and CLI selection

## Problem

Patch review needs separate model selection and pass-count resolution.

## Decisions

`modes.review` is a top-level sibling of `modes.patch` and `modes.plan`, not a nested patch override.
`modes.review.agentOrder` may be unset; fall back to `modes.plan.agentOrder` (review is critique work, closer to plan than patch) rather than requiring duplicated review config.
`modes.review.agentOrder` runs through the same `validateAgentOrder` contract as `modes.patch`/`modes.plan` at load — no stricter, no looser. A bad entry fails at load, not at runtime.
Effective review passes resolve as `--review-passes` -> `modes.review.passes` -> `2`, not from plan-mode settings.
Effective `git: false` skips patch review entirely, not a loop-only review variant.

## Task Checklist

- [ ] Extend the v1 config schema/defaults with `modes.review.{passes,agentOrder}` and validation for non-negative `passes` plus the same `validateAgentOrder` contract used by `modes.patch`/`modes.plan` for `agentOrder` when provided (reuse that path; do not add a review-only rule).
- [ ] Add `jarvis1 run --review-passes <n>` with the same non-negative integer validation style as plan mode.
- [ ] Add one resolver for effective review passes and review agent order from CLI overrides, `modes.review`, and `modes.plan.agentOrder`.
- [ ] Reuse existing patch-mode model/quota selection once a review agent/model pair is resolved.
- [ ] Add unit coverage for config loading and CLI parsing failures and override precedence.

## Documentation updates

- [ ] Update `v1/docs/config.md` for the new `modes.review` block, its fallback to `modes.plan.agentOrder`, the shared `validateAgentOrder` validation of `agentOrder`, and the default review-pass count.

## Acceptance criteria

- [ ] `jarvis1 run --review-passes 0 <spec>` disables the review loop without changing implementation iteration behavior or requiring config edits.
- [ ] Without `--review-passes`, review passes resolve from `modes.review.passes` and otherwise default to `2`.
- [ ] When `modes.review.agentOrder` is unset, patch review uses `modes.plan.agentOrder`; when set, it uses the review order instead.
- [ ] A `modes.review.agentOrder` that fails the shared `validateAgentOrder` contract, or invalid `--review-passes` input, fails at load before any agent CLI invocation; an entry valid for `modes.patch`/`modes.plan` is equally valid for review.
- [ ] Effective `git: false` runs do not attempt patch review even when review passes are configured.
