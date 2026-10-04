# Preparation parity, structural authority, and docs

Authoritative for cross-path preparation parity, structural authority, preservation regressions, and durable docs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

CLI workflow starts and daemon pipeline dispatch still have two production paths that can diverge on step bytes and preparation authority even after resolution and stale-reset slices land. Durable docs still describe daemon-local assembly and intent-only stale reset.

## Decision ledger

- Assert byte-identical prepared steps from CLI and pipeline adapters through `prepareWorkflowStart` for the same normalized inputs; rules out posture-table alignment tests without step-byte parity.
- Extend structural authority tests so realizability mapping and prepared-step assembly each have one production owner; rules out a second `prepareWorkflowStart` call site or duplicate assembly in `pipeline-stage-resolve.ts` / `pipeline-execution.ts`.

## Tasks

- Add a cross-path parity test driving CLI and pipeline adapters through shared preparation for representative `intent`, `plan`, and `implement` workflow/posture/config triples.
- Extend `workflow-start-preparation.test.ts` structural guards to reject duplicate production prepared-step assembly outside the shared owner and pipeline adapter.
- Update durable docs listed below.
- Run full v2 verification.

## Acceptance criteria

- [x] `v2/src/daemon/pipeline-workflow-preparation-parity.test.ts` test `CLI and pipeline adapters produce byte-identical prepared steps for representative workflow postures` drives CLI and pipeline adapters through `prepareWorkflowStart` for representative `intent`, `plan`, and `implement` workflow/posture/config triples and asserts byte-identical step arrays; it fails against the pre-fix daemon assembly path in `pipeline-stage-resolve.ts`.
- [x] `v2/src/commands/workflow-start-preparation.test.ts` test `production prepared-step assembly lives only in shared preparation and the pipeline adapter` rejects a second production `prepareWorkflowStart` assembly path or duplicate unstamped preset-builder dispatch assembly in daemon pipeline resolution; it fails against the pre-fix duplicate assembly reachable on main before this spec lands.
- [x] `v2/src/commands/workflow.test.ts` — `run workflow implement sends start and wait IPC requests, blocks on completion, and prints run ID and wait JSON` stays green.
- [x] `v2/docs/daemon-host.md` documents that pipeline stages and CLI workflow starts share preparation, config resolution, stamping, and stale-reset semantics through `prepareWorkflowStart`.
- [x] `v2/docs/v2-architecture.md` documents that daemon pipeline dispatch consumes the shared workflow-start front door rather than daemon-local assembly.
- [x] `v2/docs/workflow-runner.md` documents pipeline posture selection and canonical project review-config ownership for implement stages.
- [x] `v2/docs/v1-behaviors.md` replaces daemon-local pipeline assembly and intent-only stale-reset behavior with shared-preparation dispatch semantics.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline stages and CLI workflow starts share preparation, config resolution, stamping, and stale-reset semantics.
- `v2/docs/v2-architecture.md` — daemon pipeline dispatch consumes the shared workflow-start front door.
- `v2/docs/workflow-runner.md` — pipeline posture and project review-config ownership.
- `v2/docs/v1-behaviors.md` — replace daemon-local pipeline assembly and intent-only stale-reset behavior.
