---
name: triage-merge-resolves-v2-worktrees
---

# `triage --merge` resolves worktrees in both homes

`jarvis1 triage <pr|name|spec-path> --merge` today only looks under `<repo>/.worktree/`, so
every PR produced by a v2 workflow (worktrees live at `~/.jarvis/worktrees/<project>/<branch>/`)
refuses with `unknown worktree` and gets hand-merged with raw `gh`, skipping the local ready gate
— the only gate that runs `lint:md`.

## Behavior

- Merge-target resolution searches both worktree homes: `<repo>/.worktree/` and the v2 home for the
  current project. All three resolution forms (worktree name, PR reference, spec path) work in both.
- Resolution yields a worktree **path**, not a name relative to a single hardcoded home; triage's merge
  path (lock check, dirty commit-and-push, ready gate, merge) operates on that path.
- A name/branch matching in both homes is an ambiguity refusal, not a silent pick.
- The local ready gate (including `lint:md`) runs in the resolved worktree regardless of which home it
  came from.

## Decisions

- Teach the existing resolver both homes rather than add a `--worktree-home` flag — the operator should
  not have to know which harness produced a PR to merge it.
- Resolve the v2 home from the project's registered root, not from an operator-supplied path.

## Prerequisites

## Out of scope

- `jarvis1 cleanup` v2 support (seed `v2-cleanup-command`).
- v2 worktrees in `triage`'s no-arg listing / drill-down.

## Documentation updates

- `v1/docs/operator-runbook.md` — drop the "hand-merge v2 PRs with raw `gh`" stopgap.
- `v2/docs/v1-behaviors.md` — record the widened resolution.
