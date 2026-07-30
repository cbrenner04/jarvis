Verifying key implementation points against the spec and advocate positions before issuing the verdict.
# Adjudicator verdict

Required outcomes before merge:

1. **Unify authored-stage ordering across derivation, execution, and projection.** `derivePipelineState` and `derivePipelineBoundary` must walk stages in the same authored order that `runPipeline` and `pipeline_list` use (durable rows ordered by stored `position`, resolving authored stages through that index). The spec promises authored-order snapshots and a single precedence walk shared by list and wait; execution already treats position order as canonical. Walking `definition.stages` array index separately creates a coupling that diverges if `position` and definition index ever disagree.

2. **Narrow `pipeline_wait` abort handling.** Only genuine cancellation (`AbortSignal` aborted or the wait loop’s explicit abort path) must surface as `pipeline_wait aborted` with no boundary payload. Other failures during a wait must not be converted into abort; they must propagate or map to an appropriate RPC error, consistent with run `wait` and operator diagnosability.

3. **Prove live wait holds through `pending`, not only `running`.** Subspec 01 requires continuing through both `pending` and `running`. The live wait regression must start `pipeline_wait` immediately after admission and assert the wait stays unresolved while durable state is still `pending`, before `running` appears.

4. **Make inversion-guard coverage honest.** Acceptance criteria require that inverting classification, terminality, boundary, or non-follow guards fails tests. Tests that only assert a boolean twice (`x` and `!x`) do not satisfy that. Add negative fixtures that fail if terminality, boundary `stageId`, stage projection order, or live non-terminal snapshot state were wrong—or replace “inverting” test names with accurate descriptions if equivalent matrix/live tests already guard those properties.

5. **Complete operator-facing RPC documentation.** `pipeline_start`, `pipeline_list`, and `pipeline_wait` must appear in the canonical RPC methods table in `v2/docs/daemon-host.md`, not only in the pipeline subsection. Subspec docs ACs and the documentation standard require the wire contract at its durable home.

6. **Align approval-trigger documentation with implementation.** Docs and subspec text should describe `awaiting-approval` as the first unsatisfied approval stage after satisfied predecessors (via `isAuthoredStageSatisfied`), not an enumerated subset of raw statuses (`awaiting` / `pending` only). Runtime already treats any unsatisfied approval row correctly; documentation must not under- or over-specify relative to that contract.

7. **Align `intent.md` acceptance criteria with deliverable scope.** Intent AC #1 still bundles unknown-ID refusal into snapshot reporting despite parameterless `pipeline_list`; unknown-ID errors belong under wait-only criteria (already in subspec 01). Intent ACs should match subspec 00/01 so the routing file does not describe behavior this slice did not ship.

**Not required for merge** (defensible under spec):

- Observer hooking only `updateStage` with `FOLLOW_POLL_MS` polling fallback for other writers (including startup reconciliation).
- Live E2E `pipeline_wait` through a runtime approval gate (seeded rows plus execution stop-at-gate suffice for this slice).
- `skipped` rows without preceding `failed` (writer invariant / corruption; derivation `pending` is correct).
- `handlers.close()` unwinding in-flight `pipeline_wait` (low risk via transport abort; optional polish).
- Multi-pipeline list enumeration, non-string `pipelineId` validation, `reconcilePipelines` + wait integration tests.
- Refactoring duplicated ordered walks in `derivePipelineBoundary` or tightening `PipelineSnapshot.stages[].status` typing (intentional raw projection).