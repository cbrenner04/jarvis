---
name: completion-commit-checkfix-output
---
# Converge the completion check:fix output instead of looping on a dirty tree

**Scope.** The patch completion pipeline's ready gate + clean-tree assertion + fix-up loop. Make a green-but-formatted tree converge in one pass; bound the fix-up loop so it can never spin indefinitely.

## Problem

At spec completion the harness runs the full `ready` gate (which runs `check:fix`, modifying files), then requires a clean worktree before flipping the PR. When `check:fix` emits formatting output that is not committed, the "spec complete but worktree not clean" fix-up path fires and re-runs the agent — which cannot resolve a tree that is already test-green, only dirty-from-formatting. The result is a non-converging `fix-up: ready failure` loop.

## Evidence (this session)

- `shared-pr-module-deferred-narrative` (#291): looped ~47 min on `fix-up: ready failure`; all gates green, the only diff was uncommitted check:fix lint/format output. Killed and finalized by hand.
- `shared-spec-blocker-parsing` (#294): same loop, caught at iteration 4. Tests were green throughout; the "failure" was the clean-tree assertion, not a test failure.
- `review-shrink-model-tiering` (#310): completion timed out churning on the same uncommitted check:fix output.

## Desired behavior

When the completion ready gate leaves the tree dirty solely because `check:fix` reformatted files (tests/typecheck/lint otherwise green), the harness commits that output as part of the completion transition and proceeds — one pass, no loop. A genuinely red ready result (failing test/typecheck/unfixable lint) still drives the existing fix-up iteration. The fix-up loop is bounded by a hard cap regardless of cause, so a non-converging completion exits with a clear terminal status instead of spinning.

## Decisions

- The completion gate folds its own `check:fix` formatting output into the completion commit (commit-after-check:fix, before the clean-tree assertion), so a green-but-reformatted tree converges without a fix-up iteration. Rules out asserting a clean tree against output the gate itself just produced.
- Distinguish a clean-tree-from-formatting dirty state (auto-commit and proceed) from a real red ready result (loop back for an agent fix-up). Rules out treating all completion dirtiness as an agent-resolvable failure.
- The fix-up loop gets a hard iteration cap with a distinct terminal exit/telemetry reason (e.g. ready-stuck), so non-convergence terminates rather than spins. Rules out an unbounded completion fix-up loop.
- Reuse the existing `runReadyAndCommit` / completion-pipeline seams; no new ready tier or gate. Rules out a parallel completion path.

## Acceptance signals

- A completion where `check:fix` reformats files but tests/typecheck/lint pass commits the formatting and flips the PR in a single pass, with no `fix-up: ready failure` iteration (test).
- A completion with a genuinely failing ready result still drives a fix-up iteration as today (test).
- A persistently non-converging completion stops at the bounded cap with the terminal reason, not an infinite loop (test).
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: completion-transition check:fix commit + bounded fix-up behavior.
- `v2/docs/v1-behaviors.md`: record the completion convergence + fix-up cap.
- `v2/spec/wip-intents/completion-commit-checkfix-output.md`: remove once landed.

## Out of scope

- The no-progress stop misfiring on complete-but-unticked first runs ([[no-progress-stop-spares-green-work]]) — distinct cause in the same completion neighborhood; separate intent.
- Changing what `ready` / `check:fix` themselves do.

## Prerequisites

- The completion fix-up loop is reproducible (established this session on #291/#294/#310): green tree, uncommitted check:fix output, `fix-up: ready failure`.
- `bun run typecheck` and `bun run test` green on `main`.
