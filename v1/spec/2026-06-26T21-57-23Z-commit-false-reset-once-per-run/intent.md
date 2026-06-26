---
name: commit-false-reset-once-per-run
---

# commit:false reset runs once per run, not against own progress

## Problem

The no-commit re-run reset applies per non-fixup iteration. On a multi-iteration
`commit: false` run, a later iteration reloads this same run's own delta and
un-ticks acceptance criteria the agent just completed, undoing in-flight
progress.

## Direction

Apply the reset at most once per run, at run start, against a prior run's delta
only — never re-apply it against the current run's in-flight mutations. The
committed (`git: true`) path is unaffected.

## Prerequisites

- The commit:false re-run auto-reset un-ticks acceptance criteria and strips an appended blocker from the source spec before the agent re-runs.

## Blocker

The behavior this intent asks for already exists in committed code. The stated problem ("reset applies per non-fixup iteration … a later iteration reloads this same run's own delta and un-ticks AC") contradicts the current implementation, so there is nothing to fix and a drafted spec's ACs would already be satisfied (a no-op).

Evidence (HEAD):

- `v1/src/modes/patch/iteration.ts:512` guards the reset with `!state.noCommitResetAppliedThisRun`; `:519` sets it true after the first application. Reset runs at most once per run.
- `loadDelta` (`:513`) and `applyReset` (`:515`) have exactly one call site each, both inside that guard — no second reset path. `saveDelta` persists in-flight delta but never triggers a reload.
- `ctx`/`state` are created once before the `while (true)` loop (`v1/src/modes/patch/run.ts:347-348`), so `noCommitResetAppliedThisRun` persists across iterations. Later iterations take the else branch and never reload/re-apply.
- The `!gitEnabled` guard already leaves the `git: true` path unaffected.
- This guard shipped with the original feature in #496 (`c32caa77`, ancestor of HEAD) and `git log -S noCommitResetAppliedThisRun` shows no later commit modified it.

Decision needed from the operator (pick one):

1. Close this intent as already-implemented (no spec).
2. Re-scope to **add a regression test** locking in the once-per-run guarantee — currently unpinned: `v1/test/no-commit-delta.test.ts` only unit-tests the delta helpers in isolation; no test exercises a multi-iteration `commit: false` run proving in-flight progress survives. If this is the real goal, revise the intent's Problem/Direction to say so and I will draft it.

Not guessing between these — they are materially different deliverables.
