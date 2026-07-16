---
name: blocked-run-retains-worktree-and-branch
---

# A blocked run retains its worktree and branch

A `jarvis run workflow implement` run that ends `blocked` currently leaves no worktree, no
branch, and no git registration for either — the agent's paid work is deleted. Observed
2026-07-13 on run `e93a8429-2726-400b-9643-0fb753340f99` (`duration_ms: 174000`,
`exit_kind: ok`, `blocked` / `agent_blocked` / `inspect_spec`, `resumable: false`).

`blocked` is a state the operator inspects and resumes from. The run's worktree and branch
must survive it, and the run row must name the surviving worktree path so the operator can
reach it.

## Decisions

- A blocked outcome retains the worktree and the branch; no teardown runs on the blocked path. Rules out treating `blocked` as terminal-and-reclaimable like a completed run.
- Root-cause the deletion first: the destroying teardown is not visibly a worktree-remove call, so identify what removes it before changing behavior. Rules out a speculative guard bolted onto an unidentified path.

## Out of scope

- Blocker text content and the missing-blocker case — separate behavior.
- Why the agent blocked on this particular spec.
- Teardown behavior on any other outcome or error path — this fix is scoped to `blocked` only.

## Prerequisites

## Documentation updates

- `v2/docs/operator-runbook.md` — blocked-run recovery: the worktree and branch survive, and where to find them.
- `v2/docs/v1-behaviors.md` — record the changed teardown behavior on the blocked path.
