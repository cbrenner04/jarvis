# 01 - Honest intent finalization settlement

## Problem

Intent runs have recorded `boundary_committed` with `outcomeKind: "done"` / `runStatus: "completed"`
before landing/finalization finished (production: `boundary_committed` then failed or stranded stage),
while the branch head was unchanged and `.jarvis-intent-stage/` still held finished work; settled
`invocation_failure` after every review role reported `exit_kind: "ok"` including failures in the
workflow tail after review returned complete; and emitted durable `failed` rows with empty
`error.reason`, `retryable`, and `nextAction` while the same run’s log showed `loop_finished`
`complete`. Operators cannot trust terminal rows to name the failing step or whether work is
recoverable.

## Decisions

- Authoritative row: `list` / `wait` / `resume` use the intent workflow’s durable completion row
  (split write step after publication-tail redirection per `daemon-host.md`), not ephemeral review-step
  rows alone.
- That row must not emit completion-boundary `outcomeKind: "done"` / `runStatus: "completed"` while
  `.jarvis-intent-stage/` still holds staged files or while paths under `intentOutput.durableDir` lack
  a matching completion commit; guard review-step `boundary_committed` ordering as well as the
  completion committer path; rules out “completed” with an unchanged head and a populated stage.
- When the completion committer returns no new commit and work remains uncommitted,
  `completion_commit_failed` names every operator-relevant path: staged paths under
  `.jarvis-intent-stage/` while the stage is still populated; paths under `durableDir` when promotion
  succeeded but commit did not.
- Post–all-roles-`ok` failures in review finalization or the workflow tail after review completes
  classify as finalization failures, not `invocation_failure`; operator `error.reason` is
  `landing_failed` when promotion is still pending (populated stage or landing-step fault before a
  durable commit). `landing_failed` covers landing/promotion-step faults; `completion_commit_failed`
  covers commit/push/PR tail faults after promotion; both pair with `nextAction: "resume"` and
  `retryable: true` when republication can finish publication (subspec 02).
- No terminal durable `failed` row on the authoritative completion row may omit `error.reason`,
  `retryable`, and `nextAction`; when that row’s log records `loop_finished` `complete`, the row must
  agree or name the mismatch; rules out empty operator-error payloads (including split-run rows that
  disagree with their own log).
- Depends on subspec 00 finalization entry and trace events; rules out re-deriving promotion in this
  slice.
- Out of scope: misclassified `invocation_failure` on non-intent steps; empty or absent stage
  recovery (subspec 02).

## Tasks

- Guard completion-boundary emission on the authoritative completion row for premature `done` and for
  review-step `boundary_committed` emitted before landing/finalization finishes.
- Classify post-invocation finalization errors in review landing and in the workflow tail after review
  returns `complete` as `landing_failed` (or finalization-named `failureKind`), not
  `invocation_failure`.
- Harden terminal row projection so `composeRunOperatorError` never returns an all-empty failure for
  intent finalization paths on the authoritative row.
- Add regressions with inverted guards for boundary ordering, tail-vs-review classification, commit
  gap, and empty failed rows.

## Acceptance criteria

- [ ] `workflow-runner.test.ts` `"does not emit done boundary before intent finalization finishes"`
  drives a scenario where landing/finalization is still in flight (or fails after a premature boundary
  attempt), asserts no `boundary_committed` with `outcomeKind: "done"` / `runStatus: "completed"`
  on the authoritative completion row until promotion and commit succeed; inverting the guard fails the
  test.
- [ ] `workflow-runner.test.ts` `"does not record done completion boundary when intent stage remains
  uncommitted"` stubs the completion committer to return no `commitSha` with staged files present,
  asserts no `boundary_committed` with `outcomeKind: "done"` / `runStatus: "completed"` on the
  authoritative row and asserts uncommitted stage paths are named in `completion_commit_failed`; inverting
  the guard fails the test.
- [ ] `workflow-runner.test.ts` `"settles workflow-tail finalization failure without invocation_failure
  when all roles succeeded"` fails finalization in the post-review workflow tail (not inside review role
  execution) after every review role returned `ok`, asserts terminal outcome names finalization /
  `landing_failed` (not `invocation_failure`); inverting the classifier fails the test.
- [ ] `workflow-runner.test.ts` `"settles post-review finalization failure without invocation_failure
  when all roles succeeded"` injects a finalization error after all review roles return `ok` within the
  review step, asserts the same finalization classification; inverting the classifier fails the test.
- [ ] `workflow-runner.test.ts` `"does not emit an empty failed row when log shows loop_finished
  complete"` drives split-vs-log disagreement on the authoritative durable completion row (`list` /
  `wait` id), asserts non-empty `error.reason`, `retryable`, and `nextAction` (naming mismatch or
  resumable `landing_failed`); inverting the guard fails the test.
- [ ] `run-operator-error.test.ts` covers `landing_failed` with `nextAction: "resume"` and
  `retryable: true` for populated-stage finalization pending promotion, distinct from
  `completion_commit_failed`.
- [ ] `composeRunOperatorError` does not rely on a `loop_finished` + `complete` branch that never
  executes when `run.status === "failed"` (`allowResumableLogOutcomes` is false). For a failed
  authoritative row whose log says `loop_finished complete` — or whose attempt detail maps to no
  resumable reason — the row still exposes non-empty `error.reason`, `retryable`, and `nextAction`.
  Either implement that path for failed status or delete the dead branch; either way a regression
  fails without attempt-backed landing detail. This is the occurrence #8/#9 empty-failed-row shape.

## Documentation updates

- `v2/docs/workflow-runner.md` — boundary settlement on the authoritative completion row: no `done` with
  unchanged head and populated stage; `completion_commit_failed` path naming; post-invocation
  finalization vs `invocation_failure`; `landing_failed` vs `completion_commit_failed`; terminal row must
  carry operator-error fields.
- `v2/docs/v1-behaviors.md` — intent publication and settlement behavior changes from this slice.
