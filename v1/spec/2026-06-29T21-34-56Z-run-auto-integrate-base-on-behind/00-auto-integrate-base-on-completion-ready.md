# Auto-integrate base on conflict-free behind-base at patch-run completion

## Problem

Patch-run completion can reach the final draft→ready flip with all criteria checked
yet block because the branch is behind its PR base (`ready flip blocked: branch …
does not contain base …; PR stays draft`). Conflict-free integration is common when
sibling PRs merge during a long run; the operator today hand-runs
Integration-merge-then-retest. Post-block, fix+ready never runs on the integrated
tree, so post-actuator lint dirt can reach CI (observed PR #773).

## Decisions

- Shared auto-integrate helper in `v1/src/git/` (e.g. `auto-integrate-base.ts`) — rules out duplicating merge/abort/reset logic in `pr.ts` and `review.ts`.
- `maybeMarkReady` opts `autoIntegrateBase?: boolean` default `false`; only final completion call sites pass `true` — rules out per-iteration early-ready auto-merge in `iteration.ts`.
- Final completion sites: completion-pipeline `maybeMarkReady` (`patch-complete`, `review-incomplete`) and review-final behind-base branch — rules out `maybeMarkReady`-only wiring (misses review-enabled completion path).
- Behind-base at an enabled site: `git merge --no-edit origin/<base>` in the run worktree after the existing fetch — rules out `--no-commit` trial merge or a new subcommand.
- Record pre-merge `HEAD` before merge; on conflict call `git merge --abort` — rules out leaving conflict markers in the worktree.
- On conflict-free merge, force `full` ready gate (fix + verify + harness commit-if-dirty) on the merged tree, then `pushCurrent`, then `gh pr ready` — rules out reusing `fast`/recorded-green tier on the integrated tree and rules out flipping without re-gating.
- On merge conflict or post-merge gate failure, restore pre-merge `HEAD` (`git merge --abort` when in-progress; else `git reset --hard` to recorded sha), emit today's `writeReadyFlipBlocked` stderr, leave PR draft — rules out auto-resolving conflicts and rules out leaving an integrated-but-ungated branch.
- `autoIntegrateBase: false` (default) preserves today's immediate block without merge attempt — rules out changing per-iteration early-ready or other implicit call sites.
- Triage `--mark-ready` and plan-mode draft→ready stay unchanged — rules out widening auto-integrate to manual finalize paths.

## Task checklist

- [ ] Add `v1/src/git/` auto-integrate helper: merge, gate, push, ready flip, abort/reset on failure; injectable git/gate/push seams for tests.
- [ ] Wire helper into `maybeMarkReady` behind-base branch when `autoIntegrateBase: true`.
- [ ] Pass `autoIntegrateBase: true` from completion-pipeline `maybeMarkReady` call sites only.
- [ ] Wire the same helper into review-final behind-base branch before gate/ready.
- [ ] Tests: conflict-free behind → merge, `full` gate, push, `gh pr ready`; merge conflict → abort, blocked stderr, no ready; post-merge gate failure → reset, blocked stderr, no ready; default `autoIntegrateBase` → block without merge (existing behavior).
- [ ] Preservation: triage behind-base and plan behind-base tests stay green.

## Acceptance criteria

- [ ] When patch-run completion reaches a final draft→ready flip (`autoIntegrateBase: true`) and the branch is behind its fetched PR base with a conflict-free `origin/<base>` merge, the harness merges base, runs the `full` ready gate on the merged tree, pushes integrated commits, and flips the PR ready on green.
- [ ] When that merge conflicts, the harness aborts the merge, emits `ready flip blocked: branch … does not contain base …; PR stays draft`, and does not call `gh pr ready`.
- [ ] When the merge succeeds but the post-merge `full` ready gate fails, the harness restores the pre-merge tree, emits the same blocked stderr, and does not call `gh pr ready`.
- [ ] When `maybeMarkReady` is called without `autoIntegrateBase: true` and the branch is behind base, behavior is unchanged: immediate blocked stderr, no merge attempt, PR stays draft.
- [ ] `v1/test/triage-command.test.ts` behind-base `--mark-ready` refusal tests stay green.
- [ ] `v1/test/modes/plan/pr.sandbox-unrunnable.test.ts` `blocks ready flip when branch is behind base` stays green.

## Documentation updates

- [ ] `v1/docs/operator-runbook.md`: conflict-free behind-base auto-integrates at patch-run completion; Integration-merge-then-retest remains for conflicts; remove the concurrency caveat referencing this seed.
- [ ] `v1/docs/run-loop.md`: note behind-base auto-integrate + post-merge `full` gate ordering at final patch draft→ready flip sites.
- [ ] `v2/docs/v1-behaviors.md`: record behind-base auto-merge + post-merge `full` gate in final draft→ready ordering; note triage/plan unchanged.
