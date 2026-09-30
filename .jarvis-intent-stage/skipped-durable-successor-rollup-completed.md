---
name: skipped-durable-successor-rollup-completed
---

# Legitimately skipped durable successors roll up completed when the entry step completed

## Problem

Non-live workflow rollup treats every durable authored step without a run row as `killed`. After `pipeline resume` reopens an implement stage, a fresh invocation can complete the entry `implement` row with zero attempts (gate only; review already settled for the lane) and never write an `implement-review` row, so rollup reports `killed` while the entry row's terminal cause is `complete`.

## Decisions

- A durable successor the workflow legitimately skipped does not roll up as `killed` when the invocation entry row completed with terminal cause `complete`.
- A missing durable row after a non-complete entry still rolls up `killed`.

## Acceptance criteria

- [ ] `workflow-run-status-rollup.test.ts` adds a case where the entry step completed with zero attempts, terminal cause `complete`, and no row exists for a later durable successor; rollup is `completed` and fails against the pre-fix `killed`.
- [ ] `workflow-run-status-rollup.test.ts` pins a constructible case where a durable successor never ran after a non-complete entry and rollup stays `killed`.

## Prerequisites
