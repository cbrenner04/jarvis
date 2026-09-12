---
name: recover-plan-stage-from-own-durable-row
---

# Recover a plan stage from its own durable row

Unsplit rationale: The fix changes one module-boundary surface: daemon recovery-target resolution; dispatch resolution and the recovery execution loop retain their existing contracts.

## Prerequisites

- Admitted plan-stage recovery validates and lands the linked entry run's populated on-disk `.jarvis-plan-stage/` without invoking a plan writer, reviewer, or actuator.
- Plan-stage dispatch resolves its ready-intent from the preceding workflow artifact and refuses when that artifact is absent.

## Primary implementation surface

- Daemon pipeline-stage recovery target resolution (`v2/src/daemon/pipeline-stage-recovery.ts`)

## Problem

`pipeline recover` reuses the dispatch-oriented stage resolver, so a failed plan stage with a correct staged tree refuses `stage_resolution_failed` when its predecessor artifact is unavailable. Recovery already has the failed row's linked entry run and does not dispatch the plan workflow, making that predecessor requirement irrelevant and forcing a wasteful redraft through `pipeline resume`.

## Behavior

`pipeline recover` resolves a failed plan target from its own durable row, linked workflow invocation, recorded worktree, and staged tree, admitting recovery even when the predecessor artifact is absent. Plan dispatch continues to require the predecessor artifact.

## Decisions

- Derive recovery identity and location from the failed plan row and its linked entry run; do not call the general dispatch resolver.
- Preserve recovery refusals for a non-failed or non-plan target, missing workflow linkage, an existing claim, or a missing staged tree.
- Preserve direct validation and landing of the staged bytes with no plan write, review, or actuator invocation.
- Leave `pipeline resume` and general stage resolution unchanged; missing predecessor artifacts still refuse plan dispatch with the existing `pipeline-stage-resolve:` diagnostic.

## Acceptance criteria

- [ ] A regression test proves `recover` admits a failed plan stage with a present staged tree and absent predecessor artifact; it fails against the pre-fix `stage_resolution_failed` refusal.
- [ ] A dispatch test proves the same absent predecessor artifact still refuses plan-stage dispatch with the existing `pipeline-stage-resolve:` message.
- [ ] Tests prove recovery retains its existing refusals for a target that is not a failed plan stage, lacks a linked workflow invocation, is already claimed, or lacks its staged tree.
- [ ] An admitted-recovery test proves the staged tree lands exactly as it sits on disk without invoking a plan write step, reviewer, or actuator.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — recovery target resolution from the failed row versus predecessor-dependent dispatch resolution.
- `v2/docs/operator-runbook.md` — remove predecessor resolution from `pipeline recover` preconditions.
- `v2/docs/v1-behaviors.md` — record the narrowed recovery resolution path.
