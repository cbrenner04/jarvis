# `triage --merge` is blind to v2's worktree home, forcing raw `gh` merges

`jarvis1 triage <pr> --merge` cannot resolve any PR produced by a v2 workflow, because it
only looks for worktrees under `<repo>/.worktree/`. v2 puts them in
`~/.jarvis/worktrees/<project>/<branch>/`.

## Problem

Observed 2026-07-13 merging the v2 plan PR #1482:

```
$ jarvis1 triage 1482 --merge
triage --merge (unknown worktree): no local worktree for PR reference 1482
  (branch plan/intent-review-prompts-render)
```

The worktree existed — at
`~/.jarvis/worktrees/jarvis/plan/intent-review-prompts-render/`. Triage never looks there.

This forces every v2-produced PR onto the raw `gh pr merge --admin --squash` path, which is
exactly the path the runbook warns against: **PR CI does not run `lint:md`, `bun run ready`
does.** So the one gate that catches lint-dirty markdown is skipped on precisely the PRs
most likely to carry markdown — plan and intent PRs, which are *mostly* markdown. A
green-CI plan PR can merge lint-dirty and redden every subsequent run's completion gate.

Same root cause as `jarvis1 cleanup` being unable to retire v2 worktrees (seed
`v2-cleanup-command`): **v1's operator tooling hardcodes the v1 worktree home.** Every v1
command that resolves a worktree by name has this blind spot, not just these two.

## Decisions

- **Resolve worktrees from both homes**, `<repo>/.worktree/` and
  `~/.jarvis/worktrees/<project>/<branch>/` — rules out fixing `triage` alone while
  `cleanup` and any other worktree-resolving command stay blind.
- Prefer teaching the *existing* resolver both homes over adding a `--worktree-home` flag —
  the operator should not have to know which harness produced a PR to merge it.
- The local ready gate (including `lint:md`) must run for v2-produced PRs too. That is the
  actual value being lost, not the convenience.

## Prerequisites

- None.

## Out of scope

- `jarvis1 cleanup`'s v2 support — that is `v2-cleanup-command`.

## Documentation updates

- `v1/docs/operator-runbook.md` — remove the "hand-merge v2 PRs with raw `gh`" stopgap once
  this ships.
