---
name: standalone-plan-redispatch-retires-never-landed-lane
---

# Standalone `plan` re-dispatch retires a never-landed lane instead of refusing the descendant gate

Unsplit rationale: the classification predicate (`classifyNeverLandedLane`), its inconclusive refusal, and the `disposableLane` reset flag already exist and are exported; the only change is CLI admission for standalone `plan` re-dispatch, so there is a single module-boundary surface to split on.

## Primary implementation surface

- CLI workflow-start admission for standalone `plan` re-dispatch (`v2/src/commands/stale-reset-workspace.ts` / `v2/src/commands/workflow-start-preparation.ts`)

## Problem

`jarvis run workflow plan --ready-intent <path>` refuses re-dispatch when the managed plan worktree's `HEAD` is not a descendant of the resolved base (`stale reuse refused`), with no flag override, forcing `jarvis cleanup --yes --abandon plan/<name>` plus an identical re-issue. Failed pipeline plan resume already classifies such a lane as never-landed and retires plus rematerializes it from base. Both paths share `resetStaleWorkspace` but not the classification, so the same lane is refused on one path and retired on the other.

## Decisions

- Standalone `plan` re-dispatch runs the same never-landed classification before the stale reset, and on `never-landed` sets `disposableLane` so the lane is retired and rematerialized from base rather than refused by the descendant gate.
- The classification, its landed-work guards, and the inconclusive refusal are reused verbatim from the failed-pipeline-plan-resume path rather than re-derived; rules out a second, divergent staleness policy for the same worktree.
- Classification stays fail-closed: an inconclusive open-PR probe (the sandboxed-`gh` default) refuses before any retirement, and any commit ahead of base touching a path outside harness workflow staging keeps the lane.
- A retirement on this path prints the same worktree-disposition line the pipeline path prints.
- Not in scope: the descendant gate itself, `implement` (already resets on its own base), and `intent`.

## Acceptance criteria

- [ ] A test proves standalone `plan` re-dispatch over a never-landed plan worktree whose `HEAD` is not a descendant of base retires and rematerializes it, then dispatches; it fails against the current `stale reuse refused` refusal.
- [ ] A test proves a plan lane with a commit ahead of base changing a path outside harness workflow staging is still refused, with worktree and commit intact.
- [ ] A test proves an inconclusive open-PR probe refuses before any retirement, preserving the worktree.
- [ ] A test proves a retirement on this path emits the worktree-disposition line.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — standalone plan re-dispatch retires a never-landed lane; drop the `cleanup --abandon` step for that case.
- `v2/docs/workflow-runner.md` — record the shared classification between standalone plan re-dispatch and pipeline plan resume.
- `v2/docs/v1-behaviors.md` — this changes existing re-dispatch refusal behavior.

## Prerequisites

- Failed pipeline plan resume classifies a never-landed lane and retires plus rematerializes it from base.
- The stale-workspace reset accepts a disposable-lane option that bypasses the descendant gate.
- Never-landed classification refuses fail-closed on an inconclusive open-PR probe.
