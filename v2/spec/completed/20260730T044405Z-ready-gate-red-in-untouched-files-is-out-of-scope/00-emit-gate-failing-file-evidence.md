# Emit gate failing-file evidence

## Problem

`runV2TestFiles` (`scripts/run-v2-tests.ts`) captures per-file output behind `--- <file> ---`
headers, but the ready-gate boundary receives combined stdout/stderr. It needs terminal,
machine-readable evidence rather than stale records from a recovered retry or prose.

## Decision ledger

- Export a marker constant from `scripts/run-v2-tests.ts`; emit one deterministic
  repo-relative failing-file record for each non-zero, timed-out, signal, or null-status
  settlement — rules out inferring paths from headers or test prose.
- Records cover pooled concurrent and isolated load-sensitive phases — rules out
  attribution gaps when multiple files settle out of roster order.
- Healthy settled files emit no record — rules out treating the full roster as failed.
- `scripts/ready.ts` emits a parseable completion boundary for every ready-step attempt, including
  its step identity, attempt identity, and terminal status. A retried test step gives each attempt
  a distinct identity and forwards it to its file records — rules out stale first-attempt markers
  selecting a later failure.
- The terminal failed ready step is the last failed completion boundary. Only its final test attempt
  can supply failure paths; a later non-test failure, a recovered test retry, or a missing boundary
  is unattributed. Non-test steps emit boundaries but no file records.
- A runner emits one record per failed settlement. Consumers validate then normalize and deduplicate
  exact paths only within the selected terminal attempt, preserving deterministic first-seen order —
  rules out ambiguous duplicate semantics.
- Record wire shape is owned here — marker-prefixed, repo-relative paths plus attempt correlation —
  rules out divergent literals in `v2/src`.

## Task checklist

- Add the exported marker, attempt correlation, and per-failing-settlement emission to
  `runV2TestFiles`.
- Add ready-step attempt/completion boundaries in `scripts/ready.ts`.
- Pin both contracts, including concurrent and isolated cases.
- Document the contract in the runner durable home.

## Acceptance criteria

- [x] `scripts/run-v2-tests.test.ts` adds pre-fix-failing coverage that every non-zero, timed-out,
      signal, or null-status settled file emits exactly one correlated marker-prefixed repo-relative
      record and healthy files emit none, including concurrent and isolated load-sensitive cases.
- [x] `scripts/ready.test.ts` adds pre-fix-failing coverage that the final failed ready step and
      attempt are unambiguous: a retry gets a new identity, a recovered retry contributes no terminal
      failure, and a later non-test failure supersedes earlier test records.
- [x] Inverting per-settlement emission, attempt correlation, or a completion boundary turns its
      corresponding test RED; a healthy-only run remains record-free when restored.
- [x] Existing `scripts/run-v2-tests.test.ts` attribution, fail-fast, timeout, pool, and
      load-sensitive cases and `scripts/ready.test.ts` retry/timeout cases stay green.

## Documentation updates

- `v2/docs/test-writing.md` — marker/attempt/completion contract, terminal selection, one record
  per failed settlement, duplicate handling, and that non-test steps have no file records.
