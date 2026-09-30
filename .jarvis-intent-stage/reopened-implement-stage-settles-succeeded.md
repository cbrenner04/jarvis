---
name: reopened-implement-stage-settles-succeeded
---

# A reopened implement stage whose entry row completed without new work settles succeeded

## Problem

Linked pipeline stage settlement follows workflow rollup. When rollup reads `killed` for a completed entry invocation with no successor row, `settleLinkedStagesFromEntryRunWith` fails the stage `resumable_kill` despite PR evidence on the completed entry row.

## Decisions

- A stage whose entry row completed with PR evidence settles `succeeded` when rollup is `completed`.

## Acceptance criteria

- [ ] `pipeline-stage-settlement.test.ts` adds a reopened-implement-shaped fixture: completed entry `implement` row with zero attempts, no `implement-review` sibling row, rollup `completed`, running linked stage settles `succeeded` with the entry row's PR evidence; fails against the pre-fix `resumable_kill` failure path.

## Documentation updates

- `v2/docs/pipeline-execution.md` — reopened implement that finishes without new work settles `succeeded`.

## Prerequisites

- Non-live workflow rollup treats a legitimately skipped durable successor as `completed` when the invocation entry row completed with terminal cause `complete`, not `killed`.
- Non-live workflow rollup still reports `killed` when a durable successor genuinely never ran after a non-complete entry.
