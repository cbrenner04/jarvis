# cleanup abandon single worktree

## Problem

`jarvis1 cleanup --abandon` can remove stale interrupted worktrees, but it is
global. During recovery from one interrupted plan worktree, the dry run listed
several unrelated abandoned worktrees too, making the command unsafe as a scoped
operator action.

Observed stale target:

- `plan/plan-cascade-advances-on-model-config`

`jarvis1 plan --resume` refused because the worktree was dirty, and
`jarvis1 triage` only suggested manual inspection.

## Desired behavior

Jarvis should provide a scoped way to abandon exactly one named dirty/no-PR
worktree after triage identifies it as stale, without touching unrelated
worktrees.

## Decisions

- Prefer extending an existing command over adding a new top-level command.
- A good shape is likely `jarvis1 cleanup --abandon <worktree-name>` or
  `jarvis1 triage <worktree-name> --abandon`.
- The command must print the target path/branch and refuse if the worktree has
  an open PR or active lock unless explicitly supported.

## Documentation updates

- Update `v1/docs/operator-runbook.md` recovery guidance for transient-killed
  plan worktrees to use the scoped abandon path once it exists.
- Remove any manual `git worktree remove` stopgap guidance when this ships.
