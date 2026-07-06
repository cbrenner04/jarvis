---
name: tui-log-tail-client-envelope-trust
---

# TUI log tail client trusts daemon-produced persisted records

`tui-log-tail-client.ts`'s `parsePersistedRecord` field-by-field validates `runId`/`seq`/`ts`/`event.kind` on every `stream-data` frame, even though the payload is always a `PersistedRecord` the daemon itself persisted and serialized. Replace the field-by-field validation with a thin envelope check (parsed JSON is an object with a `runId` string and an `event` object), and trust the rest of the `PersistedRecord` shape via the shared type.

## Decisions

- `tui-log-tail-client.test.ts`: delete the malformed-`PersistedRecord` sections that fabricate impossible daemon payloads; keep JSON-parse-failure and stream-protocol-error cases.

## Out of scope

- `daemon-wire.ts`, `tui-daemon-client.ts`, `cli.ts`.

## Prerequisites
