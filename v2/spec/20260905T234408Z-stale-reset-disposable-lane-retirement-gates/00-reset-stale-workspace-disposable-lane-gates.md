# Reset stale workspace disposable-lane gates

## Primary implementation surface

cli

## Problem

Shared `resetStaleWorkspace` still refuses retirement on descendant drift and landed-criteria drift before pipeline restart can rematerialize a never-landed lane, and it retires branches with commits not on base and no PR without naming salvage risk — the shape that will block `cleanup --abandon` in [[abandon-refuses-unlanded-work-with-no-pr]].

## Decision ledger

- Retirement refuses when the branch has commits not reachable from the resolved base, at least one changed path outside harness workflow staging (`.jarvis-plan-stage/`, `.jarvis-intent-stage/`, and ignored `.jarvis-*` sidecars), and no associated open PR, naming tip SHA, commit count, and a hand-finish salvage path; rules out silently destroying unpushed implementation work during disposable rematerialization and rules out refusing staging-only commits that [[pipeline-restart-discards-disposable-stage-state]] treats as disposable.
- Callers may mark a lane disposable via `ResetStaleWorkspaceOptions.disposableLane`; disposable retirement bypasses descendant and landed-criteria refusals and proceeds to teardown via `performAbandonmentSteps`; rules out requiring per-gate `--reset-despite-*` overrides for dead lanes.
- Live worktree claim, dirty reuse outside harness draft dirt, and ready (non-draft) PR ownership refusals stay unconditional with `disposableLane`; rules out disposable bypass eating operator edits or published work.
- `disposableLane` does not bypass the path-scoped unlanded-commits refusal; rules out honor-system disposable marking destroying real unpushed work.
- `jarvis cleanup` merged-worktree retirement and standalone `run workflow` incomplete re-run defaults stay unchanged (`disposableLane` defaults false); rules out widening disposable bypass beyond caller-marked pipeline restart retirement.
- Unlanded-commits refusal runs when `baseRef` is set and `prGate.pr` is undefined; rules out refusing superseded branches whose commits are already on base.
- Draft open PR with non-staging commits ahead of base follows today's open-PR path (reset proceeds, PR closed during retirement); rules out treating draft PR presence as the no-PR salvage shape.
- Stale-reset unlanded refusal names tip SHA, commit count, and hand-finish salvage path only; changed-file count and explicit override recovery stay in [[abandon-refuses-unlanded-work-with-no-pr]]; rules out divergent operator text without a recorded boundary.
- Structural disposable predicate validation for `disposableLane` is deferred to [[pipeline-restart-discards-disposable-stage-state]]; rules out duplicating restart caller checks in this slice.
- Gate order: live-held → open-PR (ready/multi) → claim → dirty inventory → `baseRef` block (path-scoped unlanded-commits when no open PR, descendant skipped when `disposableLane`, landed-criteria skipped when `disposableLane` or `skipLandedCriteriaGate`) → dirty refusal append → retirement; rules out doc or implement drift on evaluation order.
- Deferred to first consumer: `--discard-unlanded` override wiring at stale-reset — pin when [[abandon-refuses-unlanded-work-with-no-pr]] lands.

## Prerequisites

- `resetStaleWorkspace` pre-mutation gates (live-held, open PR, claim) and post-gate retirement via `performAbandonmentSteps` are implemented in `v2/src/commands/cleanup.ts`.
- Descendant and landed-criteria refusals with `--reset-despite-landed-criteria` bypass are implemented and pinned in `cleanup.test.ts` and `workflow.test.ts`.

## Task checklist

- Add `disposableLane?: boolean` to `ResetStaleWorkspaceOptions` and thread it only through direct `resetStaleWorkspace` callers in this slice (default false in `maybeResetStaleWorkspace`).
- Add a path-scoped unlanded-commits gate: when `baseRef` is set, `prGate.pr` is undefined, and `git diff --name-only <baseRef>..HEAD` from the worktree includes at least one path outside harness workflow staging, refuse before retirement with tip SHA, commit count, and hand-finish salvage wording aligned with the [[abandon-refuses-unlanded-work-with-no-pr]] refusal shape minus changed-file count and override recovery (without `--discard-unlanded` override in this slice).
- When `disposableLane === true`, skip descendant and landed-criteria refusal parts only; do not skip path-scoped unlanded-commits, live-held, claim, ready-PR, or dirty gates.
- Add `cleanup.test.ts` coverage for the four intent-named scenarios below; use `@mutate` on the disposable bypass or unlanded gate only if needed to keep tests red against pre-fix behavior.
- Landed-criteria disposable fixture: commit the ticked criterion on the worktree branch, advance `projectRoot` base with a new commit so `git rev-list --count <baseRef>..HEAD` is zero while `landedCriteriaAbsentFromBase` still reports drift; rules out copying the uncommitted-tick fixture that hits the dirty gate first.

## Acceptance criteria

- [ ] `cleanup.test.ts` test `resetStaleWorkspace refuses unlanded commits with no PR before retirement` builds a worktree whose branch is ahead of base with a non-staging commit and no PR, asserts retirement refuses without removing the worktree or deleting branches, and names tip SHA, commit count, and salvage recovery; it fails against the pre-fix path that retires it.
- [ ] `cleanup.test.ts` test `resetStaleWorkspace refuses unlanded commits even when disposableLane is set` builds a worktree whose branch is ahead of base with a non-staging commit and no PR, passes `disposableLane: true`, and asserts the same refusal without teardown; it fails against a path that bypasses unlanded-commits when disposable.
- [ ] `cleanup.test.ts` test `resetStaleWorkspace retires a disposable never-landed lane past descendant drift` builds a worktree whose HEAD is not descended from base with zero non-staging commits ahead of base, passes the disposable-lane marker, and asserts `status: "reset"` with the worktree absent from `git worktree list` per existing reset pins; it fails against the pre-fix descendant refusal.
- [ ] `cleanup.test.ts` test `resetStaleWorkspace retires a disposable never-landed lane past landed-criteria drift` builds a worktree using the committed-tick-plus-advanced-base fixture (zero commits ahead of base, ticked criteria absent from base), passes the disposable-lane marker, and asserts `status: "reset"` with the worktree absent from `git worktree list` per existing reset pins; it fails against the pre-fix landed-criteria refusal.
- [ ] `cleanup.test.ts` — `reset refuses when worktree spec has criteria ticked absent from base` stays green (default non-disposable path unchanged).
- [ ] `cleanup.test.ts` — `reset proceeds with reset-despite-landed-criteria when worktree spec has criteria ticked absent from base` stays green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None in this subspec — durable docs land in later subspecs.
