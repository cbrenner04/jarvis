# F3 — `work_boundary_recorded` telemetry at the completion boundary

Telemetry slice F3 from `v2/docs/telemetry-capture.md` (record kind
`work_boundary_recorded`) and `v2/docs/v2-build-order.md` (Cross-cutting →
Telemetry, gated on **Phase 8**). Emits work facts (commit SHA, files-changed
count) for analysis history once the v2 runner produces a real harness commit.

## Problem

`v2/docs/telemetry-capture.md` defines a `work_boundary_recorded` record emitted
at `commitCompletionBoundary` with the git facts of the completed work, but no
runtime emitter exists. Grep for `work_boundary|commit_sha|files_changed` across
`v2/src` and `shared/` returns nothing. The record is scheduled for Phase 8
because its payload (`commit_sha`, `files_changed`) has no source until the
Phase 8 harness commit exists — the boundary hook (`commitCompletionBoundary`,
`v2/src/execution/write-loop.ts`) is already wired, but today it carries only
SQLite bookkeeping, no git commit.

## Direction

Mirror the F1 emitter pattern (`shared/invocation/execute.ts`, doc
`v2/docs/shared-invocation.md`): an injectable JSONL sink modeled on
`InvocationTelemetrySink`, a context struct that threads the already-stamped IDs
(no log re-parsing), a `createWorkBoundaryRecordedRecord(...)` builder, and
append-failure isolation (a sink `append` failure is surfaced separately and does
**not** change control flow).

Attach the emitter at the write-loop / workflow-runner call sites around
`store.commitCompletionBoundary(...)` — the boundary layer **above** git and
**below** the runner, **not** inside `state-store.ts` (telemetry must never live
in the orchestration store API). Emit to the telemetry store
(`~/.jarvis/telemetry.jsonl`, injectable) — never the observability `logs.jsonl`
(which already gets the sibling `boundary_committed` event; do not alias the two
kinds) and never the orchestration SQLite.

## Decisions

- One `work_boundary_recorded` row per completion boundary that produces a commit.
- Envelope `{ schema_version: 1, record_kind: "work_boundary_recorded", ts }`
  plus required fields `run_id`, `attempt_id`, `outcome_kind`, `run_status`,
  `commit_sha`, `files_changed`. Attempt-grain fact: carries `run_id` +
  `attempt_id` but **not** `invocation_id` (a boundary spans the whole attempt).
- `files_changed` is a **count** (path-list shape is the deferred pin in
  `telemetry-capture.md` §"Deferred implementation questions" — resolve here as
  count; note the deferral in the spec).
- `commit_sha`/`files_changed` come from the Phase 8 harness commit facts, not
  the agent. Consume them from the boundary layer that just created the commit.

## Out of scope

- F4 export commands (post-parity).
- Any change to the orchestration store or the `boundary_committed` observability
  event.

## Prerequisites (dependency)

- Phase 8 behavior 1 (harness commit at the completion boundary, producing a
  `commit_sha`) is committed on `main`. Without it there is no commit fact to
  record.

## Documentation updates

- `v2/docs/telemetry-capture.md`: resolve the `files_changed` count-vs-path-list
  deferred pin for `work_boundary_recorded` (count), and mark the slice
  implemented.
