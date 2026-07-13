# `implement` reports `done` with zero criteria ticked and the work uncommitted

A `jarvis run workflow implement` run reported `outcomeKind: done` / `runStatus: completed`
on a spec with **0 of 5 acceptance criteria ticked**, the agent's work left **uncommitted** in
the worktree, and **no commit and no PR** ever created.

## Problem

Observed 2026-07-13, run `f9d556ed` (spec
`20260713T193047Z-blocked-run-retains-worktree-and-branch`), daemon on current `main`:

- Run log: `iteration_started` 19:37:18 → `boundary_committed: done` 19:44:08 →
  `loop_finished: complete`. Seven minutes of agent work, terminal status `completed`.
- The branch head is `c511dcc2` — **`main`'s HEAD**. Not one commit was made.
- The worktree holds uncommitted modifications to `v2/docs/operator-runbook.md`,
  `v2/docs/v1-behaviors.md`, `v2/src/execution/workflow-runner.test.ts`.
- The subspec's acceptance criteria: **0 of 5 checked.**
- No PR exists.

`done` is supposed to mean the spec is complete. Here it means nothing at all was finished,
committed, or published — while the operator is told the run succeeded. The completion
publication path (commit → PR → ready gate) never ran, so none of the gates that would have
caught this got a chance to.

This is the same failure class as every other defect found this session — **a terminal
status asserted without the evidence that would substantiate it** — but it is the worst
instance, because `done` on an untouched spec is not a degraded signal, it is a false one. An
operator batching runs would merge nothing and never know work was dropped.

Note the contrast: run `3c9536a9` earlier the same day, same preset, did commit, did publish
a PR, and did tick its criteria. So this is not "implement never works" — it is
nondeterministic, which makes it worse.

## Decisions

- **A run cannot report `done` while any non-human-only acceptance criterion is unticked.**
  Mirrors v1's completion contract (complete = zero unchecked items). Rules out trusting an
  agent's terminal token over the spec's actual state.
- **A run cannot report `done` with a dirty worktree and no commit.** Either the work commits
  and publishes, or the run reports a non-success outcome naming what was left behind.
- **Reconcile the agent's claimed outcome against the spec before committing the boundary.**
  The write loop currently takes the token at face value.

## Prerequisites

- None.

## Out of scope

- Why the agent emitted a done token here (unknown; it left real work behind, so it was not
  idle).

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — `completed` on a v2 implement run does not
  imply committed or published work; verify the branch has commits until this ships.
