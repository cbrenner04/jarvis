---
name: triage-resolve-plan-spec-path-merge-target
---

# Resolve plan spec paths for `triage --merge`

## Problem

`jarvis1 triage <timestamped-plan-spec>/index.md --merge` fails with no backing worktree because timestamped plan spec directories do not basename-match `.worktree/plan-<name>/` and plan worktrees lack `.active-spec-path`.

## Desired behavior

`jarvis1 triage <plan-spec-path> --merge` resolves a committed plan spec path (for example `v1/spec/2026-06-29T04-20-42Z-<name>/index.md`) to the local `.worktree/plan-<name>/` worktree before the gated merge flow runs.

## Decisions

- Apply resolution in the shared merge-target resolver used by `triage --merge` — rules out a triage-only parallel lookup.
- Match plan spec directories to plan worktrees via timestamp-stripped basename equality with `plan/<name>` — rules out requiring `.active-spec-path` on plan worktrees for spec-path entry.
- Keep patch spec-path resolution unchanged — rules out regressing basename or marker scan behavior for implementation specs.
- Ambiguous or zero matches still refuse before gate or merge side effects — rules out picking an arbitrary plan worktree.

## Documentation updates

- `v2/docs/v1-behaviors.md` — `triage --merge` spec-path resolution covers timestamped plan spec directories without a marker.

## Prerequisites

- `jarvis1 triage <spec-path> --merge` resolves patch spec paths to a local worktree via directory basename or `.active-spec-path` marker scan
