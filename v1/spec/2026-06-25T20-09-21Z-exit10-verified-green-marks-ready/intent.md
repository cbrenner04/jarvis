---
name: exit10-verified-green-marks-ready
---

# Low-friction exit-10 recovery: re-run gate, mark ready on green

## Problem

On exit `10` (`ready-stuck-red`) a flaky `readyCommand` strands correct work as a
draft PR. The only recovery is manual: operator re-runs the gate in the worktree
by hand, then `gh pr ready`. The north-star path "operator verified green → mark
ready" is owned by no command.

## Direction

Fold the recovery into an **existing** command (e.g. `triage`) rather than a new
subcommand: re-run the completion ready gate once against the worktree and, if
green, mark the PR ready. On red, report the failure and leave the PR draft.
The "weigh default bound / flake classification for whole-suite gates" note from
the seed is context, not part of this slice.

## Out of scope

- New top-level subcommand if the behavior fits an existing command.
- Changing the default `readyGateRetryBound` or retryable classification.
- Operator-side config (a flaky-gate project should set `readyGateRetryBound`).

## Prerequisites

- A red completion ready gate exits 10 (`ready-stuck-red`) and leaves the PR a draft.
- The completion ready gate can re-run against a worktree and mark the PR ready when green.
