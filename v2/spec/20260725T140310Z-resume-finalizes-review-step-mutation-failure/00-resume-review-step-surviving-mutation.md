# Resume review-step surviving-mutation finalization

A durable `implement-review` row that settles `failed` with
`loopOutcomeKind: "surviving_mutation_failed"` advertises `nextAction: "resume"`, but `jarvis run resume` answers
`resume_unsupported: step "implement-review" is not an executable write step` because admission
hands off to `reconstructWriteResume`, which rejects `review` / `review-debate` behaviors. The
implement write step is already complete; only mutation verification and finalization need to run
again. Resuming the entry id or the completed `~shrink` row does not replay that tail (observed
2026-07-25, PR #2121).

Distinct from shrink `contract_miss` / text-less shrink `blocked`
(`shrink-step-contract-miss-strands-the-run-terminally`).

## Decisions

- After admission (`nextAction: "resume"` from prerequisite
  `resume-admits-every-row-it-calls-resumable`), reconstruction applies only when the row is
  `failed`, step behavior is `review` or `review-debate`, and terminal `loop_finished` is
  `surviving_mutation_failed` — treated as “review agents done, publication tail only”; rules out
  widening resume to other review failures (landing `invocation_failure`, timeouts, etc.).
- That predicate branches daemon/workflow resume to a **publication-tail** entry (existing
  `publishWithReadyRepair` and ready finalizer — re-verification, ready gate, draft→ready; commit,
  push, and PR refresh follow existing finalizer/idempotency rules), not `reconstructWriteResume` and
  not write-loop landing retry; rules out `resume_unsupported` solely because the row is not
  `write`.
- Resume respawns the tail with a **completion-bound** loop result aligned with how the workflow
  attributes publication to the **completion step**; a generic `failed`-row / `committedResult`
  path must not be assumed to auto-replay publication the way a `complete` write-loop result does.
- The operator resumes the **durable review row** that owns `surviving_mutation_failed`
  (`implement-review` or a durable `review-debate` last step); publication/finalization work is
  attributed like normal post-review completion so `loop_finished` and terminal state on the resumed
  row id match honest settlement from `surviving-mutation-row-honest-on-any-step`; rules out
  completing on the implement row or respawning a write loop under it.
- That resume path does not spawn a write-loop iteration for an already-completed implement write
  step; rules out re-invoking the write-step agent binding.
- This slice adds reconstruction/execution after admission, not a second eligibility predicate;
  rules out a review-only `run resume` bypass that ignores the row contract.
- Non-durable light-review redirect-to-`~shrink` settlement stays as-is; rules out changing which
  row owns the failure.
- Out of scope: whether `implement-review` should run mutation verification at all (intent).

## Tasks

- Add daemon/workflow resume reconstruction for the `surviving_mutation_failed` review-behavior
  predicate: branch to publication-tail respawn instead of `reconstructWriteResume`.
- Once that entry path exists, preserve checkpoint skip for the completed implement write step and
  any completed review roles on retry.
- Add regressions in `daemon-resume.test.ts` for success (both review step kinds on the same path),
  write-step non-invocation, guard inversion, completed-review control, and entry/completed-shrink
  refusal.
- Align operator-runbook, daemon-host, and v1-parity docs with the recovery that works for a
  review-step mutation failure.

## Acceptance criteria

- [x] New cases in `v2/src/daemon/daemon-resume.test.ts` drive workflows whose durable
      `implement-review` and durable `review-debate` last-step rows each settle
      `surviving_mutation_failed`, call `resume` on that row id, and assert finalization completes
      (`loop_finished` with `loopOutcomeKind: "complete"`, `resumable: false`) after a succeeding
      ready finalizer on the same publication-tail resume code path; they fail against pre-fix code
      with `resume_unsupported`.
- [x] The same `daemon-resume.test.ts` end-to-end resume fixture asserts the completed `implement`
      write step records no additional `iteration_started` / agent invocation during that resume;
      inverting the skip guard fails the test.
- [x] Inverting the review-step `surviving_mutation_failed` resume reconstruction guard fails at
      least one test in `v2/src/daemon/daemon-resume.test.ts` by restoring `resume_unsupported` or
      by recording an **implement** `iteration_started` / agent invocation.
- [x] `v2/src/execution/workflow-runner.test.ts` `"settles a surviving-mutation failure on the durable review-debate step's own row, not the implement step's"` stays green; `jarvis run resume` on a completed non-resumable workflow row is still refused `terminal_run` per existing `daemon-resume.test.ts` completed-run cases; `resume` on the workflow entry id and on a completed `~shrink` row for the same surviving-mutation scenario still refuses (`terminal_run` or non-resumable), matching the intent problem statement.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — resume the durable row that owns
  `surviving_mutation_failed` (including `implement-review`); replace the misleading
  “resume owning `~shrink` only” story when the failure is on the review row.
- `v2/docs/operator-runbook.md` § Known gotchas — correct surviving-mutation recovery for
  review-owned failures (resume that row after fixing coverage; entry id / completed shrink resume
  still refuse).
- `v2/docs/daemon-host.md` — the `resume` RPC row: review-step `surviving_mutation_failed` resume
  uses completion-step / publication-tail reconstruction, not review write-resume snapshot fields
  (`stepRules`, `expectedArtifactPath`).
- `v2/docs/v1-behaviors.md` — review-step `surviving_mutation_failed` resume replays finalization
  without re-running the implement write step.
