# Remove the parseOrThrow wrapper from tui-daemon-client

`tui-daemon-client.ts` wraps every daemon-wire parse result in `parseOrThrow`, throwing `TuiDaemonConnectionError` when the (now envelope-thin) parse returns `undefined`. IPC-frame-envelope failures (unexpected frame kind, non-correlated reply, connection loss) already throw `TuiDaemonConnectionError` independently in `tui-daemon-rpc-transport.ts`. Drop the wrapper; pass each daemon-wire parse result straight through as the method's declared return type.

## Decisions

- Each RPC method casts its daemon-wire parse result directly to its declared return type instead of gating it through a throw-if-falsy check — the transport already surfaces connection errors for malformed IPC replies, so the client-level gate duplicated that guarantee.
- Delete `tui-daemon-client.test.ts` tests "wait malformed success payload (missing runStatus) rejects as TuiDaemonConnectionError" and "steering malformed success payloads reject as TuiDaemonConnectionError" — both fabricate payload shapes the trusted same-build daemon cannot produce.
- Keep `tui-daemon-client.test.ts` tests "rejects malformed RPC replies with TuiDaemonConnectionError" and "rejects non-correlated RPC replies with TuiDaemonConnectionError" — these cover the transport-level IPC-frame envelope, unaffected by this change.

## Out of scope

- `daemon-wire.ts` parsing behavior itself.
- `tui-log-tail-client.ts`, `cli.ts`.

## Task checklist

- [ ] Remove the `parseOrThrow` function and all its call sites from `tui-daemon-client.ts`; each RPC method returns its daemon-wire parse result directly (cast to the declared return type).
- [ ] Delete the two malformed-payload test sections named above from `tui-daemon-client.test.ts`.

## Acceptance criteria

- [ ] `tui-daemon-client.ts` contains no `parseOrThrow` function or callers.
- [ ] `tui-daemon-client.test.ts` no longer contains the two deleted malformed-payload tests; the transport-level malformed-frame and non-correlated-frame tests stay green.
- [ ] `bun run typecheck` and the `v2` test suite pass.

## Documentation updates

- None: internal simplification with no operator-facing or v1-behavior change.
