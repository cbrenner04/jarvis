---
name: triage-lists-v2-worktrees
---

# `triage` lists and drills into v2 worktrees

With merge fixed, the operator still can't *see* v2 worktrees: no-arg `jarvis1 triage` enumerates only
`<repo>/.worktree/`, and `jarvis1 triage <name>` drill-down resolves the same single home. v2 work is
invisible in the one command meant to show what's in flight.

## Behavior

- No-arg `triage` lists worktrees from both homes, each row identifying which home it came from.
- `triage <name>` drill-down resolves names in either home; ambiguity refuses rather than picks.
- Per-row classification (dirty status, ahead/behind, PR state, spec progress, landed/draft) works the
  same for v2-home worktrees.

## Prerequisites

- Merge-target resolution searches both worktree homes and yields a worktree path.

## Out of scope

- `jarvis1 cleanup` v2 support (seed `v2-cleanup-command`).

## Documentation updates

- `v1/docs/operator-runbook.md` — triage listing now covers v2 worktrees.
- `v2/docs/v1-behaviors.md` — record widened listing/drill-down resolution.
