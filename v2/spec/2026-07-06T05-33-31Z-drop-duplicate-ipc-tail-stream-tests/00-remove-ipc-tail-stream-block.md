# Remove ipc.test.ts tail-stream block

`v2/src/ipc/ipc.test.ts` lines ~158–323 duplicate
`daemon-tail-stream.test.ts` scenario-for-scenario. Drop the IPC tail-stream
block and its helpers; keep the transport suite. `daemon-tail-stream.test.ts`
is the superset owner (replay, unknown-run, client `stream-end` abort, plus
missing/non-string `runId` guards).

Reverses the 2026-07-01 overlap decision in
[`00-migrate-ipc-tail-log-tests.md`](../completed/2026-07-01T04-18-24Z-ipc-tail-stream-use-real-handler/00-migrate-ipc-tail-log-tests.md)
that kept colocated IPC+tail integration in `ipc.test.ts`.

## Prerequisites

- Lean documentation-standard seeds landed (`2026-07-06T04-37-56Z`, `2026-07-06T04-37-57Z`).
- `daemon-tail-stream.test.ts` covers replay, unknown-run, and client `stream-end` abort for the three dropped ipc scenarios (plus missing/non-string `runId` guards not in the ipc block).

## Decisions

- Delete only the `ipc.test.ts` tail-stream block (~lines 158–323) and tail-only helpers/imports — rules out deleting `daemon-tail-stream.test.ts` or transport-level IPC coverage.
- `daemon-tail-stream.test.ts` owns tail-stream handler behavior — rules out re-homing dropped scenarios to a new file.
- Retire 2026-07-01 colocated ipc+tail overlap — lean standard (in-process default, capped socket budget) plus scenario-level duplication in `daemon-tail-stream.test.ts` — rules out keeping colocated integration for wire-path coverage alone.
- Dropped registration → surviving owner map lives in implementation PR body — rules out silent test-count shrink.
- `test-writing.md` line 94 stale ipc/`createTailStreamHandler` cross-ref must update; round-trip owners are `daemon-tail-stream.test.ts` and `tui-log-tail-client.test.ts` — rules out deferring doc alignment after reversing the 2026-07-01 pairing.
- Rewrite `ipc.test.ts` file-header lines 14–19 — remove `openLogReader`/`follow()` tail rationale; retain sandbox-unrunnable pointer to `daemon.sandbox-unrunnable.test.ts` — rules out conditional header tweak or leaving false `openLogReader` claims.
- Trim unused tail-only imports — rules out dead imports after deletion.
- Merged implementation drops duplicate ipc tail item from `v2/spec/seeds/02-v2-dead-weight-purge.md` — rules out double-landing the same deletion.

### Dropped → owner map

| Dropped (`ipc.test.ts`) | Owner (`daemon-tail-stream.test.ts`) |
| --- | --- |
| `tail-log stream replays persisted events in seq order` | `tail stream replays persisted events in seq order for known run` |
| `tail-log stream rejects unknown run ID` | `tail stream closes without stream-data for unknown runId` |
| `tail-log stream closes on client stream-end` | `tail stream aborts follow signal on client stream-end` |

## Tasks

- Remove tail-stream `socketTest` registrations, `LOGS_PATH`, and helpers (`seedRun`, `appendSampleEvents`, `createRunWithLogs`, `wrapLogReaderWithFollowSpy`, `withTailTest`, `startTailServer`, `withTailServer`) from `ipc.test.ts`.
- Remove imports used only by the tail block (`createTailStreamHandler`, `openLogReader`, `openLogSink`, `openStateStore`, `StateStore`).
- Rewrite file-header lines 14–19: drop `openLogReader`/`follow()` tail rationale; keep sandbox-unrunnable judgment pointing at `daemon.sandbox-unrunnable.test.ts`.
- Update `v2/docs/test-writing.md`: remove stale `ipc.test.ts`/`createTailStreamHandler` cross-ref (line 94); name `daemon-tail-stream.test.ts` and `tui-log-tail-client.test.ts` as surviving tail round-trip owners; leave in-process-default guidance (lines 92–93) unchanged.

## Acceptance criteria

- [x] `ipc.test.ts` has no tail-stream `socketTest` registrations or tail-only helpers/imports listed in Tasks.
- [x] `ipc.test.ts` transport `socketTest` registrations (`health RPC round-trips` through `server stays up after a malformed client disconnects`, lines 63–156) stay green.
- [x] `daemon-tail-stream.test.ts` stays green.
- [x] `test-writing.md` no longer claims `ipc.test.ts` exercises `createTailStreamHandler`; names `daemon-tail-stream.test.ts` and `tui-log-tail-client.test.ts` as tail round-trip owners.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Verification

- Implementation PR body lists all three dropped registrations with surviving `daemon-tail-stream.test.ts` owners per the table above.
- Baseline before drop: 481 registrations / 544 run cases.

## Documentation updates

- `v2/docs/test-writing.md`: remove stale `ipc.test.ts` exercising `createTailStreamHandler` through `startIpcServer` (line 94); name surviving tail round-trip owners (`daemon-tail-stream.test.ts`, `tui-log-tail-client.test.ts`). Leave in-process-default guidance (lines 92–93) unchanged.
