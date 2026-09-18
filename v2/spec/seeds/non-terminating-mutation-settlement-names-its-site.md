---
name: non-terminating-mutation-settlement-names-its-site
---

# A publication-time `non_terminating_mutation_failed` never names the mutation site

## Problem

The documented recovery for `non_terminating_mutation_failed` is "fix the killing test or mutation site, then resume" — but the settlement does not say which site. The workflow publication tail builds its terminal `loop_finished` from `publicationLoopFinishedBase` (`v2/src/execution/workflow-runner.ts:1556-1560`), which spreads `survivingMutationLogFields` but not `nonTerminatingMutationLogFields`. The other settlement paths (`write-loop.ts:4372-4373`, `workflow-runner-resume.ts:1330-1331`, `2267-2268`) spread both. So `jarvis run log` and `run list`/`run wait` carry the reason with no file, line, or mutation; the site exists only in `runs.terminal_failure_detail`.

## Evidence (2026-09-14)

Review row `1a8d83b5` (lane `route-draining-run-logs-to-owner`, #3887) settled `non_terminating_mutation_failed`; `run log` ended `{"kind":"loop_finished","loopOutcomeKind":"non_terminating_mutation_failed","iterationsConsumed":0,"resumable":true}` and `run list` showed only the reason. The site (`daemon-stable-run-routing.ts:99`, `operator-flip: === → !==`) had to be read out of SQLite by hand before recovery could start.

## Status (2026-09-18)

`run-operator-error.ts` already projects `nonTerminatingMutationLogFields`; only the publication-tail spread is missing, so this is a one-line fix plus test. Sequence after the open spec `surviving-mutation-settlement-records-killing-set` subspec 01, which edits the same sites.

## Decisions

- Every terminal settlement carrying a non-terminating mutation failure spreads `nonTerminatingMutationLogFields` alongside `survivingMutationLogFields`, including the publication tail.

## Acceptance criteria

- [ ] A test proves a publication-time `non_terminating_mutation_failed` records the mutation text, source file, and line on the terminal `loop_finished`; it fails against the pre-fix `publicationLoopFinishedBase`.
- [ ] A test proves `run list`/`run wait` surface that site on the row's operator error (currently starved only by the missing spread).

## Documentation updates

- `v2/docs/operator-runbook.md` — non-terminating mutant recovery names where the site is reported.
