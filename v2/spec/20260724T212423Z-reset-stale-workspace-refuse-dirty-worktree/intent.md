---
name: reset-stale-workspace-refuse-dirty-worktree
---

# Refuse implicit stale-workspace reset on a dirty managed worktree

## Problem

`resetStaleWorkspace` runs on every incomplete git-enabled `jarvis run workflow implement` or `plan` re-run after the existing live-held and open-PR gates, then force-removes the worktree and deletes branch refs. It never inspects the working tree. A blocked or failed run often leaves uncommitted work; the runbook’s inspect-then-re-run path destroys it silently.

## Decisions

- Refuse implicit reset when the managed worktree has uncommitted tracked changes or untracked files; name the dirty paths in stderr. Rules out proceeding to `performAbandonmentSteps` on a dirty tree.
- On refusal, perform no retirement mutations (no worktree removal, no branch or PR deletion). Rules out partial teardown before the dirty check.
- Keep live-held and open-PR gates unchanged; add the dirty check after them and before abandonment. Rules out replacing those gates with a single combined check.
- Implement the dirty gate on the shared `resetStaleWorkspace` seam used by `maybeResetStaleWorkspace` for implement and plan; one workflow-level regression per behavior at subspec time, not duplicate ACs per workflow name.
- Do not auto-stash or auto-commit agent leftovers. Rules out silently preserving unreviewed output.
- `jarvis cleanup --abandon` keeps today’s behavior (no new dirty gate on that path). Rules out coupling the abandon escape hatch to the implicit re-run guard in this slice.

## Acceptance criteria

- [ ] A regression test drives an incomplete git-enabled workflow re-run with uncommitted tracked or untracked paths in the managed worktree and asserts stderr names those paths and performs no retirement mutations; fails against the pre-fix code.
- [ ] `cleanup.test.ts` `resetStaleWorkspace: incomplete implement re-run reset` stays green (clean worktree teardown unchanged).
- [ ] The refusal stderr states recovery via commit, discard, or `jarvis cleanup --abandon <branch>`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Implement workflow / Recovery — dirty-worktree refusal on incomplete implement or plan re-run and recovery without an override flag.
- `v2/docs/v1-behaviors.md` — incomplete implement and plan re-run stale reset refuses when the worktree is dirty.

## Prerequisites
