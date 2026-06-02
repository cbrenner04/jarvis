# 00 - Add review-mode config and CLI selection

## Problem

Patch review needs its own model/order config and pass-count override.

## Decisions

`modes.review` is a top-level sibling of `modes.patch` and `modes.plan`, not a nested patch override.
`modes.review.agentOrder` may be unset; fall back to `modes.patch.agentOrder` rather than requiring duplicated review config.
Effective review passes resolve as `--review-passes` -> `modes.review.passes` -> `2`, not from plan-mode settings.
Effective `git: false` skips patch review entirely, not a loop-only review variant.

## Task Checklist

- [ ] Extend the v1 config schema and defaults so `modes.review` is a sibling of `modes.patch` and `modes.plan`, with `passes` and optional `agentOrder`, plus validation for non-negative pass counts and non-empty `agentOrder` entries when provided.
- [ ] Update patch-mode option parsing so `jarvis1 run` accepts `--review-passes <n>` with the same non-negative integer validation style as plan mode.
- [ ] Add a single resolver for patch review settings that computes the effective pass count and effective review agent order from CLI overrides, `modes.review`, and `modes.patch.agentOrder`.
- [ ] Keep model-config and quota behavior aligned with existing patch-mode selection semantics once a concrete review agent/model pair has been resolved.
- [ ] Add or update unit coverage for config loading and CLI parsing so malformed `modes.review` values fail before any agent invocation and so `--review-passes` overrides config predictably.

## Documentation updates

- [ ] Update `v1/docs/config.md` for the new `modes.review` block, its fallback to `modes.patch.agentOrder`, and the default review-pass count.

## Acceptance criteria

- [ ] `jarvis1 run --review-passes 0 <spec>` disables the review loop without changing implementation iteration behavior or requiring config edits.
- [ ] Without `--review-passes`, patch mode uses `modes.review.passes` when set and otherwise defaults to `2`.
- [ ] When `modes.review.agentOrder` is unset, patch review uses `modes.patch.agentOrder`; when it is set, review agent selection uses that order instead.
- [ ] Invalid `modes.review` config values or invalid `--review-passes` input fail before any agent CLI invocation.
- [ ] Effective `git: false` runs do not attempt patch review even when review passes are configured.
