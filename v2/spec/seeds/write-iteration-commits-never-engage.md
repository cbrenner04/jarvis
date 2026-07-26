---
name: write-iteration-commits-never-engage
---

# In-flight iteration commits never engage on implement runs

## Problem

`workflow-steps-commit-each-progress-iteration` shipped a durability guarantee: a write step commits
each iteration in-flight, so a mid-run kill leaves prior iterations' commits on the branch instead of
an all-dirty worktree. **That guarantee has never engaged on an observed implement run.**

`write-loop.ts:396` commits only when the agent returns `result.kind === "progress"`. An agent that
finishes its subspec and returns `done` produces no `progress` result, so `commitProgressIteration`
is never called. Observed implement runs consume exactly **one** iteration and settle `done` — so
the commit path is dead code in practice and the only commit is the completion commit at the end.

A run killed inside that single iteration loses all of its work.

## Evidence (2026-07-26, five run rows across two lanes)

Every row: one `iteration_started`, one `boundary_committed` with `outcomeKind: "done"`, zero
`iteration_commit` records.

| Run | Outcome | Iterations | `iteration_commit` records |
| --- | --- | --- | --- |
| `9c61a90e` (claim-refusal write) | `idle_output_timeout` | 1 | 0 |
| `e9d66045` (terminal-runs write) | `complete` | 1 | 0 |
| `9750e830` (terminal-runs write) | `complete` | 1 | 0 |
| `e466524f` (terminal-runs gate repair) | `complete` | 1 | 0 |

Realized cost on `9c61a90e`: killed by the idle watchdog mid-iteration, leaving **9 modified files
and 0 commits** on the branch. `idle_output_timeout` is non-retryable, so the work was unrecoverable
— exactly the loss the shipped guarantee was meant to prevent.

## Decisions

- Durability must not depend on the agent returning `progress`. Commit on a boundary the harness
  controls, not on an outcome kind the agent chooses. Rules out "the feature works, agents just
  return `done`" — a guarantee that never engages is not a guarantee.
- Do not fabricate `progress` results to trigger the existing path. Rules out making the outcome
  kind lie to reach a commit.
- The completion commit stays the publication input; in-flight commits are a durability floor
  beneath it, not a replacement. Rules out changing what gets published or how.
- Verification must observe a **killed** run, not a completed one. A completed run commits anyway,
  so a test asserting "commits exist after success" would stay green against the current dead path.
  Rules out the coverage shape that let this ship.

## Acceptance criteria

- [ ] A write step killed mid-iteration, after the agent has written files but before it returns,
      leaves those files committed on the branch; a test drives that kill and asserts a non-empty
      `main..HEAD` commit list. It fails against current code.
- [ ] A single-iteration `done` run commits its work before the completion commit; a test asserts an
      `iteration_commit` (or equivalent) record exists for a run that never returns `progress`.
      Fails against current code.
- [ ] The existing `progress`-path commit behavior is unchanged; current `write-loop` tests stay
      green.
- [ ] Inverting the new commit trigger turns the killed-run test RED.
- [ ] No test asserts durability using only a successfully-completed run.

## Documentation updates

- `v2/docs/write-behavior.md` — what is committed and when; state the durability floor precisely.
- `v2/docs/operator-runbook.md` § Orphaned non-terminal runs — the current text says a
  `publishCompletion: false` step "still commits each `progress` iteration in-flight, so a mid-run
  kill or crash leaves prior iterations' commits on the branch." Correct it: on single-iteration
  runs there are no prior iterations, and nothing is committed.
