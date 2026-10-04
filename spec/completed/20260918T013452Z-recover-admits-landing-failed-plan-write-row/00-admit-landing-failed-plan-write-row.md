# `recoverPlanStage` admits `landing_failed` plan write rows with a present staged tree

## Problem

`recoverPlanStage` (`v2/src/execution/workflow-runner-resume.ts`) admits only `blocked` plan write rows (`isBlockedPlanWriteRecoveryCandidate`) and completed drafts with a failed review sibling. A `landing_failed` plan write row — settled by the write loop's exhausted staged-lint reprompt with the stage preserved, always with `runStatus: "failed"` (`write-loop.ts:1544-1853`) — is refused `unrelated_plan_stage`, so a hand-corrected staged tree cannot be re-landed.

## Prerequisites

- The decisions-ledger prompt guidance requires a Markdown bullet list — satisfied, landed in #4013.
- The plan-draft normalizer bulletizes bare `## Decisions` lines before staged lint — satisfied, landed in #4017.

Both fix the *trigger*; this lane is the recovery path for a row that already settled `landing_failed`.

## Decisions

- Admit a plan write row whose last attempt outcome is `landing_failed` only when `.jarvis-plan-stage/` exists and contains at least one file; rules out admitting on outcome alone, which could land an empty spec.
- Absent or empty stage keeps the existing `unrelated_plan_stage` refusal rather than a new refusal code; rules out widening the operator-facing refusal vocabulary.
- Admitted rows go through the existing recovery landing path (normalizer + staged lint + land), never redrafting; rules out landing unvalidated operator edits.
- `isPlanStageEntryRunRecoverable` (`:661-672`) is unchanged: its `status !== "blocked" && status !== "completed"` fallback already admits a `failed`-status `landing_failed` row, so only the attempt-time predicate in `recoverPlanStage` needs to widen — rules out touching resolution, which would be a no-op.
- A `landing_failed` row is not review-failed, so it takes the same blocker-provenance path as a `blocked` row (`resolvePlanBlockerProvenance`); the harness only writes a blocker for `contract_miss`, so any `## Blocker` found on a `landing_failed` row is operator-authored and refuses `operator_blocker` until removed — rules out skipping blocker provenance, which would silently land past an operator-left blocker.
- `invocation_failure` with `failureKind: "landing"` is excluded: the plan write step's staged-lint failure path only ever settles `landing_failed`, never that invocation-failure/landing combination (which occurs only on the review-behavior row's separate publication-landing recovery path) — rules out widening admission to an outcome this row never produces.

- A `landing_failed` row admitted through the widened predicate is checked for a live worktree claim before it lands, the same as the review-failed path. `admitPlanRecoveryBlockerAndClaim` runs `hasLivePlanRecoveryWorktreeClaim` only on the review-failed branch today; the blocked-write branch this row now travels does not. `landing_failed` is the one state where an operator plausibly reached for `pipeline resume` — which redrafts the same branch — before reaching for `recover`, so the two can race on one worktree. Rules out landing a hand-corrected tree underneath a live redraft.

## Acceptance criteria

- [x] A test in `v2/src/execution/workflow-runner-resume-recover-plan-stage.test.ts` asserts `recoverPlanStage` admits a `landing_failed` plan write row with a corrected staged tree and lands it; it fails against the pre-fix `unrelated_plan_stage` refusal.
- [x] A test in `v2/src/execution/workflow-runner-resume-recover-plan-stage.test.ts` asserts a `landing_failed` plan write row with no `.jarvis-plan-stage/` directory is refused `unrelated_plan_stage`.
- [x] A test in `v2/src/execution/workflow-runner-resume-recover-plan-stage.test.ts` asserts a `landing_failed` plan write row with an empty `.jarvis-plan-stage/` directory (exists, no files) is also refused `unrelated_plan_stage`.
- [x] A test in `v2/src/execution/workflow-runner-resume-recover-plan-stage.test.ts` asserts a `landing_failed` plan write row whose staged tree still fails staged lint is admitted but not landed.
- [x] A test asserts a `landing_failed` plan write row whose worktree is held by a live claim is refused rather than landed; it fails against the pre-fix blocked-write branch, which runs no claim check.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline recover — `landing_failed` plan write rows with a present staged tree are recoverable.
- `v2/docs/v1-behaviors.md` — record the widened recover admission.
