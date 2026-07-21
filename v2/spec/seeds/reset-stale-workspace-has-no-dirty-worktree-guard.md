# `resetStaleWorkspace` destroys uncommitted work without a guard

## Problem

`resetStaleWorkspace` (`v2/src/commands/cleanup.ts:651`) runs on every incomplete
`jarvis run workflow implement` re-run. It gates on three things — worktree exists, not live-held,
open-PR ownership — and then calls `performAbandonmentSteps`, which force-removes the worktree and
deletes local and remote branch refs. **It never inspects the working tree for uncommitted changes.**

So a re-run silently destroys any uncommitted work in the managed worktree. That is exactly the
state a `blocked` or failed run leaves behind, and the runbook currently sends the operator to
re-run after inspecting the spec there — the inspect-then-re-run path is the one that eats the work.

The `--abandon` path shares `performAbandonmentSteps` and has the same hole, but there the operator
typed the word "abandon"; on the implicit re-run path they did not.

## Decisions

- Refuse the implicit reset when the managed worktree has uncommitted changes (tracked
  modifications or untracked files), naming the dirty paths; the operator commits, discards, or
  passes an explicit override.
- Provide an explicit override on the re-run path so the operator can proceed deliberately;
  the existing `jarvis cleanup --abandon <branch>` remains the manual escape hatch and keeps its
  current behavior.
- Rules out auto-stashing or auto-committing agent leftovers — silently preserving unreviewed agent
  output is its own hazard.
- Keep the existing live-held and open-PR gates unchanged; this is an additional gate, not a
  replacement.

## Acceptance criteria

- [ ] An incomplete implement re-run against a managed worktree with uncommitted tracked changes
      refuses without removing the worktree or deleting any branch ref, and names the dirty paths.
- [ ] Untracked files in the managed worktree trigger the same refusal.
- [ ] A clean managed worktree resets exactly as today.
- [ ] The explicit override proceeds with the reset over a dirty worktree.
- [ ] The refusal message states the recovery options (commit, discard, override, `--abandon`).
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Implement workflow / Recovery — the dirty-worktree refusal and
  its recovery options.
