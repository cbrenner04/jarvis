# Terminal run finish on list

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

Daemon `list` derives terminal `finishedAtMs` only from attempt `completedAt` and run `reconciledAt`. A run failed through `setRunStatus` without a completion boundary has durable `finishedAt` but reaches the wire without `finishedAtMs`.

## Decision ledger

- `runListTerminalFinishAtMs` takes durable run `finishedAt` and returns the maximum non-null value across it, attempt `completedAt`, and `reconciledAt`. Rules out preferring one source and reporting an earlier finish than another durable transition recorded.
- Terminal rows derive `finishedAtMs` only from durable finish sources; no `createdAt` or read-clock fallback. Rules out masking missing persistence and making a historical row's finish change between reads.
- The non-null guarantee covers rows whose terminal status was written through a current durable terminal transition. Legacy/unbackfilled rows and rows created terminal without that transition remain allowed to omit `finishedAtMs`. Rules out an unsound universal promise without a migration or read-time fallback.
- Non-terminal rows continue to omit `finishedAtMs`, even if malformed legacy data carries a finish source. Rules out exposing stale terminal timing after resume.
- No TUI rendering or aggregation change. Rules out coupling the daemon wire guarantee to later elapsed/work-idle work.

## Prerequisites

- `Run.finishedAt` is loaded from `runs.finished_at`; `setRunStatus` and `commitGuardedKill` stamp it on current terminal writes while completion and reconciliation retain their existing finish sources.
- `buildRunListRow` calls `runListTerminalFinishAtMs` only when the reported status is terminal.

## Tasks

- Update `v2/src/daemon/daemon.ts` so `runListTerminalFinishAtMs(attempts, reconciledAt, finishedAt)` folds the run finish timestamp into the existing latest-durable-finish calculation and `buildRunListRow` passes `fullRun.finishedAt`; keep the unique source guard as `if (finishedAt != null) {` for the mutation anchor.
- Add `daemon-start-list.test.ts` regression coverage for a `failed` run settled without an attempt completion or reconciliation timestamp, every current terminal transition, each of the three durable finish sources winning when latest, and non-terminal omission retained.
- Update the `DaemonListRunRow.finishedAtMs` inline contract only as needed to match the durable-source and terminal-presence semantics; do not add TUI behavior.
- Apply the Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-start-list.test.ts` — `a failed run with no completion boundary still reports finishedAtMs` drives the run through the durable failure transition with no attempt `completedAt` and no `reconciledAt`, asserts `list.finishedAtMs` equals the loaded run's non-null `finishedAt`, and fails against the pre-fix projection.
- [x] `v2/src/daemon/daemon-start-list.test.ts` — `every current terminal run transition reports finishedAtMs and non-terminal status omits it` covers `completed`, `failed`, `blocked`, `killed`, and `interrupted` through their durable finish paths, asserts a non-terminal row omits the field, and makes no promise for legacy/unbackfilled or terminal-at-creation rows.
- [x] `v2/src/daemon/daemon-start-list.test.ts` — `runListTerminalFinishAtMs selects the latest durable finish source` makes run `finishedAt`, attempt `completedAt`, and `reconciledAt` independently latest and asserts each wins over the other two.
- [x] `v2/src/daemon/daemon-start-list.test.ts` — `a failed run with no completion boundary still reports finishedAtMs`; Keystone checkpoint: its test body carries `// @mutate v2/src/daemon/daemon.ts "if (finishedAt != null) {" -> "if (false) {"`, reverting the new durable run-finish source to baseline behavior, and the mutation turns the regression RED.
- [x] `v2/src/daemon/daemon-start-list.test.ts` — `a failed run with no completion boundary still reports finishedAtMs`; Mutation checkpoint: the linked source-guard inversion suppresses the run-level finish while leaving attempt and reconciliation sources intact, and the mutation turns the regression RED.
- [x] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` describe non-null `finishedAtMs` for terminal rows written by current durable transitions, its latest durable finish sources, and the deliberate exclusion of legacy/unbackfilled and terminal-at-creation rows.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § RPC methods `list` row — `finishedAtMs` is present and non-null for terminal statuses reached through current durable transitions, sourced from the latest durable run/attempt/reconciliation finish; legacy/unbackfilled and terminal-at-creation rows are not backfilled by projection.
- `v2/docs/v1-behaviors.md` — record that daemon `list` now projects the durable run finish source for current terminal transitions, so those rows no longer omit `finishedAtMs` when attempts and reconciliation carry none.
