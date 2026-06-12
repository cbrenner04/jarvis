# 02 — Kill/crash resume

Re-running the write loop after a kill or crash resumes from durable state: it
re-runs the interrupted iteration over the dirty worktree, or continues a clean
soft-stop, idempotently. Kill-resume and crash-recovery are the same path.
Proven via injected bindings against a temp store/worktree.

## Decisions

- Kill-resume == crash-recovery: one path; never resume mid-step; replay from the
  last durable pre-step boundary. Rules out a separate crash-only recovery path.
- Recovery derives from durable state (run status + attempt/outcome history), not
  in-memory flags. Rules out persisting an in-process resume flag.
- Resume branches on the last attempt: interrupted (attempt start with no
  committed boundary) → re-run that iteration over the dirty worktree;
  completed-at-boundary, including a budget soft-stop → continue with a fresh
  per-invocation budget. Rules out re-running a cleanly-finished iteration or
  skipping an interrupted one.
- A missing worktree path is reconstructed from its branch on resume — carry
  forward the v1 auto-materialization already in `external-worktree.ts`. Rules
  out failing a resume because the worktree dir was pruned.
- A budget soft-stop is resumable: re-running picks up remaining spec work with a
  fresh budget (per-invocation model from 01), not a decremented durable counter.
- Re-running a run whose boundary already committed is idempotent: no double
  checkpoint/attempt-count advance, no duplicate outcome (builds on 00's
  idempotent boundary). Rules out a double-advance on a retried finished boundary.

Whether "interrupted vs completed-at-boundary" is a derived read of attempt
history or an explicit column is the minimal-column choice from 00 — driven by
what this resume read actually needs.

## Task checklist

- [ ] Add a create-or-resume entry to the loop: on invocation, load an existing
  run for the run identity; if found, branch on interrupted vs
  completed-at-boundary.
- [ ] Interrupted → re-run the iteration over the existing (dirty) worktree
  (reuse the `withExternalWorktree` reuse path).
- [ ] Completed-at-boundary / soft-stop → continue looping with a fresh
  per-invocation budget.
- [ ] Missing worktree path → reconstruct from the branch via existing
  auto-materialization.
- [ ] Ensure a finished-boundary re-commit stays idempotent end-to-end through
  the loop.
- [ ] Co-located tests via injected bindings + temp store/worktree.

## Acceptance criteria

- [x] Re-invoking the loop for an existing run loads durable state and resumes
  without resuming mid-step (test).
- [x] An interrupted run (attempt started, no committed boundary) re-runs that
  iteration over the dirty worktree (test).
- [x] A budget-soft-stopped run resumes and continues remaining work with a fresh
  per-invocation budget (test).
- [x] Re-running a run whose boundary already committed does not advance the
  checkpoint/attempt-count twice or duplicate the outcome (test).
- [x] Resume rebuilds a missing worktree from its branch (test, or asserted reuse
  of the existing auto-materialization path).
- [x] Recovery decisions derive from durable state, not in-memory flags.
- [x] State/resume tests run against a temp/override SQLite path and write nothing
  under `~/.jarvis`.
- [x] No `v2 -> v1` imports; `bun run typecheck`, `bun test`, and `bun run ready`
  pass.

## Documentation updates

- `v2/docs/write-behavior.md`: add the resume model — kill == crash, interrupted
  vs completed-at-boundary, worktree reconstruction from branch, budget soft-stop
  resumability, idempotent boundary. Cross-link `state-store.md`.
- `v2/docs/state-store.md`: note the resume read (run status + attempt history)
  that the recovery branch depends on, if 00 did not already.
- `v2/docs/v1-behaviors.md`: no change — additive v2-only code.
