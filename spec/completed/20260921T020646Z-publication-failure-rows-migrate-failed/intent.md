---
name: publication-failure-rows-migrate-failed
---

# Existing `completed` rows with a failure cause migrate to `failed`

A state-store migration (`v2/src/persistence/state-store.ts`) rewrites `completed` rows whose `terminal_cause` is neither `complete` nor null to `failed`; other rows untouched.

## Acceptance criteria

- [ ] A migration test proves existing `completed` rows with a non-`complete` terminal cause become `failed`, and other rows are untouched.

## Prerequisites

- Publication-tail failures (`completion_commit_failed`, `ready_flip_failed`) settle the run row `failed`, not `completed`.
