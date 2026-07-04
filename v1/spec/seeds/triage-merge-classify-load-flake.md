---
name: triage-merge-classify-load-flake
---

# `triage --merge classifies all spec check statuses correctly` times out under CI load

## Problem

Observed 2026-07-04 across 6+ separate CI runs (different PRs: #1003, #1007,
\#1008, #1009, plus at least one `2026-07-04T17-23-45Z-ci-scoped-tests-by-changed-path`
run), always in the `Test (v1)` job:

```
(fail) triage --mark-ready > --merge flag > --merge classifies all spec check
statuses correctly [~5040ms]
```

The duration is suspiciously consistent (5036–5043ms across all
occurrences) — a strong signal this is hitting `bun:test`'s default 5000ms
per-test timeout, not a random assertion failure. The test passes reliably
in isolation locally (`bun test v1/test/triage-command.test.ts` — 143/143
pass in ~25s) and every failure this session coincided with heavy concurrent
CI load (many PRs' CI running at once during a long multi-intent session).
None of the PRs that hit this were touching `triage`-related code — several
were markdown-only (ready-intent/spec files) — ruling out a content-caused
regression.

## Scope (for plan → run)

- Confirm the 5000ms bun:test default timeout is what's being hit (check for
  an explicit per-test timeout override already set elsewhere in the suite
  for comparison).
- Identify why this specific test (`setupMergeWorktree` + the classification
  loop) is close enough to the timeout boundary that CI-runner load tips it
  over — likely real subprocess/filesystem setup in `setupMergeWorktree`.
- Either raise this test's timeout, make its setup cheaper/mocked, or mark it
  in a slower/serial-only lane if it's fundamentally load-sensitive.

## Out of scope

- General CI runner performance tuning — this is one specific test's margin,
  not a suite-wide timeout audit (unless the audit surfaces more instances of
  the same pattern, which would then be an separate follow-up).

## Decisions (seed-level — refine in plan)

- This is a timeout-margin bug, not a logic bug — the fix should not touch
  the classification behavior under test, only its time budget or setup cost.

## Documentation updates

- `v1/docs/operator-runbook.md` — if unresolved by session end, note under
  Known gotchas: "`triage --merge classifies all spec check statuses
  correctly` can fail under heavy concurrent CI load at ~5040ms (likely the
  bun:test default timeout) — treat as safe to retry/force-merge for
  markdown-only PRs, same as other load flakes."
