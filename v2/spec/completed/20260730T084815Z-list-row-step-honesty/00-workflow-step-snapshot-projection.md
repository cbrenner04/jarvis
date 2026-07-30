# Workflow step snapshot projection

## Problem

On a workflow entry row whose rollup status is `completed`, non-durable review steps can
still read `pending` after live progress is cleared (`workflow-list-snapshot.ts:68-86`) —
the panel disagrees with the run outcome. The same fall-through can hollow a review step
that invoked an agent on early-stop terminal rollups (`killed`, `failed`, etc.) when
in-memory progress is cleared. Review and review-debate steps that invoked an agent emit
`attemptCount: 0` on terminal projection (`:72-80`), so the counter carries no information.

## Decisions

- When entry rollup `reportedStatus` is `completed`, no authored step in that row's workflow
  snapshot reports `status: "pending"`; rules out leaving completed invocations with pending
  steps.
- Early-stop rollups (`blocked`, `failed`, `killed`, etc.) keep later **unstarted** steps
  `pending`; rules out changing the existing stopped-before-last-step contract.
- On any terminal entry rollup, non-durable review steps that had reported progress before
  the progress map was cleared retain frozen terminal projection (`role`, `terminalOutcome`,
  `attemptCount`, non-`pending` status); rules out the completed-only partial fix.
- **Freeze at the invocation completion boundary is primary** — persist terminal review
  progress before the workflow runner clears the daemon map. The completed-rollup
  `reportedStatus` guard backstops when progress was cleared without a freeze so rollup-only
  reconciliation cannot yield non-`pending` but hollow steps (missing `role` /
  `terminalOutcome`).
- Terminal or settled non-durable review steps that invoked an agent report `attemptCount >=
  1`; rules out placeholder zero after progress quiesces. Live `in_progress` review steps
  keep `attemptCount: 0` until settled; rules out changing existing live list expectations.
- Durable step rows continue to source `attemptCount` from that step's durable
  `run.attempts.length`; rules out a second counter for rows that already persist attempts.
- Non-durable review and review-debate steps source settled `attemptCount` from progress the
  workflow runner reports into the daemon map (extend `ReviewProgress` or equivalent);
  rules out inferring invocations from role labels alone.
- In-process honesty only for non-durable review: in-memory progress does not survive daemon
  restart; rollup guards may suppress `pending` post-restart but cannot recover counts or
  role/outcome without persistence — cross-restart honesty is out of scope unless a future
  persistence spec owns it.
- Deferred to first consumer: whether never-run steps on a `completed` rollup map to
  `stopped` with a dedicated outcome or inherit another terminal shape — pin only if a
  caller needs a distinction beyond "not pending".

## Task checklist

- Thread entry rollup `reportedStatus` into `workflowRowSnapshot` / `workflowStepSnapshot`.
- Freeze terminal review progress at the invocation completion boundary (primary); add
  completed-rollup guard when progress map is cleared without freeze.
- Extend freeze/guard to early-stop terminal rollups for non-durable review steps that had
  reported progress.
- Propagate per-step invocation counts from the workflow runner into daemon list projection
  for settled review-shaped steps.
- Extend `v2/src/daemon/daemon-start-list.test.ts` for the new behaviors.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [x] `daemon-start-list.test.ts` test `list projects a review behavior entry in authored order and tracks progress to terminal` expects `attemptCount >= 1` on the terminal review step after critic progress was reported; it fails against baseline and passes after implementation.
- [x] `daemon-start-list.test.ts` test `list retains frozen review snapshot when completed entry rollup clears in-memory progress` asserts no authored step in `workflow.steps` has `status: "pending"` and the review step retains `role`, `terminalOutcome`, and `attemptCount >= 1`; it fails against baseline and passes after implementation.
- [x] `daemon-start-list.test.ts` test `list retains frozen review snapshot when early-stop entry rollup clears in-memory progress` asserts a review step that reported progress before a `killed` or `failed` rollup cleared the map retains `role`, `terminalOutcome`, `attemptCount >= 1`, and non-`pending` status; it fails against baseline and passes after implementation.
- [x] The completed-rollup cleared-progress regression fails if the guard that suppresses `pending` when rollup is `completed` is inverted (step returns `pending` despite completed rollup).
- [x] The attempt-count regression fails if review progress omits or zeroes `attemptCount` after an agent invocation was reported on a settled step.
- [x] `daemon-start-list.test.ts` test `list projects a review behavior entry in authored order and tracks progress to terminal` keeps `attemptCount: 0` on the `in_progress` review step assertion (live unsettled contract).
- [x] `daemon-start-list.test.ts` test `list returns workflow step snapshots for live, stopped, and completed workflow-backed runs` stays green (early-stop pending steps unchanged).
- [x] `daemon-start-list.test.ts` test `list retains durable plan debate rows across live, terminal, and restart projection` stays green (durable `attemptCount` from `run.attempts.length`).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — workflow snapshot rules: no `pending` steps when entry rollup
  is `completed`; freeze/guard precedence; terminal `attemptCount` semantics for
  review-shaped steps; in-process-only scope for non-durable review.
- `v2/docs/v1-behaviors.md` — list-row workflow step snapshot honesty (completed rollup,
  early-stop freeze, review attempt counts).
