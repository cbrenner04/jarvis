# Replace field-by-field PersistedRecord validation with an envelope check

`parsePersistedRecord` in `v2/src/tui/tui-log-tail-client.ts` validates `runId`, `seq`, `ts`, and `event.kind` on every `stream-data` frame. The payload is always a `PersistedRecord` the daemon itself persisted and serialized, so full field validation is dead weight — trust the shared `PersistedRecord` type past a thin envelope check.

## Decisions

- Envelope check: parsed JSON is an object with a `runId` string and an `event` object; nothing more.
- `tui-log-tail-client.test.ts`: delete sections that fabricate impossible `PersistedRecord` shapes (missing/wrong-typed `seq`, `ts`, `event.kind`); keep JSON-parse-failure and stream-protocol-error (unexpected frame, error `stream-end`, connection loss) cases.

## Out of scope

- `daemon-wire.ts`, `tui-daemon-client.ts`, `cli.ts`.

## Task checklist

- [ ] Narrow `parsePersistedRecord` to the envelope check (`runId` string, `event` object) and trust the rest via `PersistedRecord`.
- [ ] Remove test coverage asserting rejection of fabricated malformed `PersistedRecord` shapes beyond the envelope.

## Acceptance criteria

- [ ] A `stream-data` payload missing `runId` or `event` (or with a non-string `runId`) still throws `TuiDaemonConnectionError`.
- [ ] `tui-log-tail-client.test.ts` no longer asserts rejection of well-enveloped payloads with fabricated field-level defects (bad `seq`/`ts`/`event.kind`); JSON-parse-failure and stream-protocol-error tests stay green.

## Documentation updates

- None: internal validation narrowing with no operator-facing or v1-behavior change.
