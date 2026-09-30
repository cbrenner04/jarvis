---
name: reopened-implement-stage-settles-succeeded
---

# A reopened implement stage whose entry row completed without new work settles succeeded

## Problem

Linked pipeline stage settlement follows workflow rollup. When rollup reads `killed` for a completed entry invocation with no successor row, `settleLinkedStagesFromEntryRunWith` fails the stage `resumable_kill` despite PR evidence on the completed entry row. When rollup is already `completed`, settlement already succeeds with that PR evidence; the bug is rollup misreporting `killed`.

## Decisions

- Scope is the prerequisite rollup intent, a settlement-layer regression test with rollup `completed`, and operator docs — not new settlement projection when rollup matches a completed entry row with PR evidence.

## Acceptance criteria

- [ ] `pipeline-stage-settlement.test.ts` adds a reopened-implement-shaped fixture: completed entry `implement` row with zero attempts, no `implement-review` sibling row, rollup `completed`, running linked stage settles `succeeded` with the entry row's PR evidence; fails against the pre-fix `resumable_kill` failure path.

## Documentation updates

- `v2/docs/pipeline-execution.md` — reopened implement that finishes without new work settles `succeeded`.
- `v2/docs/v1-behaviors.md` — operator-visible linked stage outcome for that path.

## Prerequisites

- Non-live workflow rollup treats a legitimately skipped durable successor as `completed` when the invocation entry row completed with terminal cause `complete`, not `killed`.
- Non-live workflow rollup still reports `killed` when a durable successor genuinely never ran after a non-complete entry.
