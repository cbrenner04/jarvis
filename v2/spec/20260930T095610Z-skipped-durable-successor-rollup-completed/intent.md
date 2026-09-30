---
name: skipped-durable-successor-rollup-completed
---

# Legitimately skipped durable successors roll up completed when the entry step completed

## Problem

Non-live workflow rollup treats every durable authored step without a run row as `killed`. After `pipeline resume` reopens an implement stage, a fresh invocation can complete the entry `implement` row with zero attempts (a no-op resume; review already completed in an earlier invocation of the same lane) and never write an `implement-review` row, so rollup reports `killed` while the entry row's terminal cause is `complete`.

## Decisions

- A missing durable successor row in a non-live invocation rolls up satisfied only when the entry completed with terminal cause `complete`, entry attempt count is 0, and an earlier invocation of the same lane (project, branch, spec_ref) completed that successor; otherwise `killed`. Completing on terminal cause alone is ruled out — it masks a daemon death between entry settlement and successor row creation.
- Live invocations return in-progress before the step loop, unchanged.

## Acceptance criteria

- [ ] No-op resume (entry complete, attempt 0, prior same-lane successor completed, no successor row) rolls up `completed`.
- [ ] Entry complete with attempt ≥ 1, no successor row, no prior successor → `killed`.
- [ ] Entry complete with attempt 0, no prior successor → `killed`.
- [ ] Linked-implement cases stay green.

## Documentation updates

- `v2/docs/workflow-runner.md` — the narrowed missing-row rule.
- `v2/docs/v1-behaviors.md` — list/wait durable-step rollup bullet aligned.

## Prerequisites
