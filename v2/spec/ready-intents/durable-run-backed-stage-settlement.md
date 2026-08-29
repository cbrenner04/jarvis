---
name: durable-run-backed-stage-settlement
---

# Settle pipeline stages from durable run rows

## Prerequisites

- Pipeline workflow stages durably record the admitted entry-run ID before settlement begins.
- Successful completion publication persists complete `prNumber`/`prUrl` evidence on the entry run before its first durable `completed` status.

## Module-boundary surface

- Persistence: terminal run-to-stage settlement and artifact projection.

## Problem

Stage terminal status and artifacts are copied by daemon wait paths, so a terminal entry run can leave its linked stage `running` when no process-local promise delivers the result.

## Decision ledger

- A durable settlement operation maps a terminal entry run and its workflow rows onto every linked `running` stage idempotently; rules out requiring an in-process promise or caller-supplied rollup.
- Completed runs settle `succeeded` with artifacts rebuilt from the durable entry row, including `prNumber`/`prUrl`; all other terminal rollups settle `failed` with durable failure evidence; rules out event-path and restart-path mappings drifting.
- A non-terminal linked entry run leaves its stage unchanged; rules out replacing deferred markers with premature terminalization.
- The existing missing-spec and terminal-publication-evidence failures remain settlement outcomes; rules out weakening artifact validity while moving ownership.

## Acceptance criteria

- [ ] The new `state-store.test.ts` test `settles linked running stages from terminal durable entry runs idempotently` fails against the pre-fix promise-backed path and settles completed and non-success terminal rollups without promise input.
- [ ] The settlement guard in `v2/src/persistence/state-store.test.ts` — `settles linked running stages from terminal durable entry runs idempotently`; Mutation checkpoint:
- [ ] The new `state-store.test.ts` test `settled stage artifacts retain durable entry-run publication evidence` fails against the pre-fix path and proves succeeded settlement rebuilds complete `prNumber`/`prUrl` evidence while missing required spec or terminal-publication evidence retains the existing named failure.
- [ ] A live linked entry run receives no terminal stage write.
- [ ] The non-terminal-entry-run guard in `v2/src/persistence/state-store.test.ts` — `live linked entry runs receive no terminal stage write`; Mutation checkpoint:
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — durable settlement contract, idempotence, run-to-stage mapping, and artifact projection.
- `v2/docs/v1-behaviors.md` — stage settlement derives from terminal durable workflow rows and carries publication evidence.
