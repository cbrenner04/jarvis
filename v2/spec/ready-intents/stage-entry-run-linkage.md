---
name: stage-entry-run-linkage
---

# Stage linkage follows the admitted entry run through settlement

## Problem

A fan-out `plan` stage recorded `failed` with `worktree_claimed` naming a prior stage's workflow while its own entry run was still live and later completed. A separate implement stage recorded `harness_failure` / `nextAction: "stop"` while the owning run reported `completion_commit_failed` / `resumable: true`, with `workflowInvocationId` naming a different completed run and `startedAt == endedAt`.

Prior art: PR #2555 (draft, do not merge) — lift linkage/settlement tests, not its subspec.

## Decisions

- Once a stage admits an entry run, its row stays `running` and linked until that run settles — rules out writing `failed` (or any terminal row) while the entry run is still live.
- `workflowInvocationId` is the admitted entry-run id for the whole live window — rules out recording a prior stage's invocation or a superseded run id.
- Non-success settlement copies the owning run's operator error (`reason`, `nextAction`, resumability) onto the stage — rules out generic `harness_failure` when the run carries operator detail.
- Pre-run dispatch refusal still records `failed` immediately with no `workflowInvocationId` — rules out leaving a refused stage `pending` or inventing linkage.
- Out of scope: `derivePipelineState` terminality, retry/backoff, `multiple_failed_stages` resume refusal.

## Acceptance criteria

- [ ] `pipeline-stage-dispatch.test.ts` proves a live entry run keeps the stage `running` with `workflowInvocationId` set until settlement; inverting the live guard turns the regression red.
- [ ] `pipeline-stage-dispatch.test.ts` proves non-success settlement mirrors the owning run's operator error and `nextAction` instead of `harness_failure`; the regression fails against baseline.
- [ ] `pipeline-execution.test.ts` proves a stage stays `running` and never records `failed` while its recorded `workflowInvocationId` names a still-live entry run; the regression fails against baseline.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — stage-to-entry-run linkage identity and failure-reason mirroring.
- `v2/docs/operator-runbook.md` — a `failed` stage never names a live invocation.
- `v2/docs/v1-behaviors.md` — record changed v2 stage linkage behavior.

## Prerequisites
