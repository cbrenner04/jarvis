# 00 — Durable state store (first rows)

Stand up the SQLite store the architecture specifies, but only the columns the
write-loop resume path reads. The write loop (01) and resume (02) are its
consumers; nothing here is built ahead of them.

## Decisions

- Store at `~/.jarvis/state/v2.sqlite`; a library-owned bootstrap opens that
  file or a caller-supplied path override (tests/temp), and applies forward-only
  idempotent migrations before any repository op is exposed. Rules out a
  daemon-owned store assuming single-writer lock/WAL — host-agnostic now, daemon
  tuning is later.
- Use `bun:sqlite` (no external dependency). Rules out adding a third-party
  driver for a hermetic, single-process store.
- Repository-style named operations keyed by durable IDs; no generic SQL/query
  surface is public. Rules out a generic query layer callers address with raw
  SQL.
- Single transactional completion boundary: attempt completion + outcome
  durability + checkpoint/attempt-count advance commit or roll back as one unit,
  and re-committing a finished boundary is idempotent. Rules out three separate
  writes that can partially apply on crash and a retry that double-advances.
- Column set is driven only by what resume reads. `runs` carries an attempt
  count for history/idempotency, not a remaining-iterations column — budget is
  per-invocation (see 01). Rules out persisting a global remaining-budget that
  resume decrements.
- Status carries only the states Phase 2 produces and reads (in-progress/
  interrupted, completed, blocked, budget-soft-stopped). Rules out modelling
  paused/awaiting-human/killed/queued ahead of their Phase 3/6/7 consumers.

Deferred to first consumer: a `next_step_id` checkpoint column — a single-step
loop has no step graph, so the checkpoint here is run terminal status + attempt
count; pin `next_step_id` when the Phase 5 runner needs it.

## Task checklist

- [ ] Add a state-store module under `v2/src` (e.g. `state-store.ts`) using
  `bun:sqlite`; bootstrap opens the default path or an override and runs
  migrations before exposing any op.
- [ ] Forward-only, idempotent migrations applied at open.
- [ ] `runs` table: identity (run ID, project, spec/target ref, created-at),
  status, checkpoint pointer (terminal status + attempt count), and work
  pointers (worktree path, branch, spec path) — not their contents.
- [ ] Attempt/outcome rows linked to the run by durable ID: timestamps, terminal
  status, outcome classification. No transcripts, no token/cost streams.
- [ ] Named ops: create a run; record an attempt/iteration start; commit a
  completion boundary (transactional + idempotent); load a run for resume (run +
  attempt history).
- [ ] Keep SQL text, row mappers, and migration helpers internal; the public
  surface is named ops over durable IDs/typed rows.
- [ ] Co-located tests against a temp/override path.

## Acceptance criteria

- [ ] A state module in `v2/src` opens `~/.jarvis/state/v2.sqlite` by default and
  a caller-supplied path override; tests use the override and write nothing under
  `~/.jarvis`.
- [ ] Migrations are forward-only and idempotent: re-opening an already-migrated
  store is a no-op (test).
- [ ] Repository ops (create run, record attempt start, commit boundary, load run
  for resume) are exposed as named ID-keyed operations; no generic SQL surface is
  public.
- [ ] The completion boundary persists attempt completion + outcome + checkpoint/
  attempt-count advance atomically; a forced failure mid-boundary rolls all of it
  back (test).
- [ ] Re-committing an already-finished boundary is idempotent: no double
  attempt-count or checkpoint advance, no duplicate outcome row (test).
- [ ] `runs` carries an attempt count, not a remaining-iterations column.
- [ ] New code lives under `v2/**`/`shared/**` with no `v2 -> v1` imports.
- [ ] `bun run typecheck` (both tsconfigs) and `bun test` pass.

## Documentation updates

- New `v2/docs/state-store.md`: location `~/.jarvis/state/v2.sqlite`, the `runs`
  + attempt/outcome shape, bootstrap + idempotent migrations, the repository-op
  surface, and the transactional boundary. Cross-link the architecture
  Persistence/Runs sections; do not restate them.
- `v2/docs/write-behavior.md`: add a pointer to `state-store.md` next to the
  Phase 1 worktree-layout note.
- `v2/docs/v1-behaviors.md`: no change — additive v2-only code.
