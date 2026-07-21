# A run that failed mutation verification is reported `completed`

## Problem

Both implement runs of 2026-07-21 ended in a **failure**, and both are reported as `completed`.

Final log record, run `3c02684c` (`publish-review-verdicts-in-prs`, PR #1859):

```json
{"kind": "loop_finished", "loopOutcomeKind": "surviving_mutation_failed",
 "iterationsConsumed": 4, "resumable": true}
```

Run `b5fb90e3` (`durable-review-debate-run-row`, PR #1858) ends identically at `iterationsConsumed: 5`.

Yet:

- `jarvis run list` reports both rows **`completed`**, with empty `error`, `retryable`, and
  `nextAction` columns — despite `resumable: true`.
- `jarvis run workflow implement` printed `{"runStatus":"completed","loopOutcomeKind":"complete",
  "resumable":false}` and exited **0**, because it reports the workflow's *first* constituent run,
  not the run that carries the outcome.
- Both PRs correctly stayed **draft** — the flip was blocked, as it should be.

So the harness behaved correctly at the gate and lied about it everywhere the operator looks. This
is the reported symptom "runs are labeled complete but the PR is a draft with failing checks": the
PR state is right; the *run status* is wrong.

A status of `completed` that coexists with `resumable: true` is self-contradictory — a completed run
has nothing to resume. And the two claims are *both* wrong, in opposite directions:

```console
$ jarvis run resume 3c02684c-5c3d-43e3-bfbf-d50046b68011
terminal_run: Cannot resume a failed run
```

So the resume path knows the run is **failed and terminal**, while `run list` calls it `completed`
and the log advertises `resumable: true`. Three subsystems, three different answers about one row.

`resume` refuses as terminal. Re-running `implement --base main` does still work — the ticks live
only on the unmerged branch, so the spec reads unticked from `main` — but that path discards the
branch and its review history rather than finishing the run, and nothing in `run list` tells the
operator that a re-run is the move.

Verified after full quiescence: both worktrees clean, `local == remote`, no live runs, all
acceptance criteria ticked. This is the settled end state, not a mid-flight snapshot.

### Why it misleads badly

An operator who trusts `completed` merges a draft PR whose changed guards are not constrained by any
test — exactly the failure `implement-completion-requires-adversarial-mutation-verification` was
built to prevent. The gate works; its result is discarded at the reporting layer.

## Decisions

- A run whose final `loopOutcomeKind` is a failure (`surviving_mutation_failed` and its siblings)
  settles with a failed durable status, never `completed`. The last loop outcome owns the row's
  status. Rules out an earlier boundary's `completed` surviving as the row's status.
- `resumable: true` and status `completed` are mutually exclusive; pin the invariant in the state
  store so the pair cannot be persisted.
- `run list` / `run wait` populate `error`, `retryable`, and `nextAction` for a surviving-mutation
  failure, naming the unconstrained guard(s) so the operator knows what coverage is missing.
- `jarvis run workflow` reports the **workflow's** outcome and exits non-zero when the workflow
  failed; it must not report a constituent run's outcome as the command result. Overlaps
  `workflow-commands-block-the-operator-terminal` — land the exit-status half wherever that lands.
- Rules out weakening or bypassing mutation verification; the gate's verdict is correct and must be
  surfaced, not relaxed.

## Acceptance criteria

- [ ] A run ending `surviving_mutation_failed` settles with a failed durable status; `run list`
      never reports it `completed`.
- [ ] No durable row can hold status `completed` together with `resumable: true`.
- [ ] `run list` and `run wait` report `error`, `retryable: true`, and a `nextAction` of `resume`
      for that run, and name the surviving mutation's file and guard.
- [ ] `jarvis run workflow implement` exits non-zero and reports the failing outcome when its
      workflow ends in a mutation-verification failure.
- [ ] `run list`, the run log's `resumable` flag, and `run resume`'s admission decision agree about
      one row; a row reported `resumable: true` is accepted by `resume`, and one refused as terminal
      is never reported resumable.
- [ ] A surviving-mutation failure leaves at least one harness-native way forward, and the refusal
      message names it.
- [ ] A run that genuinely completes is unaffected: status `completed`, `resumable: false`, exit 0.
- [ ] Regression coverage reproduces a multi-run workflow whose final run fails while an earlier one
      completed, and fails against current behavior.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — what `completed` implies, and how a surviving-mutation
  failure presents.
- `v2/docs/state-store.md` — the status/resumable invariant.
- `v2/docs/workflow-runner.md` — workflow-level outcome reporting.
