---
name: reconcile-done-token-against-unticked-criteria
---

# Reject a `done` completion whose spec still has unticked criteria

A v2 write-loop iteration that returns a completion token must be reconciled against the
spec's actual state in the worktree before the boundary is committed. If any non-human-only
acceptance criterion in the active subspec is still unticked, the run must not record
`outcomeKind: done` / `runStatus: completed`.

Observed 2026-07-13, run `f9d556ed`: `boundary_committed: done` on a subspec with 0 of 5
criteria ticked. Mirrors v1's completion contract — complete means zero unchecked items.

## Decisions

- Reconcile the claimed completion against the spec re-read from the worktree at the boundary; rules out trusting the agent's terminal token at face value.
- Unticked non-human-only criteria ⇒ not `done`; the outcome names the unticked criteria so the operator sees why. Reuse `shared/spec-parser.ts` (`parseSpec`, `humanOnly`) rather than a new parser.
- Human-only criteria are exempt (the agent cannot tick them).

## Prerequisites

- `shared/spec-parser.ts` exports `parseSpec` and `humanOnly`.

## Out of scope

- The uncommitted-work case (a separate behavior).
- Why an agent emits a done token on untouched criteria.

## Documentation updates

- `v2/docs/v1-behaviors.md` — completion contract now enforced on v2 implement runs.
- `v2/docs/operator-runbook.md` § Gate trust — `completed` implies the spec's criteria are ticked.
