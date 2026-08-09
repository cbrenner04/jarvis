# Terminal run finish on `list`

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`runListTerminalFinishAtMs` (`v2/src/daemon/daemon.ts:675`) reads attempt `completed_at` and `reconciledAt` only. A run driven terminal with no completion boundary and no reconciliation — spawn-boundary failure capture (`v2/src/daemon/daemon.ts:2226`), kill, any `setRunStatus` terminal write — now carries `runs.finished_at`, but `list` ignores that column and omits `finishedAtMs`. Observed: a dead run's TUI elapsed advancing 46m→49m across refreshes, and terminal-window/order logic treating the row as unfinishable.

## Decision ledger

- `runs.finished_at` joins attempt `completed_at` and `reconciledAt` as a third source of the same maximum, not a precedence chain — rules out a precedence order in which a stale attempt boundary shadows a later kill-time or re-settlement finish.
- The new source is a required third parameter on `runListTerminalFinishAtMs`, so every call site states it — rules out an optional parameter that silently keeps two-source behavior at a missed caller.
- No read-time fallback: a terminal row whose three durable sources are all null (pre-`023-run-finished-at` rows, never backfilled) keeps the field omitted — rules out synthesizing `createdAt`, which renders an elapsed spanning the whole run age.
- The wire field stays optional `finishedAtMs?: number` — rules out widening to `number | null`, which churns every TUI `=== undefined` consumer for no operator-visible gain.
- The terminal-status gate at the row builder (`isTerminalRunStatus(reportedStatus)`) is unchanged, so a resumed run still lists no finish; the store already clears `finished_at` on a non-terminal write.

## Prerequisites

- `Run.finishedAt` is projected by `RUN_COLUMNS`/`mapRunRow` and stamped by `setRunStatus` and `commitGuardedKill` (`v2/src/persistence/state-store.ts`).
- `buildRunListRow` derives `finishedAtMs` only for `isTerminalRunStatus(reportedStatus)` and spreads it in only when defined (`v2/src/daemon/daemon.ts:1420`).
- `seedTerminalRun` in `daemon-start-list.test.ts` creates its row through `createRun`'s `status` override, which stamps no finish, so existing reconciledAt-sourced tests keep their fixed expectations.

## Tasks

- `v2/src/daemon/daemon.ts`:
  - `runListTerminalFinishAtMs` gains a third parameter `runFinishedAt: number | null | undefined` and, after the `reconciledAt` block, `if (runFinishedAt != null) {` guarding `if (finishedAtMs === undefined || runFinishedAt > finishedAtMs) {` then `finishedAtMs = runFinishedAt;` — both conditions are mutation anchors and must stay one physical line each.
  - The `buildRunListRow` call site passes `fullRun.finishedAt`.
- `v2/src/daemon/daemon-wire.ts`: the `finishedAtMs` doc comment names the three sources and states it is present on every terminal row that carries a durable finish.
- Tests — `v2/src/daemon/daemon-start-list.test.ts`:
  - `a failed run with no completion boundary still reports finishedAtMs`: seed a run, record no attempt, leave `reconciledAt` null, `stateStore.setRunStatus(runId, "failed")`, assert the list row's `finishedAtMs` equals the loaded run's `finishedAt` and is a number, with `attempts` empty and `reconciledAt` null. Carries the keystone `// @mutate`.
  - `list reports finishedAtMs for every terminal run status`: one seeded run per `TERMINAL_RUN_STATUSES` member driven through `setRunStatus`, asserting each row's `finishedAtMs` is a number.
  - `list takes the run finish over a stale attempt completed_at`: record an attempt, patch its `completed_at` to `STALE_COMPLETED_AT`, then `setRunStatus(runId, "failed")`, assert the row reports the run's `finishedAt`, not the stale attempt value. Carries the maximum-guard `// @mutate`.
  - Update the existing `reconciledAt-only finish-time maximum guard inversion` call to the new arity (pass `null`); its expectations are unchanged.
- Docs per Documentation updates.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-start-list.test.ts` — `a failed run with no completion boundary still reports finishedAtMs` drives a run to `failed` with no attempt row and no `reconciledAt` and asserts the daemon `list` row reports a non-null `finishedAtMs` matching the durable run finish; it fails against the pre-fix code, which omits the field.
- [ ] `v2/src/daemon/daemon-start-list.test.ts` — `list reports finishedAtMs for every terminal run status` asserts a non-null `finishedAtMs` for each of `completed`, `failed`, `blocked`, `interrupted`, and `killed`, not `failed` alone.
- [ ] `v2/src/daemon/daemon-start-list.test.ts` — `list takes the run finish over a stale attempt completed_at` asserts the later run finish wins over an earlier attempt `completed_at`.
- [ ] `v2/src/daemon/daemon-start-list.test.ts` — `a failed run with no completion boundary still reports finishedAtMs`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/daemon/daemon.ts "if (runFinishedAt != null) {" -> "if (false) {"` inside the test body — baseline semantics where the durable run finish is not a list source — and the mutation turns that regression RED.
- [ ] `v2/src/daemon/daemon-start-list.test.ts` — `list takes the run finish over a stale attempt completed_at`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/daemon/daemon.ts "finishedAtMs === undefined || runFinishedAt > finishedAtMs" -> "finishedAtMs === undefined"` inside the test body — a run finish that only fills an empty slot instead of taking the maximum — and the mutation turns that regression RED.
- [ ] Existing `v2/src/daemon/daemon-start-list.test.ts` finish-time tests (`list sets finishedAtMs from reconciledAt when terminal row has no attempt completed_at`, `list sets finishedAtMs to later reconciledAt when attempt completed_at is stale`, `reconciledAt-only finish-time maximum guard inversion`) stay green; the last is updated for the new arity only.
- [ ] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` record that terminal `list` rows source `finishedAtMs` from the durable run finish as well as attempt `completed_at` and `reconciledAt`, and that no read-time fallback synthesizes one.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § RPC methods, `list` row — `finishedAtMs` is the maximum of non-null attempt `completed_at` values, non-null `reconciledAt`, and the durable run `finished_at`; it is reported for every terminal status (`completed`, `failed`, `blocked`, `killed`, `interrupted`) and omitted only while the run is non-terminal or when no durable source carries a finish (pre-`023-run-finished-at` rows, never backfilled). No read-time fallback synthesizes one from `createdAt`.
- `v2/docs/v1-behaviors.md` — update the existing terminal-`list`-`finishedAtMs` entry: the maximum now includes the durable run finish, so a run driven terminal by `setRunStatus` or a guarded kill (spawn-boundary failure capture, kill) reports a finish where it previously reported none.
