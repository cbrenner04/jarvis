# 00 - Blocked run retains worktree and branch

`jarvis run workflow implement` ending `blocked` left no worktree, no branch, and no
`git worktree list` registration (run `e93a8429-2726-400b-9643-0fb753340f99`, `exit_kind: ok`,
`blocked` / `agent_blocked` / `inspect_spec`). `blocked` is an inspect-and-resume state; the
agent's work must survive it, and the operator must be able to find it.

## Root cause first

No worktree-remove or branch-delete call exists anywhere in `v2/src` — `external-worktree.ts`
only creates/reuses and calls `git worktree prune`, and neither `write.ts`, `write-loop.ts`,
`workflow-runner.ts`, nor `daemon.ts` tears one down. Do not bolt a guard onto a path you have
not identified. Reproduce first (see below), find the call that actually destroys the worktree
and branch on the blocked path, name it in this subspec, then fix it.

Reproduction instrument: drive the implement workflow against a real git fixture with a bound
agent that returns `blocked`, exercising the same entry point the operator used
(`jarvis run workflow implement`), not just `executeWriteLoop` in isolation. If the write-loop-level
reproduction retains the worktree, escalate the reproduction outward (workflow runner → daemon →
CLI) until it destroys it. If no layer reproduces the destruction, append a `## Blocker` naming
what you ran and what survived — do not invent a fix for a defect you cannot reproduce.

## Decisions

- Blocked retains the worktree and the branch, with no teardown on that path. Rules out treating `blocked` as terminal-and-reclaimable like a completed run.
- `git worktree prune` in `ensureExternalWorktree` is a suspect only if the worktree directory is already gone; a present directory is never pruned. Rules out "fixing" prune as a shortcut past the real cause.
- The blocked run's row must name the surviving worktree path (`worktree_path`), so the operator reaches it from `jarvis run list`/`show` without guessing `~/.jarvis/worktrees/<project>/<branch>`. Rules out relying on path reconstruction by the operator.
- Scope is the `blocked` outcome only; other outcomes and error paths keep their current teardown behavior. Rules out a blanket "never tear down" change.

## Acceptance criteria

- [ ] A `jarvis run workflow implement` run whose agent returns `blocked` leaves its worktree directory on disk, its branch present in the project's `git branch`, and the worktree registered in the project's `git worktree list`.
- [ ] The uncommitted work the agent produced before blocking is still present in that worktree (nothing is reset, cleaned, or checked out on the blocked path).
- [ ] The blocked run's row reports the surviving worktree path, and the operator-facing run output for a blocked run names that path.
- [ ] A regression test drives the implement workflow to a `blocked` outcome against a real git fixture and asserts worktree, branch, registration, and uncommitted work survive; it fails against the pre-fix code.
- [ ] Non-blocked outcomes are unchanged: existing `write-loop.test.ts` and `workflow-runner.test.ts` stay green.

## Documentation updates

- `v2/docs/operator-runbook.md` — blocked-run recovery: worktree and branch survive; where to find them and how to resume.
- `v2/docs/v1-behaviors.md` — record the teardown behavior on the blocked path.
