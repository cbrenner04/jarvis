---
name: cleanup-archives-completed-v2-artifacts
---

# Cleanup archives completed v2 artifacts

After safe workspace retirement, `jarvis cleanup` moves complete v2 specs into their home's `completed/` directory and removes the ready-intent consumed to create each retired plan. It also finds complete, unowned specs stranded without a worktree. Incomplete specs, specs with an open PR, and specs owned by another worktree remain in place with a skip reason. Durable run rows remain untouched.

## Decisions

- Read spec completeness from non-human acceptance criteria across the spec tree; rules out trusting daemon run status or index routing checkboxes as archival authority.
- Prune only a ready-intent whose consumption is proven by the retired plan's durable artifacts; rules out deleting a same-named unconsumed intent by convention alone.
- Archive stranded complete specs even when no worktree is removed in the invocation; rules out requiring a historical worktree to reclaim durable artifacts.

## Out of scope

- Removing unmerged workspaces.
- Repairing incorrect run rows.
- Auto-ticking acceptance criteria.

## Prerequisites

- `jarvis cleanup` can safely discover and retire merged v2 workspaces without touching live owners.

## Documentation updates

- `v2/docs/operator-runbook.md` — archival, consumed-intent pruning, and refusal cases.
- `v2/docs/first-workflow-walkthrough.md` — describe the artifacts retired at session end.
