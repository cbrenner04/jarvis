---
name: reset-stale-workspace-override-dirty-retirement
---

# Explicit override for stale-workspace reset over a dirty worktree

## Problem

After the dirty-worktree gate lands, operators who deliberately want retirement despite local changes need a path on the incomplete re-run command. `--abandon` remains the manual escape hatch but is a separate command; the re-run surface should admit a deliberate override without weakening the default refusal.

## Decisions

- Add an explicit operator-facing switch on the git-enabled implement and plan incomplete re-run path (shared `resetStaleWorkspace` seam) that skips the dirty-worktree refusal and runs retirement as today. Rules out making dirty retirement the default again.
- When override is not passed, behavior matches the dirty refusal slice exactly. Rules out implicit or env-based overrides.
- Refusal stderr names the override switch alongside commit, discard, and `--abandon`. Rules out a refusal message that omits the deliberate-continue option once it exists.
- Shared reset seam covers implement and plan; one workflow-level regression per behavior at subspec time, not duplicate ACs per workflow name.
- Deferred to first consumer: exact flag name and help text — pin when wiring the workflow CLI.

## Acceptance criteria

- [ ] A regression test sets the override switch on an incomplete git-enabled workflow re-run with a dirty managed worktree and asserts the same teardown outcomes as a clean re-run (`cleanup.test.ts` `resetStaleWorkspace: incomplete implement re-run reset` baseline); fails against the pre-fix code.
- [ ] Without the override switch, a dirty incomplete re-run performs no retirement mutations (guard-inversion case; fails if teardown runs without the switch).
- [ ] Refusal-slice dirty-worktree regression tests stay green when the override switch is omitted.
- [ ] Dirty-worktree refusal stderr lists commit, discard, the override switch, and `jarvis cleanup --abandon <branch>`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Implement workflow / Recovery — the override switch on incomplete implement or plan re-run and when to use it vs `--abandon`.
- `v2/docs/v1-behaviors.md` — record the override on incomplete implement and plan re-run stale reset.

## Prerequisites

- Incomplete git-enabled workflow re-run refuses `resetStaleWorkspace` when the managed worktree has uncommitted tracked or untracked changes, without tearing down artifacts.
