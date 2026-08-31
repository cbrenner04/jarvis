# Pipeline must land the intent PR at approve-intent so the plan stage MOVES the ready-intent instead of recreating it

## Problem

The plan workflow is designed to **move** its input ready-intent — `git mv <spec-dir>/ready-intents/<name>.md → <spec-dir>/<slug>/intent.md`, consuming it — which only works when the ready-intent is present on the plan stage's base. In a standalone `plan` run the operator has already merged the intent PR, so the ready-intent is on `main` and the move happens (the plan PR shows a rename).

In a `full-review` pipeline, approving `approve-intent` advances the gate but does **not** merge the intent PR, so when the plan stage dispatches, the ready-intent is not on its base (it lives only on the unmerged intent branch). The plan workflow then falls back to **recreating** the ready-intent as `intent.md` in the spec dir — a workaround, not the design. Consequences: the ready-intent is stranded on the unmerged intent branch (never moved/deleted), the intent PR becomes dead weight, and the operator finishes with stacked intermediate PRs to clean up. The end artifact (`spec/intent.md`) is correct, so this is a design/hygiene defect, not a correctness one.

Observed 2026-08-31 on the jarvis `full-review` dogfood (pipeline `f5d15811`, stall-diagnostics feature): the plan stage recreated `intent.md`; the intent PR (#3223) and plan PR (#3224) were closed as folded into the merged implement PR (#3227), and the ready-intent never landed as a move.

## Decisions

- The pipeline must ensure the ready-intent is on the plan stage's base so the plan workflow moves it. The direct mechanism: **`pipeline approve` lands (squash-merges) the approved intent stage's PR to its base as part of approval**, so the plan stage materializes off the updated base with the ready-intent present and moves it. Rules out the recreate workaround and the stranded intent branch.
- Same for the plan gate: landing the plan PR at `approve-plan` lets the implement stage materialize off `main` (the documented merge-first retarget), avoiding stacked intermediate PRs. Handle the retarget cleanly, don't error on it.
- Merging on approve mutates GitHub, so gate it behind opt-in — a `pipeline approve --merge` flag and/or a per-project `pipeline.mergeStagesOnApproval` config — not an unconditional default. Rules out silently merging on every approve.
- Alternative to consider if approve-time merge is undesirable: teach the pipeline plan stage to move the ready-intent from the prior stage's landed artifact directly (delete-on-consume across the chain) rather than recreate. Weigh against the merge-at-gate approach; the move-across-unmerged-branches is harder and the merge-at-gate path also solves the stacked-PR cleanup. Rules out silently keeping the recreate fallback as the norm.

## Acceptance criteria

- [ ] A daemon/pipeline test proves that with the intent PR landed at `approve-intent` (via `--merge`/config), the plan stage's output shows the ready-intent **moved** to `intent.md` (source ready-intent deleted), not recreated; it fails against the pre-fix recreate fallback.
- [ ] A test proves the default (no flag / config off) preserves today's behavior exactly (gate advances, PR unmerged, plan recreates).
- [ ] A test proves plan-gate approve-merge lets the implement stage retarget to `main` without error, and no stacked intermediate PR is left.
- [ ] A refused or failed stage merge (dirty base, non-fast-forward, GitHub error) surfaces a named error and does not corrupt gate/stage state.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — replace the interim merge-at-gate operator practice (added this session) with the `--merge` / config behavior once it ships.

## Sequencing

P3 — low priority; hygiene/ergonomics, end artifact is already correct. The interim operator practice (merge the intent PR at approve-intent so plan moves; plan PR at approve-plan; implement retargets to main) is captured in the runbook now, so this only folds that manual step into the harness. Related: [[pipeline-resume-resolves-downstream-input-from-durable-artifact]], [[pipeline-dispatch-shares-cli-front-door]].
