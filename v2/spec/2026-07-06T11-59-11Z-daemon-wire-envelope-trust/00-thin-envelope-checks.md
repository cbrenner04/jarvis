# Thin envelope checks in daemon-wire.ts

`daemon-wire.ts` parse functions deep-validate fields that only ever come from
the daemon's own typed state (per-row `DaemonListRunRow` fields, workflow step
fields, `RunOperatorError`/`RunStatus`/write-loop-outcome enums on `wait`
payloads). The client already trusts the daemon process; re-validating those
fields is dead defense. Reduce each parser to an envelope check: result object
present, plus the minimal shape needed to route the value into its typed
result (e.g. `runs` is an array; `runStatus` is present).

## Decisions

- Client trusts daemon *response* shapes end-to-end; daemon-side request
  validation is untouched.
- `parseListRuns` drops per-row/per-step validation (`isDaemonListRunRow`,
  `isDaemonWorkflowSnapshot`, `isDaemonWorkflowStepSnapshot`, and their
  supporting guards); it becomes: object present, `runs` is an array, cast to
  `DaemonListRunRow[]`.
- `parseWaitCompletion` drops enum re-validation (`isRunStatus`,
  `isWriteLoopOutcomeKind`, `isRunOperatorError`) on the result payload; it
  becomes: object present, `runStatus` present, cast to
  `WaitRunCompletionResult`.
- `parseHealthResult`, `parseStatusResult`, `parseStartResult` are already
  envelope-thin; left as-is.
- Deferred to first consumer: whether any future wire method needs partial
  per-field validation (e.g. a value crossing a trust boundary other than
  daemon-to-client) — pin when that caller exists.

## Task checklist

- [ ] Rewrite `parseListRuns` and `parseWaitCompletion` in `daemon-wire.ts` as
      thin envelope checks; delete now-unused per-field guards and their
      enum-table constants.
- [ ] Shrink `daemon-wire.test.ts` to envelope-level cases (missing/malformed
      envelope, present/absent result key); delete per-field malformed-payload
      cases that are no longer reachable through the parser.
- [ ] Add a real-socket integration case to `daemon.sandbox-unrunnable.test.ts`:
      spawn the real daemon (`startDaemon`), `start` a run and `list` runs over
      the IPC socket, and assert `parseStartResult`/`parseListRuns` from
      `daemon-wire.ts` succeed against the genuine response frames.
- [ ] Record the trust decision under `## Interface & IPC` in
      `v2/docs/v2-architecture.md`: client trusts daemon response shapes,
      wire parsers are envelope-thin, future wire additions should not
      reintroduce per-field client-side validators.

## Documentation updates

- `v2/docs/v2-architecture.md` (`## Interface & IPC`): note the envelope-trust
  decision so future wire additions don't reintroduce per-field validators.
- `v2/docs/v1-behaviors.md`: not applicable — no v1 behavior exists for this
  v2-only daemon wire code.

## Acceptance criteria

- [ ] `parseListRuns` and `parseWaitCompletion` no longer call any per-field
      guard for `DaemonListRunRow`, workflow step shapes, `RunOperatorError`,
      `RunStatus`, or write-loop-outcome kind; malformed nested fields on an
      otherwise well-shaped envelope pass through unchanged (untestable by
      construction, per the removed cases in `daemon-wire.test.ts`).
- [ ] `daemon-wire.test.ts` contains only envelope-level cases (missing
      envelope, malformed envelope, present/absent result key) for
      `parseListRuns` and `parseWaitCompletion`.
- [ ] `daemon.sandbox-unrunnable.test.ts` has a real-socket case that starts a
      run and lists runs against a spawned daemon process and asserts the
      envelope-thin parse succeeds on genuine daemon output.
- [ ] `v2/docs/v2-architecture.md` `## Interface & IPC` documents the
      envelope-trust decision.
- [ ] `bun run typecheck` and `test:v2` + `test:integration:v2` pass.
