# 01 - Entry rollup surfaces mutation detail from any producing step

## Problem

`workflowSurvivingMutationOwner` (`v2/src/daemon/daemon.ts`) only accepts a sibling whose `stepId` ends
`~shrink`. When a durable review step (`implement-review`, review-debate) owns the
`surviving_mutation_failed` terminal record, the entry rollup finds no owner and falls back to the entry
row's own terminal record — the implement step's `complete`. The entry then reports the rolled-up status
with no `error`, so `run list` / `run wait` on the workflow show a stop with no reason and no
mutation/file/line.

## Decisions

- Owner selection matches any settled `failed` sibling whose terminal `loop_finished` carries
  `loopOutcomeKind: "surviving_mutation_failed"`, not only `~shrink` step ids. Rules out step-id pattern
  matching that hides review-step and completion-row owners.
- With multiple candidates, the chronologically last terminal record wins. Rules out first-match order
  dependence across a retried invocation.
- Entry `resumable` / `retryable` projection is unchanged: the entry stays non-resumable
  (`retryable: false`, `nextAction: "stop"`) and recovery targets the owning row. Rules out widening
  resume admission here — that is the sibling `resume-admits-every-row-it-calls-resumable` intent.
- Out of scope: which durable row the workflow settles (subspec 00), resume execution.

## Acceptance criteria

- [x] With an entry `implement` row `completed` and a durable `implement-review` row `failed` carrying a
      terminal `surviving_mutation_failed` record, entry `run wait` and `run list` report `runStatus:
      "failed"`, `loopOutcomeKind: "surviving_mutation_failed"`, and `error` with `reason:
      "surviving_mutation_failed"` plus mutation/file/line; a new `daemon-wait-run-completion.test.ts`
      case fails against pre-fix code (entry reports no `error`).
- [x] A workflow whose review step succeeded and whose durable rows are all `completed` still reports
      entry `completed` with no `error`.
- [x] `daemon-wait-run-completion.test.ts`'s existing hidden-shrink surviving-mutation and
      complete-after-shrink cases stay green (entry projection unchanged).
- [x] Inverting the added owner-match guard fails at least one test; with the guard inverted to match
      nothing, the negative case proves the entry reports no mutation detail.
- [x] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — operator-error section: entry `list` / `wait` source
  `surviving_mutation_failed` detail from whichever durable sibling owns it, review steps included.
- `v2/docs/v1-behaviors.md` — update the entry-rollup bullet (line ~494) from "hidden finalization row"
  to any owning durable row, keeping the entry non-resumable statement.
