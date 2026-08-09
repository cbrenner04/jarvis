# Terminal run finish time on `list`

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`runListTerminalFinishAtMs` (`v2/src/daemon/daemon.ts:675`) reads only attempt `completed_at` and `reconciledAt`, and `buildRunListRow` omits `finishedAtMs` when it returns `undefined`. The store's third durable finish source — `runs.finished_at`, stamped by `setRunStatus` and `commitGuardedKill` — never reaches the wire. A run driven terminal through the spawn-boundary failure shape (`setRunStatus(runId, "failed")`, no attempt row, no `reconciledAt`) therefore lists as having no finish time, and every consumer that reads elapsed from `createdAt → finishedAtMs` renders a dead run's clock advancing forever (observed 46m→49m across refreshes).

## Decision ledger

- `finishedAtMs` on a terminal `list` row is the maximum of the three durable sources (attempt `completed_at`, `reconciledAt`, run `finishedAt`) — rules out picking one source, which is what leaves the spawn-boundary shape unfinished.
- `runListTerminalFinishAtMs` returns `number`, not `number | undefined`: the caller has no omission branch left for a terminal row — rules out leaving the field optional at the source and re-introducing the omission at a later call site.
- When every durable source is absent, the row reports `createdAt` — a lower bound, not a synthesized finish. Reachable today: `createRun({ status: "killed" })` admits a terminal row with no attempt, no `reconciledAt`, and no `finished_at` (the `seedTerminalRun` helper in `daemon-start-list.test.ts`), as do pre-`023-run-finished-at` rows. Rules out continuing to omit the field on that shape, and mirrors `derivePipelineFinishedAtMs`'s existing `createdAt` floor.
- Non-terminal rows still omit `finishedAtMs`; the wire field stays optional.
- The `isTerminalRunStatus(reportedStatus) && fullRun !== undefined` gate at the call site is unchanged — a row with no loaded run still omits the field.

## Prerequisites

- `Run.finishedAt` is selected by `RUN_COLUMNS` and stamped on terminal `setRunStatus` / `commitGuardedKill` writes (`v2/src/persistence/state-store.ts`).
- `LoadedRun` (`v2/src/daemon/daemon.ts:761`) carries `attempts`, `reconciledAt`, `finishedAt`, and `createdAt`.
- `TERMINAL_RUN_STATUSES` and `isTerminalRunStatus` are exported from `v2/src/persistence/state-store.ts`.

## Tasks

- `v2/src/daemon/daemon.ts`:
  - `runListTerminalFinishAtMs` takes one object — `{ attempts: Array<{ completedAt: number | null }>; reconciledAt?: number | null; finishedAt?: number | null; createdAt: number }`, with `reconciledAt` and `finishedAt` declared optional so a `LoadedRun` is assignable directly — and returns `number`.
  - Body keeps these two lines each on one physical line (mutation anchors): `const durableFinishes = [...run.attempts.map((attempt) => attempt.completedAt), run.reconciledAt, run.finishedAt];` and `return latest ?? run.createdAt;`, with a `latest` fold over `durableFinishes` skipping `null`/`undefined` between them.
  - `buildRunListRow` calls `runListTerminalFinishAtMs(fullRun)`; the spread stays `...(finishedAtMs !== undefined ? { finishedAtMs } : {})` so non-terminal rows still omit.
- Tests — `v2/src/daemon/daemon-start-list.test.ts`:
  - `a failed run with no completion boundary still reports finishedAtMs`: seed an `in-progress` run, back-date `created_at` to `SEEDED_CREATED_AT`, `stateStore.setRunStatus(runId, "failed")`, assert the list row's `finishedAtMs` equals the loaded run's `finishedAt` and is greater than `createdAt`. Carries the keystone `// @mutate`.
  - `a terminal run with no durable finish source reports createdAt as its finish time`: bare `seedTerminalRun()` (killed at admission, no attempt, no `reconciledAt`, no `finished_at`), back-date `created_at`, assert `finishedAtMs` is `SEEDED_CREATED_AT`. Carries the floor-guard `// @mutate`.
  - `every terminal run status reports a finishedAtMs on list`: one seeded run per `TERMINAL_RUN_STATUSES` member driven through `setRunStatus`, each list row's `finishedAtMs` a number.
  - Update the existing `runListTerminalFinishAtMs` call sites in this file (`reconciledAt-only finish-time maximum guard inversion`, line ~926) to the object signature; the reconciledAt-maximum tests keep asserting the same values.
- Docs per Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-start-list.test.ts` — `a failed run with no completion boundary still reports finishedAtMs` drives a run to `failed` through `setRunStatus` with no attempt row and no `reconciledAt` and asserts the daemon `list` row carries the durable run `finishedAt`; it fails against the pre-fix code, which omits `finishedAtMs` on that shape.
- [ ] `v2/src/daemon/daemon-start-list.test.ts` — `every terminal run status reports a finishedAtMs on list` asserts a non-null `finishedAtMs` for every `TERMINAL_RUN_STATUSES` member, not only `failed`.
- [ ] `v2/src/daemon/daemon-start-list.test.ts` — `a terminal run with no durable finish source reports createdAt as its finish time` asserts a terminal row admitted with no attempt, no `reconciledAt`, and no run `finishedAt` reports `createdAt` rather than omitting the field.
- [ ] `v2/src/daemon/daemon-start-list.test.ts` — `a failed run with no completion boundary still reports finishedAtMs`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/daemon/daemon.ts "const durableFinishes = [...run.attempts.map((attempt) => attempt.completedAt), run.reconciledAt, run.finishedAt];" -> "const durableFinishes = [...run.attempts.map((attempt) => attempt.completedAt), run.reconciledAt];"` inside the test body — baseline semantics where the durable run finish stamp never reaches the wire — and the mutation turns that regression RED.
- [ ] `v2/src/daemon/daemon-start-list.test.ts` — `a terminal run with no durable finish source reports createdAt as its finish time`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/daemon/daemon.ts "return latest ?? run.createdAt;" -> "return latest as number;"` inside the test body — a terminal row with no durable source falling back to no finish time — and the mutation turns that regression RED.
- [ ] `v2/src/daemon/daemon-start-list.test.ts` — `list sets finishedAtMs from reconciledAt when terminal row has no attempt completed_at` and `list sets finishedAtMs to later reconciledAt when attempt completed_at is stale` stay green (source precedence unchanged by the added source).
- [ ] `v2/src/tui/tui-monitor-terminal-window.test.ts` — `keeps terminal rows with omitted finishedAtMs in the live window` stays green (the helper's omitted-input branch is unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § RPC table `list` row — `finishedAtMs` is present on every terminal-status row: the maximum of non-null attempt `completed_at`, `reconciledAt`, and run `finished_at`, falling back to `createdAt` when no durable source carries one; it is omitted only while the run is non-terminal (or no durable run row loaded), replacing the "omitted when neither source has a finish timestamp" sentence.
- `v2/docs/v1-behaviors.md` — record that `list` now reports `finishedAtMs` for every terminal run status, sourced from run `finished_at` in addition to attempt `completed_at` and `reconciledAt`, with a `createdAt` floor; consequence: terminal rows no longer sit permanently inside consumers' live windows through an omitted finish time. Amend the existing entry stating terminal list `finishedAtMs` is the maximum of attempt `completed_at` and `reconciledAt`.
