---
name: triage-merge-classify-timeout-margin
---

# Fix timeout margin in `--merge classifies all spec check statuses correctly`

## Problem

Test times out under CI load at ~5040ms, matching bun:test's default 5000ms
per-test timeout, not a logic failure. Root cause: the test loops 12 status
cases; 5 "shouldWait" cases each poll with `pollTimeoutMs: 1000`, summing to
~5000ms baseline runtime with near-zero margin before any CI slowdown tips it
over.

## Scope

- Confirm the 5000ms bun:test default is the trigger (check for existing
  per-test timeout overrides elsewhere in the suite for comparison).
- Reduce the test's time budget (e.g. lower each `pollTimeoutMs`) or set an
  explicit longer per-test timeout, without changing the classification
  behavior under test.

## Out of scope

- General CI runner performance tuning — this is one test's margin, not a
  suite-wide timeout audit.

## Decisions (seed-level — refine in plan)

- Timeout-margin bug, not a logic bug — fix must not touch classification
  behavior under test, only its time budget or setup cost.

## Documentation updates

- `v1/docs/operator-runbook.md` — if unresolved by session end, note under
  Known gotchas: "`triage --merge classifies all spec check statuses
  correctly` can fail under heavy concurrent CI load at ~5040ms (likely the
  bun:test default timeout) — treat as safe to retry/force-merge for
  markdown-only PRs, same as other load flakes."

## Prerequisites
