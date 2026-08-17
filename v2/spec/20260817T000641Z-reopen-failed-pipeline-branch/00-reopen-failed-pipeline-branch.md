# 00 - Reopen one failed pipeline branch

## Problem

`reopenFailedPipeline` counts failures at whole-pipeline scope, although after finding one non-default failure its later shape analysis already narrows to that failed branch and its shared prefix. A sibling failure therefore causes a multiple-failure refusal; an awaiting sibling alone does not. The caller still cannot choose which failed fan-out branch to reopen.

## Decision ledger

- Add optional `branchKey` scope to `reopenFailedPipeline`; omission and `branchKey: "default"` both retain the current whole-pipeline analysis, outcome, and mutation contract. Rules out a separate default-only interpretation or a compatibility change for existing callers.
- For a non-default named scope, the continuation boundary is the lowest durable `(position, stageId)` pair that has both one `default` row and one row carrying the named key. Analyze the unique `default` rows strictly before that boundary plus the unique named rows at the boundary and every later durable default position; exclude all default rows at or after the boundary and every sibling row. Refuse when a selected default or named row is missing, duplicated, position/stage-misaligned, or the named continuation is incomplete through the last durable default position. Rules out ambiguous splits, sparse branch rows, default fan-out placeholders, and sibling rows affecting predecessor, failure-count, or suffix validation.
- A named scope with no replayable failed continuation refuses without mutation and never retries unscoped. Rules out an absent or non-failed branch reopening a sibling failure.
- Re-read and re-analyze the same resolved scope inside the transaction; conditionally reopen only its failed row and skipped suffix, aborting and rolling back every target write when any conditional update loses. Rules out stale analysis, mixed-attempt payloads, and partial reopen under duplicate or racing calls.
- Preserve durable row identity and clear the existing prior-attempt lifecycle fields only on reopened target rows; all shared predecessors and sibling rows remain byte-for-byte unchanged. Rules out reconstructing rows or normalizing unrelated lifecycle state.
- Deferred to first consumer: persistence refusal vocabulary for an absent or non-failed named branch — pin when a caller needs it.

## Task checklist

- Extend the `StateStore.reopenFailedPipeline` contract and implementation in `v2/src/persistence/state-store.ts` with optional named branch scope, with `branchKey: "default"` an exact alias of omission.
- Make non-default branch shape analysis validate the explicit continuation boundary and complete durable named continuation before validating its failure count, predecessors, and skipped suffix.
- Keep initial analysis and transactional re-analysis on the identical resolved scope, with conditional writes and rollback covering the full target continuation.
- Add focused branch selection, raw sibling isolation, default alias, absent/non-failed/malformed refusal, duplicate, and deterministic stale-interference coverage in `v2/src/persistence/state-store.test.ts`.
- Add in-body `// @mutate` directives on stable, unique production guard lines for the keystone and every added or modified branch-selection, no-fallback, and conditional-write guard.
- Update the durable state-store and v1-behavior contracts.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` test `reopens only the named failed fan-out branch while sibling rows stay unchanged` fails against the pre-fix code, then proves the target failed row and only its named skipped suffix become clean `pending` rows. It snapshots the raw `pipeline_stages` records before and after, including stored lifecycle and JSON payload columns, and proves every shared predecessor plus sibling awaiting, failed, skipped, and payload-bearing row is byte-for-byte unchanged.
- [ ] `v2/src/persistence/state-store.test.ts` test `branch-scoped reopen refuses absent, non-failed, and malformed continuations without mutation` proves a named branch never falls back to a replayable sibling failure and refuses with raw-record non-mutation for absent and non-failed branches, multiple target failures, an invalid target predecessor, a non-skipped target suffix, and a missing or incomplete target continuation; exact absent/non-failed refusal reasons remain unpinned.
- [ ] `v2/src/persistence/state-store.test.ts` test `branchKey default aliases the unscoped reopen contract` proves omission and `branchKey: "default"` have the same whole-pipeline outcome and raw persisted rows, including refusal when sibling failures make the pipeline-wide shape invalid.
- [ ] `v2/src/persistence/state-store.test.ts` test `branch-scoped reopen rolls back deterministic stale-suffix interference` installs a test-local SQLite trigger that changes a target skipped suffix after transactional re-analysis and before its conditional reopen write. It proves refusal and byte-for-byte restoration of every raw target and sibling record, demonstrating rollback rather than a sequential duplicate only.
- [ ] `v2/src/persistence/state-store.test.ts` test `competing branch-scoped reopen calls admit one transaction` proves two store handles targeting the same failed branch admit exactly one applied outcome, the loser and a later duplicate refuse, and raw target and sibling records contain no partial mutation.
- [ ] `v2/src/persistence/state-store.test.ts` — `reopens only the named failed fan-out branch while sibling rows stay unchanged`; Keystone checkpoint: an in-body `// @mutate v2/src/persistence/state-store.ts "const branchKey = args.branchKey;" -> "const branchKey = undefined;"` directive restores whole-pipeline selection and turns the scoped regression red.
- [ ] `v2/src/persistence/state-store.test.ts` — `reopens only the named failed fan-out branch while sibling rows stay unchanged`; Mutation checkpoint: in-body directives invert every added or modified named-branch membership, continuation-boundary, and continuation-completeness guard on its real production line, and each mutation turns the scoped regression red.
- [ ] `v2/src/persistence/state-store.test.ts` — `branch-scoped reopen refuses absent, non-failed, and malformed continuations without mutation`; Mutation checkpoint: an in-body directive inverts every added or modified named-scope no-fallback and malformed-continuation refusal guard on its real production line, turns the refusal regression red, and the negative cases prove the suppressed sibling reopen and partial writes remain absent.
- [ ] `v2/src/persistence/state-store.test.ts` — `branch-scoped reopen rolls back deterministic stale-suffix interference`; Mutation checkpoint: an in-body `// @mutate v2/src/persistence/state-store.ts "WHERE id = ? AND status = ?" -> "WHERE id = ?"` directive removes the conditional-write guard, turns the stale-interference regression red, and its raw snapshot proves the otherwise-suppressed partial target write is observable.
- [ ] Existing `v2/src/persistence/state-store.test.ts` whole-pipeline `reopenFailedPipeline` tests stay green with omitted `branchKey`, including valid reopen, malformed/no/multiple-failure refusal, lifecycle clearing, restart, duplicate, and race coverage.
- [ ] `v2/docs/state-store.md` documents optional branch scope, the explicit continuation boundary and incomplete-row refusal, shared-prefix/named-suffix shape analysis, atomic target reopen, sibling byte isolation, named-scope refusal without fallback, `default` aliasing omission, and unchanged omitted-scope behavior without pinning deferred refusal vocabulary.
- [ ] `v2/docs/v1-behaviors.md` records v2 branch-scoped durable reopen, `default` aliasing omission, and preserved unscoped behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` § API: add optional `branchKey` to `reopenFailedPipeline`; define `default` as the omission alias, the continuation boundary, complete durable shared-prefix/named-suffix selection, malformed-row refusal, transactional re-analysis, sibling isolation, no fallback, and preserved unscoped semantics.
- `v2/docs/v1-behaviors.md`: add the v2-only named-branch durable reopen behavior, the `default` omission alias, and preserved whole-pipeline semantics.

## Implementer notes

- Bind optional scope once as the unique line `const branchKey = args.branchKey;` and use it for both pre-transaction and in-transaction analysis so the keystone directive is stable.
- Keep mutation directives in the named test bodies and target real production guards; do not add test-only inversion hooks. The stale-interference trigger is test setup, not a production hook.
