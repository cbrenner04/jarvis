---
name: repair-commits-limited-to-run-diff-and-spec-tree
---

# Ready-gate repair commits only paths the run already touched or its spec tree

## Problem

Ready-gate repair re-commits the whole worktree with no path fence. Repair agents weaken unrelated
tests or change suite policy to green flake outside the run's diff (PR #2228, PR #2243).

## Decisions

- Allowed repair paths are the union of paths in the run's diff against its base ref and the run's
  spec tree directory — rules out handing the agent an unfenced worktree.
- A repair completion commit that stages a path outside that union fails the repair iteration and
  names the first offending path — rules out committing scope violations for operator review to catch.
- In-scope repair behavior is unchanged when every staged path is allowed — rules out tightening scope
  by breaking legitimate fixes inside the fence.

## Acceptance criteria

- [ ] A ready-gate repair that stages a path outside the run diff plus spec tree fails before
      publish, naming the offending path; a test drives an edit to an untouched file and fails against
      pre-fix unfenced behavior.
- [ ] A repair that stages only allowed paths still completes the existing bounded repair loop;
      ready-gate repair coverage in `write-loop.test.ts` stays green.
- [ ] Inverting the allowed-path check turns the first acceptance test red.

## Documentation updates

- `v2/docs/write-behavior.md` — ready-gate repair path fence (allowed set, failure semantics).

## Prerequisites

