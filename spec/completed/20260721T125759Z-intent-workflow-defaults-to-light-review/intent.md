---
name: intent-workflow-defaults-to-light-review
---

# Intent workflow defaults to one light review pass

`jarvis run workflow intent` with no review flags currently builds zero review passes
(`reviewPasses ?? 0`). The deprecated `intent-reviewed` alias already defaults to one `light`
pass; that default never moved to the primary preset.

## Decisions

- Default `reviewPasses` to `1` in `buildIntentWorkflowSteps`; rules out leaving zero passes on the primary preset.
- Default `reviewBehavior` to `light` when unset; rules out inheriting the builder's `debate` fallback for reviewed intent runs.
- Keep `--review-passes 0` and explicit `--review-passes` / `--review-behavior` as overrides; rules out making review unskippable.
- `intent-reviewed` must resolve to the same steps as `intent` with no flags; rules out keeping a distinct legacy configuration path.
- Pin defaults with tests that fail against the current `?? 0` and `?? "debate"` fallbacks; rules out doc-only or manual verification.
- Same-seam sibling `plan-workflow-defaults-to-debate-review` must plan/run after this spec merges; rules out parallel fan-out on `publication-workflow-steps.ts`.

## Documentation updates

- `v2/docs/workflow-runner.md` — intent preset review defaults and opt-out.
- `v2/docs/operator-runbook.md` — review is on by default; document `--review-passes 0` opt-out.
- `v2/docs/v1-behaviors.md` — v2 primary presets now match v1 review-by-default; note the prior zero-pass default.

## Prerequisites
