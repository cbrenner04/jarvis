# Activate a durable continuation

## Problem

- An approved gate or reopened failure can have eligible pending rows without a safe daemon activation that restores
  pipeline ownership and runnable state.

## Decisions

- Activate an approved approval boundary or a successfully reopened failed pipeline by atomically claiming a live
  owner and runnable pipeline state before dispatching its eligible continuation; rules out client reconstruction
  and stage-row-only resume.
- Reconciliation preserves awaiting gates and blocked suffixes, while activation operates only after an approved or
  applied-reopen outcome; rules out fail-open activation of awaiting, rejected, or refused pipelines.

## Task checklist

- Wire approval and reopen outcomes into daemon activation.
- Compose activation with reconciliation and continuation claiming.
- Add focused approval/reopen activation race coverage.
- Update daemon and v2 behavior docs.

## Acceptance criteria

- [x] After restart reconciliation, an awaiting or rejected approval is not activated, while an approved approval
      activates exactly its eligible continuation under one live owner and runnable pipeline state.
- [x] After an applied reopen, daemon activation dispatches only the reopened failed stage, preserves succeeded
      predecessor evidence, and establishes ownership and runnable state without client reconstruction.
- [x] A duplicate, refused, or losing activation request changes no stage row and produces no additional dispatch.
- [x] New or updated `v2/src/daemon/pipeline-execution.test.ts` regressions for approved and reopened activation
      after restart fail against the pre-fix daemon behavior.
- [x] Inverting the approval/reopen eligibility or activation-claim guard makes its targeted regression fail;
      negative cases prove awaiting, rejected, refused, and duplicate activation cannot dispatch.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` document durable activation for approved and reopened
      pipelines.

## Documentation updates

- `v2/docs/daemon-host.md` — activation, ownership, and reconciliation composition.
- `v2/docs/v1-behaviors.md` — additive v2 approval and reopen activation.
