# 00 - Add review-mode config and CLI selection

## Problem

Patch review needs separate model selection and pass-count resolution.

## Decisions

`modes.review` is a top-level sibling of `modes.patch` and `modes.plan`, not a nested patch override.
`modes.review.agentOrder` may be unset; fall back to `modes.plan.agentOrder` (review is critique work, closer to plan than patch) rather than requiring duplicated review config.
`modes.review.agentOrder` entries are validated against priced models at load, exactly like `modes.patch`/`modes.plan`; an unpriced model is a load-time error.
Effective review passes resolve as `--review-passes` -> `modes.review.passes` -> `2`, not from plan-mode settings.
Effective `git: false` skips patch review entirely, not a loop-only review variant.

## Task Checklist

- [ ] Extend the v1 config schema/defaults with `modes.review.{passes,agentOrder}` and validation for non-negative `passes` plus priced-model validation of `agentOrder` entries when provided (reuse the existing `resolveAgentPriceKey` path used by `modes.patch`/`modes.plan`).
- [ ] Add `jarvis1 run --review-passes <n>` with the same non-negative integer validation style as plan mode.
- [ ] Add one resolver for effective review passes and review agent order from CLI overrides, `modes.review`, and `modes.plan.agentOrder`.
- [ ] Reuse existing patch-mode model/quota selection once a review agent/model pair is resolved.
- [ ] Add unit coverage for config loading and CLI parsing failures and override precedence.

## Documentation updates

- [ ] Update `v1/docs/config.md` for the new `modes.review` block, its fallback to `modes.plan.agentOrder`, priced-model validation of `agentOrder`, and the default review-pass count.

## Acceptance criteria

- [ ] `jarvis1 run --review-passes 0 <spec>` disables the review loop without changing implementation iteration behavior or requiring config edits.
- [ ] Without `--review-passes`, review passes resolve from `modes.review.passes` and otherwise default to `2`.
- [ ] When `modes.review.agentOrder` is unset, patch review uses `modes.plan.agentOrder`; when set, it uses the review order instead.
- [ ] Invalid `modes.review` config values (including an `agentOrder` entry whose model has no price key) or invalid `--review-passes` input fail at load, before any agent CLI invocation.
- [ ] Effective `git: false` runs do not attempt patch review even when review passes are configured.
