# Completion fix-up loop on uncommitted check:fix output

## Problem

At spec completion the harness runs the full `ready` gate (which includes `check:fix`, modifying files), then requires a clean worktree before flipping the PR. When `check:fix` emits output, that output is left uncommitted, so the "spec complete but worktree not clean" fix-up path fires and re-runs the agent — which can't resolve a tree that is already green, only dirty-from-formatting. The result is a non-converging `fix-up: ready failure` loop.

## Evidence (this session)

- `shared-pr-module-deferred-narrative` (#291): looped ~47 min on `fix-up: ready failure` before being killed; all gates were green, the only diff was uncommitted check:fix lint/format output.
- `shared-spec-blocker-parsing` (#294): same loop, caught at iteration 4; uncommitted shrink + check:fix output, full suite green throughout. The "failure" was the clean-tree assertion, never a test failure.

Both were finalized by killing the loop and committing the converged output by hand.

## Direction (characterize before fixing)

The completion gate must fold its own `check:fix` output into the completion commit (or run check:fix and commit before the clean-tree assertion), so a green-but-formatted tree converges in one pass instead of looping. Confirm the loop is the clean-tree check and not a real ready failure. Bound the fix-up iterations regardless, so a non-converging completion can never spin indefinitely.

## Out of scope

- The no-progress stop misfiring on complete-but-unticked first runs ([[no-progress-stop-spares-green-work]]) — a distinct cause in the same completion neighborhood; pair them in sequencing but keep the fixes separable.
