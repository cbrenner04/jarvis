# Thin cli.test.ts

`v2/src/cli.test.ts` re-proves behavior already owned by handler/pure-layer
tests, and asserts a test fixture's own mock behavior instead of product
behavior. Remove the re-proofs; exit-code-mapping singles already fold into
the existing `run wait maps %p to exit %i` `test.each` table.

## Decisions

- Drop `"mints a different operatorSessionId for each main() invocation"` —
  asserts `crypto.randomUUID()` uniqueness, not product behavior.
- Drop `"run wait returns immediately for an already-quiescent run"` —
  duplicates `daemon/daemon-wait-run-completion.test.ts`'s `"wait returns
  immediately for quiescent run with last loop_finished payload"` and the
  existing table row for `{runStatus:"paused",loopOutcomeKind:"paused"}`.
- Drop `"run wait includes error in stdout JSON when daemon result carries
  error"` — duplicates `daemon/daemon-wait-run-completion.test.ts`'s `"wait
  resolve payload includes the same error object as list for the same run"`
  and the existing table row for
  `{runStatus:"failed",loopOutcomeKind:"invocation_failure"}`.
- Drop `"run list prints daemon rows with liveness"` — list-row/`isLive`
  composition owned by `daemon/daemon-start-list.test.ts`.
- Drop `"run list prints error columns from daemon error when present"` —
  operator-error column composition owned by
  `daemon/daemon-start-list.test.ts`'s `"list includes error on terminal rows
  and omits it on in-progress and completed"`.
- Drop the `describe("simulated bindings", ...)` block — asserts
  `simulatedBindings()`'s own scripted-outcome fixture behavior, not product
  behavior.
- No other test in `v2/src/cli.test.ts` is touched; the `run wait maps %p to
  exit %i` table already covers every exit code the dropped wait tests
  exercised, so no new rows are needed.

## Out of scope

- Src changes.
- Any edit to `daemon/daemon-wait-run-completion.test.ts` or
  `daemon/daemon-start-list.test.ts` (owning-layer coverage stays intact).

## Task checklist

- [ ] Remove the six tests/blocks named in Decisions from `v2/src/cli.test.ts`.

## Acceptance criteria

- [x] `v2/src/cli.test.ts` no longer contains `"mints a different
      operatorSessionId for each main() invocation"`.
- [x] `v2/src/cli.test.ts` no longer contains `"run wait returns immediately
      for an already-quiescent run"`.
- [x] `v2/src/cli.test.ts` no longer contains `"run wait includes error in
      stdout JSON when daemon result carries error"`.
- [x] `v2/src/cli.test.ts` no longer contains `"run list prints daemon rows
      with liveness"`.
- [x] `v2/src/cli.test.ts` no longer contains `"run list prints error columns
      from daemon error when present"`.
- [x] `v2/src/cli.test.ts` no longer contains a `describe("simulated
      bindings", ...)` block.
- [x] `bun test v2/src/cli.test.ts` passes with a lower test count than the
      pre-change baseline, and every other test in the file is unchanged.
- [x] `daemon/daemon-wait-run-completion.test.ts` and
      `daemon/daemon-start-list.test.ts` are unchanged and pass (wait
      semantics, list-row composition, and operator-error columns stay
      covered at the owning layer).
- [ ] PR body lists each dropped test by name next to its surviving owner
      test, plus the before/after `cli.test.ts` test count. (Manual)

## Documentation updates

None — test-only change; no operator-facing or v1 behavior changes.
