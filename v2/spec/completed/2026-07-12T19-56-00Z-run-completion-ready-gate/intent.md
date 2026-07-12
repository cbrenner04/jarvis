---
name: run-completion-ready-gate
---

# Require the shared ready gate before a run completes

## Problem

`jarvis1 run` reported `criteria-complete` and flipped a PR ready while the
branch failed the gate that `jarvis1 triage --merge` later ran.

## Direction

Make the completion gate used by `jarvis1 run` the same gate used by
`jarvis1 triage --merge`. A red result is terminal: preserve the PR as draft,
do not report `criteria-complete`, and exit non-zero with a named gate reason.

Cover the reproduced red-suite path so it cannot reach a success exit.

## Decisions

- Completion requires checked criteria and a green shared ready gate — rules out criteria-only success.
- `triage --merge` remains strict — rules out weakening its gate to match a faulty run path.
- A red completion gate terminates the run — rules out ready flipping or `criteria-complete` after a failed gate.

## Documentation updates

- `v1/docs/operator-runbook.md` — the gate and `criteria-complete` contract.
- `v2/docs/v1-behaviors.md` — shared completion-gate contract.

## Prerequisites
