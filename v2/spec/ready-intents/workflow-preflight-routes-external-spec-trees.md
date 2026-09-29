---
name: workflow-preflight-routes-external-spec-trees
---

# Route external spec trees into stale-reset preflight

## Problem

`buildResetStaleWorkspaceOptions` deliberately drops `specPath` when `externalPlanSpec` is set, and stale-reset preparation does not carry the write step's actual `specReadRoot`. CLI and pipeline re-dispatch therefore cannot invoke gate 2 for external homes or prior-stage worktrees even when the comparison engine supports them.

## Primary implementation surface

- `v2/src/commands/stale-reset-workspace.ts`

## Decisions

- Carry the write step's actual spec path and read root into stale-reset gate 2 for external-plan and chained prior-stage trees; ordinary in-project steps keep their current defaults.
- Use the shared workflow-start preparation path so standalone and pipeline re-dispatch receive the same gate behavior.
- Preserve `--reset-despite-landed-criteria` as a gate-2-only override. Do not change gates 1 and 3, committed-lane continuation, `cleanup --abandon`, or external-tree mutation boundaries.
- Preserve the already-landed destroyed-artifacts branch-tip SHA output; this intent does not reimplement that surface.

## Acceptance criteria

- [ ] A workflow-preflight regression drives an external plan tree whose subspec is ticked only in the current tree and proves retirement is refused naming that subspec; it fails against the current `externalPlanSpec` omission.
- [ ] A chained pipeline regression proves a prior-stage worktree outside the code project root reaches the same comparison rather than being skipped.
- [ ] A test proves missing, unreadable, or non-Git external comparison context refuses with a named reason and leaves the stale workspace intact.
- [ ] `v2/src/commands/workflow.test.ts` in-project stale-reset tests stay green, and new tests prove `--reset-despite-landed-criteria` bypasses only gate 2 for in-project, external-home, and prior-stage trees.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — gate 2 covers external homes and prior-stage worktrees and refuses when comparison is inconclusive.
- `v2/docs/workflow-runner.md` — external and chained implement admission routes the actual spec tree into landed-criteria preflight instead of skipping it.
- `v2/docs/v1-behaviors.md` — record the changed incomplete re-dispatch guard.

## Prerequisites

- The stale-reset preserve-landed-criteria gate can compare a spec tree from an explicit read root outside the code project, refuses when comparison is inconclusive, preserves in-project behavior, and lets `--reset-despite-landed-criteria` bypass only that gate.
