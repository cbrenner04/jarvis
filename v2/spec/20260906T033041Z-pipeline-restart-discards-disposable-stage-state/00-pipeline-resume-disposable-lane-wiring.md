# Pipeline resume disposable-lane wiring

## Primary implementation surface

`v2/src/daemon/pipeline-execution.ts` (failed-plan resume stale-reset admission: `disposableLane` marker, draft-tree versus landed operator-blocker guard); `v2/src/commands/cleanup.ts` (export or thin shared never-landed classifier aligned with `unlandedNonStagingPaths` plus PR absence).

## Problem

Failed-plan `pipeline resume` still refuses before dispatch when a never-landed lane carries stale worktree drift, landed-criteria drift, or an operator `## Blocker` confined to `.jarvis-plan-stage/` — state the restart exists to replace. Shared `resetStaleWorkspace` already supports `disposableLane` bypass of descendant and landed-criteria gates and path-scoped unlanded-commits refusal, but resume never passes the marker and the pre-dispatch operator-blocker guard treats all staged blockers alike.

## Decision ledger

- Failed-plan resume passes `disposableLane: true` into shared stale-reset only when structural never-landed classification succeeds (no open PR on the lane branch and no commits ahead of base whose changed paths leave harness workflow staging); rules out honor-system disposable marking that could destroy unpushed implementation.
- Structural never-landed classification reuses the same path-scoped unlanded-commits predicate and PR absence check as shared stale-reset rather than duplicating git policy in a parallel classifier; rules out divergent disposal boundaries between resume admission and `resetStaleWorkspace`.
- When `disposableLane` is set, shared stale-reset bypasses descendant and landed-criteria refusals; path-scoped unlanded-commits, live-held, claim, ready-PR, and operator-dirt gates stay unconditional; rules out widening disposable bypass beyond the landed head-lane gates spec.
- Draft-tree operator `## Blocker` (non-reserved sections present only under `.jarvis-plan-stage/` on the lane worktree, not committed on base and not owned by a live draft PR) does not refuse failed-plan resume; rules out a dead attempt's blocker note permanently poisoning the lane.
- Operator `## Blocker` committed on base or associated with a live draft PR on the lane branch still refuses before rematerialization; rules out disposable rematerialization through landed operator decisions.
- Default resume performs disposal; no new CLI surface or `--reset-despite-*` extensions; rules out per-gate override growth for restart.
- `maybeResetStaleWorkspace` threads `disposableLane` from resume callers into `ResetStaleWorkspaceOptions`; rules out a second reset entry point in `pipeline-execution.ts`.
- Deferred to first consumer: intent-stage or implement-stage disposable restart — pin when a caller needs it beyond failed `plan` resume.

## Prerequisites

- Shared stale-reset path-scoped unlanded-commits refusal and `disposableLane` descendant/landed-criteria bypass are implemented in `v2/src/commands/cleanup.ts` and pinned in `cleanup.test.ts`.
- Failed-plan resume harness preamble, dirty-gate classification, and shared stale-reset preflight wiring exist in `v2/src/daemon/pipeline-execution.ts`.

## Task checklist

- Export or add a thin shared never-landed classifier in `cleanup.ts` (path-scoped unlanded-commits predicate plus open-PR absence) for resume admission; do not duplicate git policy in `pipeline-execution.ts`.
- Thread `disposableLane: true` through `runPlanStageStaleResetPreflight` / `maybeResetStaleWorkspace` when classification succeeds.
- Revise `refuseReopenedPlanOperatorBlocker` so draft-tree-only operator blockers do not refuse disposable resume; retain refusal when the blocker is committed on base or associated with a live draft PR on the lane branch.
- Add `pipeline-execution.test.ts` coverage named in the acceptance criteria below; trim `failed plan resume preserves %s despite both reset overrides` parameters superseded by disposable rematerialization ACs.
- Pin disposition of `failed plan resume operator blocker refusal includes staged intent.md absolute path` and `failed plan resume mixed blockers refusal includes staged intent.md absolute path`: relocate staged-intent absolute-path suffix assertions to landed-blocker refusal fixtures, or add a preservation AC below if retired.
- Keep live worktree claim and operator-dirt-outside-harness preservation pins green.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` test `pipeline resume rematerializes a never-landed lane with stale worktree and draft-tree operator blocker` drives resume on a failed plan lane whose worktree is not descended from base and whose `.jarvis-plan-stage/intent.md` carries an operator `## Blocker`, with no PR and no unpushed real commits, and asserts rematerialization and dispatch without flags; it fails against the current pre-dispatch operator-blocker and descendant refusals.
- [x] `pipeline-execution.test.ts` test `pipeline resume rematerializes never-landed lane through landed-criteria-only drift` drives resume on a failed plan lane that is never-landed with landed-criteria drift only (no non-descendant `HEAD`, no draft-tree operator blocker) and asserts rematerialization and dispatch without `--reset-despite-landed-criteria`; it fails against the current landed-criteria refusal on disposable lanes.
- [x] `pipeline-execution.test.ts` test `pipeline resume rematerializes never-landed lane with mixed harness and operator blocker` drives resume on a failed plan lane whose `.jarvis-plan-stage/intent.md` carries both a reserved harness `## Blocker` and an operator `## Blocker`, with no PR and no unpushed real commits, and asserts rematerialization and dispatch (harness cleared, draft-tree operator blocker discarded); it fails against the current mixed-blocker refusal.
- [x] `pipeline-execution.test.ts` test `pipeline resume refuses never-landed lane with unpushed commits and names salvage path` drives resume on a failed plan lane whose branch is ahead of base with no PR and asserts refusal without worktree retirement, naming salvage recovery; it fails against a path that rematerializes through unlanded commits.
- [x] `pipeline-execution.test.ts` test `pipeline resume refuses operator blocker committed on base` drives resume on a failed plan lane whose `.jarvis-plan-stage/intent.md` operator `## Blocker` is committed on base, and asserts refusal without rematerialization or dispatch including staged `intent.md` absolute path in stderr and failure detail; it fails against disposable rematerialization through landed blockers.
- [x] `pipeline-execution.test.ts` test `pipeline resume refuses operator blocker on live draft PR` drives resume on a failed plan lane whose `.jarvis-plan-stage/intent.md` operator `## Blocker` is associated with a live draft PR on the lane branch, and asserts refusal without rematerialization or dispatch including staged `intent.md` absolute path in stderr and failure detail; it fails against disposable rematerialization through landed blockers.
- [x] `pipeline-execution.test.ts` — `failed plan resume preserves %s despite both reset overrides` guard `live worktree claim` stays green (reachable on main: parameterized test at ~6590).
- [x] `pipeline-execution.test.ts` — `failed plan resume refuses operator dirt outside harness draft stage and preserves worktree` stays green.
- [x] `pipeline-execution.test.ts` — `failed plan resume preserves %s despite both reset overrides` drops never-landed `operator blocker`, `mixed blockers`, and `non-descendant HEAD` parameters; rematerialization ACs own those outcomes on disposable fixtures.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None in this subspec — durable docs land in later subspecs.
