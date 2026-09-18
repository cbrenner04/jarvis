---
name: run-ad-hoc-terminal-derives-from-settled-marker
---

# `run-ad-hoc-terminal` fires once per invocation outcome, from the settled marker

Seed: `v2/spec/seeds/workflow-terminal-incident-fires-once.md`.

## Behavior

- `invocationTerminal` (`v2/src/daemon/operator-incidents.ts`) derives the incident only from the settled marker. It does not use the latest row-status time or in-memory liveness. With no marker, no daemon emits the incident.
- The transition key is `terminal:${cause}`. If the cause changes, the operator is notified once more.
- Terminal incidents already delivered before the upgrade are not delivered again.
- Docs: `v2/docs/daemon-host.md` § Operator notifications; `v2/docs/operator-runbook.md` § Deciding a workflow is finished.

## Acceptance

- A daemon that does not own the invocation derives no incident while a review row reads `completed` and its publication tail is still running. This test fails against the current rollup.
- Rewriting a row's `status_changed_at` after the marker is written yields no second incident. This test fails against the timestamped key.
- A completed-then-failed republication yields exactly two deliveries.
- Terminal incidents delivered before the upgrade are not delivered again.
- `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Prerequisites

- Persistence stores a durable per-invocation settled marker (cause and time).
- The owning daemon writes the settled marker with the workflow promise's cause when the promise ends.
