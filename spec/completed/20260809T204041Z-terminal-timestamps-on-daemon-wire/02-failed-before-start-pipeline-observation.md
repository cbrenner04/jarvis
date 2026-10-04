# Failed-before-start pipeline observation

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`settleUnexpectedThrow` can fail a stage before entry-run admission. The intended durable shape is `failed` with `endedAt` and no `startedAt`, but the producer-to-`pipeline_list` seam is not pinned end to end.

## Decision ledger

- A throw before entry-run admission settles `failed` with numeric `endedAt`, no `startedAt`, and no workflow linkage; this is a legitimate failed-before-start shape. Rules out inventing a start timestamp to make elapsed time renderable.
- `pipeline_list` projects the stored shape unchanged: terminal status, non-null `endedAt`, and `startedAt: null`. Rules out a projection-only test that misses the actual producer or a producer-only test that misses the wire.
- The `endedAt` invariant concerns terminal stage-run statuses; this failed write is in scope because it is `failed`, while approval decisions remain excluded.
- No TUI rendering or elapsed aggregation change. Rules out absorbing later observation-consumer work into this producer-to-wire slice.

## Prerequisites

- `settleUnexpectedThrow` handles a throw before entry-run admission and never writes `startedAt`.
- `projectPipelineSnapshot` projects durable `startedAt` and `endedAt` without following live transitions.

## Tasks

- Audit `settleUnexpectedThrow` in `v2/src/daemon/pipeline-stage-dispatch.ts` and retain its explicit failed-before-start write: `status: "failed"`, `endedAt`, no `startedAt`, and no workflow linkage.
- Add integrated `daemon-pipeline-observation.test.ts` coverage that makes a real pre-admission dispatch throw, reads the durable `StateStore` row, calls daemon `pipeline_list`, and compares both shapes.
- Apply the Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-pipeline-observation.test.ts` — `pipeline_list preserves the failed-before-start stage from a pre-admission throw` drives a real dispatch throw before entry-run admission through durable storage and `pipeline_list`, asserts both the stored and wire rows are `failed` with numeric `endedAt`, `startedAt: null`, and no workflow linkage, and fails against a producer or projection that invents a start or loses the terminal finish.
- [x] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` describe the failed-before-start `pipeline_list` shape: non-null `endedAt`, `startedAt: null`, and no synthesized start.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § RPC methods `pipeline_list` row and § Pipeline stage dispatch — a pre-admission throw produces a failed-before-start stage with non-null `endedAt`, `startedAt: null`, and no workflow linkage; no start is synthesized.
- `v2/docs/v1-behaviors.md` — record the unchanged null `startedAt` projection for a durable failure before admission.
