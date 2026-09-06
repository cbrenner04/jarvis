# v1-behaviors stale-reset disposable-lane gates

## Problem

The incomplete implement/plan/intent re-run stale-reset bullet in `v2/docs/v1-behaviors.md` omits the unlanded-commits refusal and the caller-marked `disposableLane` bypass for descendant and landed-criteria gates.

## Decision ledger

- Extend the existing incomplete re-run stale-reset bullet only; rules out a new competing catalog entry.
- Record path-scoped unlanded refusal (non-staging commits only), `disposableLane` bypass of descendant and landed-criteria refusals only, draft-PR unchanged path, and that `disposableLane` defaults false for standalone `run workflow` with pipeline restart wiring deferred to [[pipeline-restart-discards-disposable-stage-state]]; rules out documenting restart as already live in this slice.

## Task checklist

- Update the `v2/docs/v1-behaviors.md` incomplete re-run stale-reset bullet to add: path-scoped refusal when the branch has non-staging commits not on base with no open PR (tip SHA, commit count, hand-finish salvage path); `disposableLane` bypass of descendant and landed-criteria refusals only; draft open PR with unlanded commits still proceeds; unchanged scope for merged-worktree cleanup and default standalone re-run.

## Acceptance criteria

- [x] `v2/docs/v1-behaviors.md` — the incomplete implement/plan/intent re-run stale-reset bullet records the path-scoped unlanded-commits refusal, `disposableLane` bypass scope, draft-PR unchanged behavior, and that default standalone re-run and bulk cleanup paths stay unchanged.

## Documentation updates

- `v2/docs/v1-behaviors.md` — incomplete re-run stale-reset refusal list and disposable-lane bypass.
