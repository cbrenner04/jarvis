---
name: workflow-invocation-settled-marker-store
---

# Persistence stores a durable per-invocation settled marker

Seed: `v2/spec/seeds/workflow-terminal-incident-fires-once.md`.

## Behavior

- The run store keeps one settled marker per workflow invocation (keyed by entry run id), with a cause (`completed`/`failed`/`killed`) and a settled time. Writing the marker again with a new cause replaces the cause.
- Any daemon sweeping the shared store can read it. No marker means the invocation has not finished.
- The migration adds the marker without backfilling invocations that already exist.

## Acceptance

- Tests cover write, read, cause replacement, and that a migrated store has no markers for existing invocations.

## Prerequisites
