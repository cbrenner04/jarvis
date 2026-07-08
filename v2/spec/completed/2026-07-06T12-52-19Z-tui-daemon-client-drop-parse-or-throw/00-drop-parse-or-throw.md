# Remove the parseOrThrow wrapper from tui-daemon-client, only where the wire parse is confirmed envelope-thin

`tui-daemon-client.ts` wraps every daemon-wire parse result in `parseOrThrow`, throwing `TuiDaemonConnectionError` when the parse returns `undefined`. In `daemon-wire.ts`, only `parseListRuns` and `parseWaitCompletion` are documented and implemented as envelope-thin (presence/shape only); `parseHealthResult`, `parseStatusResult`, and `parseStartResult` still perform per-field value/type checks (`ok === true`, `state === "running"`, `typeof runId === "string"`) and are unaffected by this change. Drop the wrapper only at the two confirmed-thin call sites — `list()` (`parseListRuns`) and `wait()` (`parseWaitCompletion`) — passing their results straight through as the method's declared return type. All other RPC methods (`health`, `status`, `start`, `pause`, `resume`, `kill` — the last three via `parseHealthResult`) keep their `parseOrThrow` gate.

## Decisions

- In scope: `list()` and `wait()`, backed by `parseListRuns` and `parseWaitCompletion` respectively — both confirmed envelope-thin in `daemon-wire.ts`. Their daemon-wire parse result is cast directly to the declared return type instead of gated through `parseOrThrow`.
- Out of scope (retain `parseOrThrow`): `health()`, `status()`, `start()`, `pause()`, `resume()`, `kill()` — backed by `parseHealthResult`/`parseStatusResult`/`parseStartResult`, which still validate field values. Thinning those parsers, if ever done, is separate future work.
- Delete `tui-daemon-client.test.ts` test "wait malformed success payload (missing runStatus) rejects as TuiDaemonConnectionError" — it fabricates a payload shape the trusted same-build daemon cannot produce, and `wait()` no longer gates on it.
- Keep `tui-daemon-client.test.ts` tests "rejects malformed RPC replies with TuiDaemonConnectionError" and "rejects non-correlated RPC replies with TuiDaemonConnectionError" (transport-level IPC-frame envelope, unaffected).
- Keep `tui-daemon-client.test.ts` test "steering malformed success payloads reject as TuiDaemonConnectionError" — it covers `pause`/`resume`/`kill`, which retain their `parseHealthResult` gate; this is still real, exercised behavior.

## Out of scope

- `daemon-wire.ts` parsing behavior itself, including thinning `parseHealthResult`/`parseStatusResult`/`parseStartResult`.
- `tui-log-tail-client.ts`, `cli.ts`.

## Task checklist

- [x] Remove `parseOrThrow` only at the `list()` and `wait()` call sites in `tui-daemon-client.ts`; each returns its daemon-wire parse result directly (cast to the declared return type). Leave `parseOrThrow` (and its call sites for `health`, `status`, `start`, `pause`, `resume`, `kill`) in place.
- [x] Delete the "wait malformed success payload (missing runStatus)" test from `tui-daemon-client.test.ts`. Do not delete the "steering malformed success payloads" test.

## Acceptance criteria

- [x] `list()` and `wait()` in `tui-daemon-client.ts` no longer route through `parseOrThrow`; `health()`, `status()`, `start()`, `pause()`, `resume()`, `kill()` still do.
- [x] `tui-daemon-client.test.ts` no longer contains the "wait malformed success payload (missing runStatus)" test; the "steering malformed success payloads reject as TuiDaemonConnectionError" test and the transport-level malformed/non-correlated-frame tests stay green.
- [x] `bun run typecheck` and the `v2` test suite pass.

## Documentation updates

- None: no validation is lost — the two narrowed call sites (`list`, `wait`) already had their parsers documented as envelope-thin, and every other RPC method's field-level check is unchanged.
