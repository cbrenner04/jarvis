---
name: commit-false-rerun-resets-killed-run
---

# A killed commit:false run is reset on re-run

## Problem

The no-commit re-run auto-reset records its delta only on a graceful agent
return. A `commit: false` run interrupted by Ctrl-C, idle/iteration/run timeout
returns before the delta is diffed and persisted, so the ticked acceptance
criteria and any appended `## Blocker` survive into the next re-run unreset —
the headline reporter case (intake issue #520).

## Direction

Persist the delta (AC ticks + appended blocker) on the interrupt and timeout
paths — or persist mutations incrementally as they happen — so a run killed
mid-progress is reset when it is re-run. The committed (`git: true`) path is
unaffected.

## Prerequisites

- The commit:false re-run auto-reset un-ticks acceptance criteria and strips an appended blocker from the source spec before the agent re-runs.

## Blocker

The Direction is already implemented on `main`; the intent's premise ("records its delta only on a graceful agent return") is stale.

PR #496 (`c32caa77`, merged 2026-06-24) added `captureInterruptedDelta(...)` and wired it into all four interrupt/timeout paths in `v1/src/modes/patch/iteration.ts`:

- idle timeout — line 796
- iteration timeout — line 822
- run timeout — line 854
- SIGINT (Ctrl-C) — line 868

Each path snapshots the spec, diffs newly-ticked ACs, detects a newly-appended `## Blocker`, and persists via `recordNewlyCheckedAc` / `recordBlocker` (synchronous `saveDelta`) before returning. On re-run, `loadDelta` + `applyReset` (iteration.ts:488-502) reverts those mutations. No-commit completion loop-backs re-enter `runIteration`, re-arming capture; shrink/review are `gitEnabled`-gated (no-op in commit:false). The null-controller `process.exit(130)` (run.ts:286-288) only fires before the first agent runs, when no AC/blocker delta exists yet. `v1/docs/run-loop.md:586-606` already documents interrupt/kill capture.

Drafting an implementation spec for this would be redundant, no-op work.

The one genuine residual gap: **no end-to-end regression test pins the interrupt/timeout-path capture (the #520 reporter case)**. `v1/test/no-commit-delta.test.ts` exercises only the delta helpers in isolation; `run.test.ts` has timeout/SIGINT tests but none assert no-commit delta capture or re-run reset.

Operator decision needed — pick one, then re-run plan:

1. Close the intent as already-fixed by #496.
2. Re-scope the intent to regression-test hardening only: an end-to-end test that ticks an AC (and appends a blocker) in a commit:false run, kills it via each interrupt/timeout path, and asserts the delta is captured and reset on re-run. (Revise `## Problem`/`## Direction` to say "the fix is unverified" rather than "the delta is not persisted.")
3. If a concrete unreset reproduction on current `main` exists, attach the failing scenario (spec + interrupt path) so a real residual gap can be scoped.
