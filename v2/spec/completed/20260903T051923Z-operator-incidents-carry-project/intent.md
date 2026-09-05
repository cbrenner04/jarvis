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

- Every serialized incident includes `project`, derived from the row already held during derivation (`Run.project` for run incidents; for pipeline and stage incidents, collect `project` from each stage's `workflowInvocationId` lookup in `entryRunsById`, emit the value only when exactly one distinct non-empty project remains); rules out a consumer-side lookup to recover identity the derivation already held.
- When no single owning project applies — no attributable entry run or conflicting entry-run `project` values — emit `project: null` rather than omitting the key; rules out shape-sniffing for a missing field.
- Incident pipeline/stage `project` is `entryRunsById`-only aggregation, deliberately not monitor tree or detail algorithms; no shared helper or cross-surface parity AC in this spec; rules out unifying with TUI or adding drift tests here.
- Run-derived incidents emit `run.project` verbatim (may be `""`); pipeline/stage with no single owner emit `null`, not `""`; rules out normalizing run empty project to `null`.
- Gate-only / publication-only pipelines without attributable entry runs emit `project: null` on pipeline incidents; acceptable limitation for this spec's motivating sink use case; rules out blocking on project-scoped routing for those kinds without an explicit decision.
- Populating `project` adds zero per-incident store calls beyond the existing derivation path for an identical actionable set; rules out a follow-up `loadRun` or pipeline lookup per incident.

## Acceptance criteria

- [x] `operator-incidents.test.ts` test `deriveOperatorIncidents emits project for run-derived incidents` drives `deriveOperatorIncidents` on a run-actionable fixture and asserts derived incident `project` and serialized JSON `project` match the source run's `project`; it fails against pre-fix derivation omitting `project`.
- [x] `operator-incidents.test.ts` test `pipeline and stage incidents emit project from entry runs and null when unowned` drives `deriveOperatorIncidents` on pipeline-terminal and stage-settlement-wedged fixtures with one attributable entry run (that run's `project`), fixtures with no attributable entry run or conflicting entry-run projects (`project: null`), and gate-only `pipeline-awaiting-approval` from `seedActionableDerivationFixtures` (`project: null`); it fails against pre-fix derivation omitting `project`.
- [x] `operator-notification.test.ts` test `deriving project does not increase store calls` seeds `seedActionableDerivationFixtures`, instruments store access with `instrumentStageAttributedLookups` during `deriveOperatorIncidents`, and asserts `{ loadRunsByIdsCount: 1, findRunsByInvocationIdsCount: 1 }`; it fails against pre-fix if project derivation adds per-incident lookups.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — § Operator notifications: the incident payload's `project` field and its `null` case.
- `v2/docs/v1-behaviors.md` — notification incident payload includes `project` (`null` when no single owner applies).
