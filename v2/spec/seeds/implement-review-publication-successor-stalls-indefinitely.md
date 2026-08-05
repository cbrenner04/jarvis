---
name: implement-review-publication-successor-stalls-indefinitely
---

# Implement workflow review/shrink/publication successor steps stall indefinitely with no watchdog

## Problem

Observed twice on 2026-08-04, both on `20260803T214753Z-fan-out-concurrent-sibling-dispatch`.
A workflow-started implement spawns a successor step (review, shrink, or publication) as its own run
row. The successor emits `iteration_started` and then produces **no further events for tens of
minutes** while `run list` reports it `in-progress`/`live`. The idle-output watchdog
(`idleOutputTimeoutMs`, 90s default → `role_stalled`) never fires, and no wall-clock bound settles
it. The stalled row holds the `(project, branch)` claim, so a re-run refuses with
`Cannot re-run incomplete spec: daemon reports live run` and the branch cannot make progress.
Recovery is only `jarvis run kill <id>`.

## Evidence

- **`c6bf9b42`** — review successor of no-work write run `328c3cc6`. `iteration_started` at
  05:12:22Z, zero further events, still live 17+ min later. Held the branch claim; blocked the
  subspec re-run. Only `jarvis run kill` cleared it (and it did not settle for ~2 min after the
  first kill signal).
- **`503f2683`** — shrink/publication successor after completed write run `471ebf35` and its review
  step `b9e87457`. `iteration_started` at ~07:56Z, **zero log events**, live 36+ min, never pushed
  or opened a PR. It was **mid-refactor**: the worktree held large uncommitted edits
  (`pipeline-execution.ts` −428 lines, docs, test file) plus an untracked `verdict-patch.md`. The
  verified implementation sat committed at `a956dcbd` but was never published; the operator killed
  the successor and hand-published.

Both times the write step's own work was sound (mutation contract passed); the failure is entirely
in the successor step hanging before it can publish.

## Decisions

- Root cause is not established — the first acceptance criterion is a reproduction/diagnosis. Do not
  cut a fix against a guessed cause. Candidate loci: the review/shrink/publication successor arms no
  idle-output or wall-clock watchdog (unlike the write step), OR it hangs before the agent
  invocation so the watchdog has no scope. Both observed stalls were successors of runs hit by
  `implement-completion-honesty` defects, so once that bundle lands the reproduction must construct
  the stalled successor synthetically rather than replay those runs.
- A review/shrink/publication successor that produces no output for the machine idle budget settles a
  named, operator-visible failure (`role_stalled` or equivalent) instead of hanging live forever —
  rules out an unbounded successor with no recovery but `kill`.
- A stalled successor releases or times out the `(project, branch)` claim so the branch is
  recoverable without a manual `jarvis run kill` — rules out a hung successor wedging every re-run.
- Out of scope: the write step's own watchdogs (already bounded); the `jarvis run kill` classifier
  gate (operator-config concern).

## Acceptance criteria

- [ ] A regression reproduces a review/shrink/publication successor that emits `iteration_started`
      and then no output, and asserts today's behavior leaves it live and unbounded (fails once a
      watchdog is armed).
- [ ] A successor step with no output for the idle budget settles a named non-live failure; a
      regression asserts `run list`/`wait` report it and the branch claim is released.
- [ ] Mutation checkpoint: a `// @mutate` directive disabling the successor idle/wall-clock watchdog
      turns its pinning test RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and
      `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust / Recovery — record that successor steps are now
  watchdog-bounded; remove the "settled run row can have a live successor step" manual-kill guidance
  once this ships.
- `v2/docs/v1-behaviors.md` — record the added successor-step watchdog.

## Prerequisites

- The successor-step dispatch path after write-step settlement (review/shrink/publication).
- The write step's existing idle-output watchdog (`idleOutputTimeoutMs`) as the model to extend.
