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
- `parseWaitCompletion` drops the entire conditional per-field result
  assembly, not just the enum guards (`isRunStatus`,
  `isWriteLoopOutcomeKind`, `isRunOperatorError`) — those enum checks and the
  primitive-shape checks on `iterationsConsumed`/`resumable` all go. Once the
  envelope is confirmed well-shaped with `runStatus` present, the whole result
  collapses into a single cast to `WaitRunCompletionResult`.
- `parseHealthResult`, `parseStatusResult`, `parseStartResult` are already
  envelope-thin; left as-is.
- Casting without runtime narrowing is safe here: client and daemon are the
  same build/version talking over a local Unix socket, no cross-version
  protocol skew is possible, so there's no realistic mismatch between the
  cast type and the actual payload.
- Only guards/constants defined locally in `daemon-wire.ts` are deleted
  (`isDaemonListRunRow`, `isDaemonWorkflowSnapshot`,
  `isDaemonWorkflowStepSnapshot`, `isDaemonWorkflowStepStatus`,
  `isDaemonWorkflowStoppedOutcome`, `isNonNegativeInteger`, and the
  workflow-step enum-table constants). Guards imported from other modules
  (`isRunStatus`, `isRunOperatorError`, `isWriteLoopOutcomeKind`) are used
  elsewhere and must not be deleted — only their call sites in
  `daemon-wire.ts` are removed.
- Deferred to first consumer: whether any future wire method needs partial
  per-field validation (e.g. a value crossing a trust boundary other than
  daemon-to-client) — pin when that caller exists.

## Task checklist

- [ ] Rewrite `parseListRuns` and `parseWaitCompletion` in `daemon-wire.ts` as
      thin envelope checks; delete now-unused local guards and enum-table
      constants (not guards imported from other modules — those keep their
      definitions, only their call sites here are removed).
- [ ] Shrink `daemon-wire.test.ts` to envelope-level cases (missing/malformed
      envelope, present/absent result key); delete per-field malformed-payload
      cases that are no longer reachable through the parser.
- [ ] Add a real-socket integration case to `daemon.sandbox-unrunnable.test.ts`:
      spawn the real daemon (`startDaemon`), seed a run row directly into its
      state store (no real `start` invocation, which would drive a genuine
      agent CLI), then `list` runs over the IPC socket and assert
      `parseListRuns` from `daemon-wire.ts` succeeds against the genuine
      response frame.
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

- [x] `parseListRuns` and `parseWaitCompletion` no longer call any per-field
      guard for `DaemonListRunRow`, workflow step shapes, `RunOperatorError`,
      `RunStatus`, or write-loop-outcome kind.
- [x] `daemon-wire.test.ts` contains only envelope-level cases (missing
      envelope, malformed envelope, present/absent result key) for
      `parseListRuns` and `parseWaitCompletion`; per-field malformed-payload
      cases are removed as untestable by construction.
- [x] `daemon.sandbox-unrunnable.test.ts` has a real-socket case that seeds a
      run into a spawned daemon's state store and lists runs over the IPC
      socket, asserting the envelope-thin `parseListRuns` succeeds on genuine
      daemon output.
- [x] `v2/docs/v2-architecture.md` `## Interface & IPC` documents the
      envelope-trust decision.
- [x] `bun run typecheck` and `test:v2` + `test:integration:v2` pass.
