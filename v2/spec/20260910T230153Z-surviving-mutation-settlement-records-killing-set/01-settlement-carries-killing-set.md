# The `surviving_mutation_failed` settlement carries the killing set through to the run record and operator error

With the verifier result carrying the killing set and its observed result ([00](./00-verifier-result-carries-killing-set.md)), the settlement path still drops them: `SurvivingMutationError` takes only mutation + source site, `survivingMutationLogFields` emits only those three fields, and the persisted `LoopFinishedEvent`, the `surviving_mutation_failed` run result, and the `jarvis run` operator error therefore name only the site. Carry the two new fields the whole way.

## Decisions

- `SurvivingMutationError`'s constructor gains `killingTests: string[]` and `killingSetObservedResult` as its 4th and 5th positional arguments, ahead of the existing optional trailing `dualConstraint` (6th) — not appended after it. This keeps the two new arguments required (TypeScript cannot skip a required parameter to reach a trailing optional one), so no in-repo throw site can construct the error without supplying them.
- `killingSetObservedResult`'s type on `SurvivingMutationError` and `SurvivingMutationLogFields` is `"passed-confirmed" | "passed-unconfirmed" | "not-run" | "unknown"` — one literal wider than the verifier's three ([00](./00-verifier-result-carries-killing-set.md)). `"unknown"` is reserved for reconstruction from a persisted record that predates these fields; using `"not-run"` there would conflate "a killing set ran but wasn't recorded" with a genuine no-set-resolved survivor, which is the exact conflation this spec exists to remove.
- Log-field names are `survivingMutationKillingTests` and `survivingMutationKillingSetResult`, matching the existing `survivingMutation*` prefix on that field group.
- Both new log fields are optional in `SurvivingMutationLogFields` and on `LoopFinishedEvent` (`v2/src/persistence/log-stream.ts`), mirroring the existing three members: persisted rows written before this change have no such fields, and reading them back must not fail.
- `survivingMutationErrorFromTerminalRecord` does not require the new fields to be present on the terminal record — an older row still reconstructs, recording `killingTests: []` and `killingSetObservedResult: "unknown"` — because gating reconstruction on them would make pre-existing paused runs unresumable.
- The error message is unchanged; the killing set travels as structured fields, not prose, so operator output can render it without parsing.
- AC scope for "the `jarvis run` operator error" is the `RunOperatorError` shape built in `v2/src/daemon/run-operator-error.ts` (surfaced verbatim as JSON `error` on both `jarvis run list` and `jarvis run wait`, documented in `v2/docs/daemon-host.md`), plus the `jarvis run list` tab-separated row (`formatListRunRow` in `v2/src/commands/run.ts`), which already renders the sibling `survivingMutation`/`survivingMutationSourceFile`/`survivingMutationSourceLine` fields as columns — leaving the two new fields off that row while adding them to the JSON error would strand the TSV operator view exactly one field short of a hand flip-and-test comparison. The two new columns append after the existing sixteen (following the precedent of `completionCommitError`, itself appended after `prUrl`), not inserted between the existing `survivingMutation*` columns and `prNumber`.
- Out of scope: the `write.surviving-mutation-reprompt` prompt contract (`SURVIVING_MUTATION`, `SOURCE_FILE`, `SOURCE_LINE`, `DUAL_CONSTRAINT_DETAIL` placeholders) is unchanged — this spec settles a terminal failure record, not a live reprompt.

## Task checklist

- [ ] Widen `SurvivingMutationError` and `SurvivingMutationLogFields`/`survivingMutationLogFields` in `v2/src/execution/ready-finalize.ts`.
- [ ] Widen `LoopFinishedEvent` in `v2/src/persistence/log-stream.ts` with the two optional fields so they round-trip through the persisted log.
- [ ] Widen the `surviving_mutation_failed` run-result field shapes in `v2/src/execution/write-loop.ts` and `v2/src/execution/workflow-runner.ts`.
- [ ] Widen `RunOperatorError` in `v2/src/daemon/run-operator-error.ts`.
- [ ] Widen `formatListRunRow` in `v2/src/commands/run.ts` to append the two new columns.
- [ ] Pass the verifier's new fields at every `new SurvivingMutationError(...)` site (`write-loop.ts` in-loop and publication, `workflow-runner-resume.ts` review-mutation retry); reconstruct legacy values only in `survivingMutationErrorFromTerminalRecord`.

## Acceptance criteria

- [ ] An in-loop `surviving_mutation_failed` settlement records the killing test paths the verifier ran and that set's observed result on the run's terminal `loop_finished` evidence.
- [ ] The `surviving_mutation_failed` run result returned to the caller carries the same killing test paths and observed result.
- [ ] `jarvis run`'s operator error for `surviving_mutation_failed` (`RunOperatorError`, surfaced on `jarvis run list` and `jarvis run wait`) reports the killing test paths and observed result alongside the mutation and source site, and `jarvis run list`'s tab-separated row carries the same two fields as additional columns.
- [ ] A publication-time surviving mutation settles with the same killing-set evidence as the in-loop path.
- [ ] Reconstructing a `SurvivingMutationError` from a persisted terminal record that predates these fields still yields a usable error, recording an empty killing set and `killingSetObservedResult: "unknown"`.
- [ ] `v2/src/execution/write-loop.test.ts` gains a test asserting the killing set and observed result on an in-loop `surviving_mutation_failed` settlement; it fails against the pre-change code.
- [ ] `v2/src/daemon/run-operator-error.test.ts` gains a test asserting the operator error reports the killing set and observed result; it fails against the pre-change code.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- [ ] `v2/docs/write-behavior.md` records that the `surviving_mutation_failed` settlement carries the killing set and its observed result through to the run record and operator error, so a report can be compared against a hand flip-and-test without re-deriving resolution; updates the `jarvis run list` row-format table and column-count note (sixteen columns becomes eighteen; `--all`'s trailing `dismissed` column shifts accordingly).
- [ ] `v2/docs/daemon-host.md` records the two new fields on the `surviving_mutation_failed` `error` projection.
- [ ] `v2/docs/v1-behaviors.md` records the widened `surviving_mutation_failed` settlement evidence (existing behavior changed).
