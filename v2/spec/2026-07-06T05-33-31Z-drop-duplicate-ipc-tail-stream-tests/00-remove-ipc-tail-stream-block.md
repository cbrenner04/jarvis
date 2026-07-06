# Remove ipc.test.ts tail-stream block

`v2/src/ipc/ipc.test.ts` lines ~158–323 duplicate
`daemon-tail-stream.test.ts` scenario-for-scenario. Drop the IPC tail-stream
block and its helpers; keep the transport suite. `daemon-tail-stream.test.ts`
is the superset owner (replay, unknown-run, client `stream-end` abort, plus
missing/non-string `runId` guards).

Reverses the 2026-07-01 overlap decision in
[`00-migrate-ipc-tail-log-tests.md`](../completed/2026-07-01T04-18-24Z-ipc-tail-stream-use-real-handler/00-migrate-ipc-tail-log-tests.md)
that kept colocated IPC+tail integration in `ipc.test.ts`.

## Decisions

- Delete only the `ipc.test.ts` tail-stream block (~lines 158–323) and tail-only helpers/imports — rules out deleting `daemon-tail-stream.test.ts` or transport-level IPC coverage.
- `daemon-tail-stream.test.ts` owns tail-stream handler behavior — rules out re-homing dropped scenarios to a new file.
- Dropped registration → surviving owner map lives in the implementation PR body — rules out silent test-count shrink.
- No `v2/docs/` or `v1-behaviors.md` edits — test dedup only; `test-writing.md` already names in-process handler tests as default — rules out follow-on doc alignment for a stale `ipc.test.ts`/`createTailStreamHandler` cross-reference.
- Trim unused imports and the file-header comment tail-stream claims if no longer true after deletion — rules out leaving dead imports or misleading header prose.

### Dropped → owner map (PR body must reproduce)

| Dropped (`ipc.test.ts`) | Owner (`daemon-tail-stream.test.ts`) |
| --- | --- |
| `tail-log stream replays persisted events in seq order` | `tail stream replays persisted events in seq order for known run` |
| `tail-log stream rejects unknown run ID` | `tail stream closes without stream-data for unknown runId` |
| `tail-log stream closes on client stream-end` | `tail stream aborts follow signal on client stream-end` |

Baseline before drop: 481 registrations / 544 run cases.

## Tasks

- Remove tail-stream `socketTest` registrations, `LOGS_PATH`, and helpers (`seedRun`, `appendSampleEvents`, `createRunWithLogs`, `wrapLogReaderWithFollowSpy`, `withTailTest`, `startTailServer`, `withTailServer`) from `ipc.test.ts`.
- Remove imports used only by the tail block (`createTailStreamHandler`, `openLogReader`, `openLogSink`, `openStateStore`, `StateStore`).
- Update the file-header comment if it still claims tail/`openLogReader` coverage this file no longer exercises.
- Paste the dropped→owner table into the implementation PR body.

## Acceptance criteria

- [ ] `ipc.test.ts` has no tail-stream `socketTest` registrations or tail-only helpers/imports listed in Tasks.
- [ ] `ipc.test.ts` transport-suite tests stay green (behavior unchanged for RPC/codec coverage).
- [ ] `daemon-tail-stream.test.ts` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] Implementation PR body lists all three dropped registrations with their surviving `daemon-tail-stream.test.ts` owners per the table above.

## Documentation updates

None.
