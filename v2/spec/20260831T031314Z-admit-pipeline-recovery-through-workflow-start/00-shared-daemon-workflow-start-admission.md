# Shared daemon workflow-start admission

## Problem

Fresh workflow starts and daemon pipeline dispatch share `handleWorkflowStart`, but blocked plan-stage recovery separately implements worktree claims and `activeRuns` registration and omits the live-start memory gate. The copy can diverge from ordinary admission and can mutate recovery ownership before a refusal is fully settled.

## Decisions

- Name the shared boundary `admitWorkflowStart` and parameterize it by the admitted execution lifecycle; rules out sending recovery through fabricated RPC steps or calling `handleWorkflowStart` indirectly.
- Keep recovery RPC validation and target resolution outside `admitWorkflowStart`; after that boundary, fresh starts, pipeline dispatch, and recovery share ownership checks and stale workflow-claim reclamation, memory gating, registry claim, `activeRuns` registration, and rollback through lifecycle admission.
- Set refusal precedence as retirement, request or recovery-target validation, queued or live ownership after stale-claim reclamation, memory pressure, common acquisition, then lifecycle-specific durable admission. Thus ownership and invalid targets are not masked by memory pressure, and a late durable-admission refusal rolls common acquisition back.
- Let lifecycle-specific identities, metadata, controllers, execution, durable-stage admission, and settlement remain distinct. Lifecycle settlement owns eventual release; common admission owns cleanup for every refusal or exception before execution begins.
- Preserve the recovery target's existing `recovery` active-run identity until detached settlement completes; rules out making recovery killable as an ordinary workflow run.

## Implementation

- Extract `admitWorkflowStart` from `handleWorkflowStart`, accepting lifecycle-specific admission, execution, and settlement hooks after common validation and capacity checks.
- Route standalone workflow starts, the default pipeline dispatch closure, and resolved pipeline recovery targets through `admitWorkflowStart`.
- Remove recovery-local registry admission, memory admission, and `activeRuns.set`; retain recovery-specific attempt, detached settlement, continuation, and log-close orchestration around the shared boundary.
- Test early refusal parity, late durable-admission refusal and lifecycle-admission exceptions, exact rollback, and recovery lifecycle preservation.

## Documentation updates

- `v2/docs/daemon-host.md` — state that fresh starts, pipeline dispatch, and stage recovery share daemon admission while retaining distinct execution lifecycles.
- `v2/docs/pipeline-execution.md` — record live-dispatch and recovery admission parity, including refusal-before-stage-mutation behavior.
- `v2/docs/v2-architecture.md` — define the common daemon workflow-start admission boundary after shared preparation.
- `v2/docs/v1-behaviors.md` — record that pipeline recovery uses live-start ownership and memory refusal semantics.

## Acceptance criteria

- [x] A structural test in `v2/src/daemon/daemon-workflow-start.test.ts` proves `handleWorkflowStart`, default pipeline dispatch, and pipeline recovery reach `admitWorkflowStart`, while recovery has no direct registry claim, memory gate, or `activeRuns.set`; it fails against the pre-fix recovery copy.
- [x] A regression test in `v2/src/daemon/daemon-pipeline-recover.test.ts` applies the same queued-ownership, live-ownership including stale workflow-claim reclamation, and insufficient-memory fixtures to live start and recovery, observes matching shared refusal codes and the defined precedence, and proves ownership is not masked by memory pressure. The insufficient-memory case fails against the pre-fix recovery path.
- [x] The same regression proves invalid recovery parameters and an unresolvable recovery target refuse before memory admission; target validation is explicitly recovery-specific and has no live-start counterpart.
- [x] The refusal regression proves every early recovery refusal invokes no recovery attempt and leaves the targeted durable stage record, registry record, `activeRuns`, and durable stage-admission state exactly as before: an existing owner is preserved and a free key remains unowned.
- [x] A late durable-stage-admission refusal and every possible lifecycle-admission exception in `v2/src/daemon/daemon-pipeline-recover.test.ts` roll back the registry claim, `activeRuns` entry, durable admission, and log resource, leave the targeted durable stage record unchanged, and invoke no recovery attempt; each test fails against acquisition without common rollback.
- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` tests `recovers a corrected non-first fan-out branch and leaves siblings unchanged` and `a completion-commit failure does not settle the stage succeeded` stay green.
- [x] `v2/src/daemon/daemon-pipeline-recover.test.ts` tests `a retiring daemon waits for an in-flight detached recovery` and `pipeline_recover admits one branch and advances it without redrafting` stay green; recovery ownership remains claimed through continuation and its log closes only at detached settlement.
- [x] `v2/docs/daemon-host.md` documents shared admission and lifecycle separation.
- [x] `v2/docs/pipeline-execution.md` documents recovery refusal parity and pre-mutation refusal.
- [x] `v2/docs/v2-architecture.md` documents the daemon admission boundary.
- [x] `v2/docs/v1-behaviors.md` records recovery ownership and memory refusal parity.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.
