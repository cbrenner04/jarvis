---
name: pipeline-implement-stage-breaks-when-its-plan-pr-merges
---

# A pipeline's implement stage bases its PR on the plan stage's branch, so merging that plan PR kills the pipeline

## Problem

A `full-review` implement stage opens its draft PR with `--base <plan stage branch>`, building a
stacked PR chain. Nothing documents that chain, and nothing guards it. The operator runbook and the
implement queue both direct the operator to review and merge each green PR as it lands, and a squash
merge deletes the head branch — so merging the pipeline's own plan PR removes the base ref the
implement stage is about to target. `gh pr create` then fails, the stage records
`harness_failure` / `nextAction: "stop"`, and the pipeline derives terminal `failed` with its
remaining branch gates still `awaiting`.

The completion commit is not lost — it is on the implement branch — but no PR exists, the pipeline
is terminal, and recovery is entirely by hand.

## Evidence

Pipeline `3b97c231-c0c8-4357-af9d-acf19bb20332` (`full-review` on `jarvis`), 2026-08-03, seed
`surface-the-completion-commit-error-instead-of-swallowing-it`. Plan PR #2547 merged, then the
implement stage failed:

```text
Command failed: gh pr create --draft
  --base plan/persist-completion-commit-error-in-loop-log
  --title Persist completion-commit error detail in loop logs
pull request create failed: GraphQL: Head sha can't be blank, Base sha can't be blank,
  No commits between plan/persist-completion-commit-error-in-loop-log and
  20260803T012532Z-persist-completion-commit-error-in-loop-log,
  Base ref must be a branch (createPullRequest)
```

Two diagnostics disagreed about the same failure:

| Surface | Reason | Retryable | Next action |
| --- | --- | --- | --- |
| `pipeline list` stage row | `harness_failure` | false | `stop` |
| `jarvis run wait` on the run | `completion_commit_failed` (+ full `publicationFailure`) | true | `resume` |

The stage also recorded `workflowInvocationId: 5f693e70` — a run that **completed** — while the run
that actually failed (`a7701790`) was unlinked, and `startedAt == endedAt`. That linkage half is
already owned by `20260803T002657Z-fan-out-stage-dispatch-preserves-workflow-ownership`; this seed
owns the base-ref failure and the diagnostic downgrade.

Recovery cost: rebase the completion commit off the merged plan commits onto `main`, push to a new
branch, open the PR by hand (#2549).

## Decisions

- An implement stage whose configured base ref no longer exists on the remote falls back to the
  repository base rather than failing publication — rules out a merged intermediate PR killing the
  pipeline. The fallback is reported on the stage artifact so the retarget is visible.
- A stage failure reason is derived from its owning run's operator error, not replaced by a generic
  `harness_failure` — rules out a stage advertising `stop`/non-retryable over a run that is
  `resumable: true`.
- The stacked-PR chain (`implement` based on the `plan` stage branch) is stated in the pipeline
  documentation with its merge-order constraint — rules out an operator learning it from a failed
  pipeline.
- Out of scope: stage-to-run linkage identity and premature terminal derivation (owned by the
  fan-out ownership spec and `ready-intents/pipeline-terminal-state-waits-for-stage-settlement`).

## Acceptance criteria

- [ ] An implement stage whose base branch is absent from the remote publishes against the
      repository base instead of failing; a regression fails against the baseline `gh pr create`
      invocation and asserts the resolved base.
- [ ] The retarget is recorded on the stage artifact (or its failure detail when it still fails),
      naming both the requested and resolved base.
- [ ] A stage whose owning run settled a retryable operator error reports that reason and
      `nextAction` on the stage row rather than `harness_failure` / `stop`; a regression covers the
      `completion_commit_failed` case.
- [ ] A base ref that exists is still used unchanged — no unconditional retarget to the repository
      base.
- [ ] Mutation checkpoint: a `// @mutate` directive removing the base-existence check turns the
      absent-base regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline start — state that implement stacks on the plan stage
  branch, what happens if that branch is merged first, and the resulting retarget behavior.
- `v2/docs/daemon-host.md` — stage failure reasons mirror the owning run's operator error.

## Prerequisites

- Pipeline stage dispatch resolves each stage's base ref and passes it to workflow admission
  (`v2/src/execution/pipeline-stage-resolve.ts`, `pipeline-execution.ts`).
