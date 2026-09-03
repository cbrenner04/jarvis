# Incident project payload

## Problem

`deriveOperatorIncidents` already holds run and entry-run rows with `project`, but `serializeOperatorIncident` omits it. Sink consumers cannot tell which registered project fired without a per-incident `run list` lookup.

## Decision ledger

- `OperatorIncident` carries `project: string | null` populated during derivation, not recomputed in `serializeOperatorIncident`; rules out serialization-time store access or a second resolution pass.
- Run-derived incidents set `project` from the source `Run.project` verbatim; rules out re-deriving project through entry-run attribution for ad-hoc runs.
- Pipeline- and stage-derived incidents set `project` from the pipeline's entry-run rows already in `entryRunsById`: collect `project` from each stage's `workflowInvocationId` lookup, emit the value only when exactly one distinct non-empty project remains, otherwise `null`; rules out consumer-side `run list` and rules out omitting the key when unowned.
- Incident pipeline/stage `project` is `entryRunsById`-only aggregation, deliberately not monitor tree or detail algorithms; no shared helper or cross-surface parity AC in this spec; rules out unifying with TUI or adding drift tests here.
- Run-derived incidents emit `run.project` verbatim (may be `""`); pipeline/stage with no single owner emit `null`, not `""`; rules out normalizing run empty project to `null`.
- Gate-only / publication-only pipelines without attributable entry runs emit `project: null` on pipeline incidents; acceptable limitation for this spec's motivating sink use case; rules out blocking on project-scoped routing for those kinds without an explicit decision.
- Project population reuses the `entryRunsById` map loaded in `deriveOperatorIncidents` and adds zero per-incident store calls beyond the existing derivation path; rules out follow-up `loadRun` or pipeline lookup per incident.

## Prerequisites

- Intent prerequisites: none.

## Task checklist

- Add `project: string | null` to `OperatorIncident` and thread it through every incident constructor in `operator-incidents.ts`.
- Add `resolvePipelineIncidentProject(pipeline, entryRunsById)` (or equivalent) implementing the single-owner entry-run rule above; use it for pipeline- and stage-derived incidents.
- Set run-derived `project` from `run.project` in `pushRunIncident`.
- Include `project` in `serializeOperatorIncident` JSON output (always present; `null` when unowned).
- Add `v2/src/daemon/operator-incidents.test.ts` test `deriveOperatorIncidents emits project for run-derived incidents`: seed a run-actionable fixture (e.g. blocked run), call `deriveOperatorIncidents`, assert derived incident `project` and `serializeOperatorIncident` JSON `project` match the source run's `project`; fails against pre-fix derivation omitting `project`.
- Add `operator-incidents.test.ts` test `pipeline and stage incidents emit project from entry runs and null when unowned`: drive `deriveOperatorIncidents` on pipeline-terminal and stage-settlement-wedged fixtures with one attributable entry run (emit that run's `project`), fixtures with no attributable entry run (`workflowInvocationId: null`) or conflicting entry-run projects (`project: null`), and gate-only `pipeline-awaiting-approval` from `seedActionableDerivationFixtures` (`project: null`); fails against pre-fix derivation omitting `project`.
- Add `operator-notification.test.ts` regression `deriving project does not increase store calls`: seed `seedActionableDerivationFixtures`, wrap store with `instrumentStageAttributedLookups`, call `deriveOperatorIncidents`, assert `{ loadRunsByIdsCount: 1, findRunsByInvocationIdsCount: 1 }`; fails against pre-fix if project derivation adds per-incident lookups.

## Acceptance criteria

- [ ] `v2/src/daemon/operator-incidents.test.ts` test `deriveOperatorIncidents emits project for run-derived incidents` drives `deriveOperatorIncidents` on a run-actionable fixture and asserts derived incident `project` and serialized JSON `project` match the source run's `project`; it fails against pre-fix derivation omitting `project`.
- [ ] `v2/src/daemon/operator-incidents.test.ts` test `pipeline and stage incidents emit project from entry runs and null when unowned` drives `deriveOperatorIncidents` on pipeline-terminal and stage-settlement-wedged fixtures with one attributable entry run (that run's `project`), fixtures with no attributable entry run or conflicting entry-run projects (`project: null`), and gate-only `pipeline-awaiting-approval` from `seedActionableDerivationFixtures` (`project: null`); it fails against pre-fix derivation omitting `project`.
- [ ] `v2/src/daemon/operator-notification.test.ts` test `deriving project does not increase store calls` seeds `seedActionableDerivationFixtures`, instruments store access with `instrumentStageAttributedLookups` during `deriveOperatorIncidents`, and asserts `{ loadRunsByIdsCount: 1, findRunsByInvocationIdsCount: 1 }`; it fails against pre-fix if project derivation adds per-incident lookups.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- Deferred to subspec 01.
