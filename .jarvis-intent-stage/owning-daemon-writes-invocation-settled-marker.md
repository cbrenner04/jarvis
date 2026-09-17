---
name: owning-daemon-writes-invocation-settled-marker
---

# The owning daemon writes the settled marker when the workflow promise ends

Seed: `v2/spec/seeds/workflow-terminal-incident-fires-once.md`.

## Behavior

- The owning daemon writes the settled marker in the workflow `finally`, the same point where `settleStagesForEntryRun` runs (`v2/src/daemon/daemon-workflow-admission-handlers.ts`). The marker records the promise's cause (completed, failed, killed) and is written only after the publication tail ends.
- If a later republication fails, the marker is rewritten with cause `failed`.

## Acceptance

- A test asserts the marker is written with the matching cause for completed, failed, and killed settlements, and not before the publication tail ends.

## Prerequisites

- Persistence stores a durable per-invocation settled marker (cause and time).
