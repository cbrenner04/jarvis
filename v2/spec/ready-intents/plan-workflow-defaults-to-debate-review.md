---
name: plan-workflow-defaults-to-debate-review
---

# Plan workflow defaults to one debate review pass

`jarvis run workflow plan` with no review flags currently builds zero review passes
(`reviewPasses ?? 0`). The deprecated `plan-reviewed` alias already defaults to one `debate`
pass; that default never moved to the primary preset.

## Decisions

- Default `reviewPasses` to `1` in `buildPlanWorkflowSteps`; rules out leaving zero passes on the primary preset.
- Keep `reviewBehavior` default `debate` when unset; rules out changing plan review mode while fixing pass count.
- Keep `--review-passes 0` and explicit `--review-passes` / `--review-behavior` as overrides; rules out making review unskippable.
- `plan-reviewed` must resolve to the same steps as `plan` with no flags; rules out keeping a distinct legacy configuration path.
- Regression coverage must assert the reviewed plan path still lands its spec tree; rules out a default that reintroduces stage-only PRs.
- Pin defaults with tests that fail against the current `?? 0` fallback; rules out doc-only or manual verification.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan preset review defaults and opt-out.
- `v2/docs/operator-runbook.md` — review is on by default; document `--review-passes 0` opt-out.
- `v2/docs/v1-behaviors.md` — v2 primary presets now match v1 review-by-default; note the prior zero-pass default.

## Prerequisites

- `intent-workflow-defaults-to-light-review` spec merged (same seam: `publication-workflow-steps.ts`).
- Reviewed plan runs land their spec tree without stranding `.jarvis-plan-stage/`.
