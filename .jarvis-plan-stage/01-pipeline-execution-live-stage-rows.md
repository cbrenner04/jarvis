# Pipeline execution live stage rows

## Problem

The ordered progression loop can record `failed` on a stage row while `workflowInvocationId` still names a live entry run — e.g. fan-out `worktree_claimed` from a prior stage's workflow, or `startedAt == endedAt` with a stale invocation id.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts`. In-scope: `pipeline-execution.test.ts`. Depends on subspec 00.

## Prerequisites

- Subspec 00 landed: `dispatchPipelineStage` holds live linkage and mirrors operator errors at settlement.

## Decisions

- Progression must not terminalize or overwrite a `running` stage while its recorded `workflowInvocationId` names a still-live entry run — rules out fan-out siblings, claim races, or reconciliation writing `failed` over an in-flight admitted stage.
- Out of scope: `derivePipelineState` terminality, retry/backoff, `multiple_failed_stages` resume refusal.

## Task checklist

- Guard execution paths that patch stage rows so a live-linked `running` stage is never terminalized prematurely.
- Add `pipeline-execution.test.ts` regression with `// @mutate` on the live guard.
- Update operator docs and v1 parity catalog.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — while `workflowInvocationId` names a still-live entry run, the stage row stays `running` and never records `failed`; a `// @mutate` on the live guard makes the regression fail against baseline.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/operator-runbook.md` — a `failed` stage never names a live invocation; stage `failureDetail` matches the owning run's operator error.
- `v2/docs/v1-behaviors.md` — record changed v2 stage linkage behavior.
