---
name: no-done-without-a-completion-commit
---

# Never report `done` when the work was left uncommitted

A run that reports `done` must have produced a completion commit. If the completion path
yields no commit while the worktree still holds modifications, the run must record a
non-success outcome that names the uncommitted paths, not `completed`.

Observed 2026-07-13, run `f9d556ed`: terminal `done`, branch head equal to `main`'s HEAD,
three modified files still dirty in the worktree, no PR. The operator was told the run
succeeded.

## Decisions

- Treat "no commit sha + dirty worktree" at the completion boundary as a failed completion, not a silent success; rules out today's behavior where `createCompletionCommitter` returning `{}` still leaves the boundary at `done`.
- The recorded outcome names the leftover modified paths so the operator can recover the work.
- The worktree and branch are retained (the work is still there); do not clean up.

## Prerequisites

- `createCompletionCommitter` exists in the v2 write-loop completion boundary.

## Out of scope

- Unticked acceptance criteria (a separate behavior).
- PR-creation failures after a commit exists.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — `completed` on a v2 implement run now implies a commit exists; the prior "verify the branch has commits" caveat is removed.
- `v2/docs/v1-behaviors.md` if the completion-outcome vocabulary changes.
