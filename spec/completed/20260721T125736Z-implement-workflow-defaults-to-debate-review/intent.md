---
name: implement-workflow-defaults-to-debate-review
---

# Implement workflow defaults to one debate review pass

`jarvis run workflow implement` with no review flags currently resolves zero review passes
(`reviewPasses ?? 0` across `resolveImplementLaunch` early-return paths (`projectRoot`,
`resolveProjectMatch`, missing `configPath`), `readProjectImplementReviewPasses` when config
omits the field, and the builder's `resolveImplementReviewPasses` input). Implement already
defaults `reviewBehavior` to `debate`; only the pass count was left behind. v1 reviews by
default (`modes.review.passes: 1`).

## Decisions

- Default `reviewPasses` to `1` across all implement launch default resolution (`resolveImplementLaunch` paths above, `readProjectImplementReviewPasses`, and builder `resolveImplementReviewPasses`); rules out leaving any path at zero or compensating via operator `~/.jarvis/config.json` only.
- Keep `reviewBehavior` default `debate`; rules out changing implement review mode while fixing pass count.
- Keep `--review-passes 0` and explicit CLI flags as overrides; rules out making review unskippable.
- Keep project `implement.reviewPasses` / `implement.reviewBehavior` as overrides when set; rules out ignoring per-project config.
- Pin defaults with tests that fail against the current `?? 0` / undefined-config fallbacks; rules out doc-only or manual verification.

## Documentation updates

- `v2/docs/workflow-runner.md` — implement preset review defaults and opt-out.
- `v2/docs/operator-runbook.md` — review is on by default; document `--review-passes 0` opt-out.
- `v2/docs/v1-behaviors.md` — v2 primary presets now match v1 review-by-default; note the prior zero-pass default.

## Prerequisites
