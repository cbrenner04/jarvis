# Workflow composable collapse

v2 workflow presets grew as vertical slices — duplicate builders (`intent-workflow-steps`,
`plan-workflow-steps`), runner domain branches (`deferredIntentOutput`, `planReviewContext`,
`patchReviewContext`), and render modules that re-execute review cycles
(`executePatchReviewCycle`, `executePatchReviewDebate`). Collapse to composable
publication + optional review. Net deletion required; reorganization that preserves bulk
is out of scope.

## Problem

Each preset variant (`intent-reviewed`, `plan-reviewed`, `plan-reviewed-light`, implement
review behavior flags) added a builder, runner branch, render executor, and test matrix.
Intent and plan builders are ~80% duplicate. `workflow-runner.ts` owns linked-subspec
routing, intent landing, and three review dispatch paths. Not composable.

## Scope

- One publication builder table for `intent` and `plan` rows (prompt, stage dir, output
  shape); delete duplicate builder files.
- Compose review via `--review-passes` and `--review-behavior debate|light` on intent, plan,
  and implement — delete `intent-reviewed`, `plan-reviewed`, `plan-reviewed-light` as
  separate implementation surfaces (CLI names may alias with migration hint).
- One `ReviewPromptProfile` and one runner review dispatch; `review-cycle.ts` and
  `review-debate.ts` remain the only cycle executors; render modules assemble prompts only.
- Post-write landing as step hooks (`landing: intent-stage | plan-tree | none`) — delete
  `deferredIntentOutput` runner branches.
- Linked subspec routing to `shared/` — thin runner, not a state machine in
  `workflow-runner.ts`.
- Implement launch resolution in builders, not `cli.ts`.
- Unified review enforcement primitive — delete per-domain copies.
- Review prompt assembly in `shared/prompts/` (mirror `intent-split.ts` / `plan-draft.ts`).
- Defer inflight `intent-reviewed-uses-external-worktree` into this work — no standalone
  runner branches for review cwd.
- Composition gate in `v2/docs/coding-standards.md`: new workflow behavior composes
  existing step groups; new runner dispatch branch requires spec Blocker.

## Decisions

- Preset names `intent`, `plan`, `implement` stay — rules out breaking operator CLI; they
  become table rows not separate builders.
- `--review-passes 0` omits review step — rules out zero-cycle review steps.
- No splitting `workflow-runner.ts`, `write.ts`, or `cli.ts` into files — out of scope.
- Line-count gate: combined lines in `workflow-runner.ts`, `review-debate-render.ts`,
  `render-plan-review-prompts.ts`, `review-intent-enforcement.ts`, `intent-workflow-steps.ts`,
  `plan-workflow-steps.ts` must drop ≥25% vs pre-collapse baseline.

## Out of scope

- File splits for runner, write, cli.
- YAML workflow authoring.
- `plan-workflow-intent-flag` ready intent (handle flag rename inside collapse if needed).

## Documentation updates

- `v2/docs/workflow-runner.md`, `v2/docs/prompts.md`, `v2/docs/coding-standards.md`,
  `v2/docs/first-workflow-walkthrough.md`.

## Reference

- Prior conversation: workflow bloat review (2026-07-12).
- Seed `10-step-groups-scaffold` follows this seed.
