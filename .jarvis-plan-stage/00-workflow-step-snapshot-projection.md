# Workflow step snapshot projection

## Problem

On a workflow entry row whose rollup status is `completed`, non-durable review steps can
still read `pending` after live progress is cleared (`workflow-list-snapshot.ts:68-86`) —
the panel disagrees with the run outcome. Review and review-debate steps that invoked an
agent emit `attemptCount: 0` (`:64-79`), so the counter carries no information.

## Decisions

- When entry rollup status is `completed`, no authored step in that row's workflow snapshot
  reports `status: "pending"`; rules out leaving completed invocations with pending steps.
- Early-stop rollups (`blocked`, `failed`, `killed`, etc.) keep later unstarted steps
  `pending`; rules out changing the existing stopped-before-last-step contract.
- `attemptCount` reflects started agent invocations for the step; any step that invoked an
  agent reports `>= 1`; rules out placeholder zero on rows with live or settled progress.
- Durable step rows continue to source `attemptCount` from that step's durable
  `run.attempts.length`; rules out a second counter for rows that already persist attempts.
- Non-durable review and review-debate steps source `attemptCount` from progress the
  workflow runner reports into the daemon map (extend `ReviewProgress` or equivalent);
  rules out inferring invocations from role labels alone.
- Terminal review progress remains list-visible after the invocation quiesces (freeze at
  completion boundary or equivalent); rules out re-deriving terminal step state from a map
  entry cleared on workflow exit.
- Deferred to first consumer: whether never-run steps on a `completed` rollup map to
  `stopped` with a dedicated outcome or inherit another terminal shape — pin only if a
  caller needs a distinction beyond "not pending".

## Task checklist

- Thread entry rollup status (or equivalent terminal/completed signal) into
  `workflowRowSnapshot` / `workflowStepSnapshot`.
- Reconcile non-durable review steps at the invocation completion boundary so terminal
  list projection survives progress-map cleanup.
- Propagate per-step invocation counts from the workflow runner into daemon list
  projection for review-shaped steps.
- Extend `v2/src/daemon/workflow-list-snapshot.test.ts` and/or
  `v2/src/daemon/daemon-start-list.test.ts` for the new behaviors.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [ ] `daemon-start-list.test.ts` test `list projects a review behavior entry in authored order and tracks progress to terminal` expects `attemptCount >= 1` on the terminal review step after critic progress was reported; it fails against baseline and passes after implementation.
- [ ] `daemon-start-list.test.ts` adds coverage where a workflow entry row's rollup is `completed` but in-memory review progress was cleared: no authored step in `workflow.steps` has `status: "pending"`; it fails against baseline and passes after implementation.
- [ ] The completed-rollup regression fails if the guard that suppresses `pending` when rollup is `completed` is inverted (step returns `pending` despite completed rollup).
- [ ] The attempt-count regression fails if review progress omits or zeroes `attemptCount` after an agent invocation was reported.
- [ ] `daemon-start-list.test.ts` test `list returns workflow step snapshots for live, stopped, and completed workflow-backed runs` stays green (early-stop pending steps unchanged).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — workflow snapshot rules: no `pending` steps when entry rollup
  is `completed`; `attemptCount` semantics for review-shaped steps.
- `v2/docs/v1-behaviors.md` — list-row workflow step snapshot honesty (completed rollup,
  review attempt counts).
