---
name: repair-commits-limited-to-run-diff-and-spec-tree
---

# Ready-gate repair commits only paths the run already touched or its spec tree

## Problem

Ready-gate repair re-commits the whole worktree with no path fence. The agent can weaken unrelated
tests or change suite policy to green a flake that has nothing to do with the run's diff.

## Decisions

- Allowed repair paths are the union of paths in the run's own diff against its base ref and the run's
  spec tree directory. Rules out an unfenced worktree handoff.
- A repair completion commit that stages a path outside that union fails the repair iteration and
  names the first offending path. Rules out committing then discovering scope in review.
- In-scope repair behavior is unchanged: same bounded loop, commit, and republish when every staged
  path is allowed. Rules out tightening scope by breaking legitimate fixes.

## Acceptance criteria

- [ ] A ready-gate repair that stages a path outside the run diff plus spec tree fails before
      publish, naming the offending path; a test drives an edit to an untouched file and fails against
      pre-fix unfenced behavior.
- [ ] A repair that stages only allowed paths still completes the existing bounded repair loop;
      `write-loop.test.ts` ready-gate repair coverage stays green.
- [ ] Inverting the allowed-path check turns the first acceptance test red.

## Documentation updates

- `v2/docs/write-behavior.md` — ready-gate repair iteration path fence (allowed set, failure semantics).

## Prerequisites

