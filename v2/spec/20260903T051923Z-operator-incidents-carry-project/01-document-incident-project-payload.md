# Document incident project payload

## Problem

Operator-notification sink consumers and v1-behavior parity docs do not describe the `project` field on serialized incidents.

## Decision ledger

- `daemon-host.md` § Operator notifications is the durable home for sink stdin JSON shape; rules out duplicating full payload field lists in `install-and-config.md` or `operator-runbook.md`.
- `v1-behaviors.md` records the notification incident payload contract for parity review; rules out leaving the behavior change undocumented in the v1 baseline catalog.

## Prerequisites

- Subspec 00: `serializeOperatorIncident` emits `project` (`null` when no single owner applies).

## Task checklist

- In `v2/docs/daemon-host.md` § Operator notifications, document that each sink stdin JSON object includes `project` (registered project id from the owning run or sole attributable pipeline entry run; `null` when no single owner applies).
- In `v2/docs/v1-behaviors.md`, add a **[v2 additive]** entry stating the notification incident payload includes `project` (`null` when no single owner applies).

## Acceptance criteria

- [ ] `v2/docs/daemon-host.md` § Operator notifications documents the incident payload `project` field and its `null` case.
- [ ] `v2/docs/v1-behaviors.md` documents that the notification incident payload includes `project` (`null` when no single owner applies).

## Documentation updates

- `v2/docs/daemon-host.md` — § Operator notifications: incident payload `project` field and `null` case.
- `v2/docs/v1-behaviors.md` — notification incident payload includes `project` (`null` when no single owner applies).
