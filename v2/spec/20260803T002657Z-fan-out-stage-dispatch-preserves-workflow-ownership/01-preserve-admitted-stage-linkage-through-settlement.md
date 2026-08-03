# Preserve admitted-stage linkage through settlement

## Problem

- A stage can be marked failed after its entry run was admitted, leaving `workflowInvocationId` attached to a live workflow that later completes.

## Prerequisites

- `00-admit-fan-out-branches-with-destination-ownership.md` has made entry-run admission return the durable entry-run ID before stage lifecycle handling.

## Decisions

- `workflowInvocationId` is the entry-run ID. Workflow-wide invocation metadata remains only in the entry run and optional stage artifact metadata; it is not the stage linkage identity.
- After entry-run admission, the durable stage remains linked, exactly `running`, and without `endedAt` until that entry run settles.
- A linkage-write error or wait rejection after admission is not a pre-admission refusal and must not write a failed stage while the entry run remains live.
- Admission records enough durable run-to-stage identity for restart reconciliation to find an admitted-but-unlinked or interrupted stage, restore its `running` linkage, and follow the same entry run to settlement. This closes the crash window between entry-run creation and stage linkage.
- Terminal success, terminal non-success, and completed-without-artifact settlement keep their existing terminal meanings after the admitted run is observed; destination-worktree ownership and `multiple_failed_stages` behavior are outside this lifecycle slice.

## Tasks

- Make the admitted entry run durably recoverable as the stage owner across the entry-run/linkage write window and daemon restart.
- Keep an admitted stage `running` and unended through linkage-write errors and wait rejection, then settle it from the linked entry run's real terminal outcome.
- Add lifecycle regressions for live-run adoption, linkage-write failure, wait rejection, and restart recovery.
- Pin each post-admission and recovery guard with uniquely applicable mutation directives.
- Update daemon, operator, and v1-parity documentation.

## Acceptance criteria

- [ ] `daemon-pipeline-approval.test.ts` — `admitted fan-out stages remain adopted through settlement` proves every branch stage whose `workflowInvocationId` names a live entry run is linked, exactly `running`, and lacks `endedAt` until that run settles; it never becomes `failed` while that linked run later completes. The regression fails against the baseline.
- [ ] `pipeline-stage-dispatch.test.ts` — post-admission linkage-write failure and wait rejection each preserve or recover the entry-run linkage without a failed live-run row; after the real entry run settles, the stage records that terminal outcome. Each case fails against the baseline.
- [ ] `daemon-pipeline-approval.test.ts` or `pipeline-stage-dispatch.test.ts` restarts the daemon after entry-run admission but before successful stage linkage, then proves durable reconciliation adopts the exact entry-run ID and settles the stage from that run rather than failing or redispatching it. The regression fails against the baseline.
- [ ] Every added or changed post-admission and recovery guard has one uniquely applicable single-line `// @mutate` directive on its real source condition in `daemon-pipeline-approval.test.ts` or `pipeline-stage-dispatch.test.ts`; each named pin turns RED when its mutation is applied independently, with no production inversion hook.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` document claim-free predecessor handoff, destination ownership, `workflowInvocationId` as the entry-run ID rather than workflow-wide metadata, restart recovery for an admitted entry run, and the invariant that a failed stage has no live linked invocation.

## Documentation updates

- `v2/docs/daemon-host.md` — claim-free predecessor handoff, destination ownership, entry-run linkage identity, and restart recovery.
- `v2/docs/operator-runbook.md` — a failed stage has no live linked invocation; an admitted entry run remains adopted through settlement and recovery.
- `v2/docs/v1-behaviors.md` — changed v2 fan-out ownership and stage-linkage behavior.
