# Replace field-by-field PersistedRecord validation with an envelope check

`parsePersistedRecord` in `v2/src/tui/tui-log-tail-client.ts` validates `runId`, `seq`, `ts`, and `event.kind` on every `stream-data` frame. The payload is always a `PersistedRecord` the daemon itself persisted and serialized, so full field validation is dead weight — trust the shared `PersistedRecord` type past a thin envelope check.

## Decisions

- Envelope check: parsed JSON is an object with a `runId` string and an `event` object; nothing more.
- `tui-log-tail-client.test.ts` has no existing coverage fabricating field-level defects (bad `seq`/`ts`/`event.kind`) — only a JSON-parse-failure case exists today and is unaffected; add new tests covering the narrowed envelope check itself.

## Out of scope

- `daemon-wire.ts`, `tui-daemon-client.ts`, `cli.ts`.

## Task checklist

- [x] Narrow `parsePersistedRecord` to the envelope check (`runId` string, `event` object) and trust the rest via `PersistedRecord`.
- [x] Add tests in `tui-log-tail-client.test.ts` asserting `TuiDaemonConnectionError` when `stream-data` payload has a missing/non-string `runId` or a missing/non-object `event`.

## Acceptance criteria

- [x] A `stream-data` payload missing `runId` or `event` (or with a non-string `runId`) throws `TuiDaemonConnectionError`, covered by new tests.
- [x] Existing JSON-parse-failure and stream-protocol-error tests stay green.

## Documentation updates

- None: internal validation narrowing with no operator-facing or v1-behavior change.
