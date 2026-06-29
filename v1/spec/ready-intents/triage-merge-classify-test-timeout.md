---
name: triage-merge-classify-test-timeout
---

# `--merge classifies all spec check statuses correctly` passes under parallel suite load

## Behavior

`v1/test/triage-command.test.ts` › `triage --mark-ready > --merge flag > --merge
classifies all spec check statuses correctly` passes reliably when the full suite
runs with `bun test --parallel`, instead of tipping past its per-test timeout
(~5.25s standalone at a ~5s bound).

## Decisions

- Raise this test's per-test timeout well above its standalone runtime (e.g. `{ timeout: 15000 }`) — rules out leaving a ~5s-bound test that already runs ~5.25s isolated.
- Do not paper over via suite serialization or `sandbox-unrunnable` — rules out masking correct code with runner workarounds.

## Out of scope

- Sibling `triage-command.test.ts` cases (separate intent).
- `triage --merge` runtime behavior or ready-gate policy changes.

## Documentation updates

- None (test-only). Deferred to first consumer: timeout-headroom convention in test docs — pin if a convention emerges from sibling audit.

## Prerequisites
