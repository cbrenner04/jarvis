---
name: non-terminating-mutation-settlement-names-its-site
---

# Publication-time `non_terminating_mutation_failed` names the mutation site on `loop_finished`

Unsplit rationale: one missing field spread on the workflow publication `loop_finished` base; daemon operator-error projection already consumes those fields.

## Primary implementation surface

`v2/src/execution/workflow-runner.ts` (workflow publication terminal settlement)

## Problem

Publication failure settlement builds terminal `loop_finished` from `publicationLoopFinishedBase`, which spreads surviving-mutation log fields but not non-terminating mutation site fields, so `jarvis run log` and `run list`/`run wait` report `non_terminating_mutation_failed` without mutation text, file, or line even though other settlement paths and `runs.terminal_failure_detail` carry the site.

## Decisions

- `publicationLoopFinishedBase` spreads `nonTerminatingMutationLogFields` onto publication terminal `loop_finished` the same way it already spreads `survivingMutationLogFields`; write-loop and resume settlements are prerequisite-only and out of scope.

## Acceptance criteria

- [ ] `workflow-runner-publication.test.ts` adds a publication-time `non_terminating_mutation_failed` case mirroring `settles surviving_mutation_failed as durable failed with resumable terminal details after completion boundary`: terminal `loop_finished` carries mutation text, source file, and line, and `composeRunOperatorError` on that record surfaces the same site for list/wait projection; it fails against the pre-fix `publicationLoopFinishedBase`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — catalog that publication-time `non_terminating_mutation_failed` retains mutation site on terminal `loop_finished` and daemon list/wait operator errors (parity with `surviving_mutation_failed` on the publication tail).
- `v2/docs/write-behavior.md` — publication terminal `loop_finished` rows for `non_terminating_mutation_failed` name the mutation site like other publication mutation outcomes.
- `v2/docs/operator-runbook.md` — non-terminating mutant recovery names where the site is reported on `run log`, `run list`, and `run wait`.

## Prerequisites

- Write-loop and workflow-runner-resume terminal settlements already spread non-terminating mutation site fields onto `loop_finished` for `non_terminating_mutation_failed`.
- `composeRunOperatorError` already maps non-terminating mutation site fields from terminal `loop_finished` onto `RunOperatorError` for list and wait.
- Publication-time `surviving_mutation_failed` settlement already records killing-set evidence on the terminal `loop_finished` through the same publication base object.
