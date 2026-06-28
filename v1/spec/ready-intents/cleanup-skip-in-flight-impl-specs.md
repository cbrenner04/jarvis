---
name: cleanup-skip-in-flight-impl-specs
---
name: cleanup-skip-in-flight-impl-specs

# Cleanup skip in-flight impl specs

## Problem

`jarvis1 cleanup` can archive a spec after its plan PR merges while its implementation PR or patch worktree is still active. That moves the spec to `completed/` on `main` and creates modify/delete conflicts for the implementation branch still editing the original spec path.

## Behavior

`jarvis1 cleanup` archives a spec only after implementation is complete and merged: all acceptance criteria are checked, no open implementation PR owns the spec, and no live patch worktree owns the spec. Specs that fail that guard stay in place, cleanup continues for other eligible worktrees, and the skip reason is logged.

## Decisions

- Key archival eligibility on spec completion plus implementation ownership; rules out using "a merged PR touched this spec dir" as completion.
- Treat live patch worktrees for the same spec as archive blockers; rules out archiving into `completed/` while an implementation branch still edits the source path.
- Log skipped in-flight archive candidates; rules out silent non-archival that leaves cleanup output ambiguous.

## Documentation updates

- Update `v1/docs/operator-runbook.md` end-of-session cleanup guidance to describe the implementation-in-flight archive guard and soften the current premature-archive caution.
- Update `v2/docs/v1-behaviors.md` to record the cleanup archival precondition.

## Prerequisites

- `jarvis1 cleanup` removes merged worktrees and archives matching spec directories to `completed/`.
- Spec completion is derivable from acceptance-criteria checkbox state.
