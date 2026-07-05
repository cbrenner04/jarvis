# 00 - CLI operator session bootstrap

`v2/src/cli.ts`'s `main()` is the CLI's per-process entry point. No caller
today mints or supplies `operator_session_id`; `write-loop-input.ts` never
sets `WriteLoopInput.telemetry`, so the direct (non-daemon) `write` path always
runs with `telemetry` undefined.

## Decisions

- Mint with `crypto.randomUUID()` inline in `main()` — matches the existing pattern (`cli.ts` already uses it for `streamId`/`id`); no shared helper module for a single call site.
- Mint once per `main()` invocation, before dispatching any subcommand — rules out minting per-subcommand or lazily on first telemetry read, which would produce more than one id per process.
- Inject into `parsed.input.telemetry.operatorSessionId` only when the input doesn't already carry a `telemetry` block, preserving caller-supplied telemetry (e.g. tests) rather than overwriting it. Skip-if-present, not per-field override: the caller is same-process and trusted, so there's no impersonation risk to guard against (contrast [01](./01-daemon-operator-session.md), where the daemon's id always wins because it — not the requesting CLI client — is the operator-sitting boundary for daemon-managed runs).
- Scope to the direct `executeWriteLoop` call in the `write` command branch (`cli.ts:91`). The `daemon start`/IPC dispatch path is out of scope here — runs executed by the daemon get the daemon's own session id ([01](./01-daemon-operator-session.md)), not the CLI client's.

## Acceptance criteria

- [x] A `write` command invocation with no caller-supplied `telemetry` calls `executeWriteLoop` with `input.telemetry.operatorSessionId` set to a non-empty string minted by that `main()` call.
- [x] Two separate `main()` invocations of the `write` command produce two different `operatorSessionId` values.
- [x] A `write` command invocation whose parsed input already sets `telemetry.operatorSessionId` is left unchanged (CLI does not overwrite caller-supplied telemetry).
- [x] `cli.test.ts` existing tests stay green (behavior otherwise unchanged).

## Documentation updates

- `v2/docs/telemetry-capture.md`: under "Operator session", note the CLI bootstrap point is implemented (`v2/src/cli.ts` `main()`), not just planned.
