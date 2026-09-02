# Pipeline resume override stale-reset dispatch

## Primary implementation surface

daemon

## Problem

Daemon `pipeline_resume` already admits `resetDespiteDirty` and `resetDespiteLandedCriteria`, but resume dispatch lacks end-to-end proof that operator-supplied overrides reach shared `resetStaleWorkspace` with the same per-gate outcomes as standalone `plan`/`implement` re-run preflight outside failed-plan auto-clear.

## Decision ledger

- This slice adds regression coverage only unless a minimal wiring gap is found while writing tests; rules out changing standalone workflow gates or failed-plan automatic dirty skip.
- `resetDespiteDirty` must clear only the dirty-reuse gate on a failed `implement` resume (reachable today via `pipeline implement-stage stale-reset refusal fails stage without dispatch` on main); rules out the flag also skipping landed-criteria or descendant checks.
- `resetDespiteLandedCriteria` must clear only the landed-criteria gate on a failed `plan` resume (reachable today via `failed plan auto-dirty reset preserves landed-criteria refusal` on main); rules out the flag also skipping dirty reuse on non-plan stages.
- Live-run/worktree claim, operator `## Blocker`, and non-descendant `HEAD` refusals with both overrides true stay covered by existing pins; rules out re-litigating those guards here.
- Recover does not invoke stale reset; no `pipeline-execution.test.ts` recover coverage in this slice.

## Tasks

- Add real-git `pipeline-execution.test.ts` coverage for failed `implement` resume with `resetDespiteDirty: true` clearing dirty reuse through shared stale reset and dispatching the writer.
- Add real-git coverage for failed `plan` resume with `resetDespiteLandedCriteria: true` clearing landed-criteria refusal and dispatching the writer.
- Assert each override affects only its matching gate (dirty-only and landed-only cases remain refused without the matching flag).
- Add `@mutate` checkpoints on the resume reset-flag construction path only if needed to keep the new tests red against pre-fix behavior.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` proves resume dispatch with `resetDespiteDirty: true` on a failed `implement` stage reaches shared `resetStaleWorkspace`, retires the dirty worktree, and dispatches the writer — matching standalone implement re-run dirty-gate override semantics; fails against the pre-fix path where `resumePipeline` is invoked without override flags (reachable today in `pipeline implement-stage stale-reset refusal fails stage without dispatch`).
- [ ] `pipeline-execution.test.ts` proves resume dispatch with `resetDespiteLandedCriteria: true` on a failed `plan` stage reaches shared `resetStaleWorkspace`, clears landed-criteria refusal, and dispatches the writer — matching standalone plan re-run preserve-gate override semantics; fails against the pre-fix path where `resumePipeline` omits the landed override (reachable today in `failed plan auto-dirty reset preserves landed-criteria refusal`).
- [ ] `pipeline-execution.test.ts` — `failed plan resume preserves %s despite both reset overrides` and `failed plan auto-dirty reset preserves landed-criteria refusal` stay green.
- [ ] `daemon-pipeline-resume.test.ts` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None in this subspec — operator and v1-parity docs land in later subspecs.
