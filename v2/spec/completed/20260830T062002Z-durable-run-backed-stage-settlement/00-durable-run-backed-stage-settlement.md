# Durable run-backed stage settlement

Authoritative for persistence: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

Stage terminal status and artifacts are copied by daemon wait paths (`applyEntryRunSettlement` in `pipeline-stage-dispatch.ts`), so a terminal entry run can leave its linked stage `running` when no process-local promise delivers the result. Restart, adoption, and quota-kill paths without that promise depend on deferred markers and manual or startup redrive. This slice adds one store-owned settlement primitive and tests that exercise it directly; daemon wiring stays on today's promise-backed path until the follow-on intent lands.

## Surface

Persistence: terminal run-to-stage settlement and artifact projection in `state-store.ts` and persistence-adjacent helpers it may import. Out of scope: daemon caller migration, writing `settlement_deferred` markers, log-derived `requestedBase`/`resolvedBase` on settled artifacts, and removing redrive predicates.

## Decision ledger

- Add one `StateStore` settlement operation keyed by entry run id that scans linked `running` stage rows (`workflowInvocationId` equals the entry run id) and applies terminal writes from durable run rows alone; rules out requiring an in-process promise, caller-supplied rollup, or daemon `loadLogRecords` input.
- Relocate `rollupWorkflowRunStatus` to a persistence-importable module (for example under `v2/src/persistence/`) and compute rollup with `isLive: false` from the entry run, its workflow snapshot, and `findRunsByInvocationId` sibling rows; rules out reading only the entry row's `status` when authored durable steps exist and rules out persistence importing `v2/src/daemon/**`.
- When the entry run is not terminal under that rollup (`isLiveEntryRun` / non-terminal rollup), the operation performs no stage writes; rules out replacing deferred markers or terminalizing early (reachable today when `applyEntryRunSettlement` records `settlement_deferred` on a still-live rollup — this store path simply no-ops).
- Rollup `completed` settles each linked `running` stage `succeeded` with artifact rebuilt from a fresh `loadRun` of the entry row (`entryRunId`, `specPath`, optional `downstreamInputs`, `prNumber`, `prUrl`, optional workflow `invocationId` from the entry row); rules out daemon-only artifact assembly at settlement time.
- Rollup `completed` without `specPath` settles `failed` with message `pipeline-stage-dispatch: entry run ${entryRunId} completed without a recorded spec path`; rules out weakening the existing missing-spec outcome while moving ownership.
- Rollup `completed` on a `ready`/`merge` terminal-publication stage whose entry run lacks a complete PR pair settles `failed` with `failureDetail.code: "completion_publication_missing_pr_evidence"` and the existing completion-publication message naming the linked entry run; rules out settling `succeeded` and deferring diagnosis to terminal publication (reachable today on deferred-marker rows via `applyEntryRunSettlement` in `pipeline-stage-dispatch.ts`).
- Every other terminal rollup settles linked `running` stages `failed` with durable failure evidence derived from the entry run row (`terminalCause`, `terminalFailureDetail`, attempts) without log input; rules out settlement requiring daemon log loading for the failure path.
- Re-settlement when a linked stage is already terminal (`succeeded`, `failed`, `interrupted`, or `skipped`) is a no-op; rules out duplicate terminal writes or status regression on idempotent replay.
- Deferred to first consumer: settled artifact `requestedBase`/`resolvedBase` from log records — pin when a store reader needs those fields without daemon log access.
- Deferred to first consumer: exact settlement operation name and return shape — pin when daemon wiring lands.

## Task checklist

- Relocate `rollupWorkflowRunStatus` (and its unit tests) to a persistence-importable module; update existing daemon imports to the new path without behavior change.
- Add stage artifact projection and failure-detail helpers persistence may call without importing daemon (relocate `stageArtifactFromEntryRun` or an equivalent persistence-local builder).
- Add the settlement operation to `StateStore` / `StateStoreImpl`: locate every linked `running` stage for the entry run id, refuse/no-op when the entry run rollup is non-terminal, otherwise apply the completed vs failed mapping above inside store transactions.
- Add `state-store.test.ts` regressions for idempotent terminal settlement (completed and failed rollups), publication-evidence and missing-spec failures, and the live-entry-run no-write guard; each test calls the store operation directly with no promise or daemon settlement helper.
- Update `v2/docs/state-store.md` and `v2/docs/v1-behaviors.md`.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [x] `v2/src/persistence/state-store.test.ts` test `settles linked running stages from terminal durable entry runs idempotently` seeds linked `running` stage rows for one entry run, marks sibling step runs so rollup reads `completed` in one case and terminally `failed` in another, invokes the store settlement operation twice, proves `succeeded`/`failed` terminal rows with expected artifacts or failure evidence, and proves the second call is a no-op; it fails against the pre-fix code that has no store settlement primitive (promise-backed daemon path only).
- [x] `v2/src/persistence/state-store.test.ts` test `settled stage artifacts retain durable entry-run publication evidence` seeds a `ready`-pipeline implement stage whose entry run rollup is `completed` with full `prNumber`/`prUrl`, proves succeeded settlement copies both fields into the stage artifact, and seeds separate fixtures missing `specPath` or PR evidence that settle `failed` with the existing named messages/codes; it fails against the pre-fix path with no store settlement operation.
- [x] `v2/src/persistence/state-store.test.ts` test `live linked entry runs receive no terminal stage write` seeds a linked `running` stage whose entry run rollup is still non-terminal (`in-progress` or `paused`), invokes the store settlement operation, and proves the stage row remains `running` with no terminal status, artifact, or `endedAt` write; it fails against the pre-fix code that has no store settlement guard.
- [x] `v2/docs/state-store.md` documents the durable settlement contract: entry-run-to-stage linkage via `workflowInvocationId`, terminal rollup source, idempotent `running`-only targets, succeeded artifact projection fields, missing-spec and `completion_publication_missing_pr_evidence` failures, non-terminal no-op behavior, and that daemon callers migrate in a follow-on intent.
- [x] `v2/docs/v1-behaviors.md` records that v2 stage settlement can derive from terminal durable workflow entry-run rows with publication evidence carried into succeeded stage artifacts.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — durable settlement contract, idempotence, run-to-stage mapping, artifact projection, validation failures, and non-terminal no-op.
- `v2/docs/v1-behaviors.md` — stage settlement derives from terminal durable workflow rows and carries publication evidence.
