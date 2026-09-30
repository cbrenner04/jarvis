---
name: skipped-durable-successor-rollup-completed
---

# Legitimately skipped durable successors roll up completed when the entry step completed

## Problem

Non-live workflow rollup treats every durable authored step without a run row as `killed`. After `pipeline resume` reopens an implement stage, a fresh invocation can complete the entry `implement` row with zero attempts (gate only; review already settled for the lane) and never write an `implement-review` row, so rollup reports `killed` while the entry row's terminal cause is `complete`.

## Decisions

- For any authored durable step with no run row in a non-live invocation, rollup is `completed` (not `killed`) when the invocation entry row completed with terminal cause `complete`; reopened implement without an `implement-review` row is one instance, not the sole case.
- Entry-row attempt count is scenario setup in tests and docs, not part of the rollup predicate.
- A missing durable row after a non-complete entry still rolls up `killed`.

## Acceptance criteria

- [ ] `workflow-run-status-rollup.test.ts` adds a case where the entry step completed with terminal cause `complete` and no row exists for a later durable successor (zero attempts only as fixture setup); rollup is `completed` and fails against the pre-fix `killed`.
- [ ] `workflow-run-status-rollup.test.ts` pins a constructible case where a durable successor never ran after a non-complete entry and rollup stays `killed`.
- [ ] `workflow-run-status-rollup.test.ts` linked-implement cases stay green.

## Documentation updates

- `v2/docs/workflow-runner.md` — non-live rollup: missing durable row is not `killed` when the entry row completed with terminal cause `complete`.
- `v2/docs/v1-behaviors.md` — list/wait durable-step rollup bullet aligned with the same rule.

## Prerequisites
