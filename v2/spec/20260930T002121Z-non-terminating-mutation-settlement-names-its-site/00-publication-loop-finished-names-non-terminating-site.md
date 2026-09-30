# Publication loop_finished names non-terminating mutation site

## Problem

Publication failure settlement appends terminal `loop_finished` from `publicationLoopFinishedBase`, which spreads `survivingMutationLogFields` but not `nonTerminatingMutationLogFields`, so publication-time `non_terminating_mutation_failed` omits mutation text and source file/line on the durable log row even though the workflow return payload and `runs.terminal_failure_detail` can carry the site; `jarvis run log` and daemon `run list` / `run wait` operator errors project from that row via `composeRunOperatorError`.

## Decision ledger

- Add `...nonTerminatingMutationLogFields(publication.failure.error)` to `publicationLoopFinishedBase` beside the existing `survivingMutationLogFields` spread; rules out fixing only the publication failure return-object branch without updating the appended `loop_finished` record that list/wait consume.
- Leave write-loop and workflow-runner-resume terminal settlements unchanged; rules out re-touching paths that already spread both field helpers.

## Task checklist

- Spread `nonTerminatingMutationLogFields` onto `publicationLoopFinishedBase` in `v2/src/execution/workflow-runner.ts`.
- Add a publication-time `non_terminating_mutation_failed` case in `workflow-runner-publication.test.ts` mirroring `settles surviving_mutation_failed as durable failed with resumable terminal details after completion boundary`, asserting terminal `loop_finished` site fields and `composeRunOperatorError` projection.
- Align `v2/docs/v1-behaviors.md`, `v2/docs/write-behavior.md`, and `v2/docs/operator-runbook.md` with publication-tail parity for non-terminating mutation site reporting.

## Acceptance criteria

- [ ] `workflow-runner-publication.test.ts` adds a publication-time `non_terminating_mutation_failed` case mirroring `settles surviving_mutation_failed as durable failed with resumable terminal details after completion boundary`: terminal `loop_finished` carries mutation text, source file, and line, and `composeRunOperatorError` on that record surfaces the same site for list/wait projection; it fails against the pre-fix `publicationLoopFinishedBase`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- Update `v2/docs/v1-behaviors.md` to catalog that publication-time `non_terminating_mutation_failed` retains mutation site on terminal `loop_finished` and daemon list/wait operator errors (parity with `surviving_mutation_failed` on the publication tail).
- Update `v2/docs/write-behavior.md` so publication terminal `loop_finished` rows for `non_terminating_mutation_failed` name the mutation site like other publication mutation outcomes.
- Update `v2/docs/operator-runbook.md` so non-terminating mutant recovery names where the site is reported on `run log`, `run list`, and `run wait`.
