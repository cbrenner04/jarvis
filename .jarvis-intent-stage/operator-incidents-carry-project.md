---
name: operator-incidents-carry-project
---

# Operator incidents carry owning project in the serialized payload

## Prerequisites

## Module-boundary surface

- Daemon: operator-incident derivation and notification-sink serialization.

## Problem

A shared daemon derives operator incidents from runs and pipelines that already carry project identity, but `serializeOperatorIncident` omits it. Sink consumers and any later blocking consumer cannot tell which registered project fired without a separate `run list` lookup per incident.

## Decision ledger

- Every serialized incident includes `project`, derived from the row already held during derivation (`Run.project` for run incidents; the pipeline's owning project for pipeline and stage incidents); rules out a consumer-side lookup to recover identity the derivation already held.
- When no single owning project applies, emit `project: null` rather than omitting the key; rules out shape-sniffing for a missing field.
- Populating `project` adds zero per-incident store calls beyond the existing derivation path for an identical actionable set; rules out a follow-up `loadRun` or pipeline lookup per incident.

## Acceptance criteria

- [ ] The new `operator-incidents` test `serializeOperatorIncident emits project for run-derived incidents` asserts the serialized JSON `project` matches the source run's `project`; it fails against the current payload missing `project`.
- [ ] The new `operator-incidents` test `pipeline and stage incidents emit owning project and null when unowned` asserts pipeline- and stage-derived incidents carry the owning project and an incident with no single owner emits `project: null`; it fails against the current payload.
- [ ] The new `operator-notification` test `deriving project does not increase store calls` counts store access during incident derivation for a fixed actionable fixture and asserts the call count is unchanged from the pre-fix baseline; it fails if project derivation adds per-incident lookups.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/daemon-host.md` — § Operator notifications: the incident payload's `project` field and its `null` case.
