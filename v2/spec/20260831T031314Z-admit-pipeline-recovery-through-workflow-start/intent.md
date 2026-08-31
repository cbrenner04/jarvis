---
name: admit-pipeline-recovery-through-workflow-start
---

# Admit pipeline recovery through workflow start

## Prerequisites

- CLI workflow starts use one shared preparation API for realizability, preset building, machine-config stamping, and stale-reset preflight.
- Pipeline admission persists a schema-checked context with `configPath`, and fresh and continued execution load that durable snapshot without defaults.
- Daemon pipeline stages reach workflow dispatch through the shared preparation path for single-stage and fan-out starts.

## Primary implementation surface

- Daemon pipeline recovery request handling in `v2/src/daemon/daemon.ts`

## Problem

- Blocked plan-stage recovery reimplements workflow-start registry claims, memory admission, and `activeRuns` tracking around its recovery attempt.
- The hand-copy can diverge from live workflow-start refusal and ownership semantics.

## Behavior

- Fresh workflow starts, pipeline stage starts, and stage recovery call one daemon workflow-start admission implementation.
- Recovery preserves its attempt and settlement lifecycle while sharing input validation, ownership claim, memory-headroom, and active-run admission semantics.
- Admission refusal leaves recovery stage state and ownership unchanged.

## Decision ledger

- Extract one admission target parameterized by the admitted execution lifecycle; rules out recovery calling `handleWorkflowStart` indirectly through fabricated steps.
- Keep recovery-specific attempt, detached settlement, and release timing outside the shared admission target; rules out widening ordinary workflow execution with recovery-only state.
- Make the shared target own claim and `activeRuns` rollback on every pre-execution refusal; rules out caller-specific partial cleanup.

## Acceptance criteria

- [ ] A structural test proves `handleWorkflowStart`, pipeline live dispatch, and pipeline recovery reach one admission call target with no recovery-local registry claim, memory gate, or `activeRuns.set` copy.
- [ ] A behavior test applies the same claimed-worktree and insufficient-memory fixtures to live start and recovery and asserts matching refusal codes with no recovery attempt or stage mutation; it fails against the hand-copied recovery admission.
- [ ] `v2/src/daemon/pipeline-stage-recovery.test.ts` — `recovers a corrected non-first fan-out branch and leaves siblings unchanged` and `a completion-commit failure does not settle the stage succeeded` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — fresh starts, pipeline dispatch, and stage recovery share daemon admission while retaining distinct execution lifecycles.
- `v2/docs/v2-architecture.md` — common workflow-start admission boundary.
- `v2/docs/v1-behaviors.md` — stage recovery admission shares live-start refusal and ownership semantics.
