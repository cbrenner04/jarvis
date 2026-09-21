# Pipeline stage recovery and dispatch stay on failed publication rows

`pipeline-stage-recovery.ts` and stage dispatch settle and recover on `failed` `completion_commit_failed` rows. Their base tests already ground on failed rows; this subspec removes any completed-row fixture and pins the invariant.

## Decisions

- Plan-stage recovery keeps the explicit non-recoverable `ready_flip_failed` guard and admits failed `completion_commit_failed` rows — rules out treating all failed publication causes alike.
- Stage settlement derives `completion_commit_failed` detail from the failed cause row — rules out a completed-row compatibility path.
- Preservation criteria cite existing tests; a new test is required only where an assertion changes.

## Tasks

- [ ] Keep `v2/src/daemon/pipeline-stage-recovery.test.ts` coverage grounded on a failed `completion_commit_failed` entry row and assert failed-stage recovery admission; remove any completed-row fixture carrying the cause.
- [ ] Keep `v2/src/daemon/pipeline-stage-dispatch.test.ts` coverage proving failed-stage settlement composes `completion_commit_failed` operator detail from the failed cause row.
- [ ] Add a `ready_flip_failed` case beside the `completion_commit_failed` recovery case asserting it settles failed and stays non-recoverable.

## Acceptance criteria

- [ ] `pipeline-stage-recovery.test.ts` failed `completion_commit_failed` entry-row tests stay green: the linked stage settles failed and remains eligible for plan-stage recovery, with no completed row carrying the cause.
- [ ] `pipeline-stage-dispatch.test.ts` failed-stage settlement tests stay green: `completion_commit_failed` / `resume` detail derives from a failed entry row.
- [ ] `pipeline-stage-recovery.test.ts` proves a failed `ready_flip_failed` entry row settles its linked stage failed and is not admitted for plan-stage recovery; fails if the explicit non-recoverable guard is removed.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — reconcile the `pipeline-stage-recovery.ts` entries with the failed-row invariant; remove completed-with-failure-cause wording.
