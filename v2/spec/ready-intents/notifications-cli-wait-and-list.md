---
name: notifications-cli-wait-and-list
---

# `jarvis notifications wait` and `list` are the supported operator wake primitive

## Prerequisites

- Delivery ledger rows persist the serialized incident JSON written to the sink at record time.
- The state store exposes an ordered delivered-incident query filterable by since cursor or timestamp and optional incident kinds.
- The daemon exposes `notification_wait` and `notification_list` RPCs that read the ledger and wake blocked waiters when the sweep records a delivery.

## Module-boundary surface

- CLI

## Problem

Operators wire `notificationSinkCommand` to append JSONL and hand-roll `tail -f` waiters that self-terminate after one line, miss boundaries when re-arm is late, and cannot resume from a durable cursor.

## Decision ledger

- Add `jarvis notifications wait` and `jarvis notifications list` subcommands delegating to the daemon RPCs; rules out documenting sink-only push as the only notification surface.
- `notifications wait` prints one JSON line on stdout and exits `0` when the next owed incident arrives; rules out multi-line or streaming stdout on wait.
- `notifications list` prints one incident JSON object per line (NDJSON) on stdout without blocking; rules out a single JSON array wrapper or human table output.
- `--since` accepts cursor (`deliveredAt:incidentId:transition`), duration, or timestamp and composes with `--kind` on wait and list; rules out tail line-offset semantics.
- `notificationSinkCommand` stays unchanged; wait/list are the pull side of the same ledger, not a sink replacement.
- Deferred to first consumer: `notifications list --follow` long-lived stream behavior — pin when an operator workflow needs streaming catch-up beyond one-shot list.

## Acceptance criteria

- [ ] The new notifications CLI test `notifications wait blocks until the next owed incident` arms `jarvis notifications wait`, records an incident after wait begins, and asserts one JSON line on stdout with exit `0`; it fails against the pre-fix missing subcommand.
- [ ] The new notifications CLI test `notifications wait since cursor returns delivery recorded while no waiter was armed` records a delivery, then arms `jarvis notifications wait --since <prior cursor>`, and asserts the incident is returned rather than lost; it fails against the pre-fix path.
- [ ] The new notifications CLI test `notifications wait kind filter ignores non-matching incidents` arms wait with `--kind`, delivers a non-matching incident then a matching one, and asserts only the matching incident wakes the wait; it fails against the pre-fix unfiltered wait.
- [ ] The new notifications CLI test `notifications list since duration returns prior ledger incidents` seeds delivered incidents and asserts `jarvis notifications list --since <duration>` prints one JSON line per incident without blocking; it fails against the pre-fix missing list subcommand.
- [ ] The new notifications CLI test `notifications list kind filter excludes non-matching incidents` seeds mixed-kind deliveries and asserts `jarvis notifications list --kind <set>` prints only matching incidents as NDJSON; it fails against the pre-fix unfiltered list.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Operator notifications and § Deciding a workflow is finished: `jarvis notifications wait` is the supported wake primitive; remove guidance to reach for `run list` loops when a notification is missed.
