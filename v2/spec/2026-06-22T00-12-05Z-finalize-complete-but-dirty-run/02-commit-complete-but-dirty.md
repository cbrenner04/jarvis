# 02 - Harness commits a complete-but-dirty worktree

## Problem

In `v1/src/modes/patch/completion-pipeline.ts` (`tryFinishSpecIfDone`), when `countUnchecked() === 0` (all acceptance criteria ticked) but `worktreeCompletionBlocker()` reports a dirty worktree, the harness prints "Commit and push from the worktree…" and returns exit `6`. In #335 the agent had done correct, lint-clean, fully-tested work and ticked every criterion, leaving one uncommitted file — yet the run exited non-zero and was hand-finalized.

The harness already commits work it owns on other paths: the ready gate commits `check:fix` output (`v1/src/ready-gate.ts`), and the spare-green iteration commits uncommitted *ticks* at iteration start (`commitSubspec`/`commitWipProgress` in `v1/src/modes/patch/subspec.ts`). #9 covers uncommitted ticks but not uncommitted code. A complete-but-dirty worktree is the code analogue: the harness should commit it (`git add -A` + attributed commit + push) and re-run the completion gate, not delegate it back to the agent.

## Decisions

- Trigger only when `countUnchecked() === 0` AND the worktree is dirty. Rules out touching the dirty-but-unchecked path (`run.test.ts:2065`, exit 6) — that is incomplete work and stays the agent's job.
- Never auto-tick. This commits already-present changes only; deciding criteria stays the agent's. Rules out the harness judging completion.
- After committing, re-run the completion gate (proceed into the ready/shrink/review pipeline) instead of returning exit 6. Rules out committing then still exiting 6, which would not finish the run.
- Reuse an existing `git add -A` attributed-commit-and-push helper. Rules out a bespoke commit path that drifts from the `Jarvis-Agent` trailer/push conventions.
- If the worktree is still dirty after the commit, fall back to the existing exit-6 message. Rules out silently swallowing an unexpected post-commit dirty state.

Deferred to first consumer: which existing helper (`commitSubspec` vs the ready-gate commit) and the commit message — pin in implementation; message must carry the agent attribution trailer.

## Task checklist

- [ ] In `tryFinishSpecIfDone`, replace the "Commit and push" + exit 6 branch (complete + dirty) with: commit the worktree via an existing `git add -A` attributed-commit-and-push helper, then re-run the completion gate.
- [ ] Keep exit 6 only as the fallback when the worktree remains dirty after the commit.
- [ ] Leave the dirty-but-unchecked (incomplete) exit-6 path unchanged.
- [ ] Update `run.test.ts` complete-but-dirty test (`:573`) to expect a harness commit + completion, not exit 6; add a test that no acceptance criterion is auto-ticked by the commit.

## Acceptance criteria

- [ ] A run whose checklists are all complete but whose worktree has uncommitted changes is committed by the harness and proceeds through the completion gate to success, without spending an agent turn.
- [ ] The harness-made commit carries the `Jarvis-Agent` attribution trailer and is pushed.
- [ ] No acceptance criterion is ticked by this path — only already-present changes are committed.
- [ ] A run that is dirty but still has unchecked criteria is unaffected and still exits 6 (`run.test.ts:2065` stays green).
- [ ] If the worktree is still dirty after the harness commit, the run exits 6 with the existing guidance message.

## Documentation updates

- `v2/docs/v1-behaviors.md` — completion section: a complete-but-dirty worktree is committed by the harness and finalized; exit 6 here is now only the post-commit-still-dirty fallback.
- `v1/docs/run-loop.md` — Completion: document harness commit of complete-but-dirty worktree before the ready gate.
