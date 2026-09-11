---
name: stage-success-reopens-skipped-successors
---

# A re-driven stage that succeeds reopens its branch's provisionally skipped successors

## Problem

`settleFanOutBranch` skips every later stage in a branch when a stage settles non-`succeeded`. If that stage is later re-driven and succeeds, nothing resets the successors: the lane sits at `plan: succeeded` + `implement: skipped` and keeps running past a successor that is terminally skipped.

## Decisions

- Settling a branch stage to `succeeded` reopens that branch's provisional `skipped` successors to `pending` in the same transaction that writes the success.
- Terminal (split-retired) skips are never reopened by this path.
- Reopened successors are dispatchable by the normal execution loop with no operator verb.

## Acceptance criteria

- [ ] A pipeline test proves a fan-out branch whose stage failed, skipped its successor, and then succeeded on re-drive has that successor back at `pending` and dispatchable; it fails against the current `skipped` row.
- [ ] A pipeline test proves `default` rows retired by a fan-out split are not reopened by this path.
- [ ] A pipeline test proves sibling branches' stage rows are unaffected by the reopen.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — successor reopen on re-drive.

## Prerequisites

- Stage rows record whether a `skipped` row is provisional (predecessor failure) or terminal (split-retired).
- The state store exposes a branch-scoped reopen of provisional `skipped` rows to `pending` that needs no `failed` anchor row.
