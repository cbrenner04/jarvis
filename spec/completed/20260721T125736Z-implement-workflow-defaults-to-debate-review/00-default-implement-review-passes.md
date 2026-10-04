# 00 - Default implement review passes

## Scope

`jarvis run workflow implement` with no review flags currently resolves zero review
passes (`reviewPasses ?? 0` in `resolveImplementLaunch`, `readProjectImplementReviewPasses`,
and the builder fallback). Implement already defaults `reviewBehavior` to `debate`; align
pass count with v1 (`modes.review.passes: 1`).

## Decisions

- Default `reviewPasses` to `1` in `resolveImplementLaunch` early-return paths (`projectRoot`, injected `resolveProjectMatch`, missing `configPath`), `readProjectImplementReviewPasses` when the field is absent, and `buildImplementWorkflowSteps` when launch resolution leaves the count unset; rules out leaving any default path at zero or compensating via operator `~/.jarvis/config.json` only.
- Keep `reviewBehavior` default `debate`; rules out changing implement review mode while fixing pass count.
- Keep `--review-passes 0` and explicit CLI values as overrides; rules out making review unskippable.
- Keep project `implement.reviewPasses` / `implement.reviewBehavior` as overrides when set; rules out ignoring per-project config.
- Supersede the prior implement absent-field default (`0` from implement-review-passes work) with v1 parity (`1`); callers and scripts that omit `--review-passes` now get one debate review pass (breaking change for zero-pass-by-omission). Coordinate doc narrative with any sibling intent touching the same surfaces.

## Task checklist

- Change implement launch default resolution from `0` to `1` in `implement-workflow-steps.ts` (`resolveImplementLaunch` early returns and builder `resolvedInput.reviewPasses ?? 0` → `?? 1`) and `machine-config-loader.ts` (`readProjectImplementReviewPasses` absent-field fallback).
- Update `machine-config-loader.test.ts` absent-field expectation to `{ ok: true, reviewPasses: 1 }`.
- Update `implement-workflow-steps.test.ts` fixtures (`INPUT`, `INPUT_WITH_ARTIFACT`, and other implicit-zero cases) to set explicit `reviewPasses: 0` for opt-out paths; keep `"returns a one-step implement preset workflow with resolved project and machine config"` and `"reviewPasses 0 returns a one-step implement workflow with no review step"` as opt-out fixtures; add `"omitted reviewPasses defaults to one debate review step"` for the default path.
- Update `workflow-runner.test.ts` snapshot/metadata expectations that encode zero as the implicit default.
- Add registered-path coverage: absent `implement.reviewPasses` → two steps with `review-debate`; explicit `implement.reviewPasses: 0` → one step, no review.
- Align committed docs that still state implement review default `0` (see Documentation updates).
- `bun run test:v2` passes after changes.

## Acceptance criteria

- [x] `implement-workflow-steps.test.ts` `"omitted reviewPasses defaults to one debate review step"` fails against pre-fix code and passes after the change; exercises the `projectRoot` early-return path (no CLI `reviewPasses`, no project override) and asserts a two-step workflow whose review step has `behavior: "review-debate"` (same pattern as `"positive reviewPasses appends one review-debate step with maxCycles and verdict path"`).
- [x] `implement-workflow-steps.test.ts` `"reviewPasses 0 returns a one-step implement workflow with no review step"` stays green.
- [x] Registered project with no `implement.reviewPasses` and omitted CLI flag builds a two-step workflow with one `review-debate` step (fails pre-fix, passes after).
- [x] Registered project with explicit `implement.reviewPasses: 0` and omitted CLI flag builds a one-step workflow with no review step (fails pre-fix if absent-field default leaks, passes after).
- [x] `machine-config-loader.test.ts` `readProjectImplementReviewPasses` absent-field case expects `{ ok: true, reviewPasses: 1 }`.
- [x] Every committed doc that states implement review default `0` — `v2/docs/workflow-runner.md`, `v2/docs/operator-runbook.md`, `v2/docs/v1-behaviors.md`, `v2/docs/install-and-config.md`, `v2/docs/write-behavior.md`, and `v2/docs/first-workflow-walkthrough.md` — reflects review-on-by-default (one debate pass when the flag is omitted), states the omitted-flag default, and documents `--review-passes 0` opt-out.

## Documentation updates

- `v2/docs/workflow-runner.md` — implement preset omitted-flag default (one debate pass) and `--review-passes 0` opt-out.
- `v2/docs/operator-runbook.md` — review is on by default; document `--review-passes 0` opt-out.
- `v2/docs/v1-behaviors.md` — v2 implement now matches v1 review-by-default; note the prior zero-pass default.
- `v2/docs/install-and-config.md` — `projects.<key>.implement.reviewPasses` absent-field default `1`.
- `v2/docs/write-behavior.md` — implement `--review-passes` omitted-flag default and opt-out.
- `v2/docs/first-workflow-walkthrough.md` — implement `--review-passes` table row and surrounding narrative.
