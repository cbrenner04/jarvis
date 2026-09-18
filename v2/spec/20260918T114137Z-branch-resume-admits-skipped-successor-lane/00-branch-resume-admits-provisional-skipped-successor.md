# Branch resume admits provisional skipped successor

## Problem

`scanBranchSuffixForAdmission` (`v2/src/daemon/pipeline-execution.ts`) admits only through a `failed` row or an approved-gate pending successor; a branch at `succeeded` + provisional `skipped` successor refuses `branch_not_resumable`.

## Decisions

- Replace the boolean `{ kind: "ok"; reopenFailedStage: boolean }` (`resolveBranchResumeAdmission`'s return, and `BranchSuffixScanResult`'s `{ kind: "admissible"; reopenFailed: boolean }`) with a three-way `reopenKind: "failed" | "approved_gate" | "provisional_skip"`. Both `resumePipeline`'s branch-scoped path and `branchListableForFailedPlanResume` switch on this value, so the failed-row and provisional-skip admissions stay distinguishable.
- The provisional-skip check sits in `scanBranchSuffixForAdmission`'s existing per-entry loop, after the `failed` check (which returns first, so an earlier `failed` row still wins) and alongside the approved-gate-pending-successor check: when a row is unsatisfied, `status === "skipped"`, and `skipProvenance === "provisional"`, return `{ kind: "admissible", reopenKind: "provisional_skip" }`. Loop order already guarantees every earlier suffix entry was satisfied before this row is reached (the loop returns early on the first unsatisfied entry) — including when the skipped row is the suffix's first entry, where the already-verified shared boundary stands in for a "prior" entry. No separate predecessor lookup is needed.
- `skipProvenance` values other than exactly `"provisional"` (`undefined`/legacy rows, or `"terminal"`) do not match the new branch and fall through to the existing `not_resumable` return, refusing `branch_not_resumable` — rules out treating an absent or terminal provenance as admissible.
- Branch-scoped resume, on `reopenKind === "provisional_skip"`, calls `store.reopenProvisionalSkippedStages({ pipelineId, branchKey: branchScope })` instead of `reopenFailedPipeline` (which requires a `failed` anchor and would refuse this shape). A `kind !== "applied"` result returns `{ kind: "refused", pipelineId, branchKey: branchScope, reason: reopen.reason }`, mirroring the existing `reopenFailedPipeline` refusal-propagation — resume never falls through to dispatch after a refused reopen. This explicit reopen is the admission mechanism; `advanceFanOutBranches`'s own retry of `reopenProvisionalSkippedStages` (see `pipeline-execution.md`) stays a same-pass self-heal backstop, not a substitute for it.
- The provisional-skip admission builds no `ReopenedStageReset`; `buildReopenedStageReset` stays gated on `reopenKind === "failed"` — stale-reset flags belong to reopened failed stages only.
- `branchListableForFailedPlanResume` stays keyed on `reopenKind === "failed"`; rules out listing provisional-skip or approved-gate lanes as failed-plan resume keys.
- `pipeline recover` is untouched.

## Tasks

- [ ] Replace `reopenFailedStage`/`reopenFailed` booleans with the three-way `reopenKind` across `BranchSuffixScanResult`, `scanBranchSuffixForAdmission`, `resolveBranchResumeAdmission`, `resumePipeline`'s branch-scoped path, and `branchListableForFailedPlanResume`.
- [ ] Add the provisional-skip branch to `scanBranchSuffixForAdmission`.
- [ ] Branch-scoped resume calls `reopenProvisionalSkippedStages` on `reopenKind === "provisional_skip"`, propagates a refused reopen, and otherwise continues to dispatch the reopened successor.
- [ ] Tests and docs.

## Acceptance criteria

- [ ] A `pipeline-execution.test.ts` test in `describe("resumePipeline branch scope", ...)` drives a branch at `plan: succeeded` + `implement: skipped` (`skipProvenance: "provisional"`) through `resumePipeline({ branchKey })` against a real `StateStore` (no stubbed store or reopen method), asserts admission, that the `implement` row moves from `skipped`/`provisional` to a dispatched terminal status with provenance cleared, and that sibling rows are untouched; it fails against the pre-fix `branch_not_resumable` refusal.
- [ ] A `pipeline-execution.test.ts` test in the same `describe` proves a branch whose own suffix rows are `skipped` with `skipProvenance: "terminal"` (the split-retired shape, mirroring the pattern `setupBranchResumeFixture` already applies to the fixture's `default` rows) still refuses with `reason: "branch_not_resumable"` and `status: "skipped"` — distinct from `branch_not_found`, so the fixture demonstrably reaches the suffix scan.
- [ ] A `pipeline-execution.test.ts` test extends the `branch_resume_required` listing fixture in `describe("resumePipeline", ...)` (alongside `"unscoped resume lists resumable failed plan branch keys on aggregate awaiting-approval"`) with a branch at `plan: succeeded` + `implement: skipped`/`provisional`, and asserts that branch key is absent from the refusal's `branchKeys`.
- [ ] `pipeline-execution.test.ts` — `"branch-scoped resume reopens and dispatches only the named failed branch"`, `"branch-scoped resume refuses the named branch gate, an unknown branch, and a branch without a replayable failure"`, and `"branch-scoped resume continues an approved-gate pending strand without reopenFailedPipeline"` stay green (failed-row and approved-gate admission unchanged).
- [ ] `v2/docs/pipeline-execution.md` § Operator recovery branch-scoped resume table: the **Admitted** row names provisional-skip admission; the **Refused** row's `branch_not_resumable` entry names terminal-skip and null/legacy-provenance skip refusal.
- [ ] `v2/docs/operator-runbook.md` § Pipeline resume states that `pipeline resume <id> <branch>` admits a lane stuck at a provisional `skipped` successor and reopens it.
- [ ] `v2/docs/v1-behaviors.md`'s `resumePipeline` branch-scoped admission bullet records the provisional-skip admission alongside the existing failed-row/approved-gate admission text.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — provisional-skip branch resume admission and its refusal boundary.
- `v2/docs/operator-runbook.md` — § Pipeline resume documents this shape as admitted, no manual workaround needed.
- `v2/docs/v1-behaviors.md` — update the `resumePipeline` branch-scoped admission bullet.
