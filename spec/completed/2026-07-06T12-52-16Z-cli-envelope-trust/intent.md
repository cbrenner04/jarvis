---
name: cli-envelope-trust
---

# CLI stops re-validating already-thin-checked daemon response fields

`cli.ts` re-checks daemon response fields it already gets from `daemon-wire.ts` parses (e.g. `stringProperty(response.result, "runId")` for `start`, and its own `parseStreamPayload` field checks for `log`), duplicating validation that's now handled at the envelope level. Apply the same thin-envelope trust here: use the `daemon-wire.ts` parse results directly and drop the redundant field re-checks.

## Decisions

- `cli.test.ts`: delete the malformed-payload sections that fabricate impossible daemon responses for `start`, `list`, `wait`, and `log`; keep transport-error and RPC-error-frame cases.

## Out of scope

- `daemon-wire.ts`, `tui-daemon-client.ts`, `tui-log-tail-client.ts`.

## Prerequisites

- `daemon-wire.ts` parse functions perform only envelope-level checks, not per-field validation, on daemon response payloads.
