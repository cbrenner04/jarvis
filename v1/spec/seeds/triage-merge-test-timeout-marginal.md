---
name: triage-merge-test-timeout-marginal
---

# `triage --merge` classify test flakes at its timeout boundary

`v1/test/triage-command.test.ts` › `triage --mark-ready > --merge flag > --merge
classifies all spec check statuses correctly` runs ~5.25s standalone — right at its
~5s timeout. Under full-suite parallel load it tips past the timeout and fails, so the
`bun run ready` completion gate reds on otherwise-correct code.

Observed 2026-06-29: it failed the `jarvis1 triage … --merge` gate twice (contended
*and* isolated full-suite runs), then passed in single-test isolation (5.25s, 1 pass).
Cost: hand-finalize of a clean impl PR (admin-merge after confirming CI green + the
isolated test passes).

## Decisions

- Raise this test's per-test timeout well above its standalone runtime (e.g. `15000`ms)
  so parallel-load slowdown can't tip it — rules out leaving a ~5s test under a ~5s
  timeout.
- Audit sibling `triage-command.test.ts` cases that spawn subprocesses / poll for the
  same marginal-timeout pattern; bump any within ~1.5× of their timeout — rules out
  fixing one case while leaving the same flake next door.
- Do not paper over by serializing the suite or marking the test `sandbox-unrunnable` —
  the code is correct; only the timeout headroom is wrong.

## Out of scope

- Any change to `triage --merge` runtime behavior or the gate itself.
- Broader test-suite parallelism tuning.

## Documentation updates

- None (test-only change). If a timeout-headroom convention emerges, note it where
  test conventions live.
