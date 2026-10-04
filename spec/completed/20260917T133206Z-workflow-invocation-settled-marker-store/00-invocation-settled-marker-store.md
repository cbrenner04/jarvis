# Invocation settled marker store

## Problem

No durable record says a workflow invocation finished; "settled" is derived from row-status max time plus per-daemon in-memory liveness, so a non-owning daemon sweeping the shared store cannot tell. The store needs a marker any daemon can read.

## Decisions

- New table `workflow_invocation_settled` (`entry_run_id TEXT PRIMARY KEY`, `cause TEXT NOT NULL`, `settled_at INTEGER NOT NULL`), created with `CREATE TABLE IF NOT EXISTS` in the baseline schema so stamped stores gain it on open; rules out a column on `runs` (marker is per invocation, not per row).
- Keyed by entry run id (`runs.id`), not `workflow_snapshot.invocationId` — the snapshot's `invocationId` is a separate `crypto.randomUUID()` minted per invocation (`v2/src/execution/workflow-runner.ts`) and can diverge from the entry run id (`workflow-runner-resume.ts` falls back `snapshot?.invocationId ?? run.id` for exactly this reason); matches the intent and the seed's `entry run` identity.
- No FK to `runs(id)`; Deferred to first consumer: FK/cascade behavior — pin when a caller needs it.
- Write is an upsert replacing both `cause` and `settled_at` (`ON CONFLICT DO UPDATE`); rules out `INSERT OR IGNORE`, which would keep the first cause.
- `cause` is `"completed" | "failed" | "killed"`; `settled_at` is supplied by the caller (Unix epoch ms), not stamped by the store, so tests are deterministic.
- Read returns `null` when absent; no backfill on open — rules out synthesizing markers for existing terminal invocations (would mass re-notify on upgrade).
- The new `StateStore` methods are required, not optional; existing partial/fake `StateStore` test doubles built with a bare `as StateStore` cast (e.g. `pipeline-execution.test.ts`, `daemon-pipeline-resume.test.ts`, `operator-notification-sweep.test.ts`) get stub methods added if the new members push them past TypeScript's structural-overlap threshold for that cast — rules out making the methods optional, which would weaken the interface for every future caller.
- Migration coverage builds a fixture already stamped `031-baseline-squash` (holding runs, no `workflow_invocation_settled` table) — distinct from `state-store-baseline-migration.test.ts`'s existing `createPreSquashFixtureDb`, which stamps only pre-squash migration ids and exercises the legacy-upgrade path, not the already-baselined open path this intent targets.
- Deferred to first consumer: list/bulk read shape for the sweep — pin when a caller needs it.

## Acceptance criteria

- [x] `v2/src/persistence/state-store.ts` exposes `StateStore` ops to write and read the settled marker for an entry run id (cause + settled time), returning `null` when none exists.
- [x] A test in `v2/src/persistence/state-store.test.ts` writes a marker and reads back its cause and settled time; it fails against the pre-change store.
- [x] A test in `v2/src/persistence/state-store.test.ts` writes a second marker with a different cause and a different settled time than the first write, and asserts both the cause and settled time are replaced with the second write's values.
- [x] A test in `v2/src/persistence/state-store-baseline-migration.test.ts` opens a store already stamped `031-baseline-squash` and holding runs, built without the `workflow_invocation_settled` table, and asserts the table exists afterward with no markers for those invocations.
- [x] A second `StateStore` opened on the same database file reads a marker written by the first (covered in `v2/src/persistence/state-store.test.ts`).
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/state-store.md`: add the `workflow_invocation_settled` table to `## Schema` (keying, cause vocabulary, replace-on-rewrite, no backfill on open).

## Blocker

`bun run ready` → `bun run check` fails: 61 pre-existing `bun biome check .` warnings plus a `guard-dead-exports` hit, spanning ~30 files this subspec never touches (`shared/prompts/*.ts`, `v2/src/commands/*.test.ts`, `v2/src/daemon/*.ts`, `v2/src/execution/*.ts`, `v2/src/tui/*.ts`, `scripts/guard-unbounded-subprocess.test.ts`). Confirmed present identically on `main` at `31eaa79db` (checked out `/Users/christopherbrenner/Work/jarvis`, clean tree, same 61 warnings) — this branch's merge-base is the older `48aa6cb5c`; main advanced past it with this lint debt already in place. Fixed the one item this subspec actually caused: `WorkflowInvocationSettledCause`/`WorkflowInvocationSettledMarker` in `v2/src/persistence/state-store.ts` were exported but had no consumer outside the file (spec defers the first consumer), tripping `guard-dead-exports`; de-exported both (module-internal use only, no cross-file import needed). The remaining ~30-file lint debt is out of this subspec's scope to fix (would bundle unrelated, speculative changes across the codebase) — needs a separate cleanup pass on `main` before any subspec's `bun run ready` can go green again.
