---
name: tui-daemon-client-drop-parse-or-throw
---

# TUI daemon client stops re-validating already-thin-checked results

`tui-daemon-client.ts` wraps every RPC result in `parseOrThrow`, converting an already-checked `daemon-wire.ts` parse into a thrown `TuiDaemonConnectionError` only on the rare malformed case. With `daemon-wire.ts` parses reduced to envelope checks, remove the `parseOrThrow` wrapper layer and pass results through directly (still surfacing a connection error only for a genuinely absent/malformed envelope).

## Decisions

- `tui-daemon-client.test.ts`: delete the malformed-payload sections that fabricate impossible daemon responses; keep transport-failure and connection-error cases.

## Out of scope

- `daemon-wire.ts` parsing behavior itself.
- `tui-log-tail-client.ts`, `cli.ts`.

## Prerequisites

- `daemon-wire.ts` parse functions perform only envelope-level checks, not per-field validation, on daemon response payloads.
