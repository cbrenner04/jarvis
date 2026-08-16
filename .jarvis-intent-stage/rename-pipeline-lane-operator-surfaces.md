---
name: rename-pipeline-lane-operator-surfaces
---

# Rename Pipeline Lane Operator Surfaces

## Prerequisites

- State-store lane identity is `laneKey` backed by `lane_key`; legacy `branch_key` stores migrate without row, value, or order changes.
- Pipeline execution uses lane terminology, preserves lane values, requires `laneKey` for multi-lane approvals, and names valid lanes for a mismatched target.
- Pipeline RPC emits `laneKey`, accepts current `laneKey` decision targeting, retains the request-only `branchKey` fallback for one release, and refuses omitted multi-lane targeting with `lane_key_required`.

## Surface

CLI, including the TUI operator client.

## Problem

- CLI grammar, output, TUI attention rows, and steering feedback label pipeline lanes as branches without explaining their values.

## Behavior

- `jarvis pipeline approve|reject <pipeline-id> <stage-id> <lane-key>`, pipeline list/wait output, and TUI pipeline views use lane terminology only; CLI usage and awaiting-approval TUI rows explain `lane (default, or ready-intent name after a split)`, and decision commands send `laneKey` with no CLI alias.

## Decisions

- Remove `branch-key` from CLI grammar without an alias; rules out preserving the misleading positional contract.
- Label pipeline lanes as lanes across TUI attention, detail, roll-up, and steering feedback while leaving workflow git-branch labels unchanged; rules out either partial operator renaming or erasing real git-branch terminology.
- State lane meaning inline at the approval entry points; rules out relying on the identifier rename alone.

## Required verification

- CLI tests pin `<lane-key>` usage, `laneKey` decision requests, lane-keyed list/wait output, no CLI alias, and valid-lane refusal detail for a git-branch-shaped mismatch on a single-lane pipeline.
- TUI tests pin lane wording and inline meaning for awaiting approval, with no branch wording for pipeline lanes and unchanged workflow git-branch labels.

## Documentation updates

- `v2/docs/write-behavior.md` — canonical CLI grammar, lane-keyed output, refusal behavior, and inline lane meaning.
- `v2/docs/first-workflow-walkthrough.md` — approval commands and how to obtain the `default` or ready-intent-name lane.
- `v2/docs/operator-runbook.md` — TUI lane presentation and steering semantics.
- `v2/docs/v1-behaviors.md` — operator-facing rename and unchanged real git-branch terminology.
