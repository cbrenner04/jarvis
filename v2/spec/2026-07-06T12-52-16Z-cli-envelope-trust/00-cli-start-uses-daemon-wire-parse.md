# CLI start uses daemon-wire parse result directly (list/wait/log audited: already thin)

`v2/src/cli.ts`'s `run start` handler re-implements a runId field check
(`stringProperty(response.result, "runId")`) that duplicates
`parseStartResult` in `daemon-wire.ts`, which already performs the same
envelope-thin check. `run list` and `run wait` already call
`parseListRuns`/`parseWaitCompletion` directly with no extra field checks;
`run log`'s `parseStreamPayload` is already envelope-thin (string + JSON
parse only, no per-field checks). All three were audited and need no change;
`start` is the one command with a redundant re-check to remove.

## Decisions

- Import and use `parseStartResult` from `daemon-wire.ts` in the `run start`
  handler; drop the local `stringProperty` helper (becomes unused).
- `cli.test.ts`: delete the malformed-daemon-response test sections for
  `run list` ("run list rejects a malformed daemon list envelope") and
  `run wait` ("run wait prints invalid daemon response for malformed success
  payload") — they fabricate envelope shapes the trusted same-build daemon
  cannot actually produce. Keep transport-error and RPC-error-frame tests
  for every command untouched.
- No malformed-envelope test is added for `start` or `log`, consistent with
  the same reasoning.

## Out of scope

- `daemon-wire.ts`, `tui-daemon-client.ts`, `tui-log-tail-client.ts`.

## Acceptance criteria

- [x] `run start` builds its stdout `runId` line from `parseStartResult(response.result)` instead of a local field re-check.
- [x] `stringProperty` no longer exists in `v2/src/cli.ts`.
- [x] When `parseStartResult(response.result)` returns `undefined`, `run start` still prints `invalid daemon response` and exits 1 (existing error branch at `v2/src/cli.ts`'s `run start` handler, currently reached via the `runId === undefined` check, is preserved by the swap).
- [x] `cli.test.ts` has no test simulating a malformed `list` or `wait` daemon envelope; `bun test v2/src/cli.test.ts` passes.
- [x] `run start sends one IPC start request carrying write-loop input and prints run ID` (existing test) stays green.

## Documentation updates

- `v2/docs/v2-architecture.md` "## Interface & IPC": extend the "Client
  trusts daemon response shapes" bullet to note CLI command handlers consume
  `daemon-wire.ts` parse results directly, without their own per-field
  re-validation.
