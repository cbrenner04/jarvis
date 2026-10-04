---
name: stage-settlement-foreign-owner-liveness
---

# Stage settlement treats rows owned by a live foreign daemon as live

Seed: `v2/spec/seeds/daemon-survives-committed-successor-death.md`. Startup `settleOrphanedRunningStages` (`v2/src/daemon/pipeline-execution.ts:1047`) settles via local-only liveness (`stage-settlement-owner.ts:58-59`); a terminal entry row plus an `in-progress` `~shrink` row owned by a live other daemon rolls up `killed` (`pipeline-stage-settlement.ts:247`, `workflow-run-status-rollup.ts:88-90`) and fails the stage `resumable_kill` while work continues.

## Decisions

- An invocation is live when any of its rows is non-terminal and owned by a live daemon (this one or another); only otherwise may local liveness decide.
- No change to row reconciliation.

## Acceptance criteria

- [ ] A test with an invocation whose entry row is `completed` and whose `~shrink` row is `in-progress` owned by a live foreign identity asserts the startup sweep leaves the stage `running`; it fails against the current code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — foreign-owner liveness in stage settlement.

## Prerequisites

- Every daemon retire/drain/exit path logs its trigger (RPC name and caller, or signal) before acting.
- Outgoing daemon generation rebinds the public address and reopens admission when its committed successor dies.
