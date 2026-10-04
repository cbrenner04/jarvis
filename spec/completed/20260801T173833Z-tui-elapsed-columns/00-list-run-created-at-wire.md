# List run createdAt wire

Project durable run `createdAt` onto daemon `list` rows so the TUI can render run elapsed without
inferring start time from attempts or workflow metadata.

## Problem

`DaemonListRunRow` omits `createdAt` even though every durable run row has `created_at`. Run-level
elapsed in `jarvis tui` cannot start from an honest wire field.

## Prerequisites

- Durable runs expose `createdAt` on `StateStore` list/load paths (`v2/src/persistence/state-store.ts`).

## Decisions

- `list` adds required `createdAt: number` (ms since epoch) on every row, copied from the durable run
  record — rules out optional/omitted projection or deriving start from attempt `startedAt`.
- Out of scope: elapsed formatting, TUI rendering, local display tick — sibling subspecs
  [01](./01-elapsed-duration-formatter.md) and [02](./02-tui-elapsed-columns-render-and-local-tick.md).

## Tasks

- Extend `DaemonListRunRow` in `daemon-wire.ts` and `buildRunListRow` in `daemon.ts`; update
  `DaemonListRunRow` fixtures repo-wide (typecheck and `test:v2` catch omissions, but expect broad
  literal churn beyond the new pin test).
- Add `list projects durable createdAt on every run row` in `daemon-start-list.test.ts` with a
  seeded `created_at` and strict row expectation.
- Add `Mutation checkpoint:` on that pin for omitting `createdAt` from `buildRunListRow`.
- Update `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` for the `list` row field list.

## Acceptance criteria

- [x] `daemon-start-list.test.ts` — `list projects durable createdAt on every run row` fails against the pre-fix projection and passes after implementation; pin asserts the durable `created_at` value on the wire row.
- [x] `daemon-start-list.test.ts` — omitting `createdAt` from `buildRunListRow` turns `list projects durable createdAt on every run row` RED; `Mutation checkpoint:` on that pin names `createdAt` omission.
- [x] `v2/docs/daemon-host.md` — `list` run rows include `createdAt`.
- [x] `v2/docs/v1-behaviors.md` — daemon `list` row shape includes `createdAt`.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `list` run rows include `createdAt`.
- `v2/docs/v1-behaviors.md` — daemon `list` row shape includes `createdAt`.
