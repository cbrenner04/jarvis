---
name: telemetry-capture
---

# v2 telemetry capture reference contract

Document where v2 analysis facts live, how they are emitted at code boundaries, which stable IDs join facts across stores, and what stays operator judgment — so future implementers never re-key harness-known data through CSV `notes` bindings.

Doc-only: no runtime sink, types, backfill, export commands, or analysis tooling.

## Scope

- New durable home `v2/docs/telemetry-capture.md` per seed outline (three-store model, event grains, record kinds/schema, emission boundaries, cross-behavior coverage, operator session, harness-vs-judgment mapping, v1 legacy mapping, build-order placement, testing contract, deferred implementation questions).
- Cross-links only (no schema duplication): `v2-architecture.md`, `v2-build-order.md`, `shared-step-runner.md`, `shared-invocation.md`, `state-store.md`, `outcome-data-source-audit.md`; optional one-line pointer in `v2-vision.md` if natural.

## Out of scope

- Runtime code, backfill/migration, v1 harness changes, analysis UI/query layer, orchestration SQLite schema for token/cost, extending observability log stream with invocation telemetry.

## Decisions

- Third persistence role is injectable append-only telemetry JSONL — rules out token/cost in `v2.sqlite` or substituting observability loop events for analysis facts.
- Recovery reads orchestration store + git only; telemetry is never a resume source — rules out tailing `telemetry.jsonl` for harness recovery.
- Observability log and telemetry are separate consumers with distinct event kinds — rules out aliasing `boundary_committed` across both stores without distinct `record_kind` naming (telemetry: `work_boundary_recorded`).
- Facts carry `run_id` / `attempt_id` / `invocation_id` at emission — rules out v1-style `notes` binding (`plan_ns`, `patch_ns`, `git_fallback`) as join keys.
- `record_kind` variants: `invocation_completed`, `work_boundary_recorded`, `run_terminal` — rules out a single undifferentiated event shape.
- Unavailable usage/cost emit keys with explicit `null` — rules out omitting keys and forcing "absent vs unavailable" query branching.
- Same telemetry schema across write, review-debate, and plan steps — rules out patch-only telemetry fork.
- Operator judgment columns (`success_status`, `overall_success`, `notes`, …) stay an annotation layer — rules out reconstructing them from harness facts.
- v1 `runs.jsonl` and CSV reports are legacy / derived-export targets — rules out backfill and CSV-as-capture-path.
- Default telemetry path under `~/.jarvis/` (e.g. `telemetry.jsonl`), injectable for tests — rules out a harness query API in capture v1.
- Deferred to first consumer: one telemetry row per quota fallback vs aggregated invocation — pin when shared invocation emitter lands.
- Deferred to first consumer: boundary `files_changed` as path list vs count-only — pin when `work_boundary_recorded` emitter lands.

## Documentation updates

- [ ] `v2/docs/telemetry-capture.md` — primary deliverable.
- [ ] `v2/docs/v2-architecture.md` — Persistence / Observability: third-store paragraph + link.
- [ ] `v2/docs/v2-build-order.md` — cross-cutting telemetry bullet with phase milestones.
- [ ] `v2/docs/shared-step-runner.md` — emission-boundary pointer.
- [ ] `v2/docs/state-store.md` — telemetry stays out cross-link.
- [ ] `v2/docs/outcome-data-source-audit.md` — forward link to v2 capture contract.

## Prerequisites

- v2 architecture documents orchestration vs observability persistence split; token/cost streams stay out of orchestration SQLite.
- State store schema and API boundaries are documented.
- Structured observability log stream emits loop lifecycle events (`v2/src/log-stream.ts`).
- Outcome data source audit classifies v1 outcome columns as already-logged, derivable, or operator judgment.
- v2 build-order phases are numbered for sequencing guidance.
- Shared invocation layer executes agent subprocesses through a documented seam (emission not yet wired).
