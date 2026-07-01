# Telemetry capture reference doc

## Problem

v2 splits orchestration state, observability loop events, and analysis facts across
three persistence roles, but no durable doc states where analysis facts live, how they
are emitted, which stable IDs join facts across stores, or what stays operator
judgment. Without this, future implementers re-key harness-known data through v1-style
CSV `notes` bindings (`plan_ns`, `patch_ns`, `git_fallback`).

Doc-only: no runtime sink, types, backfill, export commands, or analysis tooling.

## Decisions

- Durable home is `v2/docs/telemetry-capture.md` — rules out scattering the contract across architecture, step-runner, and outcome-audit docs.
- Three-store model: orchestration SQLite (`v2.sqlite`), observability log stream (`log-stream.ts`), injectable append-only telemetry JSONL — rules out token/cost in `v2.sqlite` or substituting observability loop events for analysis facts.
- Recovery reads orchestration store + git only; telemetry is never a resume source — rules out tailing `telemetry.jsonl` for harness recovery.
- Observability log and telemetry are separate consumers with distinct event kinds — rules out aliasing `boundary_committed` across both stores without distinct `record_kind` naming (telemetry: `work_boundary_recorded`).
- Facts carry `run_id` / `attempt_id` / `invocation_id` at emission — rules out v1-style `notes` binding as join keys.
- `record_kind` variants: `invocation_completed`, `work_boundary_recorded`, `run_terminal` — rules out a single undifferentiated event shape.
- Unavailable usage/cost emit keys with explicit `null` — rules out omitting keys and forcing "absent vs unavailable" query branching.
- Same telemetry schema across write, review-debate, and plan steps — rules out patch-only telemetry fork.
- Operator judgment columns (`success_status`, `overall_success`, `notes`, …) stay an annotation layer — rules out reconstructing them from harness facts.
- v1 `runs.jsonl` and CSV reports are legacy / derived-export targets — rules out backfill and CSV-as-capture-path.
- Default telemetry path under `~/.jarvis/` (e.g. `telemetry.jsonl`), injectable for tests — rules out a harness query API in capture v1.
- Cross-behavior coverage and harness-vs-judgment mapping cross-link `outcome-data-source-audit.md`; do not duplicate its classification tables — rules out a second audit copy in the primary doc.
- Build-order placement section names doc landing (this spec) vs runtime emitter milestones; pin emitter phases to first consumers, not ahead of them — rules out inventing phase numbers for unwired emitters.
- Testing contract describes injectable-path verification for future emitters; no new tests in this subspec — rules out speculating test file paths before emitters exist.
- Deferred to first consumer: one telemetry row per quota fallback vs aggregated invocation — pin when shared invocation emitter lands.
- Deferred to first consumer: boundary `files_changed` as path list vs count-only — pin when `work_boundary_recorded` emitter lands.

## Task checklist

- [ ] Add `v2/docs/telemetry-capture.md` with sections:
  - **Purpose** — analysis-fact contract; stable IDs; no `notes` re-keying.
  - **Three-store model** — orchestration SQLite, observability log, telemetry JSONL; recovery vs visibility vs analysis roles; cross-link `v2-architecture.md`, `state-store.md`, `log-stream.ts`.
  - **Event grains** — run, attempt/step, invocation; ID join keys (`run_id`, `attempt_id`, `invocation_id`).
  - **Record kinds and schema** — `invocation_completed`, `work_boundary_recorded`, `run_terminal`; shared envelope fields; explicit-null usage/cost keys; behavior-agnostic shape (write / review-debate / plan).
  - **Emission boundaries** — where each kind is emitted (shared invocation seam, step-runner/work boundary, run terminal); cross-link `shared-invocation.md`, `shared-step-runner.md`; observability log stays separate (`boundary_committed` ≠ `work_boundary_recorded`).
  - **Cross-behavior coverage** — same schema for all step behaviors; no patch-only fork.
  - **Operator session** — session/outcome sheets consume telemetry + judgment annotations; join by stable IDs not CSV `notes`.
  - **Harness vs operator judgment** — pointer to `outcome-data-source-audit.md` classifications; judgment columns remain annotation layer.
  - **v1 legacy mapping** — `runs.jsonl` / cost CSV as legacy derived-export targets; v1 `namespace`/`notes` bindings deprecated for v2 joins.
  - **Build-order placement** — doc contract (this spec); runtime sink deferred to first emitter consumers with named phase milestones from `v2-build-order.md`.
  - **Testing contract** — injectable path override; append-only JSONL; no recovery dependency; defer concrete test citations to emitter subspecs.
  - **Deferred implementation questions** — quota-fallback row grain; `files_changed` shape.
- [ ] Default telemetry path documented as `~/.jarvis/telemetry.jsonl` (or equivalent under `~/.jarvis/`), injectable for tests.
- [ ] State explicitly that this doc makes no runtime, backfill, or v1 harness change.

## Acceptance criteria

- [x] `v2/docs/telemetry-capture.md` exists and documents the three-store model (orchestration SQLite, observability log, telemetry JSONL) with recovery limited to orchestration + git.
- [x] The doc defines `record_kind` variants `invocation_completed`, `work_boundary_recorded`, and `run_terminal` with stable join IDs (`run_id`, `attempt_id`, `invocation_id`) at emission.
- [x] The doc states observability `boundary_committed` and telemetry `work_boundary_recorded` are distinct consumers and must not be aliased.
- [x] The doc requires explicit `null` for unavailable usage/cost keys and the same telemetry schema across write, review-debate, and plan steps.
- [x] The doc maps operator judgment columns to an annotation layer (not reconstructible from harness facts) and cross-links `outcome-data-source-audit.md` without duplicating its classification tables.
- [x] The doc classifies v1 `runs.jsonl` and cost CSV as legacy derived-export targets and rules out v1 `notes` bindings as v2 join keys.
- [x] The doc names default telemetry path under `~/.jarvis/` with injectable override for tests and records both deferred implementation questions from the intent.
- [x] The doc states no runtime sink, backfill, export command, analysis tooling, or v1 harness change in this deliverable.

## Documentation updates

- New durable doc `v2/docs/telemetry-capture.md` is the deliverable.
- No `v2/docs/v1-behaviors.md` update: net-new reference contract, no existing v1 behavior changes.
